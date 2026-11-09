const { recordId } = require("./uuid-fields.cjs");

const MAX_LINES = 100;
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const SEQ = /^[1-9][0-9]{0,18}$/;
const METHOD = /^[a-z][a-z0-9_]{0,63}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_VERSION = 2147483647;
const REFUND = "refund_v1";
const TENDER = "tender_v1";

const fields = (value, names) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const version = value => Number.isInteger(value) && value > 0 && value <= MAX_VERSION;
const fail = (message, code = "ESYNC_FINANCIAL_GROUP_PROTOCOL") => Object.assign(new Error(message), { code, table: "sales" });
const invalid = () => fail("The grouped financial correction is outside its authorized scope or shape.");
const review = () => fail("The local receipt does not match the verified correction boundary.", "ESYNC_GROUPED_REVIEW_REQUIRED");

function rowFor(change, table, rowFields, key = "id", rowKey = key) {
  if (!fields(change, ["table_name", "entity_id", "row_data", "row_version", "tombstone"]) ||
      change.table_name !== table || change.tombstone !== false || typeof change.entity_id !== "string" ||
      !fields(change.row_data, rowFields)) throw invalid();
  let identity;
  try { identity = JSON.parse(change.entity_id); } catch { throw invalid(); }
  const row = change.row_data;
  const revision = table === "stock_delta_applied" ? 1 : row.row_version;
  if (!fields(identity, [key]) || typeof identity[key] !== "string" || !UUID.test(identity[key]) ||
      identity[key] !== row[rowKey] || !version(revision) || change.row_version !== String(revision)) throw invalid();
  return row;
}

function parseFinancialCorrection(group, branch) {
  if (group?.financial?.kind === "shift_v1")
    return require("./grouped-managed-shift.cjs").parseManagedShiftGroup(group, branch);
  if (group?.financial?.kind === "drawer_v1")
    return require("./grouped-drawer-audit.cjs").parseDrawerAuditGroup(group, branch);
  const envelopeFields = ["seq", "operation_id", "changes", "financial"];
  if (group && Object.hasOwn(group, "receipt_graph")) envelopeFields.push("receipt_graph");
  if (!fields(group, envelopeFields) || typeof group.seq !== "string" ||
      !SEQ.test(group.seq) || BigInt(group.seq) > 9223372036854775807n || typeof group.operation_id !== "string" ||
      !UUID.test(group.operation_id) || !fields(group.financial, ["kind", "sale_id"]) ||
      typeof group.financial.sale_id !== "string" || !UUID.test(group.financial.sale_id) ||
      !Array.isArray(group.changes) || group.changes.length < 1 || group.changes.length > 1 + MAX_LINES * 3)
    throw invalid();
  const { kind, sale_id: saleId } = group.financial;
  if (![REFUND, TENDER].includes(kind)) throw invalid();
  const [parent, ...children] = group.changes;
  const sale = rowFor(parent, "sales", ["id", "store_id", "row_version",
    ...(kind === REFUND ? ["is_refunded"] : ["payment_type", "payments_count"])]);
  if (sale.id !== saleId || sale.store_id !== branch) throw invalid();
  const base = { kind, operationId: group.operation_id, seq: group.seq, sale, changes: group.changes,
    ...(group.receipt_graph ? { receiptGraph: group.receipt_graph } : {}) };
  if (kind === TENDER) {
    if (sale.row_version < 2 || typeof sale.payment_type !== "string" || !METHOD.test(sale.payment_type) ||
        (sale.payments_count !== null && (!Number.isInteger(sale.payments_count) ||
          sale.payments_count < 0 || sale.payments_count > MAX_LINES)) || children.length > MAX_LINES) throw invalid();
    const tenders = children.map(change => rowFor(change, "payment_transactions",
      ["id", "sale_id", "store_id", "row_version", "method", "updated_at"]));
    if (new Set(tenders.map(row => row.id)).size !== tenders.length || tenders.some(row =>
      row.sale_id !== sale.id || row.store_id !== branch || row.method !== sale.payment_type || row.row_version < 2 ||
      (row.updated_at !== null && (typeof row.updated_at !== "string" || !INSTANT.test(row.updated_at) ||
        !Number.isFinite(Date.parse(row.updated_at)))))) throw invalid();
    return { ...base, tenders };
  }
  if (typeof sale.is_refunded !== "boolean" || (sale.is_refunded && sale.row_version < 2)) throw invalid();
  const items = [];
  const ledger = [];
  const stock = [];
  for (const change of children) {
    if (change?.table_name === "sale_items" && !ledger.length && !stock.length) {
      items.push(rowFor(change, "sale_items", ["id", "sale_id", "branch_id", "product_id", "row_version", "refunded_qty"]));
    } else if (change?.table_name === "stock_delta_applied" && !stock.length) {
      ledger.push(rowFor(change, "stock_delta_applied",
        ["movement_id", "item_id", "product_id", "store_id", "delta", "applied_at"], "movement_id"));
    } else if (change?.table_name === "products") {
      stock.push(rowFor(change, "products", ["product_id", "branch_balance", "row_version"], "id", "product_id"));
    } else throw invalid();
  }
  const products = new Set(items.map(row => row.product_id));
  if (!items.length || items.length > MAX_LINES || ledger.length !== items.length || stock.length !== products.size ||
      new Set(items.map(row => row.id)).size !== items.length || new Set(ledger.map(row => row.movement_id)).size !== ledger.length ||
      stock.some(row => !products.delete(row.product_id) || !Number.isInteger(row.branch_balance) ||
        row.branch_balance < -2147483648 || row.branch_balance > MAX_VERSION) ||
      items.some((row, index) => {
        const movement = ledger[index];
        return row.sale_id !== sale.id || row.branch_id !== branch || row.row_version < 2 ||
          movement.item_id !== row.id || movement.product_id !== row.product_id || movement.store_id !== branch ||
          !Number.isInteger(movement.delta) || movement.delta <= 0 || !Number.isInteger(row.refunded_qty) ||
          row.refunded_qty < movement.delta || row.refunded_qty > MAX_VERSION ||
          typeof movement.applied_at !== "string" || !INSTANT.test(movement.applied_at) ||
          !Number.isFinite(Date.parse(movement.applied_at));
      })) throw invalid();
  return { ...base, items, ledger, stock };
}

