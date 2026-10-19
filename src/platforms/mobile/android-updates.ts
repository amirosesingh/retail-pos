/**
 * Self-update for the Android build, mirroring the Windows till.
 *
 * The release workflow uploads `Retail-<version>.apk` and a small
 * `latest.json` to the same update bucket the desktop app uses. The phone
 * reads that file, compares versions, downloads the APK and hands it to
 * Android's installer. Nothing here runs on web or Electron.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { APP_VERSION } from "@/lib/app-updates";
import { isNative, isAndroid } from "@/platform-config/platform";
import {
  describeNetworkError,
  httpExists,
  firstReachableUrl,
  httpGetJson,
} from "@/platforms/mobile/native-http";
import { compareVersions, fetchManifest, resolvePlatformTarget, withTimeout, UPDATE_BASE } from "@/lib/update-manifest";
import { acceptsReleaseVersion } from "@/lib/release-channel";

const BASE = UPDATE_BASE;
/** Current layout first, legacy path second, for phones on older releases. */
const FEEDS = [`${BASE}/latest/android`, `${BASE}/android`];
const SIX_HOURS = 6 * 60 * 60 * 1000;
const DISMISS_KEY = "pos.android.update.dismissed";

export type AndroidUpdateState = {
  supported: boolean;
  installed: string;
  latest: string | null;
  file: string | null;
  feed: string | null;
  /** Absolute APK URL from the manifest, when one was published. */
  url: string | null;
  notes: string | null;
  checking: boolean;
  downloading: boolean;
  percent: number;
  error: string | null;
  lastChecked: Date | null;
  /** Set when the APK is on the phone but Android's installer did not open. */
  readyUri: string | null;
};

const INITIAL: AndroidUpdateState = {
  supported: false,
  installed: APP_VERSION,
  latest: null,
  file: null,
  feed: null,
  url: null,
  notes: null,
  checking: false,
  downloading: false,
  percent: 0,
  error: null,
  lastChecked: null,
  readyUri: null,
};

/** "1.2.10" > "1.2.9" — plain numeric compare, missing parts count as 0. */
export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

type Latest = {
  version: string;
  file: string;
  feed: string;
  url: string | null;
  notes: string | null;
};

export async function fetchLatest(): Promise<Latest> {
  // Preferred path: the single self-hosted manifest.
  const manifest = await fetchManifest();
  if (manifest) {
    const target = resolvePlatformTarget(manifest, "android");
    if (target?.kind === "apk" && await withTimeout(httpExists(target.url)).catch(() => false)) {
      const file = target.url.split("/").pop() || `Retail-${manifest.version}.apk`;
      return {
        version: manifest.version,
        file,
        feed: FEEDS[0]!,
        url: target.url,
        notes: manifest.releaseNotes ?? null,
      };
    }
  }

  // Legacy per-folder feeds, for phones pointed at an older bucket layout.
  let last: unknown = new Error("No update feed is reachable.");
  for (const feed of FEEDS) {
    try {
      const data = await withTimeout(
        httpGetJson<{ version?: string; file?: string }>(`${feed}/latest.json`),
      );
      if (!data?.version || !acceptsReleaseVersion(data.version)) throw new Error("The update feed did not report a version for this release channel.");
      return {
        version: data.version,
        file: data.file || `Retail-${data.version}.apk`,
        feed,
        url: null,
        notes: null,
      };
    } catch (err) {
      last = err;
    }
  }
  throw new Error(describeNetworkError(last));
}

/**
 * Download the APK and open Android's package installer.
 *
 * The file goes into app cache, exposed to the installer by FileOpener's
 * FileProvider with a temporary read grant. The
 * write is confirmed with a stat before the intent fires, so the installer
 * never opens on a half-written file. Returns the content URI so the caller
 * can offer a manual "Tap to install" if the intent was refused.
 */
