const { recordId } = require("../sync/uuid-fields.cjs");

const FINANCIAL_TABLES = new Set(["sales", "sale_items", "payment_transactions"]);
const rowsOf = op => op.rows ?? (op.values ? [op.values] : []);
const forbidden = () => {
  throw Object.assign(new Error("Saved receipts must use the protected refund or correction workflow."), { code: "PERMISSION_DENIED" });
};

/** Main derives these links from the complete, permission-checked sale graph. */
function exchangeLinks(operations, permissions) {
  const links = new Map();
  if (permissions.can_process_sale !== true || permissions.can_process_exchange !== true) return links;
  const sales = operations.filter(op => op.table === "sales" && ["insert", "upsert"].includes(op.kind)).flatMap(rowsOf);
  for (const op of operations) {
    if (op.table !== "sales" || op.kind !== "update") continue;
    const match = op.match ?? {};
    const values = op.values ?? {};
    if (op.requireMatch !== true || Object.keys(values).length !== 1 ||
        typeof values.exchanged_to_bill_number !== "string" || !values.exchanged_to_bill_number.trim() ||
        typeof match.id !== "string" || !match.id || typeof match.bill_number !== "string" || !match.bill_number ||
        match.is_refunded !== false || match.exchanged_to_bill_number !== null ||
        Object.keys(match).some(key => !["id", "bill_number", "is_refunded", "exchanged_to_bill_number"].includes(key))) continue;
    const replacement = sales.find(sale => sale.is_exchange === true && sale.original_bill_number === match.bill_number &&
      sale.bill_number === values.exchanged_to_bill_number && typeof sale.id === "string" && sale.id && recordId(sale.id) !== recordId(match.id));
    if (replacement) links.set(exchangeKey(op), recordId(replacement.id));
  }
  return links;
}

function exchangeKey(op) {
  return JSON.stringify([recordId(op.match?.id), op.match?.bill_number, op.values?.exchanged_to_bill_number]);
}

/** The aggregate label never permits rewriting a posted financial record. */
function assertFinancialWrite(op, scope = {}) {
  if (!FINANCIAL_TABLES.has(op.table) || !["update", "delete"].includes(op.kind)) return;
  if (op.table === "sales" && op.kind === "update" && scope.financialExchangeLinks?.has(exchangeKey(op)) &&
      Object.keys(op.values ?? {}).length === 1 && Object.hasOwn(op.values, "exchanged_to_bill_number") &&
      op.requireMatch === true && op.match?.is_refunded === false && op.match?.exchanged_to_bill_number === null)
    return scope.financialExchangeLinks.get(exchangeKey(op));
  forbidden();
}

module.exports = { exchangeLinks, assertFinancialWrite };
