/** Build-time channel only; database/backend configuration remains operator-owned. */
export const RELEASE_CHANNEL = import.meta.env.VITE_POS_RELEASE_CHANNEL === "beta" ? "beta" : "stable";
export const DEFAULT_UPDATE_BASE = `https://updatecms.luckycharmsdnbhd.com/pos-app${RELEASE_CHANNEL === "beta" ? "/beta" : ""}`;
export function acceptsReleaseVersion(version: string): boolean {
  const match = /^\d+\.\d+\.\d+(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  return !!match && (RELEASE_CHANNEL === "beta" ? /^beta\.[1-9]\d*$/.test(match[1] ?? "") : !match[1]);
}
