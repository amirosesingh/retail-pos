import { posFetch } from "./server-origin";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { supabaseConfig } from "./external-supabase-config";
import { getPosCallerAuth } from "./pos-caller-auth";
import { localDb } from "@/core/local-db/local-db";
import { isWindowsShell, isMobileShell } from "@/platform-config/features";
import { isMissingSecureValue } from "./secure-cloud-config";
export type ApprovalToken = {
  id: string;
  userId: string;
  name: string;
  terminalId: string;
  branchId: string;
  secret: string;
  validUntil: number;
  project: string;
  sessionBinding: string;
};
const KEY = "pos.approval-token.active.v1";
export const TOKEN_CHANGED = "pos:approval-token-changed";
let revision = 0;
const OFFLINE_KEY = "pos.approval-token.locked.v1";
let enrollment: Promise<void> | null = null;
let vaultOperation: Promise<unknown> = Promise.resolve();
function withVault<T>(work: () => Promise<T>): Promise<T> {
  const next = vaultOperation.then(work, work);
  vaultOperation = next.catch(() => undefined);
  return next;
}
async function readVault() {
  try { return JSON.parse((await (await store()).value.get({ key: OFFLINE_KEY })).value) as import("./approval-offline-vault").OfflineTokenVault; }
  catch (error) { if (isMissingSecureValue(error)) return null; throw error; }
}
async function saveVault(value: import("./approval-offline-vault").OfflineTokenVault) {
  const raw = JSON.stringify(value);
  const vault = (await store()).value;
  if ((await vault.set({ key: OFFLINE_KEY, value: raw })).value === false || (await vault.get({ key: OFFLINE_KEY })).value !== raw)
    throw new Error("Could not save offline token settings.");
}
async function removeVault() {
  try { await (await store()).value.remove({ key: OFFLINE_KEY }); }
  catch (error) { if (!isMissingSecureValue(error)) throw error; }
}
export async function offlineTokenOwner() {
  if (!isMobileShell()) return null;
  const terminal = readTerminalConfig();
  if (!terminal?.tokenId) return null;
  const v = await withVault(readVault);
  const { validOfflineVault } = await import("./approval-offline-vault");
  return v && validOfflineVault(v, terminal.tokenId, supabaseConfig().url) ? { name: v.name, userId: v.userId } : null;
}
export async function setupOfflineApprovalToken(pin: string) {
  const stamp = revision;
  const token = await loadApprovalToken();
  if (!token) throw new Error("Sign in with approval-token permission and reconnect first.");
  const { sealOfflineToken } = await import("./approval-offline-vault");
  const envelope = await sealOfflineToken(token, pin);
  await withVault(async () => {
    if (stamp !== revision || !(await loadApprovalToken())) throw new Error("Sign-in changed. Please try again.");
    await saveVault(envelope);
  });
  window.dispatchEvent(new Event(TOKEN_CHANGED));
}
export async function unlockOfflineApprovalToken(pin: string) {
  const stamp = revision;
  return withVault(async () => {
    const terminal = readTerminalConfig();
    const v = await readVault();
    const { validOfflineVault, openOfflineToken } = await import("./approval-offline-vault");
    if (!terminal?.tokenId || !v || !validOfflineVault(v, terminal.tokenId, supabaseConfig().url)) throw new Error("Reconnect and sign in to renew your token.");
    if (v.retryAfter > Date.now()) throw new Error("Too many attempts. Wait before trying again.");
    // Persist the attempt before decrypting; closing the app cannot reset it.
    v.failures += 1;
    v.retryAfter = Date.now() + Math.min(300000, 1000 * 2 ** Math.min(v.failures, 9));
    await saveVault(v);
    try {
      const token = await openOfflineToken({ ...v, retryAfter: 0 }, pin);
      if (stamp !== revision || readTerminalConfig()?.tokenId !== terminal.tokenId) throw new Error("Registration changed.");
      v.failures = 0; v.retryAfter = 0;
      await saveVault(v);
      return token;
    } catch { throw new Error("Incorrect token unlock PIN. Wait before trying again."); }
  });
}
async function store() {
  const { SecureStoragePlugin } = await import("capacitor-secure-storage-plugin");
  return { value: SecureStoragePlugin };
}
export async function approvalCredentialCall(
  action: "enroll" | "methods",
  data: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string; credential?: ApprovalToken | null }> {
  const response = await posFetch("/api/v1/pos/sync?operation=authorization", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "approval_credentials", data: { action, data } }),
  });
  const result = await response.json();
  if (!response.ok && !result.error) throw new Error("Approval credential service is unavailable");
  return result;
}
async function sessionBinding() {
  const proof = await getPosCallerAuth();
  // Device sessions survive application restarts and are cleared on logout/lock.
  const session = proof.sessionToken || proof.cashierToken;
  if (!session) return "";
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(session));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function clearApprovalToken(removeOffline = false) {
  revision++;
  if (!isMobileShell()) return;
  try {
    await (await store()).value.remove({ key: KEY });
  } catch (error) {
    if (!isMissingSecureValue(error)) throw error;
  }
  if (removeOffline) await withVault(removeVault);
  window.dispatchEvent(new Event(TOKEN_CHANGED));
}
export async function loadApprovalToken(): Promise<ApprovalToken | null> {
  if (!isMobileShell()) return null;
  const terminal = readTerminalConfig();
  if (!terminal?.tokenId) return null;
  const binding = await sessionBinding();
  if (!binding) return null;
  let raw: string;
  try {
    raw = (await (await store()).value.get({ key: KEY })).value;
  } catch (error) {
    if (isMissingSecureValue(error)) return null;
    throw error;
  }
  const token = JSON.parse(raw) as ApprovalToken;
  if (
    !token?.secret ||
    !token.userId ||
    !Number.isFinite(token.validUntil) ||
    token.validUntil - 86400000 > Date.now() + 60000
  )
    return null;
  return token.terminalId.toLowerCase() === terminal.tokenId.toLowerCase() &&
    token.project === supabaseConfig().url &&
    token.sessionBinding === binding &&
    token.validUntil > Date.now()
    ? token
    : null;
}
export function enrollOwnApprovalToken(userId: string): Promise<void> {
  if (enrollment) return enrollment;
  enrollment = enroll(userId).finally(() => { enrollment = null; });
  return enrollment;
}
async function enroll(userId: string) {
  if (isWindowsShell()) {
    const proof = await getPosCallerAuth();
    await localDb()?.enrollApprovalVerifier?.({
      sessionToken: proof.sessionToken,
      cashierToken: proof.cashierToken,
      accessToken: proof.accessToken,
    });
    return;
  }
  if (!isMobileShell() || !navigator.onLine || !readTerminalConfig()?.tokenId) return;
  const version = ++revision;
  const binding = await sessionBinding();
  if (!binding) return;
  const result = await approvalCredentialCall("enroll", await getPosCallerAuth());
  if (version !== revision || binding !== (await sessionBinding())) return;
  if (!result.ok) throw new Error(result.error || "Could not refresh approval token");
  if (!result.credential) {
    await clearApprovalToken();
    await withVault(async () => { if ((await readVault())?.userId.toLowerCase() === userId.toLowerCase()) await removeVault(); });
    return;
  }
  if (result.credential.userId.toLowerCase() !== userId.toLowerCase())
    throw new Error("Approval identity changed");
  const token = { ...result.credential, project: supabaseConfig().url, sessionBinding: binding };
  const saved = await (await store()).value.set({ key: KEY, value: JSON.stringify(token) });
  if (saved.value === false) throw new Error("Secure token storage could not be updated");
  const verified = await (await store()).value.get({ key: KEY });
  if (verified.value !== JSON.stringify(token))
    throw new Error("Secure token storage could not be verified");
  if (version !== revision) return;
  await withVault(async () => {
    if (version !== revision) return;
    const v = await readVault();
    const { tokenFingerprint } = await import("./approval-offline-vault");
    if (v?.userId === token.userId && v.terminalId === token.terminalId && v.project === token.project) {
      if (v.id === token.id && v.fingerprint === await tokenFingerprint(token)) await saveVault({ ...v, validUntil: token.validUntil, name: token.name });
      else await removeVault();
    }
  });
  window.dispatchEvent(new Event(TOKEN_CHANGED));
}
