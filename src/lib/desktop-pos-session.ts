import { readCredentials, type PosCredentials } from "./pos-credentials";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { isCurrentEpoch, sessionEpoch } from "./session-epoch";
import { readNativeTerminalProof } from "./native-terminal-proof";
import { desktopAuthorityFailure, type DesktopAuthorityFailureCode } from "./desktop-authority-error";

type Result = { ok: boolean; level?: "admin" | "supervisor" | "staff"; error?: string; code?: DesktopAuthorityFailureCode; status?: number };
let pending: { epoch: number; bridge: unknown; refresh: boolean; promise: Promise<Result> } | null = null;

/** Share the native handoff between startup, reports and permission refreshes.
 * Main still verifies the proof and enforces every query's permissions.
 */
export function ensureDesktopPosSession(refresh = false, proof?: PosCredentials): Promise<Result> {
  const bridge = typeof window === "undefined" ? undefined : window.sqlAdmin;
  if (!bridge?.adoptSession) return Promise.resolve({ ok: false, error: "The desktop authorization bridge is unavailable." });
  const epoch = sessionEpoch();
  if (pending?.epoch === epoch && pending.bridge === bridge) {
    pending.refresh ||= refresh;
    return pending.promise;
  }
  const promise = (async (): Promise<Result> => {
    const status = await bridge.adminStatus?.();
    if (!isCurrentEpoch(epoch)) return { ok: false, error: "The signed-in user changed." };
    // Offline PIN sign-in establishes authority in Main without a cloud bearer.
    if (!pending?.refresh && status?.unlocked && status.source === "pos") return { ok: true, level: status.level };
    const credentials = proof ?? await readCredentials();
    if (!isCurrentEpoch(epoch)) return { ok: false, error: "The signed-in user changed." };
    const registrationProof = await readNativeTerminalProof();
    if (!isCurrentEpoch(epoch)) return { ok: false, error: "The signed-in user changed." };
    const result = await bridge.adoptSession!({ ...credentials, ...registrationProof }, readTerminalConfig());
    if (!isCurrentEpoch(epoch)) return { ok: false, error: "The signed-in user changed." };
    if (result.ok) return { ok: true, level: result.level };
    return desktopAuthorityFailure(result) ?? { ok: false, error: "The signed-in account could not be verified on this PC." };
  })().finally(() => {
    if (pending?.promise === promise) pending = null;
  });
  pending = { epoch, bridge, refresh, promise };
  return promise;
}