export async function downloadAndInstall(
  url: string,
  file: string,
  onProgress: (pct: number) => void,
): Promise<{ uri: string; opened: boolean; error?: string }> {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");

  // Stream to disk natively: transferring the entire APK as base64 through
  // the webview duplicates it in memory and supplies no byte progress.
  // Filesystem 8 exposes ExternalCache for modern file operations, but its
  // legacy Android downloader only supports CACHE (not EXTERNAL_CACHE).
  // Passing ExternalCache produces a null File and "Error downloading file: null".
  const directory = Directory.Cache;
  let expectedBytes = 0;
  let receivedBytes = 0;
  const listener = await Filesystem.addListener("progress", progress => {
    if (progress.url !== url) return;
    receivedBytes = progress.bytes;
    expectedBytes = progress.contentLength;
    if (expectedBytes > 0) onProgress(Math.min(99, Math.floor(receivedBytes / expectedBytes * 100)));
  });
  try {
    onProgress(0);
    for (let attempt = 0; ; attempt += 1) {
      try {
        await Filesystem.downloadFile({
          url, path: file, directory, recursive: true, progress: true,
          connectTimeout: 15000, readTimeout: 60000,
          headers: { "Accept-Encoding": "identity" },
        });
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error);
        if (attempt >= 2 || !/software caused connection abort|connection (?:abort|reset)|socket|timed? ?out|network is unreachable|unable to resolve host/i.test(message)) throw error;
        await Filesystem.deleteFile({ path: file, directory }).catch(() => {});
        expectedBytes = 0;
        receivedBytes = 0;
        onProgress(0);
        await new Promise(resolve => setTimeout(resolve, 750 * (attempt + 1)));
      }
    }
    const stat = await Filesystem.stat({ path: file, directory });
    if (!stat?.size || (expectedBytes > 0 && stat.size !== expectedBytes) ||
      (receivedBytes > 0 && stat.size < receivedBytes)) {
      throw new Error("The update file did not finish saving on this device. Retry the download.");
    }
  } catch (error) {
    await Filesystem.deleteFile({ path: file, directory }).catch(() => {});
    throw error;
  } finally {
    await listener.remove().catch(() => {});
  }
  onProgress(100);

  const { uri } = await Filesystem.getUri({ path: file, directory });
  try {
    await openInstaller(uri);
    return { uri, opened: true };
  } catch (e) {
    return { uri, opened: false, error: (e as Error)?.message ?? "Android refused to open the installer." };
  }
}

/**
 * Hand a saved APK to Android. FileOpener publishes the file through the
 * app's FileProvider, so the installer receives a `content://` URI with read
 * permission granted rather than a `file://` path it is not allowed to touch.
 */
export async function openInstaller(uri: string): Promise<void> {
  const { FileOpener } = await import("@capacitor-community/file-opener");
  await FileOpener.open({
    filePath: uri,
    contentType: "application/vnd.android.package-archive",
    openWithDefault: true,
  });
}

export function useAndroidUpdates() {
  const [state, setState] = useState<AndroidUpdateState>(INITIAL);
  const downloadInFlight = useRef(false);

  const check = useCallback(async () => {
    if (!isNative() || !isAndroid()) return;
    setState((s) => ({ ...s, checking: true, error: null }));
    try {
      const { version, file, feed, url, notes } = await fetchLatest();
      setState((s) => ({
        ...s,
        latest: version,
        file,
        feed,
        url,
        notes,
        lastChecked: new Date(),
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        error: describeNetworkError(err),
        lastChecked: new Date(),
      }));
    } finally {
      // Whatever happened above, the card must never stay on "Checking…".
      setState((s) => ({ ...s, checking: false }));
    }
  }, []);

  const install = useCallback(async () => {
    if (downloadInFlight.current) return;
    downloadInFlight.current = true;
    setState((s) => ({ ...s, downloading: true, percent: 0, error: null }));
    try {
      const file = state.file;
      if (!file) throw new Error("No update file is available yet.");
      // The published link can point at a folder another release pruned, so
      // try it first and fall back to the older locations that still hold the
      // same APK before telling the operator anything is wrong.
      const candidates = [
        state.url,
        `${state.feed ?? FEEDS[0]!}/${encodeURIComponent(file)}`,
        ...FEEDS.map((f) => `${f}/${encodeURIComponent(file)}`),
      ].filter((u): u is string => Boolean(u));
      const url = (await firstReachableUrl(candidates)) ?? candidates[0]!;
      const res = await downloadAndInstall(url, file, (percent: number) =>
        setState((s) => ({ ...s, percent })),
      );
      setState((s) => ({
        ...s,
        downloading: false,
        percent: 100,
        readyUri: res.opened ? null : res.uri,
        error: res.opened ? null : (res.error ?? null),
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        downloading: false,
        error: describeNetworkError(err),
      }));
    } finally {
      downloadInFlight.current = false;
    }
  }, [state.file, state.feed, state.url]);

  useEffect(() => {
    if (!isNative() || !isAndroid()) return;
    setState((s) => ({ ...s, supported: true }));
    void check();
    const timer = setInterval(() => void check(), SIX_HOURS);
    return () => clearInterval(timer);
  }, [check]);

  /** Manual retry for the "Update downloaded — tap to install" prompt. */
  const installDownloaded = useCallback(async () => {
    if (!state.readyUri) return;
    try {
      await openInstaller(state.readyUri);
      setState((s) => ({ ...s, readyUri: null, error: null }));
    } catch (err) {
      setState((s) => ({ ...s, error: describeNetworkError(err) }));
    }
  }, [state.readyUri]);

  const available = Boolean(state.latest && isNewer(state.latest, state.installed));
  return { state, available, check, install, installDownloaded };
}

export function dismissAndroidUpdate(version: string) {
  if (typeof window !== "undefined") window.localStorage.setItem(DISMISS_KEY, version);
}

export function isAndroidUpdateDismissed(version: string): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DISMISS_KEY) === version;
}
