/**
 * Step 1 of first-run setup on a terminal app: point this device at the
 * central database.
 *
 * It is not a one-time wizard — it comes back as the start-up screen any time
 * the device has no working database connection and no valid registration.
 * Terminal activation is a separate step that follows it.
 */
import { useNavigate } from "@tanstack/react-router";
import { CloudCog, LifeBuoy, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { reportAppReady } from "@/lib/app-health";
import { CloudConnectionPanel } from "@/platforms/web/components/pos/settings/panels/CloudConnectionPanel";
import { checkCloudConnected } from "@/core/activation/registration-status";
import {
  hasRequiredPlatformConfig,
  subscribeConfigReady,
} from "@/lib/platform-config-ready";

export function ConnectDatabaseScreen({
  cloudConfigured,
  onRetry,
}: {
  /** keys are saved but the link is down */
  cloudConfigured: boolean;
  onRetry: () => void;
}) {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const [hasSavedConfiguration, setHasSavedConfiguration] = useState(cloudConfigured);

  // Waiting for setup details is a normal first run, not a failed launch — tell
  // the desktop shell the app is up so it does not swap in the repair screen.
  useEffect(() => reportAppReady(), []);

  useEffect(() => {
    const apply = (state: Awaited<ReturnType<typeof hasRequiredPlatformConfig>>) =>
      setHasSavedConfiguration(Object.values(state.have).some(Boolean));
    void hasRequiredPlatformConfig().then(apply);
    return subscribeConfigReady(apply);
  }, []);

  const continueStartup = async () => {
    setChecking(true);
    try {
      await checkCloudConnected();
    } finally {
      setChecking(false);
      onRetry();
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground sm:p-6">
      <div className="w-full max-w-lg space-y-4 rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <CloudCog className="size-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Connect to the database</h1>
            <p className="text-xs text-muted-foreground">Step 1 of 2 · then activate this terminal</p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {cloudConfigured
            ? "The saved database details are not answering right now. Check the address and key below, or try again once the network is back."
            : "Enter the central database address and publishable key for your company. They are sealed in this device's secure store."}
        </p>

        <div className="rounded-xl border border-border bg-muted/40 p-4">
          <CloudConnectionPanel onConnected={continueStartup} />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={checking}
            onClick={() => void continueStartup()}
          >
            {checking ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Test and continue
          </Button>
          {hasSavedConfiguration && (
            <Button
              variant="outline"
              className="border-border bg-muted text-foreground hover:bg-accent"
              onClick={() => void navigate({ to: "/recovery" })}
            >
              <LifeBuoy className="size-4" />
              Emergency access
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