const tableKeys = Object.freeze({
  sales: "id", sale_items: "id", payment_transactions: "id", stock_delta_applied: "movement_id",
});

async function assertNoPendingCorrection(worker, transaction, branch, facts) {
  for (const [name, key] of Object.entries(tableKeys)) {
    const ids = facts.changes.filter(change => change.table_name === name).map(change => change.row_data[key]);
    if (!ids.length) continue;
    const table = worker.registry.tables.find(entry => entry.cloudTable === name && entry.sqlServerTable === name);
    if (!table || !table.columns.some(column => column.primaryKey && column.sqlServerColumn === key)) throw invalid();
    const keys = ids.map(id => JSON.stringify({ [key]: id }));
    if ((await worker.reader.unacknowledged(table, keys, transaction, { branchId: branch })).size)
      throw fail("The receipt still has a pending local correction.", "ELOCAL_UPLOAD_PENDING");
    const result = await transaction.request().input("branch", branch).input("table", name)
      .input("keys", JSON.stringify(ids)).query(`
        DECLARE @baseline bigint=(SELECT change_tracking_version FROM dbo.sync_checkpoints WITH(HOLDLOCK)
          WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=@table AND direction=N'push');
        DECLARE @minimum bigint=CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.${name}'));
        IF @baseline IS NULL OR @minimum IS NULL OR @baseline<@minimum OR @baseline>CHANGE_TRACKING_CURRENT_VERSION()
        BEGIN SELECT N'unverified' AS state; RETURN; END;
        DECLARE @pending bit=CASE WHEN EXISTS(
          SELECT 1 FROM CHANGETABLE(CHANGES dbo.[${name}],@baseline) AS ct
          JOIN OPENJSON(@keys) AS wanted ON TRY_CONVERT(uniqueidentifier,wanted.[value])=ct.[${key}]
          WHERE ct.SYS_CHANGE_CONTEXT IS NULL OR ct.SYS_CHANGE_CONTEXT<>0x434C4F5544
        ) THEN 1 ELSE 0 END;
        SET @minimum=CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.${name}'));
        SELECT CASE WHEN @minimum IS NULL OR @baseline<@minimum THEN N'unverified'
          WHEN @pending=1 THEN N'pending' ELSE N'clear' END AS state;`);
    const state = result.recordset?.[0]?.state;
    if (state === "pending") throw fail("The receipt has an unacknowledged local change.", "ELOCAL_UPLOAD_PENDING");
    if (state !== "clear") throw fail("The local receipt change boundary is unverified.", "ELOCAL_PENDING_UNVERIFIED");
  }
}

