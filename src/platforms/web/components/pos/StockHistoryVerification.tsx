import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { effectiveDatabaseMode, preferredDatabaseMode, subscribeDatabaseMode } from "@/core/local-db/db-mode";
import { canonicalBranchId, sameBranchId } from "@/lib/branch-id";
import { isManagementDevice } from "@/lib/management-device";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";
import { sessionEpoch } from "@/lib/session-epoch";
import { canonicalStockInstant } from "@/lib/stock-as-of";
import { loadStockHistoryPage, readStockRolloutReadiness, recordStockRolloutOpening } from "@/lib/stock-history-client";
import { stockHistoryExplanation, type StockHistoryPage, type StockHistoryRequest, type StockRolloutOpening, type StockRolloutReadiness } from "@/lib/stock-history-report";
import { stockDateTimeInput, stockEndOfDay } from "@/lib/stock-history-selection";
import { posTimeZone } from "@/lib/time-zone";
import { currentPlatform, isWindowsShell } from "@/platform-config/features";
import { RELEASE_CHANNEL } from "@/lib/release-channel";

type Inspection = { request: StockHistoryRequest; running: boolean; report?: StockHistoryPage; error?: string };

function desktopHistoryAvailable() {
  return !isWindowsShell() || (effectiveDatabaseMode() === "local" && !isManagementDevice());
}

