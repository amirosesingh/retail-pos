const { DOMAIN, decodeRefundCommand, checkRefundAcceptance, refundHeld, stableRefundUuid } = require("./refund-command.cjs");
const { recordId } = require("./uuid-fields.cjs");

const TABLES = new Set(["sales", "sale_items", "products", "stock_delta_applied"]);
const PREFIX = Buffer.from("POSREF1", "ascii");
const FENCE = "__grouped_refund_sender_v1__";
const guid = `LOWER(CONVERT(varchar(36),database_guid)) FROM sys.database_recovery_status WHERE database_id=DB_ID()`;
const storage = `
  IF COL_LENGTH(N'dbo.local_operation_receipts',N'refund_evidence_json') IS NULL
    OR COL_LENGTH(N'dbo.local_operation_receipts',N'refund_acceptance_json') IS NULL
    OR COL_LENGTH(N'dbo.local_operation_receipts',N'refund_branch_id') IS NULL
  BEGIN
    IF EXISTS(SELECT 1 FROM dbo.sync_checkpoints WHERE organization_id=N'default'
      AND branch_id=@branch AND entity_type=N'${FENCE}' AND direction=N'push')
      THROW 51042,'Protected refund evidence storage is unavailable.',1;
    RETURN;
  END;`;
const readRows = `
  SELECT TOP(2) r.operation_id,r.entity_id,r.note,r.refund_branch_id,r.refund_evidence_json,r.refund_acceptance_json
  FROM dbo.local_operation_receipts r WHERE r.operation_id=@id AND r.refund_evidence_json IS NOT NULL;`;

async function assertRefundCaptureReady(transaction) {
  const result = await transaction.request().query(`
    SELECT CASE WHEN COL_LENGTH(N'dbo.local_operation_receipts',N'refund_evidence_json') IS NOT NULL
      AND COL_LENGTH(N'dbo.local_operation_receipts',N'refund_acceptance_json') IS NOT NULL
      AND COL_LENGTH(N'dbo.local_operation_receipts',N'refund_branch_id') IS NOT NULL
      AND CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.sales')) IS NOT NULL
      AND CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.sale_items')) IS NOT NULL
      AND CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.products')) IS NOT NULL
      AND CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.stock_delta_applied')) IS NOT NULL
      THEN 1 ELSE 0 END AS ready;`);
  if (result.recordset?.[0]?.ready !== 1) throw refundHeld();
}

function refundContext(operationId) {
  const bytes = Buffer.from(operationId.replaceAll("-", ""), "hex");
  if (bytes.length !== 16) throw refundHeld();
  return Buffer.concat([PREFIX, bytes]);
}