async function applyRefund(transaction, branch, facts, ownAcceptance) {
  const { sale, items, ledger } = facts;
  const response = await transaction.request().input("sale", sale.id).input("branch", branch)
    .input("revision", sale.row_version).input("refunded", sale.is_refunded)
    .input("items", JSON.stringify(items.map((row, index) => ({ ...row, delta: ledger[index].delta }))))
    .input("ledger", JSON.stringify(ledger)).input("own", ownAcceptance === true).query(`
      DECLARE @local_revision int,@local_refunded bit;
      SELECT @local_revision=row_version,@local_refunded=is_refunded FROM dbo.sales WITH(UPDLOCK,HOLDLOCK)
      WHERE id=@sale AND store_id COLLATE Latin1_General_100_BIN2=@branch COLLATE Latin1_General_100_BIN2;
      IF @local_revision IS NULL OR @local_refunded IS NULL
      BEGIN SELECT N'dependency' AS state; RETURN; END;

      DECLARE @line TABLE(id uniqueidentifier PRIMARY KEY,product uniqueidentifier,revision int,refunded int,delta int);
      INSERT @line SELECT id,product_id,row_version,refunded_qty,delta FROM OPENJSON(@items)
        WITH(id uniqueidentifier,product_id uniqueidentifier,row_version int,refunded_qty int,delta int);
      DECLARE @movement TABLE(id uniqueidentifier PRIMARY KEY,product uniqueidentifier,delta int,applied datetimeoffset(7));
      INSERT @movement SELECT movement_id,product_id,delta,applied_at FROM OPENJSON(@ledger)
        WITH(movement_id uniqueidentifier,product_id uniqueidentifier,delta int,applied_at datetimeoffset(7));
      IF EXISTS(SELECT 1 FROM @line AS desired LEFT JOIN dbo.sale_items AS item WITH(UPDLOCK,HOLDLOCK)
        ON item.id=desired.id AND item.sale_id=@sale AND item.product_id=desired.product
        AND (item.branch_id IS NULL OR item.branch_id COLLATE Latin1_General_100_BIN2=@branch COLLATE Latin1_General_100_BIN2)
        WHERE item.id IS NULL OR item.quantity IS NULL OR item.quantity<desired.refunded
          OR item.refunded_qty IS NULL OR item.row_version IS NULL)
      BEGIN SELECT N'dependency' AS state; RETURN; END;
      DECLARE @remaining bit=CASE WHEN EXISTS(SELECT 1 FROM dbo.sale_items AS item WITH(UPDLOCK,HOLDLOCK)
        LEFT JOIN @line AS desired ON desired.id=item.id
        WHERE item.sale_id=@sale AND item.quantity>COALESCE(desired.refunded,item.refunded_qty,0)) THEN 1 ELSE 0 END;
      IF @remaining=@refunded BEGIN SELECT N'review' AS state; RETURN; END;
      DECLARE @ledger_exact int,@ledger_count int;
      SELECT @ledger_count=COUNT(actual.movement_id),@ledger_exact=COUNT(CASE WHEN actual.product_id=desired.product
        AND actual.store_id COLLATE Latin1_General_100_BIN2=@branch COLLATE Latin1_General_100_BIN2
        AND actual.delta=desired.delta AND actual.applied_at=desired.applied THEN 1 END)
      FROM @movement AS desired LEFT JOIN dbo.stock_delta_applied AS actual WITH(UPDLOCK,HOLDLOCK)
        ON actual.movement_id=desired.id;
      IF @local_revision=@revision AND @local_refunded=@refunded AND NOT EXISTS(
        SELECT 1 FROM @line AS desired JOIN dbo.sale_items AS item ON item.id=desired.id
        WHERE item.row_version<>desired.revision OR item.refunded_qty<>desired.refunded)
        AND @ledger_exact=(SELECT COUNT(*) FROM @movement)
      BEGIN SELECT N'applied' AS state,0 AS changed; RETURN; END;
      IF @own=1 OR @ledger_count<>0 OR @local_refunded<>0 OR @local_revision<>@revision-CONVERT(int,@refunded)
        OR EXISTS(SELECT 1 FROM @line AS desired JOIN dbo.sale_items AS item ON item.id=desired.id
          WHERE item.row_version<>desired.revision-1 OR item.refunded_qty<>desired.refunded-desired.delta)
      BEGIN SELECT N'review' AS state; RETURN; END;

      DECLARE @changed int=0;
      WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
      UPDATE item SET refunded_qty=desired.refunded,row_version=desired.revision FROM dbo.sale_items AS item
        JOIN @line AS desired ON desired.id=item.id;
      SET @changed=@changed+@@ROWCOUNT;
      IF @refunded=1
      BEGIN
        WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
        UPDATE dbo.sales SET is_refunded=1,row_version=@revision WHERE id=@sale;
        SET @changed=@changed+@@ROWCOUNT;
      END;
      WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
      INSERT dbo.stock_delta_applied(movement_id,product_id,store_id,delta,applied_at)
        SELECT id,product,@branch,delta,applied FROM @movement;
      SET @changed=@changed+@@ROWCOUNT;
      SELECT N'applied' AS state,@changed AS changed;`);
  return response.recordset?.[0];
}

