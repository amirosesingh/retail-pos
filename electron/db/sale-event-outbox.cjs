const { createHash } = require("node:crypto");
const { decimal, projection } = require("../sync/shift-recovery-exact.cjs");
const { recordId } = require("../sync/uuid-fields.cjs");

const EVENT_TYPE = "SaleCompleted";
const MAX_PAYLOAD_BYTES = 512 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields = {
  sales: ["id", "bill_number", "client_transaction_id", "store_id", "shift_id", "cashier_id", "cashier_name",
    "subtotal_amount", "total_amount", "discount_amount", "tax_amount", "payment_type", "paid_amount",
    "change_amount", "created_at", "rounding_adjustment", "rounding_label", "row_version", "member_id",
    "is_exchange", "is_refunded", "original_bill_number", "authorization_request_id", "authorized_by",
    "authorized_at", "coupon_code", "coupon_promo_id", "coupon_scope", "coupon_discount"],
  sale_items: ["id", "sale_id", "branch_id", "product_id", "product_name", "variant_code", "quantity",
    "unit_price", "unit_cost", "discount_percent", "discount_amount", "tax_rate", "is_return", "is_foc",
    "promo_id", "coupon_code", "coupon_discount", "row_version"],
  payment_transactions: ["id", "source_type", "sale_id", "store_id", "shift_id", "terminal_id", "amount",
    "method", "kind", "paid_at", "created_at", "status", "client_transaction_id", "row_version"],
  item_activity_logs: ["id", "product_id", "store_id", "terminal_id", "activity_type", "reference",
    "quantity_delta", "unit_cost", "created_at", "row_version"],
};

function refuse() {
  throw Object.assign(new Error("The checkout is outside the supported immutable sale capture or its saved facts are incomplete."), {
    code: "ESALE_EVENT_UNVERIFIED",
  });
}

const uuid = value => typeof value === "string" && UUID.test(value);
const scopedId = value => typeof value === "string" && value.length <= 128 && value.trim() === value && value !== "";
const positive = value => {
  const normalized = decimal(value);
  return normalized && normalized !== "0" && !normalized.startsWith("-");
};

function expectedIds(operations, table) {
  const ids = new Set();
  for (const operation of operations.filter(operation => operation.table === table)) {
    if (!["insert", "upsert"].includes(operation.kind)) refuse();
    for (const { id } of operation.rows ?? (operation.values ? [operation.values] : [])) {
      if (!uuid(id) || ids.has(recordId(id))) refuse();
      ids.add(recordId(id));
    }
  }
  return ids;
}

function assertExactIds(rows, expected) {
  if (rows.length !== expected.size) refuse();
  for (const row of rows) if (!expected.delete(recordId(row.id))) refuse();
}

// This capture is injected only in isolated preparation. Delivery and its
// mutable dispositions belong to a separate, reviewed protocol slice.
class SaleEventOutbox {
  constructor(connectionManager, registry) {
    this.connectionManager = connectionManager;
    this.projections = Object.fromEntries(Object.entries(fields).map(([name, names]) => {
      const table = registry.tables.find(table => table.sqlServerTable === name);
      const columns = names.map(column => table?.columns.find(candidate => candidate.sqlServerColumn === column));
      if (columns.some(column => !column)) refuse();
      return [name, projection({ columns })];
    }));
  }

