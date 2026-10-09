import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { updateBridge, useAppUpdates } from "@/lib/app-updates";
import { updateRestartSafe } from "@/lib/update-safety";
import { isElectron } from "@/platform-config/platform";

export function DesktopUpdateBanner() {
  const { state, supported, install, installing, installError } = useAppUpdates();
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try { return sessionStorage.getItem("pos.update.dismissed"); } catch { return null; }
  });
  useEffect(() => updateBridge()?.onUpdateSafety?.(updateRestartSafe), []);
  if (!supported || !isElectron()) return null;
  const ready = state.status === "ready";
  const failed = state.status === "error";
  const downloading = state.status === "available" || state.status === "downloading";
  if (!ready && !failed && !downloading) return null;
  const key = `${state.status === "available" ? "downloading" : state.status}:${state.available ?? ""}`;
  if (dismissed === key) return null;
  const later = () => {
    setDismissed(key);
    try { sessionStorage.setItem("pos.update.dismissed", key); } catch { /* in-memory dismissal still works */ }
  };
  return (
    <aside aria-label="Application update" className="fixed bottom-4 right-4 z-50 w-[calc(100%-2rem)] max-w-sm rounded-xl border border-border bg-card p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <img src="/favicon.ico" alt="Tomboard POS" className="h-9 w-9 shrink-0" />
        <div className="min-w-0 text-sm" aria-live="polite">
          <p className="font-semibold">{ready ? "Tomboard POS Update Ready" : failed ? "Update could not be downloaded" : `Tomboard POS v${state.available ?? ""}`}</p>
          <p className="mt-1 text-xs text-muted-foreground">{installError || (installing ? "Saving and synchronizing before restarting…" : ready ? "A new version is ready. Update now or install it when you next restart the application." : failed ? "Your current POS version will continue working." : `Downloading automatically — ${state.percent}%`)}</p>
          {ready && <p className="mt-1 text-xs text-muted-foreground">Version {state.available}</p>}
        </div>
      </div>
      {downloading && <progress className="mt-3 h-2 w-full" max={100} value={state.percent} aria-label="Update download progress" />}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={installing} onClick={later}>Later</Button>
        {ready && <Button size="sm" disabled={installing} onClick={() => void install()}>{installing ? "Preparing…" : "Update & Restart"}</Button>}
        {failed && <Button size="sm" variant="outline" asChild><Link to="/settings/updates">Details</Link></Button>}
      </div>
    </aside>
  );
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
