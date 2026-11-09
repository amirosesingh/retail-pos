const { createHash } = require("node:crypto");
const { recordId } = require("./uuid-fields.cjs");

const MAX_BYTES = 196608;
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/;
const DECIMALS = { "decimal(38,12)": /^-?(?:0|[1-9]\d{0,25})(?:\.\d{1,12})?$/,
  "decimal(18,4)": /^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/ };
const exact = (row, keys) => !!row && !Array.isArray(row) && typeof row === "object" &&
  Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key));
const uuid = value => typeof value === "string" && UUID.test(value);
const review = () => Object.assign(new Error("The missing receipt cannot be reconstructed from verified correction evidence."),
  { code: "ESYNC_GROUPED_REVIEW_REQUIRED", table: "sales" });
const dependency = () => Object.assign(new Error("The original receipt or a registered parent is still missing."),
  { code: "ESYNC_CASH_RECEIPT_DEPENDENCY", table: "sales" });

function validValue(column, value) {
  if (value === null) return column.nullable === true;
  if (column.sqlServerType === "uniqueidentifier") return uuid(value);
  if (column.sqlServerType === "bit") return typeof value === "boolean";
  if (column.sqlServerType === "int") return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
  if (column.sqlServerType === "datetimeoffset(7)")
    return typeof value === "string" && INSTANT.test(value) && Number.isFinite(Date.parse(value));
  const decimal = DECIMALS[column.sqlServerType];
  if (decimal) return typeof value === "string" && decimal.test(value);
  const text = /^nvarchar\((max|[1-9]\d*)\)$/.exec(column.sqlServerType);
  if (!text || typeof value !== "string" || value.includes("\0") ||
      (text[1] !== "max" && value.length > Number(text[1]))) return false;
  if (column.cloudType === "jsonb") {
    try { JSON.parse(value); } catch { return false; }
  }
  return true;
}

function registeredRows(registry, name, rows) {
  const table = registry.tables.find(candidate => candidate.cloudTable === name && candidate.sqlServerTable === name);
  if (!table || table.columns.filter(column => column.primaryKey).length !== 1 ||
      !table.columns.some(column => column.primaryKey && column.sqlServerColumn === "id") ||
      table.columns.some(column => column.cloudColumn !== column.sqlServerColumn || !/^[a-z][a-z_0-9]*$/.test(column.cloudColumn) ||
        !/^(?:uniqueidentifier|bit|int|datetimeoffset\(7\)|decimal\(38,12\)|decimal\(18,4\)|nvarchar\((?:max|[1-9]\d*)\))$/.test(column.sqlServerType)))
    throw review();
  const keys = table.columns.map(column => column.cloudColumn);
  if (new Set(rows.map(row => row?.id)).size !== rows.length || rows.some(row =>
    !exact(row, keys) || !uuid(row.id) || !Number.isInteger(row.row_version) || row.row_version < 1 ||
    table.columns.some(column => !validValue(column, row[column.cloudColumn])))) throw review();
  return { table, rows };
}

