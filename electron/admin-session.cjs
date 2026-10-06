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
function hasPermission(permission) { return active()?.permissions?.[permission] === true; }
function hasPosAuthority() { return active()?.source === "pos"; }
function branchId() { return active()?.branchId ?? null; }
function touch() { if (active()) session.expiresAt = Date.now() + MAX_IDLE_MS; }
function recoveryCodeAt(date) {
  const pad = (value, width = 2) => String(value).padStart(width, "0");
  return `${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
}
function sameCode(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
function grantRecovery(value, now = Date.now()) {
  const code = String(value ?? "").trim();
  if (!/^\d{12}$/.test(code)) return false;
  const accepted = [-1, 0, 1].some((offset) =>
    sameCode(code, recoveryCodeAt(new Date(now + offset * 60_000))),
  );
  recoveryExpiresAt = accepted ? Date.now() + RECOVERY_IDLE_MS : 0;
  return accepted;
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
