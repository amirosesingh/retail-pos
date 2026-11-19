import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Cloud, Database, RefreshCw, Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  LOCAL_DATABASE_SETTINGS_REQUEST,
  ONLINE_STARTUP_OVERRIDE,
} from "@/core/local-db/db-mode";
import { LocalDatabaseWizard } from "@/platforms/windows/components/LocalDatabaseWizard";
import { checkHealth, cloudDiagnosis } from "@/core/activation/connection-health";
import { StartupShiftRecoveryReview } from "@/platforms/windows/components/StartupShiftRecoveryReview";
import { TerminalLogin } from "@/platforms/web/components/pos/TerminalLogin";
import { desktopStorageRoute } from "@/lib/desktop-storage-route";
import { observeDesktopStartup, type StartupActivity } from "@/lib/desktop-startup-progress";

type DatabaseState = {
  enabled?: boolean;
  configured?: boolean;
  connected?: boolean;
  tradingReady?: boolean;
  state?: string;
  startupActivity?: StartupActivity | null;
  startupPaused?: boolean;
  detail?: { error?: string; hint?: string; status?: string; code?: string; table?: string } | null;
};

type StartupDatabaseApi = {
  getState(): Promise<DatabaseState>;
  retryStartup(): Promise<DatabaseState>;
  subscribe(cb: (state: DatabaseState) => void): () => void;
  onStartupActivity?: (cb: (activity: StartupActivity | null) => void) => () => void;
};

const database = () =>
  (window.pos as unknown as { database?: StartupDatabaseApi } | undefined)?.database;
const SHIFT_TABLES = new Set(["shifts", "shift_cash_counts", "shift_reconciliations", "shift_close_events", "shift_notifications", "shift_variance_alerts"]);
const SHIFT_REVIEW_CODES = new Set(["ELOCAL_PENDING_UNVERIFIED", "ELOCAL_CT_PENDING", "ESYNC_APPLY_CONFLICT",
  "SYNC_SHIFT_GRAPH_CONFLICT", "SYNC_SHIFT_GRAPH_MISSING", "SYNC_SHIFT_TARGET_FACTS_INVALID"]);
const needsRecoveryReview = (state: DatabaseState, activity: StartupActivity | null) => state.state === "enabled_bootstrapping" &&
  state.connected === true && state.tradingReady === true && activity?.active !== true &&
  SHIFT_TABLES.has(state.detail?.table ?? "") && SHIFT_REVIEW_CODES.has(state.detail?.code ?? "");

export const Route = createFileRoute("/database-startup")({
  component: DatabaseStartupPage,
});

function DatabaseStartupPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<DatabaseState>({});
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<StartupActivity | null>(null), [syncPaused, setSyncPaused] = useState(false);
  const active = useRef(false), revision = useRef(0), pendingAction = useRef(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [showLocalSettings, setShowLocalSettings] = useState(
    () => window.sessionStorage.getItem(LOCAL_DATABASE_SETTINGS_REQUEST) === "1",
  );
  const migrationRequired = state.detail?.status === "migration_required";
  const applyingMigration = state.detail?.status === "applying_migration";
  const locallyReady = desktopStorageRoute(state) === "local";
  const initializing = state.state === undefined && state.enabled === undefined && !error;
  const paused = state.state === "enabled_bootstrapping" && (syncPaused || activity?.paused === true);
  const bootstrapping = state.state === "enabled_bootstrapping";
  const restoring = initializing || state.state === "enabled_connecting" || state.state === "enabled_validating" ||
    bootstrapping && !paused && (activity?.active === true || !state.detail?.code && !state.detail?.error);
  const reviewRequired = needsRecoveryReview(state, activity);
  const waitingForData = bootstrapping && state.connected === true && state.tradingReady === true && !restoring && !reviewRequired;

  const applyState = useCallback((next: DatabaseState) => {
    if (!active.current) return;
    revision.current++;
    setState(next);
    if (desktopStorageRoute(next) === "local") {
      window.sessionStorage.removeItem(ONLINE_STARTUP_OVERRIDE);
      void navigate({ to: "/" });
    }
  }, [navigate]);

  useEffect(() => {
    window.sessionStorage.removeItem(LOCAL_DATABASE_SETTINGS_REQUEST);
    active.current = true;
    revision.current++;
    const api = database();
    if (!api) setError("The desktop database bridge is unavailable. Restart the app or open database recovery.");
    const unsubscribe = api ? observeDesktopStartup(api, next => {
      if (next) applyState(next);
      else if (active.current) setError("Could not read the saved local database state. Retry the connection.");
    }, setActivity, window.pos?.sync, setSyncPaused) : undefined;
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      active.current = false;
      unsubscribe?.();
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [applyState]);

  const retry = async () => {
    if (pendingAction.current) return;
    pendingAction.current = true;
    const startedAt = revision.current;
    setBusy(true);
    setError("");
    try {
      const next = await database()!.retryStartup();
      if (!active.current || revision.current !== startedAt) return;
      applyState(next);
    } catch (cause) {
      if (active.current && revision.current === startedAt) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pendingAction.current = false;
      if (active.current) setBusy(false);
    }
  };

  const continueOnline = async () => {
    if (pendingAction.current) return;
    pendingAction.current = true;
    const startedAt = revision.current;
    setBusy(true);
    setError("");
    try {
      const report = await checkHealth(true);
      if (!active.current || revision.current !== startedAt) return;
      if (!report.cloud) {
        const issue = cloudDiagnosis().issue.replaceAll("-", " ");
        setError(`The configured central POS service is not reachable (${issue}). Retry it or restore the local SQL Server connection.`);
        return;
      }
      window.sessionStorage.setItem(ONLINE_STARTUP_OVERRIDE, "1");
      await navigate({ to: "/" });
    } catch (cause) {
      if (active.current && revision.current === startedAt) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pendingAction.current = false;
      if (active.current) setBusy(false);
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
                    : reviewRequired ? "Saved local work needs review"
                      : locallyReady ? "Local database is ready"
                      : paused ? "Local data preparation is paused"
                        : waitingForData ? "Local store data needs verification" : "Local database is unavailable"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {applyingMigration
                ? "Retail is applying the current local database update. Keep this window open; it will continue automatically when the update finishes."
                : restoring
                  ? "Retail is checking the saved Microsoft SQL Server connection. This screen remains available while startup completes."
                  : migrationRequired
                    ? "SQL Server is connected, but its POS schema must be updated before local trading resumes."
                    : reviewRequired
                      ? "SQL Server is connected. Retail needs to verify saved local work before local trading can resume."
                      : locallyReady
                        ? "Saved local data is available. Returning to the terminal; synchronization details remain in Sync & Data."
                        : waitingForData || paused
                        ? "SQL Server is connected. Saved local work is retained while synchronization verifies store data."
                        : "Retail tried the saved Microsoft SQL Server connection before opening the terminal."}
            </p>
          </div>
        </div>

        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <div className="font-medium">{initializing ? "Checking saved connection" : state.state?.replaceAll("_", " ") ?? "Connection failed"}</div>
          <div className="mt-1 text-muted-foreground">
            {state.detail?.error ?? (restoring ? "Retail will continue automatically when local preparation finishes."
              : locallyReady ? "The saved local connection has been verified."
              : paused ? "Resume synchronization to finish preparing this terminal."
                : "Check that SQL Server is running and the saved server is reachable.")}
          </div>
        </div>

        <StartupShiftRecoveryReview connected={state.connected === true && state.tradingReady === true && !migrationRequired && !applyingMigration}
          reviewRequired={reviewRequired && !busy} renderLogin={view => <TerminalLogin view={view} />} />

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
