const { createHash, randomUUID } = require("node:crypto");
const grouped = require("./grouped-store-settings.cjs");

const RECOVERY = "paged_stock_v1";
const PAGE_LIMIT = 25;
const MAX_PAGE_BYTES = 768 * 1024 + 2048;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const PAGE_TABLE = "dbo.pos_sync_cash_settings_recovery_pages_v1";
const fail = (message, code = "ESYNC_GROUPED_PROTOCOL") => grouped.fail(message, code);
const exact = (row, keys) => !!row && !Array.isArray(row) && typeof row === "object" &&
  Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key));
const hash = value => createHash("sha256").update(value, "utf8").digest("hex");
const isInt32 = value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;

function ordinal(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,18})$/.test(value) || BigInt(value) > 9223372036854775807n)
    throw fail("The paged recovery position is invalid.");
  return BigInt(value);
}

function decode(text, digest, bytes) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > bytes ||
      typeof digest !== "string" || !HASH.test(digest) || hash(text) !== digest)
    throw fail("The paged recovery payload checksum is invalid.");
  try { return JSON.parse(text); }
  catch { throw fail("The paged recovery payload is malformed."); }
}

function snapshotFor(response, branch, table) {
  if (!exact(response, ["status", "scope_id", "epoch", "seq", "pin_id", "expires_at", "manifest_json", "manifest_sha256"]) ||
      response.status !== "OK" || response.scope_id !== branch || !UUID.test(response.pin_id ?? "") ||
      !UUID.test(response.epoch ?? ""))
    throw fail("The paged recovery manifest does not match the registered scope.");
  const manifest = decode(response.manifest_json, response.manifest_sha256, 65536);
  if (!exact(manifest, ["scope_id", "epoch", "seq", "changes", "cash_count", "stock_count"]) ||
      manifest.scope_id !== branch || manifest.epoch !== response.epoch || manifest.seq !== response.seq ||
      ordinal(manifest.cash_count) > ordinal(manifest.seq))
    throw fail("The paged recovery manifest does not prove complete coverage.");
  ordinal(manifest.stock_count);
  const { cash_count, stock_count, ...settingsManifest } = manifest;
  const settingsJson = JSON.stringify(settingsManifest);
  const settings = grouped.settingsFromSnapshot({ ...response, manifest_json: settingsJson,
    manifest_sha256: hash(settingsJson) }, branch, table);
  return { ...settings, branch, pinId: response.pin_id, expiresAt: response.expires_at,
    totals: { cash: cash_count, stock: stock_count } };
}

function assertSnapshotLive(snapshot) {
  if (snapshot.expires <= Date.now()) throw fail("The paged recovery pin expired.");
}

function pageFor(page, kind, after, snapshot) {
  if (!exact(page, ["scope_id", "epoch", "seq", "pin_id", "kind", "after", "next", "total", "rows"]) ||
      page.scope_id !== snapshot.branch || page.epoch !== snapshot.epoch || page.seq !== snapshot.seq ||
      page.pin_id !== snapshot.pinId || page.kind !== kind || page.after !== after ||
      page.total !== snapshot.totals[kind] || !Array.isArray(page.rows) || page.rows.length > PAGE_LIMIT ||
      !page.rows.length || ordinal(page.next) !== ordinal(after) + BigInt(page.rows.length) ||
      ordinal(page.next) > ordinal(page.total))
    throw fail("The recovery page does not prove its contiguous scoped coverage.");
  return page;
}

function checkRows(page, snapshot, parseCash, previous) {
  return page.rows.map(row => {
    if (page.kind === "cash") {
      const seq = ordinal(row?.seq);
      if (seq <= previous.cash || seq > ordinal(snapshot.seq))
        throw fail("The recovery archive contains a repeated or out-of-order cash group.");
      previous.cash = seq;
      return parseCash(row, snapshot.epoch);
    }
    if (!exact(row, ["product_id", "branch_balance", "row_version"]) || !UUID.test(row.product_id ?? "") ||
        !isInt32(row.branch_balance) || !isInt32(row.row_version) || row.row_version < 1 ||
        row.product_id <= previous.stock)
      throw fail("The recovery archive contains invalid or repeated branch stock.");
    previous.stock = row.product_id;
    return row;
  });
}

