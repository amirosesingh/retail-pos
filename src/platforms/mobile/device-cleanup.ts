/**
 * Phone storage hygiene.
 *
 * Android keeps only what a terminal genuinely needs — activation, device key,
 * backend address, cloud keys, a couple of interface preferences and the open
 * ticket. Everything else is cache: downloaded APK files left in the external
 * cache after an update, and WebView scratch. Those are cleared on every
 * launch, and the whole cache is dropped on the first launch after the shell
 * version changes so a new build never runs against old assets.
 *
 * Uninstall leaves nothing because Android removes the app's private storage
 * and the manifest now forbids Auto Backup (see scripts/android-permissions.cjs),
 * so a reinstall can no longer be restored from Google's cloud.
 */
import { isNative } from "@/platform-config/platform";
import { isPersistentKey } from "@/lib/live-mode";
import { APP_VERSION } from "@/version";

const VERSION_KEY = "pos.shell.version";
// Owned by web-bundle-updates.ts: it must survive a transient filesystem
// failure so the legacy directory can be retried on the next launch.
const LEGACY_BUNDLE_KEY = "pos.ui.webBundle";

/**
 * Keys to remove on this launch. Pure so the upgrade case is testable without
 * a device: on an upgrade everything that is not required goes, otherwise only
 * keys that were never allowed to persist.
 */
export function staleKeys(keys: string[], upgraded: boolean): string[] {
  return keys.filter((key) => {
    if (key === VERSION_KEY) return false;
    if (key === LEGACY_BUNDLE_KEY) return false;
    if (isPersistentKey(key)) return false;
    return upgraded || key.startsWith("pos.");
  });
}

/** True when this launch is the first after the shell version changed. */
export function shellUpgraded(previous: string | null, current = APP_VERSION): boolean {
  return (previous ?? "") !== current;
}

/** Delete APK files a previous in-app update left in the external cache. */
async function purgeDownloadedInstallers(): Promise<number> {
  try {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const directory = Directory.ExternalCache ?? Directory.Cache;
    const { files } = await Filesystem.readdir({ path: "", directory });
    let removed = 0;
    for (const file of files) {
      const name = typeof file === "string" ? file : file.name;
      if (!/\.apk$/i.test(name)) continue;
      await Filesystem.deleteFile({ path: name, directory }).catch(() => {});
      removed += 1;
    }
    return removed;
  } catch {
    return 0;
  }
}

/**
 * Run the launch cleanup. Safe to call on any platform: it returns at once
 * when the app is not running inside Capacitor.
 */
export async function runDeviceCleanup(): Promise<{ upgraded: boolean; removed: number }> {
  if (typeof window === "undefined" || !isNative()) return { upgraded: false, removed: 0 };
  let upgraded = false;
  let removed = 0;
  try {
    const ls = window.localStorage;
    upgraded = shellUpgraded(ls.getItem(VERSION_KEY));
    for (const key of staleKeys(Object.keys(ls), upgraded)) {
      ls.removeItem(key);
      removed += 1;
    }
    if (upgraded) ls.setItem(VERSION_KEY, APP_VERSION);
  } catch {
    /* storage unavailable — the cleanup simply does not run this launch */
  }
  removed += await purgeDownloadedInstallers();
  return { upgraded, removed };
}
