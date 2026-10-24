import { useEffect, useState } from "react";
import { NativeUpdateOrb } from "@/components/ui/native-update-orb";
import { updateBridge, useAppUpdates } from "@/lib/app-updates";
import { updateRestartSafe } from "@/lib/update-safety";
import { isElectron } from "@/platform-config/platform";

export function DesktopUpdateBanner() {
  const { state, supported, install, check, installing, installError } = useAppUpdates();
  useEffect(() => updateBridge()?.onUpdateSafety?.(updateRestartSafe), []);
  if (!supported || !isElectron()) return null;
  const ready = state.status === "ready";
  const failed = state.status === "error";
  const downloading = state.status === "available" || state.status === "downloading";
  if (!ready && !failed && !downloading) return null;
  const detail = installError || (installing ? "Saving and synchronizing before restart" :
    ready ? "Downloaded. Tap to install and restart." : failed ? (state.error ?? "Download failed. Tap to retry.") : "Downloading update");
  return <NativeUpdateOrb label={`Application update ${state.available ?? ""}`} detail={detail}
    progress={state.percent} busy={downloading || installing} error={failed || !!installError}
    onClick={() => void (ready ? install() : check())} />;
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
