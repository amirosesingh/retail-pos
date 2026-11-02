// Public wire format only. Keep Node/Electron APIs and private material out of
// this module: both Main and the server use the same signed message domains.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SPKI_PREFIX = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];
const BINDING_KEYS = ['projectOrigin', 'terminalId', 'authorId'];
const ENROLLMENT_KEYS = ['version', 'algorithm', 'keyId', ...BINDING_KEYS, 'publicKey'];
const INTENT_KEYS = ['version', 'algorithm', 'keyId', ...BINDING_KEYS, 'subject', 'branchId', 'shiftId', 'intentId', 'action', 'payloadHash'];
function invalid() {
  throw Object.assign(new Error('The shift author proof is invalid.'), { code: 'ESYNC_SHIFT_AUTHOR_INVALID' });
}
function objectWithKeys(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  const own = Object.keys(input);
  if (own.length !== keys.length || own.some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(input, key))) invalid();
  return input;
}
function label(value) {
  if (typeof value !== 'string' || !value || value.length > 200 || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) invalid();
  return value;
}
function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) invalid();
  return value.toLowerCase();
}
function projectOrigin(value) {
  if (typeof value !== 'string' || value.length > 2048 || value !== value.trim()) invalid();
  let url;
  try { url = new URL(value); } catch { invalid(); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) invalid();
  return url.origin;
}
function base64url(value, size) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length !== Math.ceil(size * 4 / 3)) invalid();
  let binary;
  try { binary = atob(value.replace(/-/g, '+').replace(/_/g, '/')); } catch { invalid(); }
  if (binary.length !== size || btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== value) invalid();
  return binary;
}
function normalizeBinding(input) {
  const value = objectWithKeys(input, BINDING_KEYS);
  return { projectOrigin: projectOrigin(value.projectOrigin), terminalId: label(value.terminalId), authorId: uuid(value.authorId) };
}
function bindingFrom(value) {
  return normalizeBinding({ projectOrigin: value.projectOrigin, terminalId: value.terminalId, authorId: value.authorId });
}
function common(value) {
  if (value.version !== 1 || value.algorithm !== 'Ed25519') invalid();
  return { version: 1, algorithm: 'Ed25519', keyId: uuid(value.keyId), ...bindingFrom(value) };
}
function normalizeEnrollment(input) {
  const value = objectWithKeys(input, ENROLLMENT_KEYS), result = common(value);
  const bytes = base64url(value.publicKey, 44);
  if (SPKI_PREFIX.some((byte, index) => bytes.charCodeAt(index) !== byte)) invalid();
  return { ...result, publicKey: value.publicKey };
}
function unsignedIntent(input) {
  const value = objectWithKeys(input, INTENT_KEYS), result = common(value);
  if (!['ORIGINAL', 'RECOUNT', 'VARIANCE'].includes(value.action)) invalid();
  if (typeof value.payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.payloadHash)) invalid();
  return { ...result, subject: label(value.subject), branchId: label(value.branchId), shiftId: uuid(value.shiftId), intentId: uuid(value.intentId), action: value.action, payloadHash: value.payloadHash };
}
function normalizeAttestation(input) {
  const value = objectWithKeys(input, [...INTENT_KEYS, 'signature']);
  base64url(value.signature, 64);
  const { signature, ...unsigned } = value;
  return { ...unsignedIntent(unsigned), signature };
}
function enrollmentMessage(input) {
  const value = normalizeEnrollment(input);
  return JSON.stringify(['retail-pos.shift-author.enrollment.v1', value.algorithm, value.projectOrigin, value.terminalId, value.authorId, value.keyId, value.publicKey]);
}
function intentMessage(input) {
  const value = unsignedIntent(input);
  return JSON.stringify(['retail-pos.shift-author.intent.v1', value.algorithm, value.projectOrigin, value.terminalId, value.authorId, value.keyId, value.subject, value.branchId, value.shiftId, value.intentId, value.action, value.payloadHash]);
}
module.exports = { normalizeBinding, normalizeEnrollment, normalizeAttestation, enrollmentMessage, intentMessage };
