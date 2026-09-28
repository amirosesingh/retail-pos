/**
 * Recover an already-open browser tab after a deployment replaces its
 * content-hashed JavaScript chunks. Vite emits this event before surfacing the
 * failed dynamic import, giving the app one chance to load fresh HTML.
 */
const RELOAD_KEY = "pos.stale-asset-reload-at";
const RELOAD_GUARD_MS = 60_000;

let installed = false;

export function installStaleAssetRecovery(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    const now = Date.now();
    try {
      const last = Number(window.sessionStorage.getItem(RELOAD_KEY) ?? 0);
      if (Number.isFinite(last) && now - last < RELOAD_GUARD_MS) return;
      window.sessionStorage.setItem(RELOAD_KEY, String(now));
    } catch {
      // Storage can be disabled. A single normal reload remains the safest
      // recovery because the current document cannot load its missing code.
    }
    window.location.reload();
  });
}