function refundContextOperation(context) {
  if (!Buffer.isBuffer(context) || !context.subarray(0, PREFIX.length).equals(PREFIX)) return null;
  if (context.length !== PREFIX.length + 16) throw refundHeld();
  const hex = context.subarray(PREFIX.length).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function keyFor(table, entity) {
  const field = table === "stock_delta_applied" ? "movement_id" : "id";
  let value;
  try { value = typeof entity === "string" ? JSON.parse(entity) : entity; }
  catch { throw refundHeld(); }
  if (!TABLES.has(table) || !value || Object.keys(value).length !== 1 || typeof value[field] !== "string")
    throw refundHeld();
  return `${table}:${recordId(value[field])}`;
}

function expectedJournal(saved) {
  const journal = [keyFor("sales", { id: saved.command.saleId })];
  for (const item of saved.items) {
    journal.push(keyFor("sale_items", { id: item.itemId }), keyFor("products", { id: item.productId }),
      keyFor("stock_delta_applied", { movement_id: item.nativeMovementId }));
  }
  return journal.sort();
}

function savedRefund(row, branchId) {
  let saved, acceptance;
  try { saved = JSON.parse(row.refund_evidence_json); acceptance = JSON.parse(row.refund_acceptance_json ?? "null"); }
  catch { throw refundHeld(); }
  if (!saved || Object.keys(saved).sort().join(",") !== "attestation,journal,refundJson" ||
      !Array.isArray(saved.journal)) throw refundHeld();
  const facts = decodeRefundCommand(saved.refundJson, saved.attestation);
  if (facts.command.operationId !== recordId(row.operation_id) || facts.command.saleId !== recordId(row.entity_id) ||
      facts.command.reason !== (row.note ?? null) || facts.command.branchId !== row.refund_branch_id ||
      facts.command.branchId !== branchId) throw refundHeld();
  const ids = new Set();
  const keys = saved.journal.map(entry => {
    if (!entry || Object.keys(entry).sort().join(",") !== "change_id,entity_id,entity_type,operation" ||
        !/^[1-9]\d{0,18}$/.test(entry.change_id ?? "") || ids.has(entry.change_id) ||
        entry.operation !== (entry.entity_type === "stock_delta_applied" ? "insert" : "update")) throw refundHeld();
    ids.add(entry.change_id);
    return keyFor(entry.entity_type, entry.entity_id);
  });
  if (JSON.stringify(keys.sort()) !== JSON.stringify(expectedJournal(facts))) throw refundHeld();
  if (acceptance) checkRefundAcceptance(facts, acceptance);
  return { ...saved, ...facts, acceptance };
}

async function captureRefund(transaction, { source, author, assertCurrent, sourceFingerprint }, command, rows) {
  await assertRefundCaptureReady(transaction);
  if (sourceFingerprint) {
    const { MIXED_CHECKPOINT } = require("./grouped-store-settings.cjs");
    const positions = (await transaction.request().input("branch", source.branchId).input("checkpoint", MIXED_CHECKPOINT)
      .query(`SELECT committed_cursor FROM dbo.sync_checkpoints WITH(UPDLOCK,HOLDLOCK)
        WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=@checkpoint AND direction=N'pull';`)).recordset ?? [];
    let position;
    try { position = JSON.parse(positions[0]?.committed_cursor); } catch { throw refundHeld(); }
    if (positions.length !== 1 || position.extended !== true || position.source !== sourceFingerprint ||
        position.databaseGuid !== source.databaseGuid || position.epoch !== source.feedEpoch) throw refundHeld();
  }
  if (rows.some(row => row.branch_id !== source.branchId || !Number.isInteger(Number(row.quantity)) ||
    !Number.isInteger(Number(row.refunded_qty)) || Number(row.refunded_qty) < 0 ||
    Number(row.quantity) < Number(row.refunded_qty))) throw refundHeld();
  const active = rows.filter(row => Number(row.quantity) > Number(row.refunded_qty)).map(row => {
    const itemId = recordId(row.id);
    return { line: { item_id: itemId, qty: Number(row.quantity) - Number(row.refunded_qty),
      expected_refunded_qty: Number(row.refunded_qty), expected_row_version: Number(row.row_version) },
    item: { itemId, nativeItemId: row.id, productId: recordId(row.product_id),
      nativeMovementId: stableRefundUuid({ refundId: command.refundKey, itemId: row.id }) } };
  }).sort((a, b) => a.line.item_id.localeCompare(b.line.item_id));
  const db = (await transaction.request().query(`SELECT ${guid};`)).recordset?.[0];
  if (Object.values(db ?? {})[0] !== source.databaseGuid) throw refundHeld();
  const refundJson = JSON.stringify({ domain: DOMAIN, scope: source,
    command: { ...command, lines: active.map(row => row.line) }, items: active.map(row => row.item) });
  assertCurrent();
  const attestation = author.signFinancialOperation({ branchId: source.branchId, operationId: command.operationId,
    action: "REFUND", payloadJson: refundJson });
  const facts = decodeRefundCommand(refundJson, attestation);
  const keys = expectedJournal(facts).map(key => {
    const separator = key.indexOf(":");
    return { table: key.slice(0, separator), id: key.slice(separator + 1) };
  });
  const result = await transaction.request().input("branch", source.branchId).input("keys", JSON.stringify(keys)).query(`
    DECLARE @wanted TABLE(entity nvarchar(128), id uniqueidentifier);
    INSERT @wanted SELECT DISTINCT [table],id FROM OPENJSON(@keys) WITH([table] nvarchar(128),id uniqueidentifier);
    IF EXISTS(SELECT 1 FROM dbo.sync_change_journal j WITH(UPDLOCK,HOLDLOCK) JOIN @wanted w ON w.entity=j.entity_type
      AND w.id=TRY_CONVERT(uniqueidentifier, JSON_VALUE(CASE WHEN ISJSON(j.entity_id)=1 THEN j.entity_id END,
        CASE WHEN w.entity=N'stock_delta_applied' THEN '$.movement_id' ELSE '$.id' END))
      WHERE j.acknowledged_at IS NULL AND j.branch_id IN(@branch,N'global'))
      BEGIN SELECT 0 AS ready; RETURN; END;
    DECLARE @baseline bigint=(SELECT change_tracking_version FROM dbo.sync_checkpoints WITH(HOLDLOCK)
      WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=N'products' AND direction=N'push');
    DECLARE @minimum bigint=CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.products'));
    IF @baseline IS NULL OR @minimum IS NULL OR @baseline<@minimum OR @baseline>CHANGE_TRACKING_CURRENT_VERSION()
      BEGIN SELECT 0 AS ready; RETURN; END;
    SELECT CASE WHEN EXISTS(SELECT 1 FROM @wanted w LEFT JOIN dbo.products p WITH(UPDLOCK,HOLDLOCK) ON p.id=w.id
      CROSS APPLY (SELECT COALESCE(SUM(TRY_CONVERT(bigint,entry.[value])),0) total,
        COUNT_BIG(*) entries,COUNT_BIG(DISTINCT entry.[key] COLLATE Latin1_General_100_BIN2) buckets,
        COUNT_BIG(TRY_CONVERT(int,CASE WHEN entry.[type]=2 THEN entry.[value] END)) valid
        FROM OPENJSON(CASE WHEN ISJSON(p.stock_by_store,OBJECT)=1 THEN p.stock_by_store ELSE N'{}' END) entry) balance
      WHERE w.entity=N'products' AND (p.id IS NULL OR p.owner_store_id IS NULL OR
        p.owner_store_id COLLATE Latin1_General_100_BIN2<>@branch COLLATE Latin1_General_100_BIN2 OR
        p.stock_by_store IS NULL OR ISJSON(p.stock_by_store,OBJECT)<>1 OR p.stock_quantity IS NULL OR
        p.stock_quantity<>balance.total OR balance.entries<>balance.buckets OR balance.entries<>balance.valid))
      OR EXISTS(SELECT 1 FROM CHANGETABLE(CHANGES dbo.products,@baseline) ct JOIN @wanted w ON w.id=ct.id
        WHERE w.entity=N'products' AND (ct.SYS_CHANGE_CONTEXT IS NULL OR ct.SYS_CHANGE_CONTEXT<>0x434C4F5544))
      THEN 0 ELSE 1 END AS ready;`);
  if (result.recordset?.[0]?.ready !== 1) throw refundHeld();
  return { ...facts, refundJson, attestation };
}

async function saveRefundEvidence(transaction, saved) {
  const { command, refundJson, attestation } = saved;
  const request = () => transaction.request().input("op", command.operationId).input("branch", command.branchId);
  const journal = (await request().query(`
    SELECT CONVERT(varchar(20),change_id) change_id,entity_type,entity_id,operation
    FROM dbo.sync_change_journal WITH(UPDLOCK,HOLDLOCK)
    WHERE aggregate_id=@op AND branch_id=@branch AND acknowledged_at IS NULL ORDER BY change_id;`)).recordset ?? [];
  const encoded = JSON.stringify({ refundJson, attestation, journal });
  savedRefund({ operation_id: command.operationId, entity_id: command.saleId, note: command.reason,
    refund_branch_id: command.branchId, refund_evidence_json: encoded }, command.branchId);
  await request().input("evidence", encoded).query(`
    UPDATE dbo.local_operation_receipts SET refund_branch_id=@branch,refund_evidence_json=@evidence
    WHERE operation_id=@op AND operation_type=N'refund' AND refund_evidence_json IS NULL;
    IF @@ROWCOUNT<>1 THROW 51042,'The original refund receipt could not be bound.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.sync_checkpoints WITH(UPDLOCK,HOLDLOCK)
      WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=N'${FENCE}' AND direction=N'push')
      INSERT dbo.sync_checkpoints(organization_id,branch_id,entity_type,direction)
      VALUES(N'default',@branch,N'${FENCE}',N'push');`);
}

async function readRefundRoute(connectionManager, branchId, operationId) {
  const result = await connectionManager.pool.request().input("branch", branchId).input("id", operationId)
    .query(`${storage} EXEC sys.sp_executesql N'${readRows}',N'@id uniqueidentifier',@id=@id;`);
  const rows = result.recordset ?? [];
  if (rows.length > 1) throw refundHeld();
  return rows.length ? savedRefund(rows[0], branchId) : null;
}

async function recordRefundAcceptance(connectionManager, saved, response, assertCurrent) {
  checkRefundAcceptance(saved, response);
  const { command } = saved;
  const sql = connectionManager.sql();
  const tx = new sql.Transaction(connectionManager.pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    assertCurrent();
    const result = await tx.request().input("id", command.operationId)
      .query(`SELECT ${guid}; ${readRows}`);
    const row = result.recordsets?.[1]?.[0];
    if (!row || Object.values(result.recordsets?.[0]?.[0] ?? {})[0] !== saved.scope.databaseGuid) throw refundHeld();
    const current = savedRefund(row, command.branchId);
    if (current.refundJson !== saved.refundJson || current.attestation.signature !== saved.attestation.signature ||
        JSON.stringify(current.journal) !== JSON.stringify(saved.journal)) throw refundHeld();
    if (current.acceptance && JSON.stringify(current.acceptance) !== JSON.stringify(response)) throw refundHeld();
    if (!current.acceptance) {
      await tx.request().input("op", command.operationId).input("branch", command.branchId)
        .input("journal", JSON.stringify(saved.journal)).input("receipt", JSON.stringify(response)).query(`
        DECLARE @expected TABLE(id bigint PRIMARY KEY,entity_type nvarchar(128),entity_id nvarchar(400),operation nvarchar(16));
        INSERT @expected SELECT TRY_CONVERT(bigint,change_id),entity_type,entity_id,operation
        FROM OPENJSON(@journal) WITH(change_id nvarchar(20),entity_type nvarchar(128),entity_id nvarchar(400),operation nvarchar(16));
        IF EXISTS(SELECT 1 FROM dbo.sync_change_journal WITH(UPDLOCK,HOLDLOCK) WHERE aggregate_id=@op
          AND (acknowledged_at IS NOT NULL OR branch_id<>@branch OR change_id NOT IN(SELECT id FROM @expected)))
          THROW 51042,'Unverified refund journal coverage.',1;
        UPDATE j SET acknowledged_at=SYSDATETIMEOFFSET(),last_error=NULL
        FROM dbo.sync_change_journal j JOIN @expected e ON e.id=j.change_id
          AND e.entity_type=j.entity_type AND e.entity_id=j.entity_id AND e.operation=j.operation
        WHERE j.aggregate_id=@op AND j.branch_id=@branch AND j.acknowledged_at IS NULL;
        IF @@ROWCOUNT<>(SELECT COUNT(*) FROM @expected) THROW 51042,'Missing original refund journal coverage.',1;
        UPDATE dbo.local_operation_receipts SET refund_acceptance_json=@receipt
        WHERE operation_id=@op AND refund_branch_id=@branch AND refund_acceptance_json IS NULL;
        IF @@ROWCOUNT<>1 THROW 51042,'Refund receipt acceptance was not recorded.',1;`);
    }
    await require("./grouped-live-stock.cjs").noteLocalStockAcceptance(tx, command.branchId,
      response.feed_epoch, response.feed_seq, response.stock.map(row => row.product_id));
    assertCurrent();
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  }
}

async function refundTrackingCoverage(connectionManager, branchId, table, changes, options = {}) {
  const { transaction, epoch, withReceipts } = options;
  const owner = transaction ? { pool: { request: () => transaction.request() } } : connectionManager;
  const result = await owner.pool.request().query(`SELECT ${guid};`);
  const databaseGuid = Object.values(result.recordset?.[0] ?? {})[0];
  const saved = new Map();
  const receipts = new Map();
  for (const change of changes) {
    if (!saved.has(change.refundId)) {
      saved.set(change.refundId, await readRefundRoute(owner, branchId, change.refundId));
    }
    const evidence = saved.get(change.refundId);
    if (!evidence?.acceptance || evidence.scope.databaseGuid !== databaseGuid ||
        (epoch && evidence.acceptance.feed_epoch !== epoch) || change.operation === "D" ||
        !expectedJournal(evidence).includes(keyFor(table, change.key))) throw refundHeld();
    if (withReceipts) receipts.set(recordId(change.key.id), { seq: evidence.acceptance.feed_seq });
  }
  return withReceipts ? receipts : new Set(changes);
}

async function assertLegacyRefundWrites(connectionManager, branchId, changes) {
  const keys = changes.filter(change => TABLES.has(change.table));
  if (!keys.length) return;
  const result = await connectionManager.pool.request().input("branch", branchId).input("keys", JSON.stringify(keys)).query(`
    ${storage}
    EXEC sys.sp_executesql N'SELECT TOP(1) 1 AS held FROM dbo.local_operation_receipts r
      CROSS APPLY OPENJSON(r.refund_evidence_json,''$.journal'') WITH(entity_type nvarchar(128),entity_id nvarchar(400)) saved
      INNER JOIN OPENJSON(@keys) WITH([table] nvarchar(128),id uniqueidentifier) requested ON requested.[table]=saved.entity_type
        AND requested.id=TRY_CONVERT(uniqueidentifier,CASE WHEN saved.entity_type=N''stock_delta_applied''
          THEN JSON_VALUE(saved.entity_id,''$.movement_id'') ELSE JSON_VALUE(saved.entity_id,''$.id'') END)
      WHERE r.refund_branch_id=@branch AND (r.refund_acceptance_json IS NULL OR saved.entity_type IN(N''sales'',N''sale_items'',N''stock_delta_applied''));',
      N'@keys nvarchar(max),@branch nvarchar(128)',@keys=@keys,@branch=@branch;`);
  if (result.recordset?.length) throw refundHeld();
}

function refundKeys(table, rows) {
  if (!TABLES.has(table)) return [];
  const field = table === "stock_delta_applied" ? "movement_id" : "id";
  return [...new Set(rows.map(row => recordId((row.key ?? row)[field])).filter(Boolean))].map(id => ({ table, id }));
}

async function assertRefundHandbackClear(transaction, branchId, epoch, seq) {
  const result = await transaction.request().input("branch", branchId).input("epoch", epoch).input("seq", seq).query(`
    ${storage}
    EXEC sys.sp_executesql N'SELECT TOP(1) 1 AS held FROM dbo.local_operation_receipts WITH(UPDLOCK,HOLDLOCK)
      WHERE refund_branch_id=@branch AND (refund_acceptance_json IS NULL
        OR JSON_VALUE(refund_acceptance_json,''$.feed_epoch'') IS NULL
        OR JSON_VALUE(refund_acceptance_json,''$.feed_epoch'')<>@epoch
        OR TRY_CONVERT(bigint,JSON_VALUE(refund_acceptance_json,''$.feed_seq'')) IS NULL
        OR TRY_CONVERT(bigint,JSON_VALUE(refund_acceptance_json,''$.feed_seq''))>TRY_CONVERT(bigint,@seq));',
      N'@branch nvarchar(128),@epoch nvarchar(36),@seq nvarchar(20)',@branch=@branch,@epoch=@epoch,@seq=@seq;`);
  if (result.recordset?.length) throw refundHeld();
}

async function proveNativeRefund(transaction, context, facts) {
  const saved = await readRefundRoute({ pool: { request: () => transaction.request() } }, context.branch, facts.operationId);
  if (!saved) {
    const old = await transaction.request().input("id", facts.operationId).query(`
      SELECT 1 AS held FROM dbo.local_operation_receipts WITH(HOLDLOCK)
      WHERE operation_id=@id AND operation_type=N'refund';`);
    if (old.recordset?.length) throw refundHeld();
    return null;
  }
  const { command, acceptance } = saved;
  if (saved.scope.databaseGuid !== context.databaseGuid || command.saleId !== facts.sale.id) throw refundHeld();
  if (!acceptance) throw refundHeld("ELOCAL_UPLOAD_PENDING");
  if (acceptance.feed_epoch !== context.financialEpoch || acceptance.feed_seq !== facts.seq) throw refundHeld();
  const lines = new Map(facts.items.map(item => [item.id, item]));
  const ledger = new Map(facts.ledger.map(entry => [entry.item_id, entry]));
  const stock = new Map(facts.stock.map(row => [row.product_id, row]));
  if (acceptance.sale_row_version !== facts.sale.row_version || acceptance.fully_refunded !== facts.sale.is_refunded ||
      lines.size !== acceptance.effects.length || ledger.size !== acceptance.effects.length ||
      stock.size !== acceptance.stock.length || acceptance.stock.some(row => stock.get(row.product_id)?.branch_balance !== row.balance))
    throw refundHeld();
  const aliases = new Map(saved.items.map(row => [row.itemId, row.nativeMovementId]));
  for (const effect of acceptance.effects) {
    const item = lines.get(effect.item_id);
    const movement = ledger.get(effect.item_id);
    const alias = aliases.get(effect.item_id);
    if (!item || !movement || !alias || effect.product_id !== item.product_id || effect.row_version !== item.row_version ||
        effect.refunded_qty !== item.refunded_qty || effect.movement_id !== movement.movement_id ||
        effect.product_id !== movement.product_id || effect.branch_id !== movement.store_id || effect.delta !== movement.delta)
      throw refundHeld();
    const request = () => transaction.request().input("movement", alias).input("canonical", effect.movement_id)
      .input("applied", movement.applied_at);
    const local = await request().query(`SELECT movement_id,product_id,store_id,delta,
      CASE WHEN applied_at=TRY_CONVERT(datetimeoffset(7),@applied) THEN 1 ELSE 0 END exact_time
      FROM dbo.stock_delta_applied WITH(UPDLOCK,HOLDLOCK) WHERE movement_id IN(@movement,@canonical);`);
    const rows = local.recordset ?? [];
    const row = rows[0];
    if (rows.length !== 1 || recordId(row.product_id) !== effect.product_id ||
        row.store_id !== effect.branch_id || Number(row.delta) !== effect.delta) throw refundHeld();
    if (recordId(row.movement_id) === effect.movement_id) {
      if (row.exact_time !== 1) throw refundHeld();
    } else {
      const changed = await request().query(`WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
        UPDATE dbo.stock_delta_applied SET movement_id=@canonical,applied_at=TRY_CONVERT(datetimeoffset(7),@applied)
        WHERE movement_id=@movement AND TRY_CONVERT(datetimeoffset(7),@applied) IS NOT NULL;`);
      if (changed.rowsAffected?.[0] !== 1) throw refundHeld();
    }
  }
  return true;
}

module.exports = { captureRefund, saveRefundEvidence, readRefundRoute, recordRefundAcceptance, refundTrackingCoverage,
  assertLegacyRefundWrites, assertRefundCaptureReady, assertRefundHandbackClear, refundContext, refundContextOperation,
  refundForTrackingContext: refundContextOperation, refundKeys, refundHeld, proveNativeRefund };
