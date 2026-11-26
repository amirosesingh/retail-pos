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
import type { RecoveryEvidenceKind, SavedRecoveryEvidence, StoreSettingsEditUpload } from "@/core/local-db/local-db";

type DatabaseState = { state?: string; enabled?: boolean; connected?: boolean; tradingReady?: boolean; localRecoveryPending?: boolean; profile?: { database?: string; id?: string; host?: string; instanceName?: string; port?: number } | null };
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
  getRecoveryEvidence?(input: { batchId: string; kind: RecoveryEvidenceKind }): Promise<SavedRecoveryEvidence | { ok: false; error: string }>;
  pause(): Promise<Result>; resume(): Promise<Result>; reconcile(options: Result): Promise<Result>;
  subscribe(cb: (state: SyncState) => void): () => void;
};
const shell = () => window.pos as unknown as { database?: DatabaseApi; jobs?: JobsApi; sync?: SyncApi };
const when = (value?: string | null) => value ? posDisplayDateTime(new Date(value)) : "Never";
const label = (value?: string) => (value ?? "idle").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const isDatabaseConnectivityFailure = (failure: FailureRow) => /(?:E?CONN(?:ECT|REFUSED|RESET)|ETIMEOUT|ESOCKET|ELOGIN|ENOTOPEN|network|failed to fetch|sql server|database (?:connection|offline|unreachable)|could not (?:connect|reach)|unable to (?:connect|reach))/i.test(
  `${failure.error_code ?? ""} ${failure.error_message ?? ""}`,
);
const financialReview = {
  FIN62_OPEN_BIRTH_NOT_EMPTY: {
    title: "Saved shift opening needs review",
    message: "The central database found a sale linked to the shift when verifying its opening.",
  },
  FIN62_SALE_BIRTH_ALREADY_EXISTS: {
    title: "Saved sale needs review",
    message: "The central database already has a sale with this ID.",
  },
};

function financialReviewReason(message?: string | null): keyof typeof financialReview | null {
  const match = /^(FIN62_OPEN_BIRTH_NOT_EMPTY|FIN62_SALE_BIRTH_ALREADY_EXISTS)(?: \(table: (?:transaction batch|shifts|sales)\))?$/.exec(message?.trim() ?? "");
  return (match?.[1] as keyof typeof financialReview | undefined) ?? null;
}

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const evidenceLabels = {
  shift: { label: "Shift opening", reason: "The central database already has a sale linked to this shift." },
  sale: { label: "Sale", reason: "The central database already has a sale with this ID." },
  stock: { label: "Stock movement", reason: "The original author proof or matching stock receipt has not been confirmed." },
};
const receiptLabels = {
  opening: "Shift-opening acceptance receipt saved",
  "financial-metadata": "Financial history receipt saved. Complete sale acceptance remains unconfirmed.",
  stock: "Stock movement acceptance saved",
};
const proofLabels = { saved: "Saved on this till", missing: "Missing on this till", partial: "Missing for some rows" };
type VerificationCase = { batchId: string; kind: RecoveryEvidenceKind };
type EvidenceCheck = { scope: string; entry: VerificationCase; state: "checking" }
  | { scope: string; entry: VerificationCase; state: "unavailable" }
  | { scope: string; entry: VerificationCase; state: "checked"; data: SavedRecoveryEvidence };

function verificationCase(row: BusinessBatchRow): VerificationCase | null {
  if (!row.aggregate_id || !uuid.test(row.aggregate_id)) return null;
  const batchId = row.aggregate_id.toLowerCase();
  const financial = financialReviewReason(row.error);
  if (financial === "FIN62_OPEN_BIRTH_NOT_EMPTY" && row.entity_type === "shifts") return { batchId, kind: "shift" };
  if (financial === "FIN62_SALE_BIRTH_ALREADY_EXISTS") return { batchId, kind: "sale" };
  if (row.entity_type === "stock_history_movements" &&
      /^(?:Stock history needs source\/author review \()?E?STOCK_HISTORY_AUTHOR_REQUIRED(?:\)\. Existing business data and pending evidence are retained\.)?$/.test(row.error?.trim() ?? ""))
    return { batchId, kind: "stock" };
  return null;
}

