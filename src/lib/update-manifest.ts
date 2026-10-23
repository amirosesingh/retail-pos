import { releaseRevision } from "./release-version";
/**
 * Self-hosted HTTP update manifest — one source of truth for every platform.
 *
 * The release pipeline publishes a single `manifest.json` at the root of the
 * update directory. Android, the Windows till and the browser all read that
 * one document and pick the entry that applies to them, so there is no Play
 * Store / store-listing dependency anywhere in the update path.
 *
 *   {
 *     "version": "1.2.101",
 *     "buildNumber": 1201,
 *     "releaseNotes": "Bug fixes and UI improvements",
 *     "apkUrl":     "https://…/Retail-1.2.101.apk",
 *     "bundleUrl":  "https://…/web-1.2.101.zip",
 *     "windowsUrl": "https://…/Retail-Setup-1.2.101.exe"
 *   }
 *
 * Every read is bounded by a 7 second timeout so an unreachable folder can
 * never leave the UI stuck on "Checking for updates…".
 */
import { httpGetJson } from "@/platforms/mobile/native-http";
import { isAndroid } from "@/platform-config/platform";
import { isWindowsShell, isMobileShell } from "@/platform-config/features";
import { DEFAULT_UPDATE_BASE, acceptsReleaseVersion } from "./release-channel";

const ENV_BASE =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string | undefined> }).env?.[
      "VITE_UPDATE_BASE_URL"
    ]) ||
  "";

/** Root of the self-hosted update directory (no trailing slash). */
export const UPDATE_BASE = (ENV_BASE || DEFAULT_UPDATE_BASE).replace(
  /\/+$/,
  "",
);

export const MANIFEST_URL = `${UPDATE_BASE}/manifest.json`;

/** How long any update request may take before we give up. */
export const UPDATE_TIMEOUT_MS = 7000;

export type UpdateManifest = {
  version: string;
  buildNumber?: number;
  releaseNotes?: string;
  apkUrl?: string;
  bundleUrl?: string;
  /** Compatibility generation of `bundleUrl` (see src/lib/bundle-epoch.ts). */
  bundleEpoch?: number;
  windowsUrl?: string;
};

export type UpdatePlatform = "android" | "windows" | "web";

/** Reject after `ms` instead of hanging on an unreachable HTTP folder. */
export function withTimeout<T>(work: Promise<T>, ms = UPDATE_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The update server did not answer in time.")),
      ms,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** "1.2.10" > "1.2.9" — plain numeric compare, missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  const l = parse(String(a)), r = parse(String(b));
  if (!l || !r) return 0;
  const left = l.slice(1, 4).map(n => Number(n) || 0);
  const right = r.slice(1, 4).map(n => Number(n) || 0);
  for (let i = 0; i < 3; i += 1) {
    const d = (left[i] ?? 0) - (right[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  if (!l[4] || !r[4]) return l[4] ? -1 : r[4] ? 1 : Math.sign(releaseRevision(a) - releaseRevision(b));
  const lp = l[4].split("."), rp = r[4].split(".");
  for (let i = 0; i < Math.max(lp.length, rp.length); i++) {
    const x = lp[i], y = rp[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) > Number(y) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

/** Which shell we are updating. */
export function currentPlatform(): UpdatePlatform {
  if (isMobileShell() && isAndroid()) return "android";
  if (isWindowsShell()) return "windows";
  return "web";
}

/** Absolute URL of the artefact this platform should download, if any. */
export function resolvePlatformTarget(
  manifest: UpdateManifest,
  platform: UpdatePlatform = currentPlatform(),
): { url: string; kind: "apk" | "bundle" | "installer" } | null {
  const abs = (u?: string) =>
    !u ? null : /^https?:\/\//i.test(u) ? u : `${UPDATE_BASE}/${u.replace(/^\/+/, "")}`;

  if (platform === "android") {
    const apk = abs(manifest.apkUrl);
    if (apk) return { url: apk, kind: "apk" };
    const bundle = abs(manifest.bundleUrl);
    return bundle ? { url: bundle, kind: "bundle" } : null;
  }
  if (platform === "windows") {
    const win = abs(manifest.windowsUrl);
    return win ? { url: win, kind: "installer" } : null;
  }
  return null;
}

/**
 * Read the manifest. Returns `null` (never throws) when the folder is
 * unreachable or the document is not a usable manifest, so callers can always
 * fall back to their legacy feed.
 */
export async function fetchManifest(url = MANIFEST_URL): Promise<UpdateManifest | null> {
  try {
    const data = await withTimeout(httpGetJson<UpdateManifest>(url));
    if (!data || typeof data.version !== "string" || !acceptsReleaseVersion(data.version.trim())) return null;
    return data;
  } catch {
    return null;
  } finally {
    /* callers always leave their "checking" state, reachable or not */
  }
}
