const { createHash } = require("node:crypto");
const { parseExactJson } = require("./shift-recovery-exact.cjs");
const { normalizeFinancialAttestation } = require("../security/financial-author-protocol.cjs");
const { decodeRefundApprovalEvidence } = require("./refund-approval-evidence.cjs");
const { refundHeld } = require("./refund-command.cjs");
const { prepareFinancialHistory } = require("./financial-history-ack.cjs");

const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const hash = raw => createHash("sha256").update(raw, "utf8").digest("hex");
const held = () => { throw refundHeld("ESYNC_REFUND_APPROVAL_REQUIRED"); };

function amountMinor(value) {
  if (typeof value !== "string" || !/^\d{1,80}(?:\.\d{1,80})?$/.test(value)) held();
  const [whole, fraction = ""] = value.split(".");
  if (/[1-9]/.test(fraction.slice(2))) held();
  const amount = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, "0"));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) held();
  return String(amount);
}

function decodeFinancialRefundOriginal(operationJson, attestation, { operationId, saleId, branchId, terminalId }) {
  let event, original;
  try {
    parseExactJson(operationJson, { maxBytes: 6 * 1024 * 1024, maxDepth: 16 });
    event = JSON.parse(operationJson);
    original = normalizeFinancialAttestation(attestation);
    prepareFinancialHistory({kind:"MUTATION",branchId:event.branchId,terminalId:event.terminalId,
      shiftId:event.shiftId,operationId:event.operationId,sequence:event.sequence,payloadJson:operationJson,
      payloadHash:hash(operationJson),proof:attestation},branchId,terminalId??original.terminalId);
  } catch { held(); }
  const change = event.changes?.[0];
  if (event.action !== "REFUND" || event.branchId !== branchId || (terminalId!==undefined&&event.terminalId !== terminalId) ||
      (operationId!==undefined&&event.operationId!==operationId) || (saleId!==undefined&&change?.saleId!==saleId) ||
      !Array.isArray(event.changes) || event.changes.length !== 1 || !change?.before || !change.after ||
      change.saleId !== change.before.id || change.saleId !== change.after.id ||
      change.before.branchId !== branchId || change.after.branchId !== branchId ||
      change.before.shiftId !== event.shiftId || change.after.shiftId !== event.shiftId ||
      change.before.isRefunded === true || change.after.isRefunded !== true ||
      typeof change.before.rowVersion !== "string" || !/^[1-9]\d{0,75}$/.test(change.before.rowVersion) ||
      original.action !== "REFUND" || original.operationId !== event.operationId ||
      original.payloadHash !== hash(operationJson)) held();
  return {payloadJson:operationJson,attestation,operationId:event.operationId,saleId:change.saleId,
    expectedSaleVersion:change.before.rowVersion,amountMinor:amountMinor(change.before.totalAmount)};
}

/** Original event bytes remain frozen. The companion has its own signature. */
function prepareFinancialRefundApproval(input, branchId, terminalId) {
  if (!exact(input, ["operationJson", "attestation", "refundApproval"])) held();
  const original=decodeFinancialRefundOriginal(input.operationJson,input.attestation,{branchId,terminalId});
  decodeRefundApprovalEvidence(input.refundApproval, { anchorKind: "financial", payloadJson: input.operationJson,
    attestation: input.attestation, operationId: original.operationId, saleId: original.saleId,
    expectedSaleVersion: original.expectedSaleVersion, amountMinor: original.amountMinor });
  return input;
}

function decodeFinancialRefundReceipt(saved, { operationId, saleId, branchId }) {
  if (!exact(saved, ["version", "route", "operationJson", "attestation", "refundApproval"]) ||
      saved.version !== 2 || saved.route !== "financial") held();
  let original;
  try { original = normalizeFinancialAttestation(saved.attestation); } catch { held(); }
  const input = prepareFinancialRefundApproval({ operationJson: saved.operationJson,
    attestation: saved.attestation, refundApproval: saved.refundApproval }, branchId, original.terminalId);
  const event = JSON.parse(input.operationJson);
  if (operationId !== event.operationId || saleId !== event.changes[0].saleId) held();
  const statement = decodeRefundApprovalEvidence(saved.refundApproval,
    { anchorKind: "financial", payloadJson: saved.operationJson, attestation: saved.attestation });
  return { payloadJson: saved.operationJson, attestation: saved.attestation, source: statement.basis.scope,
    basis: statement.basis, refundApproval: saved.refundApproval };
}

function readFinancialRefundApproval(row, branchId, terminalId) {
  if (row.refund_evidence_json == null) return null;
  let saved;
  try {
    parseExactJson(row.refund_evidence_json, { maxBytes: 6 * 1024 * 1024 + 64 * 1024, maxDepth: 20 });
    saved = JSON.parse(row.refund_evidence_json);
  } catch { held(); }
  if (row.refund_branch_id !== branchId) held();
  const decoded = decodeFinancialRefundReceipt(saved, { operationId: String(row.operation_id).toLowerCase(),
    saleId: String(row.entity_id).toLowerCase(), branchId });
  const input = { operationJson: decoded.payloadJson, attestation: decoded.attestation, refundApproval: decoded.refundApproval };
  if (decoded.source.terminalId !== terminalId) held();
  return input;
}

module.exports = { amountMinor, decodeFinancialRefundOriginal, prepareFinancialRefundApproval, decodeFinancialRefundReceipt, readFinancialRefundApproval };