function decodeCorrectionReceipt(registry, context, facts) {
  const wire = facts.receiptGraph;
  if (!wire) throw dependency();
  if (!exact(wire, ["payload_json", "payload_sha256"]) || typeof wire.payload_json !== "string" ||
      Buffer.byteLength(wire.payload_json, "utf8") > MAX_BYTES ||
      createHash("sha256").update(wire.payload_json, "utf8").digest("hex") !== wire.payload_sha256) throw review();
  let graph;
  try { graph = JSON.parse(wire.payload_json); } catch { throw review(); }
  const branch = context.branch;
  if (!exact(graph, ["scope_id", "epoch", "seq", "operation_id", "sale", "items", "tenders"]) ||
      graph.scope_id !== branch || graph.epoch !== context.financialEpoch ||
      graph.seq !== facts.seq || graph.operation_id !== facts.operationId ||
      !Array.isArray(graph.items) || graph.items.length < 1 || graph.items.length > 100 ||
      !Array.isArray(graph.tenders) || graph.tenders.length > 100) throw review();
  const { sale, items, tenders } = graph;
  const registered = [
    registeredRows(registry, "sales", [sale]),
    registeredRows(registry, "sale_items", items),
    registeredRows(registry, "payment_transactions", tenders),
  ];
  if (sale.id !== facts.sale.id || sale.store_id !== branch || sale.row_version !== facts.sale.row_version ||
      (sale.branch_id !== null && sale.branch_id !== branch) ||
      items.some(row => row.sale_id !== sale.id || (row.branch_id !== null && row.branch_id !== branch)) ||
      tenders.some(row => row.sale_id !== sale.id || row.store_id !== branch || row.source_type !== "sale" ||
        row.booking_id !== null || row.shift_id !== sale.shift_id)) throw review();

  if (facts.kind === "refund_v1") {
    const effects = new Map(facts.items.map((row, index) => [row.id, { row, movement: facts.ledger[index] }]));
    if (sale.is_refunded !== facts.sale.is_refunded || items.some(item => {
      const effect = effects.get(item.id);
      if (!effect) return item.refunded_qty !== 0;
      effects.delete(item.id);
      return item.product_id !== effect.row.product_id || item.row_version !== effect.row.row_version ||
        item.refunded_qty !== effect.row.refunded_qty || item.refunded_qty !== effect.movement.delta ||
        item.quantity < item.refunded_qty;
    }) || effects.size) throw review();
  } else {
    const expected = new Map(facts.tenders.map(row => [row.id, row]));
    const embedded = JSON.parse(sale.payments);
    if (sale.is_refunded || items.some(item => item.refunded_qty !== 0) || sale.payment_type !== facts.sale.payment_type ||
        (Array.isArray(embedded) ? embedded.length : null) !== facts.sale.payments_count ||
        tenders.length !== expected.size || tenders.some(row => {
          const target = expected.get(row.id);
          return !target || row.method !== target.method || row.row_version !== target.row_version || row.updated_at !== target.updated_at;
        })) throw review();
  }
  return { sale, items, tenders, registered, changes: registered.flatMap(({ table, rows }) =>
    rows.map(row_data => ({ table_name: table.cloudTable, row_data }))) };
}

async function requireParents(transaction, branch, graph) {
  const { sale, items, tenders } = graph;
  const references = [
    { table: "products", ids: items.map(item => item.product_id).filter(Boolean) },
    { table: "members", ids: [sale.member_id, ...tenders.map(tender => tender.member_id)].filter(Boolean) },
    { table: "shifts", ids: sale.shift_id ? [recordId(sale.shift_id)] : [], scope: true },
  ];
  for (const { table, ids, scope } of references) {
    if (!ids.length) continue;
    if (ids.some(id => !uuid(id))) throw review();
    const unique = [...new Set(ids)];
    const result = await transaction.request().input("keys", JSON.stringify(unique)).input("branch", branch).query(`
      SELECT COUNT(*) AS found FROM dbo.[${table}] AS source WITH(HOLDLOCK)
      JOIN OPENJSON(@keys) AS wanted ON source.id=TRY_CONVERT(uniqueidentifier,wanted.[value])
      ${scope ? "WHERE source.store_id COLLATE Latin1_General_100_BIN2=@branch COLLATE Latin1_General_100_BIN2" : ""};`);
    if (result.recordset?.[0]?.found !== unique.length) throw dependency();
  }
  const result = await transaction.request().input("id", sale.id).input("branch", branch)
    .input("bill", sale.bill_number).query(`
      SELECT CASE WHEN EXISTS(SELECT 1 FROM dbo.sales WITH(UPDLOCK,HOLDLOCK) WHERE id=@id OR (store_id=@branch AND bill_number=@bill))
        OR EXISTS(SELECT 1 FROM dbo.sale_items WITH(UPDLOCK,HOLDLOCK) WHERE sale_id=@id)
        OR EXISTS(SELECT 1 FROM dbo.payment_transactions WITH(UPDLOCK,HOLDLOCK) WHERE sale_id=@id)
        THEN N'existing'
        WHEN EXISTS(SELECT 1 FROM dbo.held_orders WITH(UPDLOCK,HOLDLOCK)
          WHERE store_id=@branch AND bill_no=@bill AND (status IS NULL OR status<>N'completed'))
        THEN N'dependency' ELSE N'clear' END AS state;`);
  const state = result.recordset?.[0]?.state;
  if (state === "dependency") throw dependency();
  if (state !== "clear") throw review();
}

