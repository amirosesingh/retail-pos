import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DatabaseHealthCard } from "./DatabaseHealthCard";
import { DatabaseJobProgress, type DatabaseJob } from "./DatabaseJobProgress";
import { mirrorTerminalConfigToDesktop } from "@/core/activation/terminal-tokens";
import { OPEN_LOCAL_DATABASE_SETTINGS_EVENT } from "./LocalDatabaseWizard";

type DatabaseState = { state?: string; enabled?: boolean; connected?: boolean; profile?: { database?: string } | null };
type TableStatus = { table: string; local: string; cloud: string; status: "SYNCED" | "VERIFIED" | "DIFFERENT"; verified?: boolean; comparedAt?: string | null };
type SyncState = { phase?: string; running?: boolean; paused?: boolean; pending?: number; failed?: number; conflicts?: number; lastPushAt?: string | null; lastPullAt?: string | null; lastComparedAt?: string | null; lastVerifiedAt?: string | null; tables?: TableStatus[] };
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
const when = (value?: string | null) => value ? new Date(value).toLocaleString() : "Never";
const label = (value?: string) => (value ?? "idle").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const isDatabaseConnectivityFailure = (failure: FailureRow) => /(?:E?CONN(?:ECT|REFUSED|RESET)|ETIMEOUT|ESOCKET|ELOGIN|ENOTOPEN|network|failed to fetch|sql server|database (?:connection|offline|unreachable)|could not (?:connect|reach)|unable to (?:connect|reach))/i.test(
  `${failure.error_code ?? ""} ${failure.error_message ?? ""}`,
);

