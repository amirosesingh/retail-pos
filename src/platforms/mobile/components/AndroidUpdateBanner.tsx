import { useEffect, useRef } from "react";
import { NativeUpdateOrb } from "@/components/ui/native-update-orb";
import { RELEASE_CHANNEL } from "@/lib/release-channel";
import { useAndroidUpdates } from "@/platforms/mobile/android-updates";

/** Available before terminal registration and login; the OS owns the APK transfer. */
export function AndroidUpdateBanner() {
  const { state, available, download, installDownloaded } = useAndroidUpdates();
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (!state.supported || !available || !state.latest || state.readyUri || state.downloading || state.error || attempted.current === state.latest) return;
    attempted.current = state.latest;
    void download();
  }, [state.supported, state.latest, state.readyUri, state.downloading, state.error, available, download]);

  if (!state.supported || !available || !state.latest) return null;
  const label = `${RELEASE_CHANNEL === "beta" ? "Beta update" : "Update"} ${state.latest}`;
  const detail = state.readyUri ? (state.error ?? "Downloaded. Tap to install.")
    : state.downloading ? `Downloading ${state.percent}%`
      : state.error ?? "Preparing download";
  return <NativeUpdateOrb label={label} detail={detail} progress={state.percent} busy={state.downloading} error={!!state.error}
    onClick={() => void (state.readyUri ? installDownloaded() : download())} />;
}
