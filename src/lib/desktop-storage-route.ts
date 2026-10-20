/** Decide storage only from Electron's canonical database state, never internet status. */
export function desktopStorageRoute(state: { enabled?: boolean; configured?: boolean; connected?: boolean; tradingReady?: boolean } | null): "online" | "local" | "pending" {
  if (!state) return "pending";
  if (state.enabled === false || state.configured === false) return "online";
  if (state.enabled === true && state.configured === true && state.connected === true && state.tradingReady === true) return "local";
  return "pending";
}
