const { fail, MIXED_CHECKPOINT } = require("./grouped-store-settings.cjs");
const { recordId } = require("./uuid-fields.cjs");
const { cashCheckoutForContext } = require("./cash-checkout-route.cjs");
const { cashTrackingCoverage } = require("../db/sale-event-outbox.cjs");
const { refundForTrackingContext, refundTrackingCoverage } = require("./grouped-refund-native.cjs");

const TABLE = "dbo.pos_sync_grouped_stock_v1";
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const exact = (value, keys) => value != null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const int32 = value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
const sequence = value => typeof value === "string" && /^(0|[1-9]\d{0,18})$/.test(value) &&
  BigInt(value) <= 9223372036854775807n;
const stockError = (message, code) => Object.assign(fail(message, code), { table: "products" });
const protocol = () => stockError("The grouped stock row does not prove the canonical product revision.");
const pending = () => stockError("Local stock is still pending upload.", "ELOCAL_UPLOAD_PENDING");
const unverified = () => stockError("Local stock cannot prove the grouped stock boundary.", "ELOCAL_PENDING_UNVERIFIED");
const review = () => stockError("The saved stock revision differs from the authorized grouped balance.", "ESYNC_GROUPED_REVIEW_REQUIRED");
const catalogueLifecycle = `EXISTS (SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID(N'dbo.products_zero_stock_catalog_lifecycle')
      AND is_disabled=0) AND COALESCE((SELECT LOWER(COALESCE(JSON_VALUE(
        CASE WHEN ISJSON(integration_settings)=1 THEN integration_settings ELSE N'{}' END,'$.autoArchiveZeroStock'),
        N'true')) FROM dbo.pos_settings WHERE id=1),N'true')=N'true'`;
const stockLifecycleDeclaration = `DECLARE @autoArchiveStock bit=CASE WHEN ${catalogueLifecycle} THEN 1 ELSE 0 END;`;
function stockLifecycleAssignments(alias, total) {
  return `is_archived=CASE WHEN @autoArchiveStock=0 OR ${alias}.deleted_at IS NOT NULL THEN ${alias}.is_archived
        WHEN ${total}>0 THEN 0 ELSE 1 END,
      archived_at=CASE WHEN @autoArchiveStock=0 OR ${alias}.deleted_at IS NOT NULL THEN ${alias}.archived_at
        WHEN ${total}>0 THEN NULL ELSE COALESCE(${alias}.archived_at,SYSDATETIMEOFFSET()) END`;
}

function parseStockRow(row) {
  if (!exact(row, ["product_id", "branch_balance", "row_version"]) || typeof row.product_id !== "string" ||
      !UUID.test(row.product_id) || !int32(row.branch_balance) || !int32(row.row_version) || row.row_version < 1)
    throw protocol();
  return row;
}

function parseStockGroup(group) {
  if (!exact(group, ["seq", "operation_id", "changes"]) || group.operation_id !== null ||
      !Array.isArray(group.changes) || group.changes.length !== 1) throw protocol();
  if (!sequence(group.seq) || group.seq === "0") throw protocol();
  const [change] = group.changes;
  if (!exact(change, ["table_name", "entity_id", "row_version", "tombstone", "row_data"]) ||
      change.table_name !== "products_stock" || change.tombstone !== false) throw protocol();
  const row = parseStockRow(change.row_data);
  let entity;
  try { entity = JSON.parse(change.entity_id); }
  catch { throw protocol(); }
  if (!exact(entity, ["id"]) || entity.id !== row.product_id || change.row_version !== String(row.row_version))
    throw protocol();
  return row;
}

