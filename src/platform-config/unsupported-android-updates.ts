import { APP_VERSION } from "@/version";
import type { AndroidUpdateState } from "@/platforms/mobile/android-updates";

/** Other targets keep their existing web/desktop updater; no APK installer is bundled. */
export function useAndroidUpdates(): ReturnType<typeof import("@/platforms/mobile/android-updates").useAndroidUpdates> {
  const state: AndroidUpdateState = {
    supported: false, installed: APP_VERSION, latest: null, file: null, feed: null,
    url: null, notes: null, checking: false, downloading: false, percent: 0,
    error: null, lastChecked: null, readyUri: null,
  };
  return { state, available: false, check: async () => {}, install: async () => {}, installDownloaded: async () => {} };
}
