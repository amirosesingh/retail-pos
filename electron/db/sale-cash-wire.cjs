const { decimal } = require("../sync/shift-recovery-exact.cjs");
const { extendedTenderFields, extendedPayments, decodeTenderJson } = require("../sync/sale-tender-evidence.mjs");
const { normalizeUuidFields, recordId } = require("../sync/uuid-fields.cjs");

// Exactly the prepared owner's cash bridge projection. The local evidence
// also keeps its existing wider, non-transmitted shadow projection.
const wireFields = {
  sales: ["id", "bill_number", "client_transaction_id", "store_id", "branch_id", "shift_id", "subtotal_amount",
    "total_amount", "discount_amount", "tax_amount", "payment_type", "points_earned", "points_redeemed", "is_exchange",
    "is_refunded", "created_at", "paid_amount", "change_amount", "exchange_credit", "coupon_discount",
    "rounding_adjustment", "row_version"],
  sale_items: ["id", "sale_id", "branch_id", "product_id", "product_name", "quantity", "unit_price", "discount_percent",
    "discount_amount", "tax_rate", "is_return", "is_foc", "created_at", "coupon_discount", "unit_cost", "row_version", "refunded_qty"],
  payment_transactions: ["id", "source_type", "sale_id", "store_id", "shift_id", "terminal_id", "amount", "method", "kind",
    "note", "paid_at", "created_at", "updated_at", "row_version", "status"],
  item_activity_logs: ["id", "product_id", "store_id", "terminal_id", "activity_type", "reference", "quantity_delta", "unit_cost",
    "note", "created_at", "row_version"],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const textId = value => typeof value === "string" && value.length <= 128 && value.trim() === value && value !== "";
const uuid = value => typeof value === "string" && UUID.test(value);
const equalAmount = (left, right) => decimal(left) !== undefined && decimal(left) === decimal(right);
const allZero = values => values.every(value => decimal(value) === "0");
const exactFields = (row, names) => Object.fromEntries(names.map(name => [name, row[name]]));
function refuseCashBridge() {
  throw Object.assign(new Error("The saved checkout or installation does not match the prepared cash bridge."), {
    code: "ESALE_CASH_BRIDGE_UNVERIFIED",
  });
}

function checkedCashBridgeScope(scope) {
  const { branchId, terminalId, installationGeneration, feedEpoch, databaseGuid } = scope ?? {};
  if (!textId(branchId) || ![terminalId, installationGeneration, feedEpoch, databaseGuid].every(uuid)) refuseCashBridge();
  return Object.freeze({ branchId: recordId(branchId), terminalId: recordId(terminalId),
    installationGeneration: recordId(installationGeneration), feedEpoch: recordId(feedEpoch), databaseGuid: recordId(databaseGuid) });
}

function cashBridgeCheckout(scope, { sale, items, tenders, movements, confirmedStock, allowExtendedTenders }) {
  const extended = tenders.length !== 1 || sale.payment_type !== "cash";
  if (items.length !== 1 || !tenders.length || (extended && !allowExtendedTenders) ||
      movements.length !== 1 || confirmedStock.size !== 1) refuseCashBridge();
  const [item] = items, [tender] = tenders, [movement] = movements;
  const product = confirmedStock.get(recordId(item.product_id))?.product;
  const quantity = Number(item.quantity);
  const normalizedPrice = decimal(item.unit_price);
  if (!product || !Number.isSafeInteger(quantity) || quantity <= 0 || !normalizedPrice || normalizedPrice === "0") refuseCashBridge();
  const [priceDigits, priceExponent] = normalizedPrice.split("e");
  const calculated = `${BigInt(priceDigits) * BigInt(quantity)}e${priceExponent}`;
  const [whole, fraction = ""] = sale.total_amount.split(".");
  const wholeAmount = BigInt(whole);
  if (wholeAmount > 1_000_000n || (wholeAmount === 1_000_000n && /[1-9]/.test(fraction)) ||
      recordId(sale.branch_id) !== scope.branchId || !sale.client_transaction_id?.trim() ||
      sale.authorization_request_id != null || sale.authorized_by != null || sale.authorized_at != null ||
      sale.coupon_code != null || sale.coupon_promo_id != null || sale.coupon_scope != null ||
      !allZero([sale.discount_amount, sale.tax_amount, sale.coupon_discount, sale.rounding_adjustment,
        sale.points_earned, sale.points_redeemed, sale.exchange_credit, sale.change_amount]) ||
      ![sale.subtotal_amount, sale.paid_amount, calculated].every(amount => equalAmount(amount, sale.total_amount)) ||
      ![sale, item, ...tenders, movement].every(row => row.row_version === "1") ||
      item.is_foc !== false || item.promo_id != null || item.coupon_code != null || !item.created_at ||
      !allZero([item.discount_percent, item.discount_amount, item.tax_rate, item.coupon_discount, item.refunded_qty]) ||
      tenders.some(row => !row.created_at || !row.updated_at || row.note !== "") || movement.note !== "" || !movement.created_at ||
      recordId(product.owner_store_id) !== scope.branchId || product.is_archived !== false ||
      product.name !== item.product_name || !equalAmount(product.selling_price, item.unit_price) ||
      !equalAmount(product.cost_price, item.unit_cost) || !equalAmount(product.cost_price, movement.unit_cost)) refuseCashBridge();

  if (extended) {
    const byAttempt = new Map(tenders.map(row => [row.client_transaction_id, row]));
    const ordered = tenders.map((_, index) => byAttempt.get(`${sale.client_transaction_id}:pay:${index}`));
    if (ordered.some(row => !row)) refuseCashBridge();
    const payments = extendedPayments(sale, ordered);
    if (!payments) refuseCashBridge();
    return normalizeUuidFields({
      sale: { ...exactFields(sale, wireFields.sales), payments },
      item: exactFields(item, wireFields.sale_items),
      tenders: ordered.map(row => ({ ...exactFields(row, [...wireFields.payment_transactions, ...extendedTenderFields]),
        terminal_id: scope.terminalId, metadata: decodeTenderJson(row.metadata) })),
      movement: { ...exactFields(movement, wireFields.item_activity_logs), terminal_id: scope.terminalId },
    });
  }
  if (!equalAmount(tender.amount, sale.total_amount)) refuseCashBridge();
  // The saved cash ledger establishes the tender. Its UI-only JSON,
  // references, and notes outside the reviewed shape never travel.
  return normalizeUuidFields({
    sale: { ...exactFields(sale, wireFields.sales), payments: [{ id: tender.id, method: "cash", amount: tender.amount }] },
    item: exactFields(item, wireFields.sale_items),
    tender: { ...exactFields(tender, wireFields.payment_transactions), terminal_id: scope.terminalId, metadata: {} },
    movement: { ...exactFields(movement, wireFields.item_activity_logs), terminal_id: scope.terminalId },
  });
}

module.exports = { wireFields, extendedTenderFields, extendedPayments, cashBridgeCheckout, checkedCashBridgeScope, refuseCashBridge };