async function readStockProof(transaction, branch, rows) {
  const result = await transaction.request().input("branch", branch).input("rows", JSON.stringify(rows)).query(`
    DECLARE @baseline bigint=(SELECT change_tracking_version FROM dbo.sync_checkpoints WITH(HOLDLOCK)
      WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=N'products' AND direction=N'push');
    DECLARE @minimum bigint=CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.products'));
    IF @baseline IS NULL OR @minimum IS NULL OR @baseline<@minimum OR @baseline>CHANGE_TRACKING_CURRENT_VERSION()
    BEGIN SELECT N'unverified' AS state; RETURN; END;
    DECLARE @locked TABLE(id uniqueidentifier PRIMARY KEY,buckets nvarchar(max),total int,version int,owner nvarchar(128));
    INSERT @locked
    SELECT wanted.product_id,product.stock_by_store,product.stock_quantity,product.row_version,product.owner_store_id
    FROM OPENJSON(@rows) WITH (product_id uniqueidentifier) AS wanted
    LEFT JOIN dbo.products AS product WITH(UPDLOCK,HOLDLOCK) ON product.id=wanted.product_id;
    IF EXISTS(SELECT 1 FROM @locked WHERE owner IS NULL OR owner COLLATE Latin1_General_100_BIN2<>@branch COLLATE Latin1_General_100_BIN2)
    BEGIN SELECT N'parent' AS state; RETURN; END;
    DECLARE @valid bit=CASE WHEN EXISTS(SELECT 1 FROM @locked WHERE ISJSON(buckets,OBJECT)<>1 OR buckets IS NULL
        OR total IS NULL OR version IS NULL OR version<1)
      OR EXISTS(SELECT 1 FROM @locked AS saved CROSS APPLY OPENJSON(CASE WHEN ISJSON(saved.buckets,OBJECT)=1 THEN saved.buckets ELSE N'{}' END) AS bucket
        WHERE bucket.[type]<>2 OR TRY_CONVERT(int,bucket.value) IS NULL)
      OR EXISTS(SELECT 1 FROM @locked AS saved CROSS APPLY OPENJSON(CASE WHEN ISJSON(saved.buckets,OBJECT)=1 THEN saved.buckets ELSE N'{}' END) AS bucket
        GROUP BY saved.id,bucket.[key] COLLATE Latin1_General_100_BIN2 HAVING COUNT_BIG(*)<>1)
      OR EXISTS(SELECT 1 FROM @locked AS saved CROSS APPLY
        (SELECT COALESCE(SUM(CONVERT(bigint,TRY_CONVERT(int,value))),0) AS total
          FROM OPENJSON(CASE WHEN ISJSON(saved.buckets,OBJECT)=1 THEN saved.buckets ELSE N'{}' END)) AS sums
        WHERE saved.total<>sums.total) THEN 0 ELSE 1 END;
    DECLARE @proof TABLE(id uniqueidentifier PRIMARY KEY,branch_balance int,prior_version int,
      change_context varbinary(128),change_operation char(1));
    INSERT @proof
    SELECT saved.id,COALESCE(bucket.balance,0),saved.version,ct.SYS_CHANGE_CONTEXT,ct.SYS_CHANGE_OPERATION
    FROM @locked AS saved LEFT JOIN CHANGETABLE(CHANGES dbo.products,@baseline) AS ct ON saved.id=ct.id
    OUTER APPLY (SELECT TOP (1) TRY_CONVERT(int,value) AS balance
      FROM OPENJSON(CASE WHEN @valid=1 THEN saved.buckets ELSE N'{}' END)
      WHERE [key] COLLATE Latin1_General_100_BIN2=@branch COLLATE Latin1_General_100_BIN2) AS bucket;
    SET @minimum=CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.products'));
    IF @minimum IS NULL OR @baseline<@minimum BEGIN SELECT N'unverified' AS state; RETURN; END;
    SELECT N'ok' AS state,@valid AS valid;
    SELECT * FROM @proof;`);
  const state = result.recordsets?.[0]?.[0]?.state;
  if (state === "parent") throw stockError("A grouped stock product is missing or belongs to another branch.", "ESYNC_CASH_RECEIPT_DEPENDENCY");
  if (state !== "ok" || result.recordsets?.[1]?.length !== rows.length) throw unverified();
  return { local: new Map(result.recordsets[1].map(row => [recordId(row.id), row])),
    valid: result.recordsets[0][0].valid === true || result.recordsets[0][0].valid === 1 };
}

async function readScopedProof(transaction, branch, rows) {
  const result = await transaction.request().input("branch", branch).input("rows", JSON.stringify(rows)).query(`
    SELECT saved.product_id,saved.feed_epoch,saved.product_version,saved.branch_balance,
      CONVERT(varchar(20),saved.own_accepted_seq) AS own_accepted_seq
    FROM OPENJSON(@rows) WITH (product_id uniqueidentifier) AS wanted
    JOIN ${TABLE} AS saved WITH(UPDLOCK,HOLDLOCK)
      ON saved.branch_id=@branch AND saved.product_id=wanted.product_id;`);
  return new Map((result.recordset ?? []).map(row => [recordId(row.product_id), row]));
}

