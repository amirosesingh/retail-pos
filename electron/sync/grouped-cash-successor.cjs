const { exactRows, parseExactJson, stringifyExactJson, projection } = require("./shift-recovery-exact.cjs");
const { recordId } = require("./uuid-fields.cjs");

// Only fields changed by the existing correction writers may supersede a cash
// birth. A newer revision alone is never evidence that a different row is safe.
const mutable = {
  refund_v1: { sales: ["is_refunded", "row_version"], sale_items: ["refunded_qty", "row_version"] },
  tender_v1: { sales: ["payment_type", "payments", "row_version"],
    payment_transactions: ["method", "updated_at", "row_version"] },
};

function exactRemote(table, row) {
  return Object.fromEntries(table.columns.map(column => {
    let value = row[column.cloudColumn];
    const type = String(column.cloudType).toLowerCase();
    if (value !== null) {
      if (/^(numeric|decimal|money|smallmoney|bigint|integer|smallint|real|double precision)/.test(type))
        value = parseExactJson(String(value));
      else if (type === "jsonb" || type.endsWith("[]"))
        value = parseExactJson(typeof value === "string" ? value : JSON.stringify(value));
    }
    return [column.cloudColumn, value];
  }));
}

async function matches(transaction, table, row) {
  const result = await transaction.request().input("cashSuccessorKey", row.id).query(`
    SELECT ${projection(table)} FROM dbo.[${table.sqlServerTable}] source WITH(UPDLOCK,HOLDLOCK)
    WHERE source.id=@cashSuccessorKey;`);
  return exactRows(table, result.recordset ?? [], [exactRemote(table, row)]);
}

async function exactChildren(transaction, name, saleId, expected) {
  const result = await transaction.request().input("cashSuccessorSale", saleId).query(`
    SELECT source.id FROM dbo.[${name}] source WITH(UPDLOCK,HOLDLOCK) WHERE source.sale_id=@cashSuccessorSale;`);
  const ids = (result.recordset ?? []).map(row => recordId(row.id));
  return ids.length === expected.length && new Set(ids).size === ids.length && expected.every(row => ids.includes(row.id));
}

function sameTenderPayments(registry, cash, graph) {
  const withoutMethod = value => {
    const rows = parseExactJson(typeof value === "string" ? value : JSON.stringify(value));
    if (!Array.isArray(rows) || rows.some(row => !row || Array.isArray(row) || typeof row !== "object" || typeof row.method !== "string")) return null;
    return rows.map(row => ({ ...row, method: "verified-tender-method" }));
  };
  const birth = withoutMethod(cash.sale.payments), later = withoutMethod(graph.sale.payments);
  if (!birth || !later) return false;
  const table = registry.tables.find(table => table.cloudTable === "sales");
  const comparison = { ...table, columns: table.columns.filter(column => ["id", "payments"].includes(column.cloudColumn)) };
  return exactRows(comparison, [{ id: cash.sale.id, payments: stringifyExactJson(birth) }], [{ id: graph.sale.id, payments: later }]);
}

async function preservesCashBirth(worker, transaction, context, cash) {
  // This lazy loader exists only in an atomic, extended pinned-page recovery.
  // It returns a revalidated later publication from that same staged archive.
  if (!context.extended || typeof context.cashSuccessor !== "function") return false;
  const correction = await context.cashSuccessor();
  if (!correction || !mutable[correction.kind] || !correction.receiptGraph ||
      correction.sale.id !== cash.sale.id || BigInt(correction.seq) <= BigInt(cash.seq)) return false;
  const graph = require("./grouped-correction-receipt.cjs").decodeCorrectionReceipt(worker.registry,
    { branch: context.branch, financialEpoch: cash.epoch }, correction);
  // A correction cannot authorize replacement tenders/lines under the birth.
  // The current grouped checkout has one line and a fixed complete tender set.
  if (graph.items.length !== 1 || graph.items[0].id !== cash.item.id || graph.tenders.length !== cash.tenders.length ||
      graph.tenders.some(row => !cash.tenders.some(tender => tender.id === row.id))) return false;
  if (correction.kind === "tender_v1" && !sameTenderPayments(worker.registry, cash, graph)) return false;
  for (const { table, rows } of graph.registered)
    for (const row of rows) if (!await matches(transaction, table, row)) return false;
  // Compare the complete local child sets, including foreign-labelled or fully
  // refunded extras. Per-ID equality alone would not prove graph completeness.
  if (!await exactChildren(transaction, "sale_items", cash.sale.id, graph.items) ||
      !await exactChildren(transaction, "payment_transactions", cash.sale.id, graph.tenders)) return false;
  for (const { table, change } of cash.rows) {
    const excluded = mutable[correction.kind][table.cloudTable] ?? [];
    const columns = table.columns.filter(column => Object.hasOwn(change.row_data, column.cloudColumn) && !excluded.includes(column.cloudColumn));
    if (!await matches(transaction, { ...table, columns }, change.row_data)) return false;
  }
  return true;
}

module.exports = { preservesCashBirth };
