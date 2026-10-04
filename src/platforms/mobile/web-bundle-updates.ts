/**
 * Android web-code update policy.
 *
 * A previous implementation downloaded an unsigned ZIP and handed its parent
 * directory to Capacitor without extracting or authenticating it. That could
 * neither boot the advertised bundle nor establish who produced the code.
 * Remote web-code activation is therefore fail-closed. Android updates ship
 * through the signed APK channel, which Android verifies before installation.
 */
import { APP_VERSION } from "@/lib/app-updates";
import { isNewerVersion } from "@/lib/update-manifest";
import { BUNDLE_EPOCH, isBundleEpochCompatible } from "@/lib/bundle-epoch";
import { isNative } from "@/platform-config/platform";

const STATE_KEY = "pos.ui.webBundle";
type StoredBundle = { version: string; path: string; epoch?: number };

export function legacyBundleStoragePath(version: string): string | null {
  return /^[0-9]+(?:\.[0-9]+){1,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(version)
    ? `web/${version}`
    : null;
}

function readState(): StoredBundle | null {
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as StoredBundle) : null;
  } catch {
    return null;
  }
}

function clearState() {
  try {
    window.localStorage.removeItem(STATE_KEY);
  } catch {
    /* packaged APK assets remain authoritative */
  }
}

async function removeStoredBundle(stored: StoredBundle): Promise<boolean> {
  const path = legacyBundleStoragePath(stored.version);
  // Invalid legacy state is not safe to turn into a filesystem path and
  // cannot be repaired by retrying, so it may be forgotten.
  if (!path) return true;
  try {
    const { Filesystem, Directory } = (await import("@capacitor/filesystem")) as unknown as {
      Filesystem: { rmdir: (options: { path: string; directory: string; recursive: boolean }) => Promise<void> };
      Directory: { Data: string };
    };
    await Filesystem.rmdir({ path, directory: Directory.Data, recursive: true });
    return true;
  } catch {
    // Keep the pointer so a transient plugin/filesystem failure can be retried
    // on the next launch. A missing directory is harmless and may retry too.
    return false;
  }
}

export async function purgeStoredBundle(stored: StoredBundle | null): Promise<void> {
  if (!stored || (await removeStoredBundle(stored))) clearState();
}

export function isNewerBundle(candidate: string, current: string): boolean {
  return isNewerVersion(candidate, current);
}

/** Retained for upgrade compatibility tests; remote bundles are never served. */
export function bundleDecision(
  stored: StoredBundle | null,
  shellVersion = APP_VERSION,
  shellEpoch = BUNDLE_EPOCH,
): "none" | "serve" | "purge" {
  if (!stored?.version || !stored.path) return "none";
  if (!isBundleEpochCompatible(stored.epoch, shellEpoch)) return "purge";
  if (!isNewerBundle(stored.version, shellVersion)) return "purge";
  return "purge";
}

/** Purge every legacy unsigned download before the packaged app starts. */
export async function applyPendingWebBundle(): Promise<void> {
  if (typeof window === "undefined" || !isNative()) return;
  const stored = readState();
  if (stored) await purgeStoredBundle(stored);
}

/** Signed APK releases are the only supported Android code-update channel. */
export async function checkWebBundle(): Promise<string | null> {
  if (typeof window !== "undefined" && isNative()) {
    const stored = readState();
    if (stored) await purgeStoredBundle(stored);
  }
  return null;
}

export function startWebBundleChecks(): () => void {
  if (typeof window === "undefined" || !isNative()) return () => {};
  void checkWebBundle();
  return () => {};
}