export function LocalDatabaseOperations() {
  const [state, setState] = useState<DatabaseState>({});
  const [health, setHealth] = useState<Result>({});
  const [schema, setSchema] = useState<Result>({});
  const [job, setJob] = useState<DatabaseJob | null>(null);
  const [sync, setSync] = useState<SyncState>({});
  const [failures, setFailures] = useState<Failures>({});
  const [file, setFile] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failureDetailsOpen, setFailureDetailsOpen] = useState(false);

  const refresh = useCallback(async () => {
    const api = shell();
    const requests = await Promise.allSettled([
      api.database?.getState(), api.database?.health(), api.database?.schemaStatus(),
      api.jobs?.getActive(), api.sync?.getStatus(), api.sync?.getFailures(),
    ]);
    if (requests[0].status === "fulfilled" && requests[0].value) setState(requests[0].value as DatabaseState);
    if (requests[1].status === "fulfilled" && requests[1].value) setHealth(requests[1].value as Result);
    if (requests[2].status === "fulfilled" && requests[2].value) setSchema(requests[2].value as Result);
    if (requests[3].status === "fulfilled") setJob((requests[3].value as DatabaseJob | null | undefined) ?? null);
    if (requests[4].status === "fulfilled" && requests[4].value) setSync(requests[4].value as SyncState);
    if (requests[5].status === "fulfilled" && requests[5].value) setFailures(requests[5].value as Failures);
  }, []);

  useEffect(() => {
    void refresh();
    const api = shell();
    const unsubscribe = [api.database?.subscribe?.(setState), api.jobs?.subscribe?.(setJob), api.sync?.subscribe?.(setSync)].filter(Boolean) as Array<() => void>;
    return () => unsubscribe.forEach((stop) => stop());
  }, [refresh]);

  const run = async (success: string, work: () => Promise<Result>) => {
    if (busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await work();
      if (result.ok === false) throw new Error(String(result.error ?? "The operation did not complete."));
      const differences = Array.isArray(result.differences) ? result.differences.length : 0;
      setMessage(differences ? `${success} ${differences} difference${differences === 1 ? " remains" : "s remain"}.` : success);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  const jobFailureCount = failures.failures?.length ?? 0;
  const failureCount = jobFailureCount + (failures.databaseErrors?.length ?? 0) + (failures.businessBatches?.length ?? 0) + (failures.conflictRows?.length ?? 0);
  const hasDatabaseConnectivityError = state.connected === false || (failures.failures ?? []).some(isDatabaseConnectivityFailure) || (failures.databaseErrors ?? []).some((failure) => isDatabaseConnectivityFailure({ error_code:failure.code, error_message:failure.message }));
  const conflictCount = Number(failures.conflicts ?? failures.conflictRows?.length ?? sync.conflicts ?? 0);
  const tableDifferences = (sync.tables ?? []).filter((table) => table.status === "DIFFERENT");
  if (state.state === "disabled" || state.enabled === false) return null;
  return (
    <div className="space-y-3">
      <DatabaseHealthCard state={state} health={health} schema={schema} />
      <Card>
        <CardHeader><CardTitle className="text-base">Database jobs and synchronization</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <DatabaseJobProgress job={job} />
          <div className="grid gap-3 rounded-md border p-3 text-sm sm:grid-cols-2 xl:grid-cols-5">
            <div><div className="text-xs text-muted-foreground">Phase</div><div>{sync.paused ? "Paused" : label(sync.phase)}</div></div>
            <div><div className="text-xs text-muted-foreground">Waiting</div><div>{Number(sync.pending ?? 0).toLocaleString()}</div></div>
            <div><div className="text-xs text-muted-foreground">Errors</div><div>{failureCount || Number(sync.failed ?? 0)}</div></div>
            <div><div className="text-xs text-muted-foreground">Conflicts</div><div>{conflictCount}</div></div>
            <div><div className="text-xs text-muted-foreground">Last completed</div><div>{when([sync.lastPushAt, sync.lastPullAt].filter(Boolean).sort().at(-1))}</div></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {failureCount || Number(sync.failed ?? 0) ? <Button type="button" variant="destructive" onClick={() => setFailureDetailsOpen(true)}>Errors ({failureCount || Number(sync.failed ?? 0)})</Button> : null}
            {hasDatabaseConnectivityError ? <Button type="button" variant="outline" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_LOCAL_DATABASE_SETTINGS_EVENT))}>Open Database Settings</Button> : null}
            <Button disabled={busy || !state.connected || sync.running} onClick={() => run("Synchronization completed.", async () => { await mirrorTerminalConfigToDesktop(); return shell().sync!.runNow({ batchSize: 500 }); })}>Sync now</Button>
            <Button variant="outline" disabled={busy || !!sync.paused} onClick={() => run("Synchronization paused.", () => shell().sync!.pause())}>Pause</Button>
            <Button variant="outline" disabled={busy || !sync.paused} onClick={() => run("Synchronization resumed.", () => shell().sync!.resume())}>Resume</Button>
            <Button variant="outline" disabled={busy || !state.connected} onClick={() => run("Reconciliation completed.", async () => { await mirrorTerminalConfigToDesktop(); return shell().sync!.reconcile({}); })}>Reconcile</Button>
            <Button variant="outline" disabled={busy || !state.connected} onClick={() => run("Full data verification completed.", async () => { await mirrorTerminalConfigToDesktop(); return shell().sync!.reconcile({ deep: true }); })}>Verify data</Button>
            <Button variant="outline" disabled={busy || !state.connected || !tableDifferences.length} onClick={() => run("Targeted repair completed.", async () => { await mirrorTerminalConfigToDesktop(); return shell().sync!.reconcile({ repair: true, tables: tableDifferences.map((table) => table.table) }); })}>Repair differences</Button>
            <Button variant="ghost" disabled={busy} onClick={() => void refresh()}>Refresh</Button>
          </div>
          <div className="rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
              <span className="font-medium">Table synchronization status</span>
              <span className="text-xs text-muted-foreground">Last compared: {when(sync.lastComparedAt)}</span>
            </div>
            <div className="max-h-72 overflow-auto">
              {(sync.tables ?? []).map((table) => (
                <div key={table.table} className="grid grid-cols-[minmax(10rem,1fr)_auto_auto_auto] gap-3 border-b px-3 py-2 text-xs last:border-b-0">
                  <span className="font-medium">{table.table}</span>
                  <span title="Local SQL Server rows">Local {table.local}</span>
                  <span title="Supabase rows">Cloud {table.cloud}</span>
                  <span className={table.status === "DIFFERENT" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}>{table.status}</span>
                </div>
              ))}
              {!sync.tables?.length ? <p className="p-3 text-xs text-muted-foreground">Run Reconcile to compare every synchronized table for this branch. A matching count is SYNCED; only a full signature check may be called VERIFIED.</p> : null}
            </div>
          </div>
        </CardContent>
      </Card>
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
      <Card>
        <CardHeader><CardTitle className="text-base">Backup and recovery</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input aria-label="SQL Server backup file" placeholder="C:\\Backups\\POS_LOCAL.bak" value={file} onChange={(event) => setFile(event.target.value)} />
          <p className="text-xs text-muted-foreground">Enter a path that the SQL Server service account can read and write.</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !file.trim() || !state.connected} onClick={() => run("Backup created.", () => shell().database!.backup(file.trim()))}>Create backup</Button>
            <Button variant="destructive" disabled={busy || !file.trim()} onClick={() => run("Backup restored and database revalidated.", () => shell().database!.restore(file.trim()))}>Restore backup</Button>
          </div>
          {message ? <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400" role="status">{message}</p> : null}
          {error ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
