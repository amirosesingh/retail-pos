/**
 * Quiet "new version ready" strip for the Android till, fed by the same
 * update bucket the Windows app uses.
 */
import { useState } from "react";
import { Download, Loader2, X } from "lucide-react";

import { RELEASE_CHANNEL } from "@/lib/release-channel";
import { Button } from "@/components/ui/button";
import {
  dismissAndroidUpdate,
  isAndroidUpdateDismissed,
  useAndroidUpdates,
} from "@/platforms/mobile/android-updates";

export function AndroidUpdateBanner() {
  const { state, available, install, installDownloaded } = useAndroidUpdates();
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (!state.supported) return null;

  // The APK is on the phone but Android did not open its installer — offer it
  // again rather than leaving the counter with a downloaded file and no way in.
  if (state.readyUri) {
    return (
      <div role="status" aria-live="polite" className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+1.75rem)] z-50 flex items-center gap-3 border-t border-border bg-card px-4 py-3 shadow-lg">
        <Download className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-foreground">Update downloaded</p>
          <p className="truncate text-xs text-muted-foreground">
            {state.error ?? "Tap to install the new version."}
          </p>
        </div>
        <Button size="sm" onClick={() => void installDownloaded()}>
          Tap to install
        </Button>
      </div>
    );
  }

  if (!available || !state.latest) return null;
  if (dismissed === state.latest || isAndroidUpdateDismissed(state.latest)) return null;

  return (
    <div role="status" aria-live="polite" className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+1.75rem)] z-50 flex items-center gap-3 border-t border-border bg-card px-4 py-3 shadow-lg">
      <Download className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-foreground">{RELEASE_CHANNEL === "beta" ? "Beta update" : "Update"} {state.latest} is available</p>
        <p className="truncate text-xs text-muted-foreground">
          {state.downloading
            ? `Downloading… ${state.percent}%`
            : (state.error ?? `You are on ${state.installed}`)}
        </p>
      </div>
      <Button size="sm" onClick={() => void install()} disabled={state.downloading}>
        {state.downloading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
        {state.downloading ? `${state.percent}%` : "Download"}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        disabled={state.downloading}
        aria-label="Dismiss update"
        onClick={() => { dismissAndroidUpdate(state.latest!); setDismissed(state.latest); }}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}