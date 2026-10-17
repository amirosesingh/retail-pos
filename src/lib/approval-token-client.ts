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
export async function clearApprovalToken() {
  revision++;
  if (!isMobileShell()) return;
  try {
    await (await store()).value.remove({ key: KEY });
  } catch (error) {
    if (!isMissingSecureValue(error)) throw error;
  }
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
export async function enrollOwnApprovalToken(userId: string) {
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
    return;
  }
  if (result.credential.userId.toLowerCase() !== userId.toLowerCase())
    throw new Error("Approval identity changed");
  const token = { ...result.credential, project: supabaseConfig().url, sessionBinding: binding };
  const saved = await (await store()).value.set({ key: KEY, value: JSON.stringify(token) });
  if (saved.value === false) throw new Error("Secure token storage could not be updated");
  if (version !== revision) return;
  window.dispatchEvent(new Event(TOKEN_CHANGED));
}