function CoverageReadout({ report }: { report: StockHistoryPage }) {
  const level = report.status === "complete" ? "Verified" : report.status === "incomplete" &&
    (report.baselineAt || report.coverage || report.recordedThrough) ? "Partially Verified" : "Unavailable";
  const dateTime = new Intl.DateTimeFormat(undefined, { timeZone: report.timeZone, dateStyle: "medium", timeStyle: "long" });
  const time = (instant: string) => <time dateTime={instant} title={instant}>{dateTime.format(new Date(instant))}</time>;
  const coverage = report.coverage;
  return <div className="space-y-3 rounded-xl border border-border bg-muted/25 p-4" aria-live="polite">
    <div className="flex flex-wrap items-center gap-2"><strong className="text-sm">Coverage at selected cutoff</strong><Badge variant="outline">{level}</Badge></div>
    <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
      <div><dt className="text-xs text-muted-foreground">Selected cutoff</dt><dd>{time(report.cutoff)}</dd></div>
      {report.baselineAt && <div><dt className="text-xs text-muted-foreground">Opening balance recorded at</dt><dd>{time(report.baselineAt)}</dd></div>}
      {report.readAt && <div><dt className="text-xs text-muted-foreground">Last verification read</dt><dd>{time(report.readAt)}</dd></div>}
      {report.recordedThrough && <div><dt className="text-xs text-muted-foreground">Accepted records available through</dt><dd>{time(report.recordedThrough)}</dd></div>}
      {report.pendingCount && <div><dt className="text-xs text-muted-foreground">Pending stock events reported by the reader</dt><dd>{report.pendingCount}</dd></div>}
      {coverage && <>
        <div><dt className="text-xs text-muted-foreground">Accepted movement records</dt><dd>{coverage.acceptedLedger === "complete" ? "Complete" : "Incomplete"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Location writer coverage</dt><dd>{coverage.writers === "confirmed" ? "Confirmed" : coverage.writers === "pending" ? "Pending uploads" : "Unknown"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Movement timestamps</dt><dd>{coverage.timeGrade === "recorded" ? "Ledger recording time" : coverage.timeGrade === "author_entered" ? "Original transaction time" : "Mixed sources"}</dd></div>
      </>}
    </dl>
    {report.reasons.length > 0 && <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
      {report.reasons.map(reason => <li key={reason}>{reason === "NO_VERIFIED_OPENING" ? "A verified opening balance is unavailable for this location." : stockHistoryExplanation(reason)}</li>)}
    </ul>}
    {report.sourceRevision && <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">Source revision</summary><p className="mt-1 break-all font-mono">{report.sourceRevision}</p>
    </details>}
  </div>;
}

function VerificationForm({ branchId, branchName, timeZone, mayCheckReadiness }: {
  branchId: string; branchName: string; timeZone: string; mayCheckReadiness: boolean;
}) {
  const mayRecordOpening = mayCheckReadiness && RELEASE_CHANNEL === "beta";
  const inputId = useId();
  const today = stockDateTimeInput(new Date(), timeZone).slice(0, 10);
  const [date, setDate] = useState(today);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [dateError, setDateError] = useState("");
  const [recording, setRecording] = useState(false);
  const [opening, setOpening] = useState<StockRolloutOpening | null>(null);
  const [openingError, setOpeningError] = useState("");
  const [rolloutReadiness, setRolloutReadiness] = useState<StockRolloutReadiness | null>(null);
  const [rolloutReadinessError, setRolloutReadinessError] = useState("");
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current++; }, []);
  const recordSequence = useRef(0);
  useEffect(() => () => { recordSequence.current++; }, []);

  async function recordOpening() {
    if (!mayRecordOpening || recording) return;
    const attempt = ++recordSequence.current, epoch = sessionEpoch();
    const current = () => recordSequence.current === attempt && sessionEpoch() === epoch;
    setRecording(true); setOpening(null); setOpeningError("");
    try {
      const result = await recordStockRolloutOpening(branchId);
      if (current()) setOpening(result);
    } catch (failure) {
      if (current()) setOpeningError(failure instanceof Error ? failure.message : "The rollout opening could not be recorded.");
    } finally {
      if (current()) setRecording(false);
    }
  }

  async function read(request: StockHistoryRequest) {
    if (!desktopHistoryAvailable()) return;
    const attempt = ++sequence.current, epoch = sessionEpoch();
    const stillCurrent = () => sequence.current === attempt && sessionEpoch() === epoch && desktopHistoryAvailable();
    setInspection({ request, running: true });
    setRolloutReadiness(null);
    setRolloutReadinessError("");
    if (mayCheckReadiness) void readStockRolloutReadiness(branchId).then(result => {
      if (stillCurrent()) setRolloutReadiness(result);
    }, failure => {
      if (stillCurrent()) setRolloutReadinessError(failure instanceof Error ? failure.message : "The rollout writer evidence could not be checked.");
    });
    try {
      const report = await loadStockHistoryPage(request);
      if (!stillCurrent()) return;
      if (!sameBranchId(report.branchId, branchId) || report.timeZone !== timeZone || report.cutoff !== request.cutoff)
        throw new Error("The history view returned a different location or cutoff.");
      setInspection({ request, running: false, report });
    } catch {
      if (stillCurrent()) setInspection({ request, running: false, error: "Stock history could not be read for this location and cutoff. Retry verification." });
    }
  }

  function verify() {
    setDateError("");
    const now = new Date(), currentDay = stockDateTimeInput(now, timeZone).slice(0, 10);
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > currentDay) throw new Error();
      const cutoff = date === currentDay ? canonicalStockInstant(now.toISOString()) : stockEndOfDay(date, timeZone).cutoff;
      // The source reports its accepted-ledger coverage on the first page. Only
      // one bounded row is needed to obtain this result and its metadata.
      void read({ branchId, timeZone, cutoff, limit: 1 });
    } catch {
      setDateError("Choose today or an earlier date.");
    }
  }

  return <div className="space-y-4">
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); if (!inspection?.running) verify(); }}>
      <div className="space-y-1.5">
        <Label htmlFor={inputId}>Verification date · {timeZone}</Label>
        <Input id={inputId} type="date" value={date} max={today} onChange={event => {
          sequence.current++; setInspection(null); setRolloutReadiness(null); setRolloutReadinessError(""); setDateError(""); setDate(event.target.value);
        }} />
      </div>
      <Button type="submit" disabled={!date || inspection?.running}><ClipboardCheck aria-hidden="true" /> Run Verification</Button>
      {inspection?.error && <Button type="button" variant="outline" onClick={() => void read(inspection.request)}>Retry Verification</Button>}
    </form>
    <p className="text-xs text-muted-foreground">{branchName} · Earlier dates use the end of the selected day. Today uses the time the check starts.</p>
    {dateError && <p role="alert" className="text-sm text-destructive">{dateError}</p>}
    {inspection?.running && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Checking coverage…</p>}
    {inspection?.error && <p role="alert" className="text-sm text-destructive">{inspection.error}</p>}
    {inspection?.report && <CoverageReadout report={inspection.report} />}
    {mayCheckReadiness && rolloutReadinessError && <p role="status" className="text-sm text-muted-foreground">{rolloutReadinessError}</p>}
    {mayCheckReadiness && rolloutReadiness && <div className="space-y-1 text-sm text-muted-foreground" role="status">
      {rolloutReadiness.registrationInventory && <>
        <p>Previously claimed location registrations · Desktop {rolloutReadiness.registrationInventory.desktop.toLocaleString()}
          {" · Mobile "}{rolloutReadiness.registrationInventory.mobile.toLocaleString()}
          {" · Unknown platform "}{rolloutReadiness.registrationInventory.unknown.toLocaleString()}</p>
        {rolloutReadiness.registrationInventory.hasUnassignedLocalCandidate &&
          <p>Check previously claimed devices with no recorded location for retained local work.</p>}
      </>}
      {rolloutReadiness.writers > 0 && <p>{rolloutReadiness.confirmed} of {rolloutReadiness.writers} enrolled tills have a current accepted upload check.</p>}
      {rolloutReadiness.reasons.length ? rolloutReadiness.reasons.map(reason => <p key={reason}>{stockHistoryExplanation(reason)}</p>)
        : <p>The current writer checks passed. Activation still needs an exact opening cutoff.</p>}
    </div>}
    {mayRecordOpening && <div className="space-y-2 border-t pt-4">
      <p className="text-sm text-muted-foreground">Record the location’s database quantities once at rollout. Movement coverage and till uploads are verified separately.</p>
      <Button type="button" variant="outline" disabled={recording || opening?.status === "recorded" || opening?.status === "already_verified"}
        onClick={() => void recordOpening()}>{recording ? "Recording opening…" : "Record rollout opening"}</Button>
      {openingError && <p role="alert" className="text-sm text-destructive">{openingError}</p>}
      {opening && <p role="status" className="text-sm text-muted-foreground">
        {opening.status === "waiting" ? opening.reasons.map(stockHistoryExplanation).join(" ")
          : opening.status === "already_verified" ? "This location already has a verified opening."
            : <>Recorded {opening.productCount.toLocaleString()} products at <time dateTime={opening.cutoff}>
              {new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: "medium", timeStyle: "long" }).format(new Date(opening.cutoff))}
            </time>. Writer coverage is still unconfirmed.</>}
      </p>}
    </div>}
  </div>;
}