  async capture(transaction, { operationId, branchId, terminalId, operations, confirmedStock }) {
    if (!uuid(operationId) || !scopedId(branchId) || !scopedId(terminalId) ||
        operations.some(operation => !Object.hasOwn(fields, operation.table) && operation.table !== "products")) refuse();
    const sales = expectedIds(operations, "sales");
    const items = expectedIds(operations, "sale_items");
    const tenders = expectedIds(operations, "payment_transactions");
    const movements = expectedIds(operations, "item_activity_logs");
    if (sales.size !== 1 || !items.size || tenders.size !== 1 ||
        confirmedStock.size !== operations.filter(operation => operation.table === "products").length) refuse();

    const saleId = sales.values().next().value;
    const sql = this.connectionManager.sql();
    const result = await new sql.Request(transaction)
      .input("sale", sql.UniqueIdentifier, saleId)
      .input("branch", sql.NVarChar(128), branchId)
      .input("item_limit", sql.Int, items.size + 1)
      .input("movements", sql.NVarChar(sql.MAX), JSON.stringify([...movements]))
      .query(`SELECT ${this.projections.sales} FROM dbo.sales source WHERE id=@sale AND store_id=@branch;
        SELECT TOP (@item_limit) ${this.projections.sale_items} FROM dbo.sale_items source WHERE sale_id=@sale ORDER BY id;
        SELECT TOP (2) ${this.projections.payment_transactions} FROM dbo.payment_transactions source WHERE sale_id=@sale ORDER BY id;
        SELECT ${this.projections.item_activity_logs} FROM dbo.item_activity_logs source
        WHERE id IN (SELECT CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@movements)) ORDER BY id;`);
    const [headers, savedItems, savedTenders, savedMovements] = result.recordsets ?? [];
    if (!headers || !savedItems || !savedTenders || !savedMovements) refuse();
    assertExactIds(headers, sales);
    assertExactIds(savedItems, items);
    assertExactIds(savedTenders, tenders);
    assertExactIds(savedMovements, movements);

    const [sale] = headers;
    const [tender] = savedTenders;
    const shiftId = recordId(sale.shift_id);
    const matchesTerminal = value => value == null || recordId(value) === recordId(terminalId);
    if (recordId(sale.store_id) !== recordId(branchId) || !uuid(shiftId) || !sale.bill_number || !sale.created_at ||
        sale.member_id != null || sale.is_exchange !== false || sale.is_refunded !== false || sale.original_bill_number != null ||
        sale.payment_type !== "cash" || !positive(sale.total_amount) || !positive(sale.paid_amount) ||
        [sale.subtotal_amount, sale.tax_amount, sale.discount_amount, sale.change_amount].some(value => decimal(value) === undefined) ||
        recordId(tender.store_id) !== recordId(branchId) || recordId(tender.shift_id) !== shiftId ||
        !matchesTerminal(tender.terminal_id) || tender.source_type !== "sale" || tender.method !== "cash" ||
        tender.kind !== "payment" || tender.status !== "completed" || !tender.paid_at ||
        decimal(tender.amount) !== decimal(sale.paid_amount)) refuse();

    const itemQuantities = new Map();
    const movementDeltas = new Map();
    for (const item of savedItems) {
      const quantity = Number(item.quantity);
      if (recordId(item.branch_id) !== recordId(branchId) || !Number.isSafeInteger(quantity) || quantity <= 0 ||
          item.is_return !== false || [item.unit_price, item.tax_rate, item.discount_percent, item.discount_amount]
            .some(value => decimal(value) === undefined)) refuse();
      if (item.product_id != null) {
        const productId = recordId(item.product_id);
        if (!uuid(productId)) refuse();
        itemQuantities.set(productId, (itemQuantities.get(productId) ?? 0) - quantity);
      }
    }
    for (const movement of savedMovements) {
      const productId = recordId(movement.product_id);
      const delta = Number(movement.quantity_delta);
      if (!uuid(productId) || !Number.isSafeInteger(delta) || delta >= 0 ||
          recordId(movement.store_id) !== recordId(branchId) || !matchesTerminal(movement.terminal_id) ||
          movement.activity_type !== "sale" || movement.reference !== sale.bill_number) refuse();
      movementDeltas.set(productId, (movementDeltas.get(productId) ?? 0) + delta);
    }
    if (confirmedStock.size !== itemQuantities.size || confirmedStock.size !== movementDeltas.size ||
        [...confirmedStock].some(([id, delta]) => delta !== itemQuantities.get(id) || delta !== movementDeltas.get(id))) refuse();

    const payload = JSON.stringify({
      eventType: EVENT_TYPE, version: 1, operationId: recordId(operationId), branchId, terminalId, shiftId,
      sale, items: savedItems, tenders: savedTenders, movements: savedMovements,
    });
    if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) refuse();
    await new sql.Request(transaction)
      .input("operation", sql.UniqueIdentifier, operationId)
      .input("branch", sql.NVarChar(128), branchId)
      .input("terminal", sql.NVarChar(128), terminalId)
      .input("shift", sql.UniqueIdentifier, shiftId)
      .input("sale", sql.UniqueIdentifier, saleId)
      .input("payload", sql.NVarChar(sql.MAX), payload)
      .input("hash", sql.Char(64), createHash("sha256").update(payload).digest("hex"))
      .query(`INSERT dbo.pos_sync_sale_outbox_v1(operation_id,branch_id,terminal_id,shift_id,sale_id,payload_json,payload_hash)
        VALUES(@operation,@branch,@terminal,@shift,@sale,@payload,@hash);`);
  }
}

module.exports = { SaleEventOutbox };
