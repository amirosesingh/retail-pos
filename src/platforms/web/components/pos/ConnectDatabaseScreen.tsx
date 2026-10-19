/**
 * Step 1 of first-run setup on a terminal app: point this device at the
 * central database.
 *
 * It is not a one-time wizard — it comes back as the start-up screen any time
 * the device has no working database connection and no valid registration.
 * Terminal activation is a separate step that follows it.
 */
import { CloudCog, Loader2, RefreshCw } from "lucide-react";
import { EmergencyAccessLink } from "@/components/shared/EmergencyAccessLink";
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
  const [checking, setChecking] = useState(false);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
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
    <div className="flex min-h-screen items-start justify-center bg-background px-3 py-4 pb-28 text-foreground sm:items-center sm:p-6">
      <div className="w-full max-w-lg space-y-3 rounded-2xl border border-border bg-card p-4 sm:space-y-4 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <CloudCog className="size-6" />
          </div>
          <div>
            <h1 className="text-base font-semibold sm:text-lg">Connect to the database</h1>
            <p className="text-xs text-muted-foreground">Step 1 of 2 · then activate this terminal</p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {cloudConfigured
            ? "Connection saved. Check the details or retry."
            : "Enter your company connection details below."}
        </p>

        {offline && <p role="status" className="rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
          Offline. Enter details now; connect to the internet to save and activate.
        </p>}

        <div className="min-w-0">
          <CloudConnectionPanel onConnected={continueStartup} />
        </div>

        {hasSavedConfiguration && <div className="flex flex-wrap gap-2 [&>button]:min-h-10 [&>button]:flex-1">
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
            <EmergencyAccessLink className="border-border bg-muted text-foreground hover:bg-accent" />
        </div>}
      </div>
    </div>
  );
}