async function insertRows(transaction, { table, rows }) {
  if (!rows.length) return 0;
  // Identifiers and SQL types come only from the validated installed registry.
  // The decoded values remain parameters, including exact JSON and decimals.
  const name = table.sqlServerTable;
  const columns = table.columns.map(column => `[${column.sqlServerColumn}]`);
  const typed = table.columns.map((column, index) => `${columns[index]} ${column.sqlServerType}`);
  const differ = table.columns.map((column, index) => {
    const field = columns[index];
    if (column.sqlServerType.startsWith("nvarchar(")) {
      return `DATALENGTH(saved.${field}) IS DISTINCT FROM DATALENGTH(expected.${field}) OR
        CONVERT(varbinary(max),saved.${field}) IS DISTINCT FROM CONVERT(varbinary(max),expected.${field})`;
    }
    return `saved.${field} IS DISTINCT FROM expected.${field}`;
  }).join(" OR ");
  const result = await transaction.request().input("rows", JSON.stringify(rows)).query(`
    DECLARE @expected TABLE(${typed.join(",")},PRIMARY KEY(id));
    INSERT @expected SELECT ${columns.join(",")} FROM OPENJSON(@rows) WITH (${typed.join(",")});
    IF EXISTS(SELECT 1 FROM dbo.[${name}] AS local WITH(UPDLOCK,HOLDLOCK) JOIN @expected AS wanted ON wanted.id=local.id)
      BEGIN SELECT 0 AS verified; RETURN; END;
    WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
    INSERT dbo.[${name}](${columns.join(",")}) SELECT ${columns.join(",")} FROM @expected;
    SELECT CASE WHEN EXISTS(SELECT 1 FROM @expected expected
      LEFT JOIN dbo.[${name}] AS saved WITH(HOLDLOCK) ON saved.id=expected.id
      WHERE saved.id IS NULL OR ${differ}) THEN 0 ELSE 1 END AS verified;`);
  if (result.recordset?.[0]?.verified !== 1) throw review();
  return rows.length;
}

async function installCorrectionReceipt(transaction, context, facts, graph, ownAcceptance) {
  const branch = context.branch;
  const result = await transaction.request().input("op", facts.operationId).query(`
    SELECT TOP(1) 1 AS owned FROM dbo.local_operation_receipts WITH(HOLDLOCK) WHERE operation_id=@op;`);
  if (!ownAcceptance && result.recordset?.length) throw review();
  await requireParents(transaction, branch, graph);
  let count = 0;
  for (const entry of graph.registered) count += await insertRows(transaction, entry);
  if (facts.kind === "refund_v1" && !ownAcceptance) {
    const ledger = await transaction.request().input("branch", branch).input("rows", JSON.stringify(facts.ledger)).query(`
      DECLARE @movements TABLE(id uniqueidentifier PRIMARY KEY,product uniqueidentifier,delta int,applied datetimeoffset(7));
      INSERT @movements SELECT movement_id,product_id,delta,applied_at FROM OPENJSON(@rows)
        WITH(movement_id uniqueidentifier,product_id uniqueidentifier,delta int,applied_at datetimeoffset(7));
      IF EXISTS(SELECT 1 FROM @movements AS wanted JOIN dbo.stock_delta_applied AS local WITH(UPDLOCK,HOLDLOCK)
        ON local.movement_id=wanted.id) BEGIN SELECT 0 AS verified; RETURN; END;
      WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
      INSERT dbo.stock_delta_applied(movement_id,product_id,store_id,delta,applied_at)
        SELECT id,product,@branch,delta,applied FROM @movements;
      SELECT @@ROWCOUNT AS verified;`);
    if (ledger.recordset?.[0]?.verified !== facts.ledger.length) throw review();
    count += facts.ledger.length;
  }
  return count;
}

module.exports = { decodeCorrectionReceipt, installCorrectionReceipt };