// Pages stay on the scoped SQL Server, rather than accumulating in process or
// leaving receipt data in an OS temporary file. Network reads never hold local
// business locks. Activation revalidates all staged pages in one transaction.
async function stagePagedRecovery(cloud, context, assertCurrent) {
  const { source, branch, table, parseCash } = context;
  assertCurrent();
  const snapshot = snapshotFor(await cloud.beginGroupedRecovery(source), branch, table);
  const runId = randomUUID();
  const clear = () => source.pool.request().input("run", runId).query(`DELETE FROM ${PAGE_TABLE} WHERE run_id=@run;`);
  try {
    assertCurrent();
    await source.pool.request().query(`DELETE FROM ${PAGE_TABLE} WHERE expires_at<=SYSUTCDATETIME();`);
    const previous = { cash: 0n, stock: "" };
    for (const kind of ["cash", "stock"]) {
      let after = "0";
      while (after !== snapshot.totals[kind]) {
        assertCurrent();
        assertSnapshotLive(snapshot);
        const response = await cloud.pageGroupedRecovery(source, { pinId: snapshot.pinId, kind, after, limit: PAGE_LIMIT });
        assertCurrent();
        if (!exact(response, ["status", "scope_id", "epoch", "seq", "pin_id", "expires_at", "payload_json", "payload_sha256"]) ||
            response.status !== "OK" || response.scope_id !== branch || response.epoch !== snapshot.epoch ||
            response.seq !== snapshot.seq || response.pin_id !== snapshot.pinId || response.expires_at !== snapshot.expiresAt)
          throw fail("The recovery page came from a different or expired pin.");
        const page = pageFor(decode(response.payload_json, response.payload_sha256, MAX_PAGE_BYTES), kind, after, snapshot);
        checkRows(page, snapshot, parseCash, previous);
        await source.pool.request().input("run", runId).input("kind", kind).input("after", after)
          .input("expires", new Date(snapshot.expires)).input("payload", response.payload_json).input("hash", response.payload_sha256)
          .query(`INSERT ${PAGE_TABLE} (run_id,kind,after_ordinal,expires_at,payload_json,payload_sha256)
            VALUES (@run,@kind,CONVERT(bigint,@after),@expires,@payload,@hash);`);
        after = page.next;
      }
    }
    assertSnapshotLive(snapshot);
    return { ...snapshot, runId, clear };
  } catch (error) {
    await clear().catch(() => {});
    throw error;
  }
}

async function verifyCoverage(transaction, snapshot) {
  const result = await transaction.request().input("run", snapshot.runId).query(`
    WITH cash AS (
      SELECT row.operation_id,row.changes
      FROM ${PAGE_TABLE} p CROSS APPLY OPENJSON(p.payload_json,'$.rows')
      WITH (operation_id uniqueidentifier '$.operation_id',changes nvarchar(max) '$.changes' AS JSON) AS row
      WHERE p.run_id=@run AND p.kind='cash'
    ), stock AS (
      SELECT row.product_id FROM ${PAGE_TABLE} p CROSS APPLY OPENJSON(p.payload_json,'$.rows')
      WITH (product_id uniqueidentifier '$.product_id') AS row
      WHERE p.run_id=@run AND p.kind='stock'
    )
    SELECT CONVERT(varchar(20),(SELECT COUNT_BIG(*) FROM cash)) AS cash_count,
      CONVERT(varchar(20),(SELECT COUNT_BIG(*) FROM stock)) AS stock_count,
      CASE WHEN EXISTS(SELECT 1 FROM cash GROUP BY operation_id HAVING COUNT_BIG(*)<>1)
        OR EXISTS(SELECT 1 FROM stock GROUP BY product_id HAVING COUNT_BIG(*)<>1)
        OR EXISTS(SELECT 1 FROM cash WHERE NOT EXISTS(SELECT 1 FROM stock
          WHERE stock.product_id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(cash.changes,'$[1].row_data.product_id'))))
        OR EXISTS(SELECT 1 FROM cash CROSS APPLY OPENJSON(cash.changes)
          WITH (table_name varchar(50) '$.table_name', entity_id uniqueidentifier '$.row_data.id') AS entity
          GROUP BY entity.table_name,entity.entity_id HAVING COUNT_BIG(*)<>1)
        THEN 0 ELSE 1 END AS complete;`);
  const row = result.recordset?.[0];
  if (row?.cash_count !== snapshot.totals.cash || row.stock_count !== snapshot.totals.stock || row.complete !== 1)
    throw fail("The staged recovery pages do not cover all receipt and stock identities.");
}

