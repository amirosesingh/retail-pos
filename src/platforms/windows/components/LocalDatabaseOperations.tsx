import { Table } from "@/components/ui/table";
import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DatabaseHealthCard } from "./DatabaseHealthCard";
import { DatabaseJobProgress, type DatabaseJob } from "./DatabaseJobProgress";
import { mirrorTerminalConfigToDesktop } from "@/core/activation/terminal-tokens";
import { OPEN_LOCAL_DATABASE_SETTINGS_EVENT } from "./LocalDatabaseWizard";
import { isNativeDatabaseSnapshot, nativeSyncSummary } from "@/lib/sync-status-summary";
import { LegacyShiftRecoveryReview } from "./LegacyShiftRecoveryReview";
import { HeldBillRecoveryReview } from "./HeldBillRecoveryReview";
import { sameBranchId } from "@/lib/branch-id";
import type { StoreSettingsEditUpload } from "@/core/local-db/local-db";

type DatabaseState = { state?: string; enabled?: boolean; connected?: boolean; tradingReady?: boolean; profile?: { database?: string } | null };
type TableStatus = { table: string; local: string; cloud: string; status: "SYNCED" | "VERIFIED" | "DIFFERENT"; verified?: boolean; comparedAt?: string | null };
const groupedSettingsLabels = {
  PAUSED: "Paused",
  CAUGHT_UP: "Caught up",
  HANDED_BACK: "Using the existing settings download",
  MORE: "More changes waiting",
  DEFERRED: "Waiting for a local edit to upload",
  REVIEW_REQUIRED: "Review required",
  UNAVAILABLE: "Feed unavailable",
  REFUSED: "Pilot connection could not be verified",
  RETRY: "Waiting to retry",
};
type GroupedSettingsPilot = { status: keyof typeof groupedSettingsLabels; branchId: string; position?: { seq: string } | null };
const uploadLabels: Record<StoreSettingsEditUpload["status"], string> = {
  EMPTY: "No edits waiting",
  PENDING: "Edit queued",
  APPLIED: "Accepted centrally, waiting for download",
  AWAITING_DOWNLOAD: "Accepted centrally, waiting for download",
  RETRY: "Waiting to retry",
  REVIEW_REQUIRED: "Edit needs review",
  AWAITING_OPERATOR: "Authorized staff sign-in required",
  PAUSED: "Paused",
  UNAVAILABLE: "Pilot connection unavailable",
};
type SyncState = { phase?: string; running?: boolean; paused?: boolean; pending?: number; failed?: number; conflicts?: number; membershipDeferred?: boolean; membershipMirrored?: number; lastPushAt?: string | null; lastPullAt?: string | null; lastComparedAt?: string | null; lastVerifiedAt?: string | null; tables?: TableStatus[]; pushed?: number; merged?: number; currentTable?: string | null; lastError?: string | null; queuedTables?: { table: string; pending: number; failed: number; error?: string | null }[]; recentTables?: { table: string; direction: "push" | "pull"; rows: number; at: string }[]; groupedSettingsPilot?: GroupedSettingsPilot | null; storeSettingsEditUpload?: StoreSettingsEditUpload | null };
type FailureRow = { job_id?: string; job_type?: string; status?: string; phase?: string; current_table?: string | null; error_code?: string | null; error_message?: string | null; updated_at?: string | null };
type ConflictRow = { conflict_id?: string; entity_type?: string; entity_id?: string; reason?: string; created_at?: string | null };
type DatabaseErrorRow = { id?: string; occurred_at?: string; event?: string; category?: string; stage?: string | null; state?: string | null; code?: string | null; message?: string | null; occurrences?: number };
type BusinessBatchRow = { aggregate_id?: string; entity_type?: string; attempts?: number; error?: string; created_at?: string | null; last_attempt_at?: string | null; rows?: number };
type Failures = { databaseErrors?: DatabaseErrorRow[]; failures?: FailureRow[]; businessBatches?: BusinessBatchRow[]; conflictRows?: ConflictRow[]; conflicts?: number };
type Result = Record<string, unknown>;
type DatabaseApi = {
  getState(): Promise<DatabaseState>; health(): Promise<Result>; schemaStatus(): Promise<Result>;
  retryStartup?(): Promise<DatabaseState>; authorizeSettings?(): Promise<Result>;
  backup(file: string): Promise<Result>; restore(file: string): Promise<Result>;
  subscribe(cb: (state: DatabaseState) => void): () => void;
};
type JobsApi = { getActive(): Promise<DatabaseJob | null>; subscribe(cb: (job: DatabaseJob | null) => void): () => void };
type SyncApi = {
  getStatus(): Promise<SyncState>; getFailures(): Promise<Failures>; runNow(options: Result): Promise<Result>;
  pause(): Promise<Result>; resume(): Promise<Result>; reconcile(options: Result): Promise<Result>;
  subscribe(cb: (state: SyncState) => void): () => void;
};
const shell = () => window.pos as unknown as { database?: DatabaseApi; jobs?: JobsApi; sync?: SyncApi };
const when = (value?: string | null) => value ? posDisplayDateTime(new Date(value)) : "Never";
const label = (value?: string) => (value ?? "idle").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const isDatabaseConnectivityFailure = (failure: FailureRow) => /(?:E?CONN(?:ECT|REFUSED|RESET)|ETIMEOUT|ESOCKET|ELOGIN|ENOTOPEN|network|failed to fetch|sql server|database (?:connection|offline|unreachable)|could not (?:connect|reach)|unable to (?:connect|reach))/i.test(
  `${failure.error_code ?? ""} ${failure.error_message ?? ""}`,
);