function validEvidence(result: SavedRecoveryEvidence | { ok: false }, entry: VerificationCase, branchId: string): result is SavedRecoveryEvidence {
  if (result?.ok !== true || result.kind !== entry.kind || result.batchId !== entry.batchId || !sameBranchId(result.branchId, branchId) ||
      !uuid.test(result.reference) || typeof result.savedAt !== "string" || !Number.isFinite(Date.parse(result.savedAt)) ||
      !Number.isInteger(result.savedRows) || result.savedRows < 1 || result.savedRows > 100 ||
      !Number.isInteger(result.queuedRows) || result.queuedRows < 0 || result.queuedRows > result.savedRows ||
      !Object.hasOwn(proofLabels, result.originalProof)) return false;
  const expected = entry.kind === "sale" ? "financial-metadata" : entry.kind === "shift" ? "opening" : "stock";
  return result.receipt === null || (result.receipt === expected && (expected !== "stock" || result.queuedRows === 0));
}

function DatabaseErrorDetail({ failure }: { failure: DatabaseErrorRow }) {
  return <div className="rounded-md border p-3 text-sm">
    <div className="font-medium">{label(failure.category ?? "Database")} · {label(failure.stage ?? failure.event)}</div>
    <div className="mt-1 text-destructive">{failure.message || "No error message was recorded."}</div>
    <div className="mt-1 text-xs text-muted-foreground">{[
      failure.code, Number(failure.occurrences ?? 1) > 1 ? `Repeated ${failure.occurrences} times` : null,
      failure.state ? label(failure.state) : null, failure.occurred_at ? when(failure.occurred_at) : null,
    ].filter(Boolean).join(" · ")}</div>
  </div>;
}

