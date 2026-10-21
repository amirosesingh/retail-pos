import type { ApprovalToken } from "./approval-token-client";
// The encrypted envelope is itself kept in the native OS secure store.
export type OfflineTokenVault = {
  id: string; userId: string; name: string; terminalId: string; project: string;
  validUntil: number; salt: string; iv: string; ciphertext: string;
  fingerprint: string; failures: number; retryAfter: number;
};
const bytes = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const base64 = (data: Uint8Array) => btoa(String.fromCharCode(...data));
async function unlockKey(pin: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: 310000 }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function tokenFingerprint(token: ApprovalToken) {
  return base64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token.secret))));
}
export function validOfflineVault(v: OfflineTokenVault, terminal: string, project: string, now = Date.now()) {
  return Boolean(v?.id && v.userId && v.ciphertext && v.terminalId?.toLowerCase() === terminal.toLowerCase() &&
    v.project === project && Number.isFinite(v.validUntil) && v.validUntil > now && v.validUntil <= now + 86460000);
}
export async function sealOfflineToken(token: ApprovalToken, pin: string): Promise<OfflineTokenVault> {
  if (!/^\d{6,12}$/.test(pin)) throw new Error("Use a 6–12 digit token unlock PIN.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await unlockKey(pin, salt), new TextEncoder().encode(JSON.stringify(token)));
  return { id: token.id, userId: token.userId, name: token.name, terminalId: token.terminalId, project: token.project,
    validUntil: token.validUntil, salt: base64(salt), iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)),
    fingerprint: await tokenFingerprint(token), failures: 0, retryAfter: 0 };
}
export async function openOfflineToken(v: OfflineTokenVault, pin: string): Promise<ApprovalToken> {
  if (v.retryAfter > Date.now()) throw new Error("Too many attempts. Wait before trying again.");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(v.iv) as BufferSource }, await unlockKey(pin, bytes(v.salt)), bytes(v.ciphertext) as BufferSource);
  const token = JSON.parse(new TextDecoder().decode(plain)) as ApprovalToken;
  if (token.id !== v.id || token.userId !== v.userId || token.terminalId !== v.terminalId || token.project !== v.project || await tokenFingerprint(token) !== v.fingerprint)
    throw new Error("Token identity does not match this device.");
  // Only an authenticated server enrollment can renew this OS-vault lease.
  return { ...token, validUntil: v.validUntil, sessionBinding: "" };
}
