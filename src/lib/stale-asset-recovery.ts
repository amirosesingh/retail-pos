/**
 * Recover an already-open browser tab after a deployment replaces its
 * content-hashed JavaScript chunks. Vite emits this event before surfacing the
 * failed dynamic import, giving the app one chance to load fresh HTML.
 */
const RELOAD_KEY = "pos.stale-asset-reload-at";
const RELOAD_GUARD_MS = 60_000;

let installed = false;

/**
 * Runs before HeadContent emits module-preload links. This catches a missing
 * entry/preload chunk even when the normal client bundle cannot start far
 * enough to install the typed listener below.
 */
export const staleAssetRecoveryScript = String.raw`(()=>{if(window.__posAssetRecovery)return;window.__posAssetRecovery=true;const k="pos.stale-asset-reload-at",g=60000,r=e=>{const t=e&&e.target,u=t&&(t.src||t.href)||"",x=e&&(e.reason||e.error),m=String(x&&x.message||x||"");if(e.type!=="vite:preloadError"&&!(/\/assets\/.*\.js(?:\?|$)/.test(u)||/dynamically imported module|importing a module script failed|failed to fetch dynamically imported module/i.test(m)))return;e.preventDefault&&e.preventDefault();const n=Date.now();try{const l=Number(sessionStorage.getItem(k)||0);if(Number.isFinite(l)&&n-l<g)return;sessionStorage.setItem(k,String(n))}catch{}location.reload()};addEventListener("vite:preloadError",r);addEventListener("error",r,true);addEventListener("unhandledrejection",r)})();`;

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
