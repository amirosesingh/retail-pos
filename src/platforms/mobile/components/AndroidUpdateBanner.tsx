import { useEffect, useRef } from "react";
import { NativeUpdateOrb } from "@/components/ui/native-update-orb";
import { RELEASE_CHANNEL } from "@/lib/release-channel";
import { useAndroidUpdates } from "@/platforms/mobile/android-updates";

/** Available before terminal registration and login; the OS owns the APK transfer. */
export function AndroidUpdateBanner() {
  const { state, available, check, download, installDownloaded } = useAndroidUpdates();
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (!state.supported || !available || !state.latest || state.readyUri || state.downloading || state.error || attempted.current === state.latest) return;
    attempted.current = state.latest;
    void download();
  }, [state.supported, state.latest, state.readyUri, state.downloading, state.error, available, download]);

  if (!state.supported || !available || !state.latest) return null;
  const label = `${RELEASE_CHANNEL === "beta" ? "Beta update" : "Update"} ${available ? state.latest : ""}`.trim();
  const detail = state.readyUri ? (state.error ?? "Downloaded. Tap to install.")
    : state.downloading ? "Downloading update"
      : state.checking ? "Checking for updates"
        : state.error ?? (available ? "Update available. Tap to download." :
          state.lastChecked ? "App is up to date. Tap to check again." : "Tap to check for updates");
  return <NativeUpdateOrb label={label} detail={detail} progress={state.downloading ? state.percent : undefined} busy={state.checking || state.downloading} error={!!state.error}
    onClick={() => void (state.readyUri ? installDownloaded() : available ? download() : check())} />;
}