async function noteLocalStockAcceptance(transaction, branch, epoch, seq, productIds) {
  if (typeof epoch !== "string" || !UUID.test(epoch) || !sequence(seq) || seq === "0" ||
      !Array.isArray(productIds) || !productIds.length || productIds.length > 100 ||
      productIds.some(id => typeof id !== "string" || !UUID.test(id))) throw protocol();
  const result = await transaction.request().input("branch", branch).input("epoch", epoch)
    .input("seq", seq).input("ids", JSON.stringify([...new Set(productIds)])).query(`
    DECLARE @products TABLE(product_id uniqueidentifier PRIMARY KEY);
    INSERT @products SELECT CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@ids);
    IF EXISTS (SELECT 1 FROM ${TABLE} AS saved WITH(UPDLOCK,HOLDLOCK)
      JOIN @products AS wanted ON wanted.product_id=saved.product_id
      WHERE saved.branch_id=@branch AND saved.feed_epoch<>CONVERT(uniqueidentifier,@epoch))
    BEGIN SELECT N'epoch' AS state; RETURN; END;
    MERGE ${TABLE} WITH(HOLDLOCK) AS saved USING @products AS wanted
      ON saved.branch_id=@branch AND saved.product_id=wanted.product_id
      WHEN MATCHED AND (saved.own_accepted_seq IS NULL OR saved.own_accepted_seq<CONVERT(bigint,@seq))
        THEN UPDATE SET own_accepted_seq=CONVERT(bigint,@seq)
      WHEN NOT MATCHED THEN INSERT(branch_id,product_id,feed_epoch,own_accepted_seq)
        VALUES(@branch,wanted.product_id,CONVERT(uniqueidentifier,@epoch),CONVERT(bigint,@seq));
    SELECT N'ok' AS state;`);
  if (result.recordset?.[0]?.state !== "ok") throw review();
}

async function writeStock(transaction, branch, rows, epoch) {
  if (!rows.length) return 0;
  const result = await transaction.request().input("branch", branch).input("path", "$." + JSON.stringify(branch))
    .input("payload", JSON.stringify(rows)).input("epoch", epoch ?? null).query(`
    DECLARE @rows TABLE(product_id uniqueidentifier PRIMARY KEY,branch_balance int NOT NULL,row_version int NOT NULL);
    INSERT @rows SELECT product_id,branch_balance,row_version
    FROM OPENJSON(@payload) WITH (product_id uniqueidentifier,branch_balance int,row_version int);
    DECLARE @next TABLE(product_id uniqueidentifier PRIMARY KEY,buckets nvarchar(max) NOT NULL,total bigint NOT NULL,changed bit NOT NULL);
    INSERT @next
    SELECT product.id,JSON_MODIFY(product.stock_by_store,@path,wanted.branch_balance),
      CONVERT(bigint,product.stock_quantity)-COALESCE(bucket.balance,0)+wanted.branch_balance,
      CASE WHEN COALESCE(bucket.balance,0)<>wanted.branch_balance THEN 1 ELSE 0 END
    FROM dbo.products AS product JOIN @rows AS wanted ON wanted.product_id=product.id
    OUTER APPLY (SELECT CONVERT(int,value) AS balance FROM OPENJSON(product.stock_by_store)
      WHERE [key] COLLATE Latin1_General_100_BIN2=@branch COLLATE Latin1_General_100_BIN2) AS bucket;
    IF (SELECT COUNT(*) FROM @next)<>(SELECT COUNT(*) FROM @rows)
       OR EXISTS(SELECT 1 FROM @next WHERE total NOT BETWEEN -2147483648 AND 2147483647)
    BEGIN SELECT N'unverified' AS state; RETURN; END;
    ${stockLifecycleDeclaration}
    -- Make the same catalogue transition in this tagged write. A nested
    -- catalogue trigger UPDATE has no sync context and would echo the stock.
    WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
    UPDATE product SET stock_by_store=prepared.buckets,stock_quantity=CONVERT(int,prepared.total),
      ${stockLifecycleAssignments("product", "prepared.total")}
    FROM dbo.products AS product JOIN @next AS prepared ON prepared.product_id=product.id WHERE prepared.changed=1;
    DECLARE @changed int=@@ROWCOUNT;
    ${epoch ? `MERGE ${TABLE} WITH(HOLDLOCK) AS saved USING @rows AS wanted
      ON saved.branch_id=@branch AND saved.product_id=wanted.product_id
      WHEN MATCHED AND (saved.product_version IS NULL OR saved.product_version<wanted.row_version) THEN UPDATE
        SET product_version=wanted.row_version,branch_balance=wanted.branch_balance
      WHEN NOT MATCHED THEN INSERT(branch_id,product_id,feed_epoch,product_version,branch_balance)
        VALUES(@branch,wanted.product_id,TRY_CONVERT(uniqueidentifier,@epoch),wanted.row_version,wanted.branch_balance);` : ""}
    SELECT N'applied' AS state,@changed AS changed;`);
  if (result.recordset?.[0]?.state !== "applied") throw unverified();
  return result.recordset[0].changed;
}

