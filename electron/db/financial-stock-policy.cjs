const { recordId } = require("../sync/uuid-fields.cjs");
function refused() { throw Object.assign(new Error("The sale may change only its branch's stock by the bill quantity."), { code: "PERMISSION_DENIED" }); }
function financialStockDeltas(operations, financial) {
  const result = new Map();
  if (!financial) return result;
  const sales = new Set(operations.filter(op => op.table === "sales" && ["insert", "upsert"].includes(op.kind)).flatMap(op => op.rows ?? (op.values ? [op.values] : [])).map(row => recordId(row.id)));
  const itemIds = new Set();
  for (const row of operations.filter(op => op.table === "sale_items").flatMap(op => op.rows ?? (op.values ? [op.values] : []))) {
    if (!row.product_id) continue;
    if (!row.id || itemIds.has(recordId(row.id))) refused();
    itemIds.add(recordId(row.id));
    if (!sales.has(recordId(row.sale_id)) || Number(row.quantity) === 0 || !Number.isFinite(Number(row.quantity))) refused();
    const id = recordId(row.product_id);
    // Sale items already encode exchange credits with negative quantities.
    result.set(id, (result.get(id) ?? 0) - Number(row.quantity));
  }
  const productIds = new Set();
  for (const op of operations.filter(op => op.table === "products")) {
    const id = recordId(op.match?.id);
    if (op.kind !== "update" || !result.has(id) || productIds.has(id)) refused();
    productIds.add(id);
  }
  return result;
}
function isFinancialStockUpdate(op, scope) {
  return op.table === "products" && scope.enforcePermissions === true && scope.productWriteKind === "sale" && scope.financialStockDeltas?.has(recordId(op.match?.id));
}
function stockMap(value, rejectAliases = false) {
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { refused(); } }
  if (!value || typeof value !== "object" || Array.isArray(value)) refused();
  const result = {};
  for (const [key, quantity] of Object.entries(value)) {
    if (!Number.isFinite(Number(quantity))) refused();
    const id = recordId(key.trim());
    if (!id || (rejectAliases && Object.hasOwn(result, id))) refused();
    result[id] = (result[id] ?? 0) + Number(quantity);
  }
  return result;
}
function assertFinancialStockUpdate(op, scope, current) {
  if (!isFinancialStockUpdate(op, scope)) return false;
  if (op.kind !== "update" || Object.keys(op.match ?? {}).join(",") !== "id" || !scope.branchId ||
      Object.keys(op.values ?? {}).some(key => !["stock_quantity", "stock_by_store"].includes(key)) ||
      !("stock_by_store" in (op.values ?? {})) || !("stock_quantity" in (op.values ?? {})) || !current) refused();
  const branch = recordId(scope.branchId), before = stockMap(current.stock_by_store), after = stockMap(op.values.stock_by_store, true);
  const delta = scope.financialStockDeltas.get(recordId(op.match.id));
  for (const key of new Set([...Object.keys(before), ...Object.keys(after), branch])) {
    const expected = (before[key] ?? 0) + (key === branch ? delta : 0);
    if (Math.abs((after[key] ?? 0) - expected) > 0.000001) refused();
  }
  if (!Number.isFinite(Number(op.values.stock_quantity)) || Math.abs(Number(op.values.stock_quantity) - (Number(current.stock_quantity) + delta)) > 0.000001) refused();
  return true;
}
module.exports = { financialStockDeltas, isFinancialStockUpdate, assertFinancialStockUpdate };