export function LocalDatabaseOperations({ branchId }: { branchId?: string } = {}) {
  const [state, setState] = useState<DatabaseState>({});
  const [health, setHealth] = useState<Result>({});
  const [schema, setSchema] = useState<Result>({});
  const [job, setJob] = useState<DatabaseJob | null>(null);
  const [sync, setSync] = useState<SyncState & { lastProgressAt?: string; startedAt?: string }>({});
  const [syncReadFailed, setSyncReadFailed] = useState(false);
  const [databaseReadFailed, setDatabaseReadFailed] = useState(false);
  const syncReadSequence = useRef(0);
  const databaseReadSequence = useRef(0);
  const invalidateStatusReads = useCallback(() => { syncReadSequence.current++; databaseReadSequence.current++; }, []);
  const applyDatabase = useCallback((next: DatabaseState) => {
    databaseReadSequence.current++;
    if (isNativeDatabaseSnapshot(next)) { setState(next); setDatabaseReadFailed(false); }
    else setDatabaseReadFailed(true);
  }, []);
  const applySync = useCallback((next: SyncState) => {
    syncReadSequence.current++;
    setSync(next);
    setSyncReadFailed(false);
  }, []);
  const [failures, setFailures] = useState<Failures>({});
  const [file, setFile] = useState("");
  const [message, setMessage] = useState<{ text: string; pending: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failureDetailsOpen, setFailureDetailsOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);

  const refresh = useCallback(async () => {
    const api = shell();
    const syncRequest = ++syncReadSequence.current;
    const databaseRequest = ++databaseReadSequence.current;
    const requests = await Promise.allSettled([
      api.database?.getState(), api.database?.health(), api.database?.schemaStatus(),
      api.jobs?.getActive(), api.sync?.getStatus(), api.sync?.getFailures(),
    ]);
    if (databaseRequest === databaseReadSequence.current) {
      if (requests[0].status === "fulfilled" && isNativeDatabaseSnapshot(requests[0].value)) applyDatabase(requests[0].value as DatabaseState);
      else setDatabaseReadFailed(true);
    }
    if (requests[1].status === "fulfilled" && requests[1].value) setHealth(requests[1].value as Result);
    if (requests[2].status === "fulfilled" && requests[2].value) setSchema(requests[2].value as Result);
    if (requests[3].status === "fulfilled") setJob((requests[3].value as DatabaseJob | null | undefined) ?? null);
    if (syncRequest === syncReadSequence.current) {
      if (requests[4].status === "fulfilled" && requests[4].value) applySync(requests[4].value as SyncState);
      else setSyncReadFailed(true);
    }
    if (requests[5].status === "fulfilled" && requests[5].value) setFailures(requests[5].value as Failures);
  }, [applySync, applyDatabase]);

  useEffect(() => {
    void refresh();
    const api = shell();
    const unsubscribe = [api.database?.subscribe?.(applyDatabase), api.jobs?.subscribe?.(setJob), api.sync?.subscribe?.(applySync)].filter(Boolean) as Array<() => void>;
    return () => { invalidateStatusReads(); unsubscribe.forEach((stop) => stop()); };
  }, [refresh, applySync, applyDatabase, invalidateStatusReads]);

  const run = async (success: string, work: () => Promise<Result>) => {
    if (busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await work();
      if (result.ok === false) throw new Error(String(result.error ?? "The operation did not complete."));
      const differences = Array.isArray(result.differences) ? result.differences.length : 0;
      const historyPending = result.historyPending === true || result.historyHoldOnly === true;
      const synced = result as SyncState;
      const upload = synced.storeSettingsEditUpload;
      const download = synced.groupedSettingsPilot;
      const settingsPending = Boolean(branchId && ((upload && sameBranchId(branchId, upload.branchId) && upload.status !== "EMPTY") ||
        (download && sameBranchId(branchId, download.branchId) && !["CAUGHT_UP", "HANDED_BACK"].includes(download.status))));
      const pending = historyPending || settingsPending;
      const status = historyPending ? "Protected history is still pending." : settingsPending ? "Store settings synchronization is still pending." : success;
      setMessage({ text: differences ? `${status} ${differences} difference${differences === 1 ? " remains" : "s remain"}.` : status, pending });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  const jobFailureCount = failures.failures?.length ?? 0;
  const failureCount = jobFailureCount + (failures.databaseErrors?.length ?? 0) + (failures.businessBatches?.length ?? 0) + (failures.conflictRows?.length ?? 0);
  const activeErrorCount = Number(sync.failed ?? 0) + (sync.lastError ? 1 : 0) + (state.connected === false ? 1 : 0);
  const hasDatabaseConnectivityError = state.connected === false || (Boolean(sync.lastError) && isDatabaseConnectivityFailure({ error_message: sync.lastError }));
  const conflictCount = Number(failures.conflicts ?? failures.conflictRows?.length ?? sync.conflicts ?? 0);
  const tableDifferences = (sync.tables ?? []).filter((table) => table.status === "DIFFERENT");
  const activeTable = sync.running ? sync.currentTable : null;
  const groupedSettings = branchId && sameBranchId(sync.groupedSettingsPilot?.branchId, branchId)
    ? sync.groupedSettingsPilot : null;
  const settingsUpload = branchId && sameBranchId(sync.storeSettingsEditUpload?.branchId, branchId)
    ? sync.storeSettingsEditUpload : null;
  const syncSummary = nativeSyncSummary({ ...sync, storeSettingsEditUpload: settingsUpload }, state, syncReadFailed || databaseReadFailed);
  const queuedTables = (sync.queuedTables ?? []).filter((row) =>
    (row.pending > 0 || row.failed > 0) && row.table !== activeTable);
  const direction = sync.phase === "pulling" ? "Download" : sync.phase === "pushing" ? "Upload" : "Processing";
  if (state.state === "disabled" || state.enabled === false) return null;
  return (
    <div className="space-y-3">
      <DatabaseHealthCard state={state} health={health} schema={schema}>
        <section className="space-y-3 border-t border-border pt-4" aria-label="Database jobs and synchronization">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <h3 className="font-semibold text-foreground">Saving to central database</h3>
            <span role="status" className={syncSummary.state === "degraded" ? "text-destructive" : "text-muted-foreground"}>{syncSummary.label}</span>
            <span className="text-muted-foreground">{syncSummary.pending === null ? "Pending count not confirmed" : `${syncSummary.pending.toLocaleString()} journal changes pending`}</span>
          </div>
          <div className="overflow-x-auto rounded-md border"><Table tableId="platforms/windows/components/LocalDatabaseOperations.native#1" clientDataControls={false} className="w-full text-left text-xs"><thead className="bg-muted/40"><tr><th className="px-3 py-2">Table</th><th className="px-3 py-2">Activity</th><th className="px-3 py-2">Rows</th><th className="px-3 py-2">Updated</th></tr></thead><tbody>
            {activeTable ? <tr className="border-t"><td className="px-3 py-2 font-medium">{activeTable}</td><td className="px-3 py-2">{direction} now</td><td className="px-3 py-2">—</td><td className="px-3 py-2">{when(sync.lastProgressAt ?? sync.startedAt)}</td></tr> : null}
            {queuedTables.slice(0, 5).map((row) => <tr key={row.table} className="border-t"><td className="px-3 py-2">{row.table}</td><td className="px-3 py-2">{row.failed ? "Needs attention" : "Queued to upload"}</td><td className="px-3 py-2">{row.pending}</td><td className="px-3 py-2">—</td></tr>)}
          </tbody></Table>
            {!activeTable && !queuedTables.length ? <p className="px-3 py-2 text-xs text-muted-foreground">{syncReadFailed || databaseReadFailed ? "Table upload status could not be confirmed." : "No journaled table uploads are listed."}</p> : null}
            {queuedTables.length > 5 ? <p className="border-t px-3 py-2 text-xs text-muted-foreground">+{queuedTables.length - 5} more pending tables in More settings</p> : null}
          </div>
          {sync.lastError ? <p role="alert" className="text-xs text-destructive">{sync.lastError}</p> : null}
          {syncReadFailed ? <p role="alert" className="text-xs text-destructive">Synchronization status could not be read. Refresh to check again; no data was changed.</p> : null}
          {databaseReadFailed ? <p role="alert" className="text-xs text-destructive">Local database status could not be read. Refresh to check again; no data was changed.</p> : null}
          <details className="group rounded-md border border-border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium">More settings</summary>
            <div className="space-y-4 border-t border-border p-3">
          <DatabaseJobProgress job={job} />
          {groupedSettings ? <p role="status" className="text-xs text-muted-foreground">
            <span>Store settings download</span> · {groupedSettingsLabels[groupedSettings.status]}
            {groupedSettings.position ? ` · Saved position ${groupedSettings.position.seq}` : ""}
          </p> : null}
          {settingsUpload ? <p role="status" className="text-xs text-muted-foreground">
            <span>Store settings upload</span> · {uploadLabels[settingsUpload.status]}
          </p> : null}
          {sync.membershipDeferred ? <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">Membership directory synchronization is waiting for the membership service. Sales and other POS data continue syncing normally.</p> : null}
          <p className="text-xs text-muted-foreground">Last upload {when(sync.lastPushAt)} · Last download {when(sync.lastPullAt)} · {activeErrorCount} current errors · {conflictCount} conflicts</p>
          <div className="flex flex-wrap gap-2 [&>button]:h-8 [&>button]:px-3 [&>button]:text-xs">
            {failureCount || activeErrorCount ? <Button type="button" variant={activeErrorCount ? "destructive" : "outline"} onClick={() => setFailureDetailsOpen(true)}>{activeErrorCount ? `Errors (${activeErrorCount})` : "Past errors"}</Button> : null}
            {hasDatabaseConnectivityError ? <Button type="button" variant="outline" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_LOCAL_DATABASE_SETTINGS_EVENT))}>Open Database Settings</Button> : null}
            <Button disabled={busy || !state.connected || sync.running} onClick={() => run("Synchronization completed.", async () => { await mirrorTerminalConfigToDesktop(); return shell().sync!.runNow({ batchSize: 500 }); })}>Sync now</Button>
            <Button variant="outline" disabled={busy || !!sync.paused} onClick={() => run("Synchronization paused.", () => shell().sync!.pause())}>Pause</Button>
            <Button variant="outline" disabled={busy || !sync.paused} onClick={() => run("Synchronization resumed.", () => shell().sync!.resume())}>Resume</Button>
            <Button variant="outline" disabled={busy || !state.connected} onClick={() => run("Count comparison completed. Open Results to review.", async () => { await mirrorTerminalConfigToDesktop(); return shell().sync!.reconcile({}); })}>Compare counts</Button>
            <Button variant="outline" disabled={busy || !state.connected} onClick={() => run("Full data verification completed. Open Results to review.", async () => { await mirrorTerminalConfigToDesktop(); return shell().sync!.reconcile({ deep: true }); })}>Verify data</Button>
            <Button variant="outline" disabled={busy || !state.connected || !tableDifferences.length} onClick={() => run("Targeted repair completed.", async () => { await mirrorTerminalConfigToDesktop(); return shell().sync!.reconcile({ repair: true, tables: tableDifferences.map((table) => table.table) }); })}>Repair differences</Button>
            <Button variant="ghost" disabled={busy} onClick={() => void refresh()}>Refresh</Button>
            <LegacyShiftRecoveryReview />
            {state.connected && state.tradingReady ? <HeldBillRecoveryReview /> : null}
          </div>
          <details open={comparisonOpen} onToggle={(event) => setComparisonOpen(event.currentTarget.open)} className="rounded-md border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium">Results · last compared {when(sync.lastComparedAt)}</summary>
            <div className="max-h-72 overflow-auto">
              {(sync.tables ?? []).map((table) => (
                <div key={table.table} className="grid grid-cols-[minmax(10rem,1fr)_auto_auto_auto] gap-3 border-b px-3 py-2 text-xs last:border-b-0">
                  <span className="font-medium">{table.table}</span>
                  <span title="Local SQL Server rows">Local {table.local}</span>
                  <span title="Supabase rows">Cloud {table.cloud}</span>
                  <span className={table.status === "DIFFERENT" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}>{table.status}</span>
                </div>
              ))}
              {!sync.tables?.length ? <p className="p-3 text-xs text-muted-foreground">Use Compare counts or Verify data to check synchronized tables.</p> : null}
            </div>
          </details>
          {queuedTables.length > 5 ? <p className="text-xs text-muted-foreground">Pending: {queuedTables.slice(5).map((row) => `${row.table} (${row.pending})`).join(" · ")}</p> : null}
      <Dialog open={failureDetailsOpen} onOpenChange={setFailureDetailsOpen}>
        <DialogContent className="max-h-[75vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>Database errors</DialogTitle><DialogDescription>Connection, validation, migration, synchronization, and conflict details recorded by this PC. Credentials are never included.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            {hasDatabaseConnectivityError ? <Button type="button" variant="outline" onClick={() => { setFailureDetailsOpen(false); window.dispatchEvent(new CustomEvent(OPEN_LOCAL_DATABASE_SETTINGS_EVENT)); }}>Open Database Settings</Button> : null}
            {(failures.databaseErrors ?? []).map((failure, index) => <div key={failure.id ?? index} className="rounded-md border p-3 text-sm"><div className="font-medium">{label(failure.category ?? "Database")} · {label(failure.stage ?? failure.event)}</div><div className="mt-1 text-destructive">{failure.message || "No error message was recorded."}</div><div className="mt-1 text-xs text-muted-foreground">{[failure.code, Number(failure.occurrences ?? 1) > 1 ? `Repeated ${failure.occurrences} times` : null, failure.state ? label(failure.state) : null, failure.occurred_at ? when(failure.occurred_at) : null].filter(Boolean).join(" · ")}</div></div>)}
            {(failures.failures ?? []).map((failure, index) => <div key={failure.job_id ?? index} className="rounded-md border p-3 text-sm"><div className="font-medium">{label(failure.job_type ?? "Database job")} · {label(failure.status)}</div><div className="mt-1 text-destructive">{failure.error_message || "No error message was recorded."}</div><div className="mt-1 text-xs text-muted-foreground">{[failure.error_code, failure.current_table, failure.updated_at ? when(failure.updated_at) : null].filter(Boolean).join(" · ")}</div></div>)}
            {(failures.businessBatches ?? []).map((failure, index) => <div key={failure.aggregate_id ?? index} className="rounded-md border p-3 text-sm"><div className="font-medium">Synchronization batch · {failure.entity_type ?? "transaction"}</div><div className="mt-1 text-destructive">{failure.error || "The local transaction has not synchronized."}</div><div className="mt-1 text-xs text-muted-foreground">{[`Attempts ${Number(failure.attempts ?? 0)}`, failure.rows ? `${failure.rows} row(s)` : null, failure.last_attempt_at ? when(failure.last_attempt_at) : null].filter(Boolean).join(" · ")}</div></div>)}
            {(failures.conflictRows ?? []).map((conflict, index) => <div key={conflict.conflict_id ?? index} className="rounded-md border p-3 text-sm"><div className="font-medium">Conflict · {conflict.entity_type ?? "record"}</div><div className="mt-1">{conflict.reason ?? "Local and cloud changes require review."}</div><div className="mt-1 break-all text-xs text-muted-foreground">{conflict.entity_id}</div></div>)}
            {!failureCount ? <p className="text-sm text-muted-foreground">No stored database errors are available. Refresh after the next operation.</p> : null}
          </div>
        </DialogContent>
      </Dialog>
            </div>
          </details>
        </section>
      </DatabaseHealthCard>
      {message ? <p className={message.pending ? "rounded-md bg-muted p-3 text-xs text-muted-foreground" : "rounded-md bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-400"} role="status">{message.text}</p> : null}
      {error ? <p className="rounded-md bg-destructive/10 p-3 text-xs text-destructive" role="alert">{error}</p> : null}
      <Card>
        <CardHeader><CardTitle className="text-base">Backup and recovery</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input aria-label="SQL Server backup file" placeholder="C:\\Backups\\POS_LOCAL.bak" value={file} onChange={(event) => setFile(event.target.value)} />
          <p className="text-xs text-muted-foreground">Enter a path that the SQL Server service account can read and write.</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !file.trim() || !state.connected} onClick={() => run("Backup created.", () => shell().database!.backup(file.trim()))}>Create backup</Button>
            <Button variant="destructive" disabled={busy || !file.trim()} onClick={() => run("Backup restored and database revalidated.", () => shell().database!.restore(file.trim()))}>Restore backup</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