async function applyTender(transaction, branch, facts) {
  const { sale, tenders } = facts;
  const response = await transaction.request().input("sale", sale.id).input("branch", branch)
    .input("revision", sale.row_version).input("method", sale.payment_type)
    .input("payments_count", sale.payments_count).input("tender_payload", JSON.stringify(tenders)).query(`
      DECLARE @local_revision int,@payments nvarchar(max),@refunded bit,@payment_type nvarchar(100);
      SELECT @local_revision=row_version,@payments=payments,@refunded=is_refunded,@payment_type=payment_type
      FROM dbo.sales WITH(UPDLOCK,HOLDLOCK)
      WHERE id=@sale AND store_id COLLATE Latin1_General_100_BIN2=@branch COLLATE Latin1_General_100_BIN2;
      IF @local_revision IS NULL BEGIN SELECT N'dependency' AS state; RETURN; END;
      IF @refunded IS NULL OR @refunded<>0 OR (@payments_count IS NULL AND ISJSON(@payments,ARRAY)=1)
        OR (@payments_count IS NOT NULL AND COALESCE(ISJSON(@payments,ARRAY),0)<>1)
      BEGIN SELECT N'review' AS state; RETURN; END;
      IF @payments_count IS NOT NULL
      BEGIN
        IF (SELECT COUNT(*) FROM OPENJSON(@payments))<>@payments_count
          OR EXISTS(SELECT 1 FROM OPENJSON(@payments) WHERE [type]<>5)
        BEGIN SELECT N'review' AS state; RETURN; END;
      END;
      DECLARE @desired TABLE(id uniqueidentifier PRIMARY KEY,revision int,updated datetimeoffset(7));
      INSERT @desired SELECT id,row_version,updated_at FROM OPENJSON(@tender_payload)
        WITH(id uniqueidentifier,row_version int,updated_at datetimeoffset(7));
      DECLARE @tenders TABLE(id uniqueidentifier PRIMARY KEY,revision int,method nvarchar(100),updated datetimeoffset(7));
      INSERT @tenders SELECT id,row_version,method,updated_at FROM dbo.payment_transactions WITH(UPDLOCK,HOLDLOCK)
        WHERE sale_id=@sale AND source_type COLLATE Latin1_General_100_BIN2=N'sale'
          AND store_id COLLATE Latin1_General_100_BIN2=@branch COLLATE Latin1_General_100_BIN2;
      IF (SELECT COUNT(*) FROM @desired)<>(SELECT COUNT(*) FROM @tenders)
        OR EXISTS(SELECT 1 FROM @desired d LEFT JOIN @tenders t ON t.id=d.id WHERE t.id IS NULL OR t.revision IS NULL)
      BEGIN SELECT N'dependency' AS state; RETURN; END;
      IF @local_revision=@revision AND @payment_type COLLATE Latin1_General_100_BIN2=@method COLLATE Latin1_General_100_BIN2
        AND NOT EXISTS(SELECT 1 FROM @tenders t JOIN @desired d ON d.id=t.id
          WHERE t.revision<>d.revision OR t.method IS NULL
            OR t.method COLLATE Latin1_General_100_BIN2<>@method COLLATE Latin1_General_100_BIN2
            OR t.updated IS DISTINCT FROM d.updated)
      BEGIN
        IF @payments_count IS NOT NULL AND EXISTS(SELECT 1 FROM OPENJSON(@payments)
          WHERE JSON_VALUE([value],'$.method') IS NULL
            OR JSON_VALUE([value],'$.method') COLLATE Latin1_General_100_BIN2<>@method COLLATE Latin1_General_100_BIN2)
        BEGIN SELECT N'review' AS state; RETURN; END;
        SELECT N'applied' AS state,0 AS changed; RETURN;
      END;
      IF @local_revision<>@revision-1 OR EXISTS(SELECT 1 FROM @tenders t JOIN @desired d ON d.id=t.id
        WHERE t.revision<>d.revision-1) BEGIN SELECT N'review' AS state; RETURN; END;

      DECLARE @index int=0;
      WHILE @index<COALESCE(@payments_count,0)
      BEGIN
        SET @payments=JSON_MODIFY(@payments,CONCAT('$[',@index,'].method'),@method);
        SET @index=@index+1;
      END;
      WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
      UPDATE dbo.sales SET payment_type=@method,payments=@payments,row_version=@revision WHERE id=@sale;
      WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
      UPDATE actual SET method=@method,row_version=d.revision,updated_at=d.updated
        FROM dbo.payment_transactions AS actual JOIN @desired AS d ON d.id=actual.id;
      SELECT N'applied' AS state,@@ROWCOUNT+1 AS changed;`);
  return response.recordset?.[0];
}

