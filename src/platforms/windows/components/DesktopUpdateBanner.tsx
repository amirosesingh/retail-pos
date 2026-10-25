import { useEffect, useState } from "react";
import { NativeUpdateOrb } from "@/components/ui/native-update-orb";
import { updateBridge, useAppUpdates } from "@/lib/app-updates";
import { updateRestartSafe } from "@/lib/update-safety";
import { isElectron } from "@/platform-config/platform";

export function DesktopUpdateBanner() {
  const { state, supported, install, check, download, installing, installError } = useAppUpdates();
  useEffect(() => updateBridge()?.onUpdateSafety?.(updateRestartSafe), []);
  if (!supported || !isElectron() || !["available", "downloading", "ready"].includes(state.status) && !(state.available && ["error", "checking"].includes(state.status))) return null;
  const ready = state.status === "ready";
  const failed = state.status === "error";
  const downloading = state.status === "downloading";
  const checking = state.status === "checking";
  const available = state.status === "available";
  const detail = installError || (installing ? "Saving and synchronizing before restart" :
    ready ? "Downloaded. Tap to install and restart." : failed ? (state.error ?? "Download failed. Tap to retry.") :
      downloading ? "Downloading update" : checking ? "Checking for updates" :
        available ? "Update available. Tap to download." :
          state.status === "unavailable" ? (state.error ?? "Updates are unavailable in this build.") :
            state.status === "current" ? "App is up to date. Tap to check again." : "Tap to check for updates");
  return <NativeUpdateOrb label={`Application update ${state.available ?? ""}`} detail={detail}
    progress={downloading ? state.percent : undefined} busy={checking || downloading || installing} error={failed || !!installError}
    onClick={() => void (ready ? install() : available ? download() : check())} />;
}

export function DesktopCloseSyncStatus() {
  const [closing, setClosing] = useState<{ active: boolean; message?: string }>({ active: false });
  useEffect(() => updateBridge()?.onClosingSync?.(setClosing), []);
  if (!closing.active) return null;
  return <div role="status" aria-live="polite" className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 p-6">
    <div className="max-w-md rounded-xl border bg-card p-6 shadow-lg">
      <p className="font-semibold">Finishing synchronization</p>
      <p className="mt-2 text-sm text-muted-foreground">{closing.message}</p>
      <p className="mt-2 text-xs text-muted-foreground">Please keep this computer connected. The application will close when synchronization finishes.</p>
    </div>
  </div>;
}
