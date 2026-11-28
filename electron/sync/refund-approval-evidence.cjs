const { createHash } = require("node:crypto");
const { normalizeFinancialAttestation } = require("../security/financial-author-protocol.cjs");
const { parseExactJson } = require("./shift-recovery-exact.cjs");
const { stableRefundUuid, refundHeld } = require("./refund-command.cjs");

// Main witnesses an independently verified approval; it never impersonates
// the approver. Original refund/event bytes and signatures remain unchanged.
const DOMAIN = "retail-pos.native-refund-approval.v1";
const MAX_BYTES = 48 * 1024;
const invalid = () => { throw refundHeld("ESYNC_REFUND_APPROVAL_REQUIRED"); };
const exact = (v, keys) => v && typeof v === "object" && !Array.isArray(v) &&
  Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
const uuid = v => typeof v === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const label = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max && v === v.trim() && !/[\u0000-\u001f\u007f]/u.test(v);
const hash = raw => createHash("sha256").update(raw, "utf8").digest("hex");
const digest = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function normalizeRefundSaleCreatedAt(value) {
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))invalid();
  const date=new Date(value);
  if(!Number.isFinite(date.getTime())||date.toISOString()!==value)invalid();
  return value;
}
function normalizePerson(value) {
  if (!exact(value, ["authorId", "subject"]) || !uuid(value.authorId) || !label(value.subject, 200)) invalid();
  return { authorId: value.authorId, subject: value.subject };
}
function normalizeScope(value) {
  const common = ["projectOrigin", "branchId", "terminalId", "databaseGuid"];
  const grouped = exact(value, [...common, "feedEpoch", "installationGeneration"]);
  if (!(grouped || exact(value, common)) || !label(value.branchId, 128) ||
      !["terminalId", "databaseGuid", ...(grouped ? ["feedEpoch", "installationGeneration"] : [])].every(k => uuid(value[k]))) invalid();
  let origin;
  try { origin = new URL(value.projectOrigin); } catch { invalid(); }
  if (origin.protocol !== "https:" || origin.origin !== value.projectOrigin) invalid();
  return { projectOrigin: value.projectOrigin, branchId: value.branchId, terminalId: value.terminalId,
    databaseGuid: value.databaseGuid, ...(grouped ? {feedEpoch: value.feedEpoch, installationGeneration: value.installationGeneration} : {}) };
}
function normalizeRefundApprovalBasis(value) {
  if (!exact(value, ["operationId", "refundKey", "saleId", "expectedSaleVersion", "amountMinor", "saleCreatedAt", "scope", "requester"]) ||
      !uuid(value.operationId) || !uuid(value.saleId) || !label(value.refundKey, 128) ||
      typeof value.expectedSaleVersion !== "string" || !/^[1-9]\d{0,75}$/.test(value.expectedSaleVersion) ||
      typeof value.amountMinor !== "string" || !/^(0|[1-9]\d{0,15})$/.test(value.amountMinor) ||
      BigInt(value.amountMinor) > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
  const scope = normalizeScope(value.scope);
  // Old FIN62 history retained the operation ID, not its caller's refund key.
  // This explicit operation reference renews that event without inventing it.
  if (value.operationId !== stableRefundUuid({ refundId: value.refundKey }) &&
      !(Object.keys(scope).length === 4 && value.refundKey === `financial-operation:${value.operationId}`)) invalid();
  return { operationId: value.operationId, refundKey: value.refundKey, saleId: value.saleId,
    expectedSaleVersion: value.expectedSaleVersion, amountMinor: value.amountMinor, saleCreatedAt: normalizeRefundSaleCreatedAt(value.saleCreatedAt),
    scope, requester: normalizePerson(value.requester) };
}
function normalizeApproval(value) {
  if (!exact(value, ["id", "mode", "approver", "credentialMethod", "reason", "auditId", "policyHash", "hostedReceipt"]) ||
      !uuid(value.id) || !["direct", "offline_pin", "hosted"].includes(value.mode) ||
      !(value.reason === null || typeof value.reason === "string" && value.reason.length <= 400 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.reason)) ||
      !(value.auditId === null || uuid(value.auditId)) || !digest(value.policyHash)) invalid();
  const approver = value.approver === null ? null : normalizePerson(value.approver);
  if (value.mode === "offline_pin") {
    if (!approver || !["pin", "totp"].includes(value.credentialMethod) || !uuid(value.auditId) || value.hostedReceipt !== null) invalid();
  } else if (value.credentialMethod !== null || approver !== null ||
      (value.mode === "hosted" ? !label(value.hostedReceipt, 32768) : value.hostedReceipt !== null)) invalid();
  return { id: value.id, mode: value.mode, approver, credentialMethod: value.credentialMethod,
    reason: value.reason, auditId: value.auditId, policyHash: value.policyHash, hostedReceipt: value.hostedReceipt };
}
function normalizeStatement(value) {
  if (!exact(value, ["domain", "version", "anchorKind", "payloadHash", "basis", "witness", "approval"]) ||
      value.domain !== DOMAIN || value.version !== 1 || !["grouped", "financial"].includes(value.anchorKind) || !digest(value.payloadHash)) invalid();
  const basis = normalizeRefundApprovalBasis(value.basis);
  if ((value.anchorKind === "grouped") !== Object.hasOwn(basis.scope, "feedEpoch")) invalid();
  return { domain: DOMAIN, version: 1, anchorKind: value.anchorKind, payloadHash: value.payloadHash,
    basis, witness: normalizePerson(value.witness), approval: normalizeApproval(value.approval) };
}
function parseRefundApprovalJson(raw) {
  try {
    parseExactJson(raw, { maxBytes: MAX_BYTES, maxDepth: 10 });
    return normalizeStatement(JSON.parse(raw));
  } catch { invalid(); }
}
function decodeRefundApprovalEvidence(evidence, anchor) {
  try {
    if (!exact(evidence, ["approvalJson", "approvalAttestation"]) || !anchor || typeof anchor.payloadJson !== "string") invalid();
    const statement = parseRefundApprovalJson(evidence.approvalJson);
    const proof = normalizeFinancialAttestation(evidence.approvalAttestation);
    const original = normalizeFinancialAttestation(anchor.attestation);
    const { basis } = statement;
    if (statement.anchorKind !== anchor.anchorKind || statement.payloadHash !== hash(anchor.payloadJson) ||
        original.payloadHash !== statement.payloadHash || original.action !== "REFUND" || proof.action !== "REFUND" ||
        proof.payloadHash !== hash(evidence.approvalJson) || proof.operationId !== basis.operationId ||
        original.operationId !== basis.operationId || proof.branchId !== basis.scope.branchId ||
        original.branchId !== basis.scope.branchId || proof.terminalId !== basis.scope.terminalId ||
        original.projectOrigin !== basis.scope.projectOrigin || original.authorId !== basis.requester.authorId ||
        original.subject !== basis.requester.subject || proof.authorId !== statement.witness.authorId ||
        proof.subject !== statement.witness.subject ||
        !["projectOrigin", "terminalId"].every(k => proof[k] === original[k])) invalid();
    if (anchor.scope && !same(basis.scope, normalizeScope({ projectOrigin: original.projectOrigin, ...anchor.scope }))) invalid();
    for (const key of ["operationId", "saleId", "expectedSaleVersion", "amountMinor", "saleCreatedAt"])
      if (anchor[key] !== undefined && String(anchor[key]) !== basis[key]) invalid();
    return { ...statement, approvalAttestation: proof };
  } catch { invalid(); }
}
function buildRefundApprovalEvidence({ anchorKind, payloadJson, attestation, basis, witness, approval, author }) {
  const statement = normalizeStatement({ domain: DOMAIN, version: 1, anchorKind, payloadHash: hash(payloadJson), basis, witness, approval });
  const approvalJson = JSON.stringify(statement);
  author.assertCurrent();
  const approvalAttestation = author.signFinancialOperation({ branchId: statement.basis.scope.branchId,
    operationId: statement.basis.operationId, action: "REFUND", payloadJson: approvalJson });
  const evidence = { approvalJson, approvalAttestation };
  decodeRefundApprovalEvidence(evidence, { anchorKind, payloadJson, attestation });
  author.assertCurrent();
  return evidence;
}
module.exports = { DOMAIN, MAX_BYTES, normalizeRefundApprovalBasis, parseRefundApprovalJson,
  decodeRefundApprovalEvidence, buildRefundApprovalEvidence, normalizeRefundSaleCreatedAt };
