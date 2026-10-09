/**
 * Quiet strip at the bottom of the Windows till when a new version is waiting
 * or when an update gave up — so nobody has to open Settings to find out.
 */
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Download, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useAppUpdates } from "@/lib/app-updates";
import { isElectron } from "@/platform-config/platform";

export function DesktopUpdateBanner() {
  const { state, supported, install, installing, installError } = useAppUpdates();
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (!supported || !isElectron()) return null;

  const ready = state.status === "ready";
  const failed = state.status === "error";
  if (!ready && !failed) return null;

  const key = `${state.status}:${state.available ?? state.detail ?? ""}`;
  if (dismissed === key) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex items-center gap-3 border-t border-border bg-card px-4 py-3 shadow-lg">
      {ready ? (
        <Download className="h-4 w-4 shrink-0 text-primary" />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
      )}
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-foreground">
          {ready
            ? `Version ${state.available ?? ""} is ready to install`
            : "The update did not go through"}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {installError || (installing ? "Synchronizing pending data before installation…" : ready ? "Pending data will synchronize before restarting. Your open shift is preserved." : state.error)}
        </p>
      </div>
      {ready ? (
        <Button size="sm" disabled={installing} onClick={() => void install()}>
          {installing ? "Preparing installation…" : "Restart and install"}
        </Button>
      ) : (
        <Button size="sm" variant="outline" asChild>
          <Link to="/settings/updates">See why</Link>
        </Button>
      )}
      <Button
        size="icon"
        variant="ghost"
        aria-label="Dismiss update message"
        onClick={() => setDismissed(key)}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