export function LocalDatabaseOperations({ branchId, reviewOperator }: { branchId?: string; reviewOperator?: string } = {}) {
  const [state, setState] = useState<DatabaseState>({});
  const [health, setHealth] = useState<Result>({});
  const [schema, setSchema] = useState<Result>({});
  const [job, setJob] = useState<DatabaseJob | null>(null);
  const [sync, setSync] = useState<SyncState & { lastProgressAt?: string; startedAt?: string }>({});
  const [syncReadFailed, setSyncReadFailed] = useState(false);
  const [databaseReadFailed, setDatabaseReadFailed] = useState(false);
  const syncReadSequence = useRef(0);
  const databaseReadSequence = useRef(0);
  const failureReadSequence = useRef(0);
  const reviewReadSequence = useRef(0);
  const invalidateStatusReads = useCallback(() => {
    syncReadSequence.current++; databaseReadSequence.current++; failureReadSequence.current++; reviewReadSequence.current++;
  }, []);
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
  const [evidenceCheck, setEvidenceCheck] = useState<EvidenceCheck | null>(null);
  const scope = JSON.stringify([branchId, reviewOperator, state.profile?.id, state.profile?.host,
    state.profile?.instanceName, state.profile?.port, state.profile?.database, state.connected]);
  const currentCheck = evidenceCheck?.scope === scope ? evidenceCheck : null;
  useEffect(() => { reviewReadSequence.current++; setEvidenceCheck(null); }, [scope]);

  const refreshFailures = useCallback(async () => {
    const request = ++failureReadSequence.current;
    const read = shell().sync?.getFailures;
    if (!read) return;
    try {
      const current = await read();
      if (request === failureReadSequence.current) setFailures(current ?? {});
    } catch {
      if (request === failureReadSequence.current) setFailures({});
    }
  }, []);

  const refresh = useCallback(async () => {
    const api = shell();
    const syncRequest = ++syncReadSequence.current;
    const databaseRequest = ++databaseReadSequence.current;
    const requests = await Promise.allSettled([
      api.database?.getState(), api.database?.health(), api.database?.schemaStatus(),
      api.jobs?.getActive(), api.sync?.getStatus(), refreshFailures(),
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
  }, [applySync, applyDatabase, refreshFailures]);

  useEffect(() => {
    void refresh();
    const api = shell();
    let wasRunning = false;
    const updateSync = (next: SyncState) => {
      applySync(next);
      if (wasRunning && next.running === false) void refreshFailures();
      wasRunning = next.running === true;
    };
    const unsubscribe = [api.database?.subscribe?.(applyDatabase), api.jobs?.subscribe?.(setJob), api.sync?.subscribe?.(updateSync)].filter(Boolean) as Array<() => void>;
    return () => { invalidateStatusReads(); unsubscribe.forEach((stop) => stop()); };
  }, [refresh, applySync, applyDatabase, invalidateStatusReads, refreshFailures]);

  const verifySavedRecord = async (entry: VerificationCase) => {
    const read = shell().sync?.getRecoveryEvidence;
    if (!read || !state.connected || !branchId || !reviewOperator) return;
    const request = ++reviewReadSequence.current;
    setEvidenceCheck({ scope, entry, state: "checking" });
    try {
      const result = await read(entry);
      if (request !== reviewReadSequence.current) return;
      setEvidenceCheck(validEvidence(result, entry, branchId)
        ? { scope, entry, state: "checked", data: result }
        : { scope, entry, state: "unavailable" });
    } catch {
      if (request === reviewReadSequence.current) setEvidenceCheck({ scope, entry, state: "unavailable" });
    }
  };

  const run = async (success: string, work: () => Promise<Result>) => {
    if (busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await work();
      if (result.ok === false) throw new Error(String(result.error ?? "The operation did not complete."));
      const differences = Array.isArray(result.differences) ? result.differences.length : 0;
      const historyPending = result.historyPending === true || result.historyHoldOnly === true;
      const stockHistoryPending = typeof result.heldStockHistoryAggregates === "number" &&
        Number.isSafeInteger(result.heldStockHistoryAggregates) && result.heldStockHistoryAggregates > 0;
      const synced = result as SyncState;
      const upload = synced.storeSettingsEditUpload;
      const download = synced.groupedSettingsPilot;
      const settingsPending = Boolean(branchId && ((upload && sameBranchId(branchId, upload.branchId) && upload.status !== "EMPTY") ||
        (download && sameBranchId(branchId, download.branchId) && !["CAUGHT_UP", "HANDED_BACK"].includes(download.status))));
      const pending = historyPending || stockHistoryPending || settingsPending;
      const status = historyPending ? "Protected history is still pending."
        : stockHistoryPending ? "Stock history still needs verification."
        : settingsPending ? "Store settings synchronization is still pending." : success;
      setMessage({ text: differences ? `${status} ${differences} difference${differences === 1 ? " remains" : "s remain"}.` : status, pending });
      await refresh();
    } catch (cause) {
      const failure = cause instanceof Error ? cause.message : String(cause);
      const reason = financialReviewReason(failure);
      setError(reason ? `${financialReview[reason].title}. ${financialReview[reason].message}` : failure);
      if (reason) await refresh();
    } finally { setBusy(false); }
  };

  const jobFailureCount = failures.failures?.length ?? 0;
  const failureCount = jobFailureCount + (failures.databaseErrors?.length ?? 0) + (failures.businessBatches?.length ?? 0) + (failures.conflictRows?.length ?? 0);
  const activeErrorCount = Number(sync.failed ?? 0) + (sync.lastError ? 1 : 0) + (state.connected === false ? 1 : 0);
  const hasDatabaseConnectivityError = state.connected === false || (Boolean(sync.lastError) && isDatabaseConnectivityFailure({ error_message: sync.lastError }));
  const review = financialReviewReason(sync.lastError);
  const canReviewEvidence = Boolean(branchId && reviewOperator && shell().sync?.getRecoveryEvidence);
  const cases = canReviewEvidence ? (failures.businessBatches ?? []).flatMap(row => {
    const entry = verificationCase(row);
    return entry ? [{ ...entry, savedAt: row.created_at }] : [];
  }) : [];
  const databaseErrors = failures.databaseErrors ?? [];
  const conflictCount = Number(failures.conflicts ?? failures.conflictRows?.length ?? sync.conflicts ?? 0);
  const tableDifferences = (sync.tables ?? []).filter((table) => table.status === "DIFFERENT");
  const activeTable = sync.running ? sync.currentTable : null;
  const groupedSettings = branchId && sameBranchId(sync.groupedSettingsPilot?.branchId, branchId)
    ? sync.groupedSettingsPilot : null;
  const settingsUpload = branchId && sameBranchId(sync.storeSettingsEditUpload?.branchId, branchId)
    ? sync.storeSettingsEditUpload : null;
  const syncSummary = nativeSyncSummary({ ...sync, groupedSettingsPilot: groupedSettings,
    storeSettingsEditUpload: settingsUpload }, state, syncReadFailed || databaseReadFailed);
  const queuedTables = (sync.queuedTables ?? []).filter((row) =>
    (row.pending > 0 || row.failed > 0) && row.table !== activeTable);
  const direction = sync.phase === "pulling" ? "Download" : sync.phase === "pushing" ? "Upload" : "Processing";
  if (state.localRecoveryPending) return <Card><CardHeader><CardTitle className="text-base">Previous local work needs recovery</CardTitle></CardHeader><CardContent><p role="status" className="text-sm text-muted-foreground">This terminal is using the saved online database. Previous local records and setup are preserved for recovery. Local SQL is held apart from the current registration; those records have not been marked synchronized.</p></CardContent></Card>;
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
          {canReviewEvidence && (cases.length || currentCheck) ? <section className="space-y-2 rounded-md border p-3 text-sm" aria-label="Needs verification">
            <h4 className="font-semibold">Needs verification</h4>
            {cases.map(entry => <div key={entry.batchId} className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{evidenceLabels[entry.kind].label}</p>
                <p className="text-xs text-muted-foreground">{evidenceLabels[entry.kind].reason} {entry.savedAt ? `Saved ${when(entry.savedAt)}.` : ""}</p>
              </div>
              <Button type="button" size="sm" variant="outline" disabled={!state.connected || currentCheck?.state === "checking"}
                onClick={() => verifySavedRecord({ batchId: entry.batchId, kind: entry.kind })}>Verify saved record</Button>
            </div>)}
            {currentCheck ? <div className="space-y-2 border-t pt-2">
              {currentCheck.state === "checking" ? <p role="status" className="text-xs">Checking saved evidence…</p> : currentCheck.state === "unavailable"
                ? <p role="status" className="text-xs">Evidence could not be confirmed for this saved batch.</p>
                : <>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt>{evidenceLabels[currentCheck.entry.kind].label} reference</dt><dd className="break-all font-mono">{currentCheck.data.reference}</dd>
                    <dt>Saved in local SQL Server</dt><dd>{when(currentCheck.data.savedAt)}</dd>
                    <dt>Journal rows still queued</dt><dd>{currentCheck.data.queuedRows} of {currentCheck.data.savedRows}</dd>
                    <dt>Original proof</dt><dd>{proofLabels[currentCheck.data.originalProof]}</dd>
                    <dt>Central acceptance evidence</dt>
                    <dd>{currentCheck.data.receipt ? receiptLabels[currentCheck.data.receipt] : "No matching acceptance receipt saved on this till"}</dd>
                  </dl>
                  <p className="text-xs text-muted-foreground">This check reads the evidence saved on this till. Use Sync now in More settings to retry with the central database.</p>
                </>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" disabled={!state.connected || currentCheck.state === "checking"}
                  onClick={() => verifySavedRecord(currentCheck.entry)}>Check again</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => { reviewReadSequence.current++; setEvidenceCheck(null); }}>Close evidence</Button>
              </div>
            </div> : null}
          </section> : null}
          {sync.lastError && !(review && cases.some(entry => entry.kind === (review === "FIN62_OPEN_BIRTH_NOT_EMPTY" ? "shift" : "sale"))) ? <p role="alert" className="text-xs text-destructive">{review
            ? `${financialReview[review].title}. ${financialReview[review].message}` : sync.lastError}</p> : null}
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
          {sync.membershipDeferred ? <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">Membership directory synchronization is waiting for the membership service. Check the separate POS upload and download status for other data.</p> : null}
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
                  <span className={table.status === "DIFFERENT" ? "text-destructive" : table.status === "VERIFIED" && table.verified ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>
                    {table.status === "DIFFERENT" ? "Differences found" : table.status === "VERIFIED" && table.verified ? "Data verified" : "Counts match · data not verified"}
                  </span>
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
            {(Object.keys(financialReview) as (keyof typeof financialReview)[]).map(reason => {
              const stages = databaseErrors.filter(failure => financialReviewReason(failure.message) === reason);
              if (!stages.length) return null;
              return <details key={reason} className="rounded-md border p-3 text-sm">
                <summary className="cursor-pointer font-medium">{financialReview[reason].title}</summary>
                <p className="mt-1 text-muted-foreground">{financialReview[reason].message}</p>
                <div className="mt-2 space-y-2">{stages.map((failure, index) =>
                  <DatabaseErrorDetail key={failure.id ?? index} failure={failure} />)}</div>
              </details>;
            })}
            {databaseErrors.map((failure, index) => financialReviewReason(failure.message) ? null :
              <DatabaseErrorDetail key={failure.id ?? index} failure={failure} />)}
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
