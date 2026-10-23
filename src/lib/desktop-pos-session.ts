import { readCredentials, type PosCredentials } from "./pos-credentials";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { isCurrentEpoch, sessionEpoch } from "./session-epoch";

type Result = { ok: boolean; level?: "admin" | "supervisor" | "staff"; error?: string };
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
    const result = await bridge.adoptSession!(credentials, readTerminalConfig());
    return isCurrentEpoch(epoch) ? result : { ok: false, error: "The signed-in user changed." };
  })().finally(() => {
    if (pending?.promise === promise) pending = null;
  });
  pending = { epoch, bridge, refresh, promise };
  return promise;
}