async function applyFinancialCorrection(worker, transaction, context, facts) {
  if (facts.kind === "shift_v1")
    return require("./grouped-managed-shift.cjs").applyManagedShiftGroup(worker, transaction, context, facts);
  if (facts.kind === "drawer_v1")
    return require("./grouped-drawer-audit.cjs").applyDrawerAuditGroup(worker, transaction, context, facts);
  const { branch } = context;
  if (facts.sale.store_id !== branch) throw invalid();
  // Lock the receipt before consulting pending evidence, matching local writer
  // order. The caller owns the transaction and advances its cursor only on success.
  const result = await transaction.request().input("sale", facts.sale.id).input("branch", branch).query(`
    SELECT id FROM dbo.sales WITH(UPDLOCK,HOLDLOCK)
    WHERE id=@sale AND store_id COLLATE Latin1_General_100_BIN2=@branch COLLATE Latin1_General_100_BIN2;`);
  const verifyOwnRefund = () => facts.kind === REFUND &&
    require("./grouped-refund-native.cjs").proveNativeRefund(transaction, context, facts);
  let ownAcceptance;
  let archivedCount = 0;
  if (recordId(result.recordset?.[0]?.id) !== facts.sale.id) {
    const { decodeCorrectionReceipt, installCorrectionReceipt } = require("./grouped-correction-receipt.cjs");
    const archive = decodeCorrectionReceipt(worker.registry, context, facts);
    const ledger = facts.changes.filter(change => change.table_name === "stock_delta_applied");
    await assertNoPendingCorrection(worker, transaction, branch, { changes: [...archive.changes, ...ledger] });
    ownAcceptance = await verifyOwnRefund();
    archivedCount = await installCorrectionReceipt(transaction, context, facts, archive, ownAcceptance === true);
  }
  else ownAcceptance = await verifyOwnRefund();
  if (!ownAcceptance && !archivedCount) await assertNoPendingCorrection(worker, transaction, branch, facts);
  const state = facts.kind === REFUND
    ? await applyRefund(transaction, branch, facts, ownAcceptance)
    : await applyTender(transaction, branch, facts);
  if (state?.state === "dependency")
    throw fail("The original receipt lines and payments must synchronize before their correction.", "ESYNC_CASH_RECEIPT_DEPENDENCY");
  if (state?.state !== "applied") throw review();
  if (facts.kind !== REFUND || context.recoveringFinancial) return archivedCount + state.changed;
  const { applyGroupedStock } = require("./grouped-live-stock.cjs");
  return archivedCount + state.changed + await applyGroupedStock(worker, transaction, branch, facts.stock, {
    epoch: context.financialEpoch, seq: facts.seq,
  });
}

module.exports = { parseFinancialCorrection, applyFinancialCorrection };