async function applyStockPage(worker, transaction, branch, rows) {
  const products = worker.registry.tables.find(table => table.cloudTable === "products" && table.sqlServerTable === "products");
  if (!products) throw fail("The registered products table is unavailable for stock recovery.");
  const pending = await worker.reader.unacknowledged(products, rows.map(row => JSON.stringify({ id: row.product_id })),
    transaction, { branchId: branch });
  if (pending.size) throw fail("Local stock is still pending upload.", "ELOCAL_UPLOAD_PENDING");
  // Ownership and Change Tracking checks are repeated with product locks held.
  // Reconstruct only the registered branch bucket, keeping local foreign
  // buckets and product metadata. A missing parent or malformed map blocks
  // the whole recovery, as does a retention cleanup during the CT read.
  const path = "$." + JSON.stringify(branch);
  const result = await transaction.request().input("branch", branch).input("path", path)
    .input("desired", JSON.stringify(rows)).query(`
    DECLARE @baseline bigint=(SELECT change_tracking_version FROM dbo.sync_checkpoints WITH(HOLDLOCK)
      WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=N'products' AND direction=N'push');
    DECLARE @minimum bigint=CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.products'));
    IF @baseline IS NULL OR @minimum IS NULL OR @baseline<@minimum OR @baseline>CHANGE_TRACKING_CURRENT_VERSION()
    BEGIN SELECT N'unverified' AS state; RETURN; END;
    DECLARE @rows TABLE(id uniqueidentifier PRIMARY KEY,balance int NOT NULL,pin_version int NOT NULL,
      prior_stock nvarchar(max),prior_total int,prior_version int,owner_store_id nvarchar(128));
    INSERT @rows
    SELECT desired.product_id,desired.branch_balance,desired.row_version,product.stock_by_store,
      product.stock_quantity,product.row_version,product.owner_store_id
    FROM OPENJSON(@desired) WITH (product_id uniqueidentifier,branch_balance int,row_version int) AS desired
    LEFT JOIN dbo.products AS product WITH(UPDLOCK,HOLDLOCK) ON product.id=desired.product_id;
    IF EXISTS(SELECT 1 FROM @rows WHERE owner_store_id IS NULL OR
       owner_store_id COLLATE Latin1_General_100_BIN2<>@branch COLLATE Latin1_General_100_BIN2)
    BEGIN SELECT N'parent' AS state; RETURN; END;
    DECLARE @pending bit=CASE WHEN EXISTS(SELECT 1 FROM CHANGETABLE(CHANGES dbo.products,@baseline) AS ct
      JOIN @rows wanted ON wanted.id=ct.id
      WHERE ct.SYS_CHANGE_CONTEXT IS NULL OR ct.SYS_CHANGE_CONTEXT<>0x434C4F5544) THEN 1 ELSE 0 END;
    SET @minimum=CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.products'));
    IF @minimum IS NULL OR @baseline<@minimum BEGIN SELECT N'unverified' AS state; RETURN; END;
    IF @pending=1 BEGIN SELECT N'pending' AS state; RETURN; END;
    IF EXISTS(SELECT 1 FROM @rows WHERE ISJSON(prior_stock,OBJECT)<>1 OR prior_stock IS NULL OR prior_total IS NULL
      OR prior_version IS NULL OR prior_version<1)
      OR EXISTS(SELECT 1 FROM @rows AS saved CROSS APPLY OPENJSON(saved.prior_stock) AS bucket
        WHERE bucket.[type]<>2 OR TRY_CONVERT(int,bucket.value) IS NULL)
      OR EXISTS(SELECT 1 FROM @rows AS saved CROSS APPLY OPENJSON(saved.prior_stock) AS bucket
        GROUP BY saved.id,bucket.[key] COLLATE Latin1_General_100_BIN2 HAVING COUNT_BIG(*)<>1)
    BEGIN SELECT N'unverified' AS state; RETURN; END;
    -- The cloud products trigger increments row_version on every update.
    -- A newer local revision with a different balance needs a newer pin.
    IF EXISTS(SELECT 1 FROM @rows WHERE prior_version>pin_version
      AND COALESCE(TRY_CONVERT(int,JSON_VALUE(prior_stock,@path)),0)<>balance)
    BEGIN SELECT N'newer' AS state; RETURN; END;
    DECLARE @next TABLE(id uniqueidentifier PRIMARY KEY,stock nvarchar(max) NOT NULL,
      total bigint NOT NULL,prior_sum bigint NOT NULL,prior_total int NOT NULL,changed bit NOT NULL);
    INSERT @next
    SELECT saved.id,JSON_MODIFY(saved.prior_stock,@path,saved.balance),
      sums.total-COALESCE(TRY_CONVERT(int,JSON_VALUE(saved.prior_stock,@path)),0)+saved.balance,
      sums.total,saved.prior_total,
      CASE WHEN COALESCE(TRY_CONVERT(int,JSON_VALUE(saved.prior_stock,@path)),0)<>saved.balance THEN 1 ELSE 0 END
    FROM @rows AS saved CROSS APPLY
      (SELECT COALESCE(SUM(CONVERT(bigint,value)),0) AS total FROM OPENJSON(saved.prior_stock)) AS sums;
    IF EXISTS(SELECT 1 FROM @next WHERE prior_total<>prior_sum OR total NOT BETWEEN -2147483648 AND 2147483647)
    BEGIN SELECT N'unverified' AS state; RETURN; END;
    WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
    UPDATE product SET stock_by_store=prepared.stock,stock_quantity=CONVERT(int,prepared.total)
    FROM dbo.products AS product JOIN @next AS prepared ON prepared.id=product.id WHERE prepared.changed=1;
    SELECT N'applied' AS state,@@ROWCOUNT AS changed;`);
  const state = result.recordset?.[0];
  if (state?.state === "pending") throw fail("Local stock is still pending upload.", "ELOCAL_UPLOAD_PENDING");
  if (state?.state === "parent") throw fail("A recovery stock product is missing or belongs to another branch.", "ESYNC_CASH_RECEIPT_DEPENDENCY");
  if (state?.state === "newer")
    throw fail("A newer local stock balance requires a fresh recovery pin.", "ESYNC_GROUPED_REVIEW_REQUIRED");
  if (state?.state !== "applied")
    throw fail("Local stock cannot prove the recovery boundary.", "ELOCAL_PENDING_UNVERIFIED");
  return state.changed;
}

