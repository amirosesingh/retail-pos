const MAX_IDLE_MS = 10 * 60 * 1000;
const RECOVERY_IDLE_MS = 5 * 60 * 1000;

let session = null;
let recoveryExpiresAt = 0;

function clear() { session = null; }
function grant(level, subject, permissions = {}, source = "manual", branchId = null) {
  if (!["admin", "supervisor", "staff"].includes(level)) throw new Error("Invalid privilege level.");
  if (!["pos", "manual"].includes(source)) throw new Error("Invalid privilege source.");
  session = { level, subject: String(subject ?? ""), permissions: { ...permissions }, source, branchId: branchId ? String(branchId) : null, verifiedAt: Date.now(), expiresAt: Date.now() + MAX_IDLE_MS };
  return status();
}
function active() {
  if (session && session.expiresAt <= Date.now()) clear();
  return session;
}
function hasLevel(required) {
  const current = active();
  if (!current) return false;
  return current.level === "admin" || (required === "supervisor" && current.level === "supervisor");
}
function hasPermission(permission) {
  const permissions = active()?.permissions ?? {};
  const pages = require("./permission-pages.json").filter(page => page.keys.includes(permission));
  return permissions[permission] === true && (!pages.length || pages.some(page => permissions[`page:${page.id}`] !== false));
}
function hasPosAuthority() { return active()?.source === "pos"; }
function branchId() { return active()?.branchId ?? null; }
function touch() { if (active()) session.expiresAt = Date.now() + MAX_IDLE_MS; }
// Only main.cjs may call this, after verifying a real POS administrator or a
// staff member carrying the database-management permission. The renderer is
// deliberately given no clock-, token- or role-based shortcut.
function grantRecovery() {
  recoveryExpiresAt = Date.now() + RECOVERY_IDLE_MS;
}
function clearRecovery() { recoveryExpiresAt = 0; }
function recoveryActive() {
  if (recoveryExpiresAt <= Date.now()) clearRecovery();
  return recoveryExpiresAt > 0;
}
function recoveryTouch() {
  if (recoveryActive()) recoveryExpiresAt = Date.now() + RECOVERY_IDLE_MS;
}
function status() {
  const current = active();
  return current ? { ok: true, unlocked: true, level: current.level, subject: current.subject } : { ok: true, unlocked: false };
}

/** Trusted identity details for main-process audit records. Never exposed to the renderer. */
function identity() {
  const current = active();
  return current ? {
    level: current.level,
    subject: current.subject,
    permissions: { ...current.permissions },
    source: current.source,
    branchId: current.branchId,
  } : null;
}

module.exports = { clear, grant, hasLevel, hasPermission, hasPosAuthority, branchId, touch, status, identity, grantRecovery, clearRecovery, recoveryActive, recoveryTouch };
