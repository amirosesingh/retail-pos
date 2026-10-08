import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Cloud, Database, RefreshCw, Settings } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  LOCAL_DATABASE_SETTINGS_REQUEST,
  ONLINE_STARTUP_OVERRIDE,
} from "@/core/local-db/db-mode";
import { LocalDatabaseWizard } from "@/platforms/windows/components/LocalDatabaseWizard";
import { checkHealth, cloudDiagnosis } from "@/core/activation/connection-health";

type DatabaseState = {
  enabled?: boolean;
  configured?: boolean;
  connected?: boolean;
  tradingReady?: boolean;
  state?: string;
  detail?: { error?: string; hint?: string; status?: string } | null;
};

type StartupDatabaseApi = {
  getState(): Promise<DatabaseState>;
  retryStartup(): Promise<DatabaseState>;
  subscribe(cb: (state: DatabaseState) => void): () => void;
};

const database = () =>
  (window.pos as unknown as { database?: StartupDatabaseApi } | undefined)?.database;

export const Route = createFileRoute("/database-startup")({
  component: DatabaseStartupPage,
});

function DatabaseStartupPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<DatabaseState>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [showLocalSettings, setShowLocalSettings] = useState(
    () => window.sessionStorage.getItem(LOCAL_DATABASE_SETTINGS_REQUEST) === "1",
  );
  const migrationRequired = state.detail?.status === "migration_required";
  const applyingMigration = state.detail?.status === "applying_migration";
  const restoring = state.state === "enabled_connecting" || state.state === "enabled_validating";

  useEffect(() => {
    window.sessionStorage.removeItem(LOCAL_DATABASE_SETTINGS_REQUEST);
    let live = true;
    const api = database();
    const applyState = (next: DatabaseState) => {
      if (!live) return;
      setState(next);
      if (next.tradingReady) {
        window.sessionStorage.removeItem(ONLINE_STARTUP_OVERRIDE);
        void navigate({ to: "/" });
      }
    };
    const unsubscribe = api?.subscribe(applyState);
    void api?.getState().then(applyState).catch((cause) => {
      if (live) setError(cause instanceof Error ? cause.message : String(cause));
    });
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      live = false;
      unsubscribe?.();
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [navigate]);

  const retry = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await database()!.retryStartup();
      setState(next);
      if (next.tradingReady) {
        window.sessionStorage.removeItem(ONLINE_STARTUP_OVERRIDE);
        await navigate({ to: "/" });
      } else {
        setError(next.detail?.error ?? "The local SQL database is still unavailable.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const continueOnline = async () => {
    setBusy(true);
    setError("");
    try {
      const report = await checkHealth(true);
      if (!report.cloud) {
        const issue = cloudDiagnosis().issue.replaceAll("-", " ");
        setError(`The configured central POS service is not reachable (${issue}). Retry it or restore the local SQL Server connection.`);
        return;
      }
      window.sessionStorage.setItem(ONLINE_STARTUP_OVERRIDE, "1");
      await navigate({ to: "/" });
    } finally {
      setBusy(false);
    }
  };

  const openSettings = async () => {
    setError("");
    setShowLocalSettings(true);
  };

  if (showLocalSettings) {
    return (
      <main className="min-h-screen bg-background p-6">
        <section className="mx-auto w-full max-w-4xl space-y-4">
          <Button variant="outline" onClick={() => setShowLocalSettings(false)}>
            Back to database recovery
          </Button>
          <LocalDatabaseWizard initiallyOpen onRecoveryClose={() => setShowLocalSettings(false)} />
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <section className="w-full max-w-xl space-y-5 rounded-xl border bg-card p-6 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-amber-500/10 p-3 text-amber-600">
            <AlertTriangle className="size-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">
              {applyingMigration
                ? "Updating local database"
                : restoring
                  ? "Preparing local database"
                  : migrationRequired
                    ? "Local database update required"
                    : "Local database is unavailable"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {applyingMigration
                ? "Retail is applying the current local database update. Keep this window open; it will continue automatically when the update finishes."
                : restoring
                  ? "Retail is checking the saved Microsoft SQL Server connection. This screen remains available while startup completes."
                  : migrationRequired
                    ? "SQL Server is connected, but its POS schema must be updated before local trading resumes."
                    : "Retail tried the saved Microsoft SQL Server connection before opening the terminal."}
            </p>
          </div>
        </div>

        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <div className="font-medium">{state.state?.replaceAll("_", " ") ?? "Connection failed"}</div>
          <div className="mt-1 text-muted-foreground">
            {state.detail?.error ?? "Check that SQL Server is running and the saved server is reachable."}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Button disabled={busy || restoring} onClick={() => void retry()}>
            <RefreshCw className={busy || restoring ? "size-4 animate-spin" : "size-4"} />
            {restoring ? "Database check in progress" : "Retry local database"}
          </Button>
          <Button variant="secondary" disabled={busy || restoring || !online} onClick={() => void continueOnline()}>
            <Cloud className="size-4" /> Continue with online terminal
          </Button>
          <Button className="sm:col-span-2" variant="outline" disabled={busy || restoring} onClick={() => void openSettings()}>
            <Settings className="size-4" /> Open local SQL database settings
          </Button>
        </div>

        {!online ? (
          <p className="flex items-center gap-2 text-xs text-destructive">
            <Database className="size-4" /> Online terminal is unavailable while this computer is offline.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Online-only mode lasts for this app session. Restart or retry the local database to return to local-first operation.
          </p>
        )}
        {error ? <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      </section>
    </main>
  );
}
