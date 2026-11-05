"use strict";
const { normalizeBinding } = require("./shift-author-protocol.cjs");
const ACTION = "LEGACY_CLOSING_RECOVERY_V1";
const MAX_UPLOAD_BYTES = 256 * 1024;
const KEYS = ["version", "algorithm", "keyId", "projectOrigin", "terminalId", "authorId", "subject", "branchId", "shiftId", "recoveryId", "action", "payloadHash"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid() { throw Object.assign(new Error("The administrator recovery approval is invalid."), { code: "ELEGACY_RECOVERY_INVALID" }); }
function unsignedLegacyRecovery(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== KEYS.length || Object.keys(input).some(k => !KEYS.includes(k))) invalid();
  const binding = normalizeBinding({ projectOrigin: input.projectOrigin, terminalId: input.terminalId, authorId: input.authorId });
  if (input.version !== 1 || input.algorithm !== "Ed25519" || input.action !== ACTION || !/^[a-f0-9]{64}$/.test(input.payloadHash)) invalid();
  for (const key of ["keyId", "shiftId", "recoveryId"]) if (typeof input[key] !== "string" || !UUID.test(input[key])) invalid();
  for (const key of ["subject", "branchId"]) if (typeof input[key] !== "string" || !input[key] || input[key].length > 200 || input[key] !== input[key].trim() || /[\u0000-\u001f\u007f]/.test(input[key])) invalid();
  return { version: 1, algorithm: "Ed25519", keyId: input.keyId.toLowerCase(), ...binding, subject: input.subject,
    branchId: input.branchId, shiftId: input.shiftId.toLowerCase(), recoveryId: input.recoveryId.toLowerCase(), action: ACTION, payloadHash: input.payloadHash };
}
function normalizeLegacyRecovery(input) {
  if (!input || typeof input !== "object" || Object.keys(input).length !== KEYS.length + 1 || typeof input.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(input.signature)) invalid();
  const { signature, ...unsigned } = input;
  let binary;
  try { binary = atob(signature.replace(/-/g, "+").replace(/_/g, "/")); } catch { invalid(); }
  if (binary.length !== 64 || btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !== signature) invalid();
  return { ...unsignedLegacyRecovery(unsigned), signature };
}
function legacyRecoveryMessage(input) {
  const value = unsignedLegacyRecovery(input);
  return JSON.stringify(["retail-pos.shift-author.legacy-recovery.v1", value.algorithm, value.projectOrigin, value.terminalId, value.authorId, value.keyId,
    value.subject, value.branchId, value.shiftId, value.recoveryId, value.action, value.payloadHash]);
}
function normalizeLegacyPayload(input) {
  const keys = ["version", "recoveryId", "branchId", "terminalId", "shiftId", "evidenceHash", "cloudWitnessHash", "reason", "localGraphText", "cloudGraphText", "financialVerification"];
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== keys.length || Object.keys(input).some(k => !keys.includes(k)) ||
    input.version !== 1 || input.financialVerification !== "UNVERIFIED_HISTORICAL") invalid();
  for (const key of ["recoveryId", "shiftId"]) if (typeof input[key] !== "string" || !UUID.test(input[key])) invalid();
  for (const key of ["branchId", "terminalId"]) if (typeof input[key] !== "string" || !input[key] || input[key].length > 128 || input[key] !== input[key].trim()) invalid();
  for (const key of ["evidenceHash", "cloudWitnessHash"]) if (typeof input[key] !== "string" || !/^[a-f0-9]{64}$/.test(input[key])) invalid();
  if (typeof input.reason !== "string" || input.reason.trim().length < 3 || input.reason.length > 400 || /[\u0000-\u001f\u007f]/.test(input.reason)) invalid();
  for (const key of ["localGraphText", "cloudGraphText"]) if (typeof input[key] !== "string" || !input[key] || new TextEncoder().encode(input[key]).byteLength > 6 * 1024 * 1024) invalid();
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > MAX_UPLOAD_BYTES) invalid();
  return { ...input, recoveryId: input.recoveryId.toLowerCase(), shiftId: input.shiftId.toLowerCase() };
}
function legacyRecoveryWire(payloadJson, attestation) {
  const proof = normalizeLegacyRecovery(attestation);
  normalizeLegacyPayload(JSON.parse(payloadJson));
  // Operations recovery attaches no management or per-uploader credential.
  // The sealed device proof is exactly 64 ASCII characters; its value is not
  // needed to calculate the wire budget before saving a pending SQL event.
  return JSON.stringify({ sqlServerLegacyRecovery: { organizationId: "default", branchId: proof.branchId, payloadJson, attestation: proof },
    terminalToken: proof.terminalId, deviceBindingProof: "0".repeat(64) });
}
module.exports = { ACTION, MAX_UPLOAD_BYTES, normalizeLegacyPayload, unsignedLegacyRecovery, normalizeLegacyRecovery, legacyRecoveryMessage, legacyRecoveryWire };
