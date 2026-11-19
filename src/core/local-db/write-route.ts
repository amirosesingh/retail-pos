import type { PosBridge } from "./local-db";

/** Select the existing writer without treating an unreadable local state as
 * permission to bypass it. Approved online-only sessions supply no bridge. */
export async function resolveLocalWriteRoute(bridge: PosBridge | null): Promise<"local" | "cloud"> {
  if (!bridge) return "cloud";
  let state: Awaited<ReturnType<NonNullable<PosBridge["database"]>["getState"]>>;
  try {
    if (!bridge.database?.getState) throw new Error();
    state = await bridge.database.getState();
    if (!state || typeof state.enabled !== "boolean" || typeof state.connected !== "boolean" ||
        (state.tradingReady !== undefined && typeof state.tradingReady !== "boolean") ||
        (state.configured !== undefined && typeof state.configured !== "boolean") ||
        (state.localRecoveryPending !== undefined && typeof state.localRecoveryPending !== "boolean")) throw new Error();
  } catch {
    throw Object.assign(new Error("The saved local SQL Server state could not be verified. Retry the local connection before saving."),
      { code: "ELOCAL_STATE_UNVERIFIED" });
  }
  if (!state.enabled && !state.connected && !state.localRecoveryPending && state.tradingReady !== true) return "cloud";
  if (state.enabled && state.connected && state.configured !== false && state.tradingReady !== false && !state.localRecoveryPending)
    return "local";
  throw Object.assign(new Error("The local SQL Server transaction is unavailable until database preparation or recovery is complete. Retry the local connection before saving."),
    { code: "ELOCAL_NOT_READY" });
}