export function StockHistoryVerification() {
  const { can, isAdmin, authUserId, appUser, terminalUser, user, terminalStoreId } = useAuth();
  const { currentStore } = usePos();
  const mode = useSyncExternalStore(subscribeDatabaseMode, effectiveDatabaseMode, preferredDatabaseMode);
  const timeZone = posTimeZone() || "Asia/Brunei";
  const heading = useId();
  const branchId = canonicalBranchId(currentStore.id);
  const bound = canonicalBranchId(terminalStoreId || user?.storeId);
  if (!can("can_manage_sync_backup") || !can("can_view_inventory")) return null;
  const scopeReady = Boolean(branchId && (!bound || sameBranchId(bound, branchId)));
  const mayCheckReadiness = currentPlatform() === "web" && isAdmin && Boolean(authUserId);
  const scopeKey = JSON.stringify([branchId, timeZone, mode, sessionEpoch(), authUserId, appUser?.id, terminalUser?.cashierId, user?.staffId]);
  return <section className="mt-4 space-y-4 rounded-2xl border border-border/70 bg-card p-4 sm:p-5" aria-labelledby={heading}>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id={heading} className="text-lg font-semibold">Stock History Verification</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">Check the recorded inventory coverage for a location and date. Physical stock counts are assessed separately.</p></div>
      <Button asChild variant="outline" size="sm"><Link to="/reports/inventory">Open Stock Report</Link></Button>
    </header>
    {!scopeReady ? <p role="status" className="text-sm text-muted-foreground">Choose an authorized location to check its stock history.</p>
      : !desktopHistoryAvailable() ? <p role="status" className="text-sm text-muted-foreground">Verification on Electron requires the authorized local SQL Server stock-history reader.</p>
        : <VerificationForm key={scopeKey} branchId={branchId} branchName={currentStore.name} timeZone={timeZone} mayCheckReadiness={mayCheckReadiness} />}
  </section>;
}