async function applyPagedRecovery(worker, transaction, context, snapshot, applyCash, assertCurrent) {
  await verifyCoverage(transaction, snapshot);
  const previous = { cash: 0n, stock: "" };
  let stockChanged = 0;
  for (const kind of ["cash", "stock"]) {
    let after = "0";
    while (after !== snapshot.totals[kind]) {
      assertCurrent();
      assertSnapshotLive(snapshot);
      const result = await transaction.request().input("run", snapshot.runId).input("kind", kind).input("after", after)
        .query(`SELECT payload_json,payload_sha256 FROM ${PAGE_TABLE} WITH(HOLDLOCK)
          WHERE run_id=@run AND kind=@kind AND after_ordinal=CONVERT(bigint,@after);`);
      const row = result.recordset?.[0];
      const page = pageFor(decode(row?.payload_json, row?.payload_sha256, MAX_PAGE_BYTES), kind, after, snapshot);
      const rows = checkRows(page, snapshot, context.parseCash, previous);
      if (kind === "cash") {
        for (const facts of rows) await applyCash(facts);
      } else {
        stockChanged += await applyStockPage(worker, transaction, context.branch, rows);
      }
      after = page.next;
    }
  }
  return stockChanged;
}

module.exports = { RECOVERY, stagePagedRecovery, applyPagedRecovery };