async function applyGroupedStock(worker, transaction, branch, values, { epoch, seq, recovery = false } = {}) {
  if (!Array.isArray(values) || values.length > 100 ||
      (epoch !== undefined && (typeof epoch !== "string" || !UUID.test(epoch) || !sequence(seq)))) throw protocol();
  if (!values.length) return 0;
  const rows = values.map(parseStockRow);
  if (new Set(rows.map(row => row.product_id)).size !== rows.length) throw protocol();
  const products = worker.registry.tables.find(table => table.cloudTable === "products" && table.sqlServerTable === "products");
  if (!products) throw unverified();
  const journal = await worker.reader.unacknowledged(products, rows.map(row => JSON.stringify({ id: row.product_id })),
    transaction, { branchId: branch });
  if (journal.size) throw pending();
  const { local, valid } = await readStockProof(transaction, branch, rows);
  const tagged = [], refunds = [];
  for (const [id, row] of local) {
    if (!row.change_operation || row.change_context?.equals(Buffer.from("CLOUD"))) continue;
    const cashCheckoutId = epoch ? cashCheckoutForContext(row.change_context) : null;
    const refundId = epoch ? refundForTrackingContext(row.change_context) : null;
    const change = { key: { id }, operation: row.change_operation };
    if (cashCheckoutId) tagged.push({ ...change, cashCheckoutId });
    else if (refundId) refunds.push({ ...change, refundId });
    else throw pending();
  }
  let accepted = new Map();
  if (tagged.length || refunds.length) {
    try {
      const options = { transaction, epoch, withReceipts: true };
      const cash = await cashTrackingCoverage(worker.connectionManager, branch, "products", tagged, options);
      const returned = await refundTrackingCoverage(worker.connectionManager, branch, "products", refunds, options);
      accepted = new Map([...cash, ...returned]);
    } catch (error) {
      if (error?.code === "ESYNC_CASH_ROUTE_HELD") throw pending();
      throw error;
    }
  }
  if (!valid) throw unverified();
  const saved = epoch ? await readScopedProof(transaction, branch, rows) : new Map();
  const due = [];
  for (const row of rows) {
    const current = local.get(row.product_id);
    if (!current) throw unverified();
    const prior = saved.get(row.product_id);
    if (prior && recordId(prior.feed_epoch) !== epoch) throw review();
    const receipt = accepted.get(row.product_id);
    const acceptedSequences = [prior?.own_accepted_seq, receipt?.seq].filter(Boolean);
    if (acceptedSequences.some(acceptedSeq => BigInt(acceptedSeq) > BigInt(seq))) {
      if (recovery) throw review();
      // A newer accepted local checkout already owns this current balance.
      // Its exact grouped receipt will reconcile the product in order.
      continue;
    }
    if (prior?.product_version != null && prior.product_version >= row.row_version) {
      if (prior.branch_balance !== current.branch_balance ||
          (prior.product_version === row.row_version && prior.branch_balance !== row.branch_balance) ||
          (recovery && prior.branch_balance !== row.branch_balance)) throw review();
      continue;
    }
    if ((!epoch || (recovery && prior?.product_version == null && !acceptedSequences.length)) &&
        current.prior_version > row.row_version && current.branch_balance !== row.branch_balance) throw review();
    due.push(row);
  }
  return writeStock(transaction, branch, due, epoch);
}

function legacyProductId(change) {
  if (change.row_data?.id) return recordId(change.row_data.id);
  try { return recordId(JSON.parse(change.entity_id).id); }
  catch { return recordId(change.entity_id); }
}

