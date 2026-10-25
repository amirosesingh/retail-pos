import type { LocalStartupState } from "./local-startup";
/** Try saved SQL configuration before falling back; internet status never selects SQL. */
export function desktopStorageRoute(state: LocalStartupState | null): "online" | "local" | "pending" {
  if (!state) return "pending";
  if (state.enabled === false || state.configured === false) return "online";
  if (["enabled_connecting", "enabled_validating", "enabled_bootstrapping"].includes(state.state ?? "")) return "pending";
  if (state.enabled === true && state.configured === true && state.connected === true && state.tradingReady === true) return "local";
  if (["enabled_error", "enabled_degraded"].includes(state.state ?? "")) return "online";
  return "pending";
}
