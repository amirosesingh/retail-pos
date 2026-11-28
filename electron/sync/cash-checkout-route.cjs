const { recordId } = require("./uuid-fields.cjs");

const TABLES = Object.freeze(["sales", "sale_items", "payment_transactions", "item_activity_logs", "products"]);
const FENCE = "__grouped_cash_sender_v1__";
const PREFIX = Buffer.from("POSCASH1", "ascii");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOLD_MESSAGES = {
  ESYNC_CASH_ROUTE_HELD: "The original cash checkout still owns this upload. Its saved work remains pending.",
  ESYNC_CASH_HANDOFF_REQUIRED: "The cash checkout is saved and waiting for its verified synchronization handoff.",
  WAITING_DEPENDENCY: "The cash checkout is saved and waiting for its shift to synchronize.",
  REVIEW_REQUIRED: "The cash checkout is saved and its matching central receipt needs review.",
  INTEGRITY_CONFLICT: "The cash checkout is saved and its operation identity conflicts with the central receipt.",
  IN_PROGRESS: "The cash checkout is saved and waiting for the central acknowledgement.",
};
const uploadHold = (code = "ESYNC_CASH_ROUTE_HELD") => ({ code, table: "sales", message: HOLD_MESSAGES[code] });
const fail = () => Object.assign(new Error(HOLD_MESSAGES.ESYNC_CASH_ROUTE_HELD), uploadHold());

function contextForCashCheckout(operationId) {
  if (typeof operationId !== "string" || !UUID.test(operationId)) throw fail();
  return Buffer.concat([PREFIX, Buffer.from(operationId.replaceAll("-", ""), "hex")]);
}

function cashCheckoutForContext(context) {
  if (!Buffer.isBuffer(context) || !context.subarray(0, PREFIX.length).equals(PREFIX)) return null;
  if (context.length !== PREFIX.length + 16) throw fail();
  const hex = context.subarray(PREFIX.length).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function cashRowKeys(table, rows) {
  if (!TABLES.includes(table)) return [];
  return [...new Set(rows.map(row => recordId((row.key ?? row).id))
    .filter(id => typeof id === "string" && UUID.test(id)))].map(id => ({ table, id }));
}

module.exports = { TABLES, FENCE, fail, uploadHold, contextForCashCheckout, cashCheckoutForContext, cashRowKeys };