async function legacyStockOwnership(transaction, batch) {
  const edits = (batch.rows ?? []).filter(change => Object.hasOwn(change.row_data ?? {}, "owner_store_id"));
  const removals = batch.tombstones ?? [];
  if (!edits.length && !removals.length) return new Set();
  const markers = await transaction.request().input("entity", MIXED_CHECKPOINT).query(`
    SELECT branch_id FROM dbo.sync_checkpoints WITH(UPDLOCK,HOLDLOCK)
    WHERE organization_id=N'default' AND entity_type=@entity AND direction=N'pull';`);
  const owned = new Set();
  const { isExtendedMixedFence } = require("./grouped-settings-handoff.cjs");
  for (const branch of (markers.recordset ?? []).map(row => row.branch_id).sort()) {
    if (await isExtendedMixedFence(transaction, branch)) owned.add(branch);
  }
  if (!owned.size) return owned;
  const ids = [...new Set([...edits, ...removals].map(legacyProductId).filter(id => typeof id === "string" && UUID.test(id)))];
  if (!ids.length) return owned;
  // The prior owner is locked after the durable fence, matching grouped
  // apply. A legacy delete/reassignment cannot remove a parent first.
  const previous = await transaction.request().input("ids", JSON.stringify(ids)).query(`
    SELECT product.id,product.owner_store_id
    FROM OPENJSON(@ids) AS wanted JOIN dbo.products AS product WITH(UPDLOCK,HOLDLOCK)
      ON product.id=TRY_CONVERT(uniqueidentifier,wanted.value);`);
  const previousOwners = new Map((previous.recordset ?? []).map(row => [recordId(row.id), recordId(row.owner_store_id)]));
  if (removals.some(change => owned.has(previousOwners.get(legacyProductId(change)))) ||
      edits.some(change => {
        const prior = previousOwners.get(legacyProductId(change));
        return owned.has(prior) && prior !== recordId(change.row_data.owner_store_id);
      })) throw stockError("The grouped stock handoff must finish before this product can move or be removed.",
    "ESYNC_GROUPED_STOCK_PARENT_FENCED");
  return owned;
}

async function legacyOwnedStockRow(transaction, row, owned) {
  const branch = recordId(row.owner_store_id);
  if (!owned.has(branch) || (!Object.hasOwn(row, "stock_quantity") && !Object.hasOwn(row, "stock_by_store"))) return row;
  if (typeof row.id !== "string" || !UUID.test(recordId(row.id))) throw protocol();
  let buckets = row.stock_by_store;
  if (typeof buckets === "string") {
    try { buckets = JSON.parse(buckets); } catch { throw protocol(); }
  }
  if (!buckets || typeof buckets !== "object" || Array.isArray(buckets) ||
      !Object.values(buckets).every(int32) || !int32(row.stock_quantity)) throw protocol();
  const result = await transaction.request().input("id", row.id).input("branch", branch).query(`
    DECLARE @auto bit=CASE WHEN ${catalogueLifecycle} THEN 1 ELSE 0 END;
    SELECT bucket.[type],TRY_CONVERT(int,bucket.value) AS balance,
      @auto AS auto_archive,product.deleted_at,
      CONVERT(nvarchar(40),COALESCE(product.archived_at,SYSDATETIMEOFFSET()),127) AS archive_at
    FROM (VALUES(1)) AS anchor(id)
    LEFT JOIN dbo.products AS product WITH(UPDLOCK,HOLDLOCK) ON product.id=@id
    OUTER APPLY (SELECT [type],value FROM OPENJSON(product.stock_by_store)
      WHERE [key] COLLATE Latin1_General_100_BIN2=@branch COLLATE Latin1_General_100_BIN2) AS bucket;`);
  const local = result.recordset ?? [];
  if (local.length > 1 || (local[0]?.type != null && (local[0].type !== 2 || !int32(local[0].balance))))
    throw unverified();
  const balance = local[0]?.balance ?? 0;
  const next = { ...buckets, [branch]: balance };
  const total = Object.values(next).reduce((sum, count) => sum + count, 0);
  if (!int32(total)) throw protocol();
  const incoming = { ...row, stock_by_store: next, stock_quantity: total };
  if (local[0]?.auto_archive && (Object.hasOwn(row, "deleted_at") ? row.deleted_at : local[0].deleted_at) == null) {
    incoming.is_archived = total <= 0;
    incoming.archived_at = total > 0 ? null : row.archived_at ?? local[0].archive_at;
  }
  return incoming;
}

module.exports = { parseStockRow, parseStockGroup, applyGroupedStock, noteLocalStockAcceptance, legacyStockOwnership, legacyOwnedStockRow,
  stockLifecycleDeclaration, stockLifecycleAssignments };
