const { stockMap } = require("./stock-history-contract.cjs");

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const stockFields = ["stock_quantity", "stock_by_store"];
const adjustmentError = () => Object.assign(
  new Error("The stock adjustment no longer matches the saved product quantities. Refresh inventory before trying again."),
  { code: "ESTOCK_ADJUSTMENT_UNVERIFIED", table: "stock_adjustments" },
);
const integer = value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;

// Validate authority and request scope before returning any old operation
// receipt. The receipt by itself does not authorize a different branch.
function stockAdjustmentScope(kind, operations, aggregate) {
  if (kind !== "stock") return null;
  const adjustments = operations.filter(operation => operation.table === "stock_adjustments");
  if (!adjustments.length) return null;
  const { branchId, terminalId, activityOperator } = aggregate;
  if (aggregate.enforcePermissions !== true || aggregate.permissions?.can_adjust_stock !== true ||
      !activityOperator?.subject || !branchId || !terminalId)
    throw Object.assign(new Error("A verified operator and terminal are required to adjust stock."), { code: "PERMISSION_DENIED" });
  const rows = adjustments.flatMap(operation => operation.rows ?? (operation.values ? [operation.values] : []));
  if (adjustments.some(operation => !["insert", "upsert"].includes(operation.kind)) || !rows.length)
    throw adjustmentError();
  if (rows.some(row => row.store_id !== branchId || (row.terminal_id != null && row.terminal_id !== terminalId)))
    throw Object.assign(new Error("The stock adjustment belongs to another branch or terminal."), {
      code: "SYNC_BRANCH_FORBIDDEN", table: "stock_adjustments",
    });
  return { rows, branchId, terminalId, actor: activityOperator };
}

async function readProducts(sql, transaction, productIds) {
  const result = await new sql.Request(transaction)
    .input("products", sql.NVarChar(sql.MAX), JSON.stringify(productIds))
    .query(`SELECT LOWER(CONVERT(nvarchar(36),product.id)) id, product.stock_by_store, product.stock_quantity
      FROM dbo.products product WITH (UPDLOCK,HOLDLOCK)
      JOIN OPENJSON(@products) wanted ON product.id=CONVERT(uniqueidentifier,wanted.value);`);
  return new Map((result.recordset ?? []).map(row => [row.id, row]));
}

function readBuckets(product) {
  if (!product || !integer(product.stock_quantity)) throw adjustmentError();
  let buckets;
  try { buckets = stockMap(product.stock_by_store); }
  catch { throw adjustmentError(); }
  if ([...buckets.values()].reduce((sum, value) => sum + value, 0n) !== BigInt(product.stock_quantity))
    throw adjustmentError();
  return buckets;
}

async function prepareStockAdjustment(sql, transaction, operations, scope) {
  const { rows, branchId } = scope;
  const ids = new Set();
  const products = new Map();
  for (const row of rows) {
    if (!uuid.test(row.id) || !uuid.test(row.product_id) || ids.has(row.id) || products.has(row.product_id) ||
        ![row.previous_stock, row.updated_stock, row.delta].every(integer) ||
        row.updated_stock - row.previous_stock !== row.delta) throw adjustmentError();
    ids.add(row.id);
    products.set(row.product_id, row);
  }

  const changed = new Set();
  for (const operation of operations.filter(operation => operation.table === "products")) {
    if (operation.kind === "delete") throw adjustmentError();
    const values = operation.rows ?? [operation.values];
    for (const value of values) {
      if (!value || !stockFields.some(field => Object.hasOwn(value, field))) continue;
      const id = operation.kind === "update" ? operation.match?.id : value.id;
      if (!products.has(id) || changed.has(id)) throw adjustmentError();
      changed.add(id);
    }
  }
  if (changed.size !== products.size) throw adjustmentError();

  const existing = await new sql.Request(transaction)
    .input("adjustment_ids", sql.NVarChar(sql.MAX), JSON.stringify([...ids]))
    .query(`SELECT TOP (1) 1 AS already_saved FROM OPENJSON(@adjustment_ids) wanted
      WHERE EXISTS (SELECT 1 FROM dbo.stock_adjustments prior WITH (UPDLOCK,HOLDLOCK)
        WHERE prior.id=CONVERT(uniqueidentifier,wanted.value))
      OR EXISTS (SELECT 1 FROM dbo.stock_delta_applied prior WITH (UPDLOCK,HOLDLOCK)
        WHERE prior.movement_id=CONVERT(uniqueidentifier,wanted.value));`);
  if (existing.recordset?.length) throw adjustmentError();

  const before = await readProducts(sql, transaction, [...products.keys()]);
  for (const [id, adjustment] of products) {
    if ((readBuckets(before.get(id)).get(branchId) ?? 0n) !== BigInt(adjustment.previous_stock))
      throw adjustmentError();
  }
  const movements = rows.filter(row => row.delta !== 0).map(row => ({
    movement_id: row.id, product_id: row.product_id, store_id: branchId, delta: row.delta,
  }));
  return { products, before, movements };
}

function stampStockAdjustments(operation, scope) {
  if (!scope || operation.table !== "stock_adjustments") return operation;
  const stamp = row => ({ ...row, terminal_id: scope.terminalId,
    staff_id: scope.actor.authorId ?? scope.actor.subject, role: scope.actor.role });
  return operation.rows ? { ...operation, rows: operation.rows.map(stamp) }
    : { ...operation, values: stamp(operation.values) };
}

async function saveStockAdjustmentReceipts(sql, transaction, plan, branchId, operationId) {
  const after = await readProducts(sql, transaction, [...plan.products.keys()]);
  for (const [id, adjustment] of plan.products) {
    const saved = after.get(id);
    const before = readBuckets(plan.before.get(id));
    const current = readBuckets(saved);
    if ((current.get(branchId) ?? 0n) !== BigInt(adjustment.updated_stock) ||
        [...new Set([...before.keys(), ...current.keys()])].some(key => key !== branchId && before.get(key) !== current.get(key)))
      throw adjustmentError();
  }
  if (!plan.movements.length) return 0;

  // The existing product write already changed local stock. The ledger row
  // makes the same relative change portable through the ordinary cloud aggregate.
  await new sql.Request(transaction)
    .input("movements", sql.NVarChar(sql.MAX), JSON.stringify(plan.movements))
    .input("branch", branchId)
    .input("operation", sql.UniqueIdentifier, operationId)
    .query(`DECLARE @new_movements TABLE (movement_id uniqueidentifier PRIMARY KEY, product_id uniqueidentifier, delta int);
      INSERT @new_movements SELECT movement_id,product_id,delta FROM OPENJSON(@movements)
        WITH (movement_id uniqueidentifier,product_id uniqueidentifier,delta int);
      INSERT dbo.stock_delta_applied(movement_id,product_id,store_id,delta)
        SELECT movement_id,product_id,@branch,delta FROM @new_movements;
      INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)
        SELECT N'stock_delta_applied',CONCAT(N'{"movement_id":"',LOWER(CONVERT(nvarchar(36),movement_id)),N'"}'),
          N'insert',@branch,1,@operation FROM @new_movements;`);
  return plan.movements.length;
}

module.exports = { stockAdjustmentScope, prepareStockAdjustment, stampStockAdjustments, saveStockAdjustmentReceipts };
