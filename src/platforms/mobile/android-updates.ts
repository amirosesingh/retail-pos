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
import { downloadPercent, readUpdateDownload, waitForUpdateDownload } from "./update-download";

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
 * Android DownloadManager owns the transfer and persists it across screen-off
 * and process recreation. Its completed file is checked natively before the
 * existing FileOpener installer flow runs.
 */
export async function downloadAndInstall(
  url: string,
  file: string,
  onProgress: (pct: number) => void,
): Promise<{ uri: string; opened: boolean; error?: string }> {
  const uri = await waitForUpdateDownload(url, file, onProgress);
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
  const checkInFlight = useRef(false);

  const check = useCallback(async () => {
    if (!isNative() || !isAndroid() || checkInFlight.current || downloadInFlight.current) return;
    checkInFlight.current = true;
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
      checkInFlight.current = false;
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
    const reconnect = () => { void check(); };
    const foreground = () => { if (document.visibilityState === "visible") reconnect(); };
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [check]);

  useEffect(() => {
    if (!isNative() || !isAndroid()) return;
    let active = true;
    let reading = false;
    const restore = async () => {
      if (reading || downloadInFlight.current || document.visibilityState === "hidden") return;
      reading = true;
      try {
        const download = await readUpdateDownload();
        const version = /^Retail-(.+)\.apk$/.exec(download.file ?? "")?.[1];
        if (!active || downloadInFlight.current || !version || !acceptsReleaseVersion(version) || !isNewer(version, APP_VERSION) || download.status === "idle") return;
        setState(s => s.latest && isNewer(s.latest, version) ? s : ({ ...s, latest: version, file: download.file!, url: download.url ?? null,
          downloading: download.status === "downloading" || download.status === "paused",
          percent: downloadPercent(download), readyUri: download.status === "complete" ? download.uri ?? null : null,
          error: download.status === "failed" ? download.error ?? "Update download failed. Tap Download to retry." : null }));
      } catch { /* Keep normal feed checks available if the Android service is unavailable. */ }
      finally { reading = false; }
    };
    void restore();
    const timer = setInterval(() => void restore(), 2000);
    const foreground = () => { void restore(); };
    document.addEventListener("visibilitychange", foreground);
    return () => { active = false; clearInterval(timer); document.removeEventListener("visibilitychange", foreground); };
  }, []);

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
