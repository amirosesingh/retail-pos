const { createHash } = require("node:crypto");
const { normalizeFinancialAttestation } = require("../security/financial-author-protocol.cjs");

const DOMAIN = "retail-pos.native-refund.v1";
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const MAX_BYTES = 64 * 1024;
const refundHeld = (code = "ESYNC_REFUND_REVIEW_REQUIRED") => Object.assign(new Error(
  code === "ESYNC_REFUND_APPROVAL_REQUIRED"
    ? "This saved refund is waiting for its original authorization."
    : "This saved refund is waiting for verified synchronization. Its original journal remains pending.",
), { code, table: "sales" });
const exact = (row, keys) => !!row && !Array.isArray(row) && typeof row === "object" &&
  Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key));
const isUuid = value => typeof value === "string" && UUID.test(value);
const count = value => Number.isInteger(value) && value >= 0 && value <= 999999999;
const version = value => Number.isInteger(value) && value >= 1 && value <= 2147483647;
const label = value => typeof value === "string" && value.length > 0 && value.length <= 128 &&
  value.trim() === value && !/\p{Cc}/u.test(value);

function stableRefundUuid(value) {
  const json = JSON.stringify(value, Object.keys(value).sort());
  const hash = createHash("sha256").update(json).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function decodeRefundCommand(refundJson, attestation) {
  if (typeof refundJson !== "string" || Buffer.byteLength(refundJson, "utf8") > MAX_BYTES) throw refundHeld();
  let saved, author;
  try {
    saved = JSON.parse(refundJson);
    author = normalizeFinancialAttestation(attestation);
  } catch { throw refundHeld(); }
  if (!exact(saved, ["domain", "scope", "command", "items"]) || saved.domain !== DOMAIN ||
      !exact(saved.scope, ["branchId", "terminalId", "databaseGuid", "feedEpoch", "installationGeneration"]) ||
      !["terminalId", "databaseGuid", "feedEpoch", "installationGeneration"].every(key => isUuid(saved.scope[key])) ||
      !label(saved.scope.branchId) ||
      !exact(saved.command, ["branchId", "operationId", "refundKey", "saleId", "expectedSaleVersion", "lines", "reason"]))
    throw refundHeld();
  const { command, scope, items } = saved;
  if (command.branchId !== scope.branchId || !isUuid(command.saleId) ||
      !label(command.refundKey) || command.operationId !== stableRefundUuid({ refundId: command.refundKey }) ||
      !version(command.expectedSaleVersion) || command.expectedSaleVersion >= 2147483647 ||
      !(command.reason === null || typeof command.reason === "string" && command.reason.length <= 400) ||
      !Array.isArray(command.lines) || !Array.isArray(items) || command.lines.length < 1 ||
      command.lines.length > 100 || items.length !== command.lines.length ||
      author.operationId !== command.operationId || author.branchId !== scope.branchId ||
      author.terminalId !== scope.terminalId || author.action !== "REFUND" ||
      author.payloadHash !== createHash("sha256").update(refundJson, "utf8").digest("hex")) throw refundHeld();
  let previous = "";
  for (const [index, line] of command.lines.entries()) {
    const item = items[index];
    if (!exact(line, ["item_id", "qty", "expected_refunded_qty", "expected_row_version"]) ||
        !isUuid(line.item_id) || line.item_id <= previous || !count(line.qty) || !line.qty ||
        !count(line.expected_refunded_qty) || !count(line.qty + line.expected_refunded_qty) ||
        !version(line.expected_row_version) || line.expected_row_version >= 2147483647 ||
        !exact(item, ["itemId", "nativeItemId", "productId", "nativeMovementId"]) ||
        item.itemId !== line.item_id || typeof item.nativeItemId !== "string" ||
        item.nativeItemId.toLowerCase() !== line.item_id || !isUuid(item.productId) ||
        item.nativeMovementId !== stableRefundUuid({ refundId: command.refundKey, itemId: item.nativeItemId }))
      throw refundHeld();
    previous = line.item_id;
  }
  return { command, scope, items, author };
}

function checkRefundAcceptance(saved, response) {
  const { command, items } = saved;
  if (!exact(response, ["status", "operation_id", "sale_id", "sale_row_version", "fully_refunded", "effects", "stock",
    "feed_epoch", "feed_seq"]) ||
      response.status !== "APPLIED" || response.operation_id !== command.operationId || response.sale_id !== command.saleId ||
      response.fully_refunded !== true || response.sale_row_version !== command.expectedSaleVersion + 1 ||
      response.feed_epoch !== saved.scope.feedEpoch || !/^[1-9]\d{0,18}$/.test(response.feed_seq ?? "") ||
      typeof response.feed_seq !== "string" || BigInt(response.feed_seq) > 9223372036854775807n ||
      !Array.isArray(response.effects) || response.effects.length !== items.length || !Array.isArray(response.stock))
    throw refundHeld();
  const expected = new Map(command.lines.map((line, index) => [line.item_id, { line, item: items[index] }]));
  const products = new Set(items.map(item => item.productId));
  const movements = new Set();
  for (const effect of response.effects) {
    const facts = expected.get(effect?.item_id);
    if (!facts || !exact(effect, ["item_id", "product_id", "movement_id", "branch_id", "delta", "refunded_qty", "row_version"]) ||
        effect.product_id !== facts.item.productId || effect.branch_id !== command.branchId ||
        !isUuid(effect.movement_id) || movements.has(effect.movement_id) || effect.delta !== facts.line.qty ||
        effect.refunded_qty !== facts.line.qty + facts.line.expected_refunded_qty ||
        effect.row_version !== facts.line.expected_row_version + 1) throw refundHeld();
    expected.delete(effect.item_id);
    movements.add(effect.movement_id);
  }
  if (response.stock.length !== products.size || !response.stock.every(row =>
    exact(row, ["product_id", "branch_id", "balance"]) && row.branch_id === command.branchId &&
    Number.isInteger(row.balance) && row.balance >= -2147483648 && row.balance <= 2147483647 &&
    products.delete(row.product_id))) throw refundHeld();
  return response;
}

module.exports = { DOMAIN, MAX_BYTES, refundHeld, stableRefundUuid, decodeRefundCommand, checkRefundAcceptance };
