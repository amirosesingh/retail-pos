import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ThemedSelect } from "./ThemedSelect";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";
import { effectiveTimeZone } from "@/lib/time-zone";
import { useReportShifts } from "@/lib/use-report-shifts";
import { sessionEpoch } from "@/lib/session-epoch";
import { loadStockHistoryPage } from "@/lib/stock-history-client";
import { exportStockHistoryXlsx, stockHistoryForExport } from "@/lib/stock-history-export";
import { stockDateTimeInput, stockTimeChoices, type StockTimeChoice } from "@/lib/stock-history-selection";
import { stockHistoryExplanation, type StockHistoryPage, type StockHistoryRequest } from "@/lib/stock-history-report";
import { stockReportDay } from "../../../../../electron/shared/stock-report-day.mjs";
import { stockInstant } from "@/lib/stock-as-of";

/** Presentation gate only; the authorized reader validates the underlying proof. */
// eslint-disable-next-line react-refresh/only-export-components -- Pure presentation decision is independently regression tested.
export function stockReportDisplayGrade(page: StockHistoryPage | null): "verified" | "provisional" | "unavailable" {
  if (!page || page.rows.some(row => row.quantity === null)) return "unavailable";
  if (page.status === "complete" && (!page.coverage || (page.coverage.acceptedLedger === "complete"
    && page.coverage.writers === "confirmed" && page.coverage.balanceGrade === "verified"))) return "verified";
  if (page.status === "incomplete" && page.coverage?.acceptedLedger === "complete"
    && page.coverage.balanceGrade === "recorded_provisional" && page.coverage.writers !== "confirmed"
    && page.baselineAt && page.readAt && page.sourceRevision
    && page.reasons.some(reason => reason === "WRITER_COVERAGE_PENDING" || reason === "WRITER_COVERAGE_UNKNOWN")
    && page.reasons.every(reason => ["WRITER_COVERAGE_PENDING", "WRITER_COVERAGE_UNKNOWN", "CLOCK_UNVERIFIED"].includes(reason))) return "provisional";
  return "unavailable";
}

export function StockHistoryDialog({ open, onOpenChange, branchId, branchName }: {
  open: boolean; onOpenChange: (open: boolean) => void; branchId: string; branchName: string;
}) {
  const { can, isAdmin, authUserId, appUser, terminalUser, user } = useAuth(), { state } = usePos(), timeZone = effectiveTimeZone();
  const mayRead = can("can_view_inventory"), mayExport = can("can_export_reports");
  const mayReadShifts = isAdmin || can("can_shift_closing_history_view");
  const [value, setValue] = useState(() => stockDateTimeInput(new Date(), timeZone));
  const [mode, setMode] = useState("time"), [shiftId, setShiftId] = useState("");
  const [showPeriod, setShowPeriod] = useState(false);
  const [choices, setChoices] = useState<StockTimeChoice[]>([]), [choice, setChoice] = useState("");
  const [page, setPage] = useState<StockHistoryPage | null>(null), [request, setRequest] = useState<StockHistoryRequest | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [exporting, setExporting] = useState(false);
  const [pageIdentity, setPageIdentity] = useState(""), [activityIdentity, setActivityIdentity] = useState("");
  const generation = useRef(0), mounted = useRef(false);
  const identity = JSON.stringify([open, branchId, timeZone, mayRead, mayExport, mayReadShifts, sessionEpoch(),
    authUserId, appUser?.id, terminalUser?.cashierId, user?.staffId]);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  // Render-time scope ownership hides protected rows before effects can run.
  const visiblePage = open && mayRead && pageIdentity === identity ? page : null;
  const visibleRequest = visiblePage ? request : null;
  const active = activityIdentity === identity;
  const shownBusy = active && busy, shownExporting = active && exporting, shownError = active ? error : "";
  const grade = stockReportDisplayGrade(visiblePage);
  useEffect(() => { mounted.current = true; const lifecycle = { mounted, generation };
    return () => { lifecycle.mounted.current = false; lifecycle.generation.current++; }; }, []);
  useEffect(() => {
    generation.current++; setPage(null); setRequest(null); setError(""); setBusy(false); setExporting(false);
    setPageIdentity(""); setActivityIdentity(identity);
    setChoices([]); setChoice(""); setShiftId(""); setMode("time"); setShowPeriod(false);
    if (open) setValue(stockDateTimeInput(new Date(), timeZone));
    // Identity includes every permission/account/scope used by this view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);
  const day = value.slice(0, 10);
  const shifts = useReportShifts(state.shifts, branchId, day, day, open && mayRead && mayReadShifts && mode === "shift");
  const shiftOptions = useMemo(() => shifts.shifts.filter(shift =>
    ["closed", "completed"].includes(String(shift.status).toLowerCase()) && !!shift.closedAt)
    .map(shift => ({ value: shift.id, label: `${shift.id.slice(0, 8)} · ${shift.cashier || "Shift"}` })), [shifts.shifts]);
  function invalidate() { generation.current++; setPage(null); setRequest(null); setPageIdentity(""); setActivityIdentity(identity); setError(""); setBusy(false); setExporting(false); }
  function context() {
    const captured = ++generation.current, epoch = sessionEpoch(), key = currentIdentity.current;
    return () => {
      if (!mounted.current || captured !== generation.current || key !== currentIdentity.current || sessionEpoch() !== epoch)
        throw new Error("The report context changed. Open the report again.");
    };
  }
  async function read(next?: StockHistoryRequest) {
    if (!open || !mayRead) return;
    const assertCurrent = context(); setActivityIdentity(identity); setBusy(true); setError("");
    try {
      let selected = next;
      if (!selected) {
        if (mode === "shift") {
          if (!mayReadShifts || !shiftId) throw new Error("Select a closed shift from this location.");
          // Required transport field only: the authorized source exclusively
          // resolves this CLOSED shift's saved instant, including exact digits.
          selected = { cutoff: "1970-01-01T00:00:00.0000000Z", timeZone, branchId, closedShiftId: shiftId };
        } else {
          const options = stockTimeChoices(value, timeZone);
          if (!options.length) throw new Error("This local date/time does not exist in this time zone. Choose another time.");
          setChoices(options);
          const cutoff = options.length === 1 ? options[0].instant : options.find(item => item.instant === choice)?.instant;
          if (!cutoff) throw new Error("This local time occurs twice. Choose the UTC offset below.");
          selected = { cutoff, timeZone, branchId,
            ...(showPeriod ? { periodStart: stockReportDay(value.slice(0, 10), timeZone).start } : {}) };
        }
      }
      const selectedRequest = Object.freeze({ ...selected });
      const result = await loadStockHistoryPage(selectedRequest); assertCurrent();
      if (result.branchId !== selectedRequest.branchId || result.timeZone !== selectedRequest.timeZone
        || (!selectedRequest.closedShiftId && stockInstant(result.cutoff) !== stockInstant(selectedRequest.cutoff))
        || Boolean(result.period) !== Boolean(selectedRequest.periodStart)
        || (selectedRequest.periodStart && stockInstant(result.period!.start) !== stockInstant(selectedRequest.periodStart)))
        throw new Error("The stock report returned a different scope or time. Refresh the report.");
      setPage(result); setPageIdentity(identity);
      setRequest({ ...selectedRequest, cutoff: result.cutoff, after: null, sourceRevision: result.sourceRevision });
    } catch (failure) {
      try { assertCurrent(); setError(failure instanceof Error ? failure.message : "The stock report could not be loaded."); } catch { /* Stale read has no visible result. */ }
    } finally { try { assertCurrent(); setBusy(false); } catch { /* New context owns its state. */ } }
  }
  async function download() {
    if (!visibleRequest || !mayExport || grade !== "verified" || visiblePage?.status !== "complete") return;
    const assertCurrent = context(); setActivityIdentity(identity); setExporting(true); setError("");
    try {
      const report = await stockHistoryForExport(visibleRequest, loadStockHistoryPage, assertCurrent); assertCurrent();
      await exportStockHistoryXlsx(report, branchName, assertCurrent); assertCurrent();
    } catch (failure) {
      try { assertCurrent(); setError(failure instanceof Error ? failure.message : "The stock report could not be exported."); } catch { /* Context changed. */ }
    } finally { try { assertCurrent(); setExporting(false); } catch { /* Context changed. */ } }
  }
  return <Dialog open={open && mayRead} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1rem)] max-w-4xl flex-col overflow-hidden">
      <DialogHeader><DialogTitle>Stock report · {branchName}</DialogTitle></DialogHeader>
      <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <p className="text-sm text-muted-foreground">Quantities at the original movement time. Late offline uploads may update an earlier report.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Label className="space-y-1"><span>Date and time · {timeZone}</span><Input aria-label="Stock report date and time" type="datetime-local" step="1" value={value} onChange={event => { invalidate(); setChoices([]); setChoice(""); setShiftId(""); setValue(event.target.value); }} /></Label>
          <Label className="space-y-1"><span>Cutoff</span><ThemedSelect ariaLabel="Stock cutoff method" value={mode} onChange={next => { invalidate(); setMode(next); setShowPeriod(false); }} options={[
            { value: "time", label: "Selected date and time" }, ...(mayReadShifts ? [{ value: "shift", label: "After a closed shift" }] : []),
          ]} /></Label>
          {mode === "time" && choices.length > 1 && <Label className="space-y-1"><span>Repeated local time</span><ThemedSelect ariaLabel="Stock cutoff UTC offset" value={choice} onChange={next => { invalidate(); setChoice(next); }} placeholder="Choose an offset" options={choices.map(item => ({ value: item.instant, label: `${item.label} · ${item.instant}` }))} /></Label>}
          {mode === "shift" && <Label className="space-y-1 sm:col-span-2"><span>Closed shift opened on {day}</span><ThemedSelect ariaLabel="Closed shift stock cutoff" value={shiftId} onChange={next => { invalidate(); setShiftId(next); }} placeholder={shifts.loading ? "Loading closed shifts…" : "Choose a closed shift"} disabled={shifts.loading} options={shiftOptions} />
            <span className="block text-xs text-muted-foreground">The saved closing instant is resolved by the database, including its exact time.</span>
            {shifts.error && <span role="alert" className="block text-xs text-destructive">{shifts.error}</span>}
          </Label>}
        </div>
        {mode === "time" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={showPeriod}
          onChange={event => { invalidate(); setShowPeriod(event.target.checked); }} /><span>Show inventory changes for this day<span className="block text-xs text-muted-foreground">Opening stock, stock in and stock out through the same selected time.</span></span></label>}
        <div className="flex flex-wrap gap-2"><Button disabled={shownBusy || shownExporting} onClick={() => void read()}>{shownBusy && <Loader2 className="size-4 animate-spin" />}Show stock</Button>
          {mayExport && <Button variant="outline" disabled={shownBusy || shownExporting || grade !== "verified" || visiblePage?.status !== "complete"} onClick={() => void download()}>{shownExporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}Export Excel</Button>}
        </div>
        {shownError && <p role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{shownError}</p>}
        {visiblePage && <div className="space-y-3" aria-live="polite">
          {grade === "provisional" && <div role="alert" className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-foreground"><p className="font-semibold">Provisional recorded stock</p><p>Some terminals have not confirmed uploads; this recorded balance may change.</p><p className="mt-1 text-xs">This report is not eligible for complete-report export.</p></div>}
          <div className="rounded-md border p-3 text-sm"><p className="font-medium">{grade === "unavailable" ? "Historical quantities are not yet verified" : "Stock available at selected time"}</p><p className="break-words text-xs text-muted-foreground">Exact cutoff: {visiblePage.cutoff} · {visiblePage.timeZone}</p>
            {visiblePage.baselineAt && <p className="break-words text-xs text-muted-foreground">Verified opening: {visiblePage.baselineAt}</p>}
            {visiblePage.period && <p className="break-words text-xs text-muted-foreground">Inventory changes from {visiblePage.period.start} through the selected time (inclusive).</p>}
            {visiblePage.coverage && visiblePage.coverage.timeGrade !== "recorded" && <p className="mt-1 text-xs text-muted-foreground">Movement times include authorized arrival-time entries.</p>}
            {visiblePage.reasons.filter(reason => grade !== "provisional" || !["WRITER_COVERAGE_PENDING", "WRITER_COVERAGE_UNKNOWN"].includes(reason)).map(reason => <p key={reason} className="mt-1 text-sm">{stockHistoryExplanation(reason)}</p>)}
          </div>
          {grade !== "unavailable" && <><div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>SKU / barcode</TableHead>{visiblePage.period && <TableHead className="text-right">Opening stock</TableHead>}{visiblePage.period && <TableHead className="text-right">Stock in</TableHead>}{visiblePage.period && <TableHead className="text-right">Stock out</TableHead>}<TableHead className="text-right">Stock available</TableHead></TableRow></TableHeader><TableBody>
            {visiblePage.rows.length ? visiblePage.rows.map(row => <TableRow key={row.productId}><TableCell className="min-w-40 max-w-80 whitespace-normal break-words">{row.name}</TableCell><TableCell className="max-w-52 whitespace-normal break-all text-xs">{row.sku || "—"}<br />{row.barcode || "—"}</TableCell>{visiblePage.period && <TableCell className="numeric whitespace-nowrap text-right">{row.openingQuantity}</TableCell>}{visiblePage.period && <TableCell className="numeric whitespace-nowrap text-right">{row.inQuantity}</TableCell>}{visiblePage.period && <TableCell className="numeric whitespace-nowrap text-right">{row.outQuantity}</TableCell>}<TableCell className={`numeric whitespace-nowrap text-right ${row.negative ? "text-destructive" : ""}`}>{row.quantity}{row.negative && <span className="block text-xs">Negative stock</span>}</TableCell></TableRow>) : <TableRow><TableCell colSpan={visiblePage.period ? 6 : 3}>No products in the verified opening for this location.</TableCell></TableRow>}
          </TableBody></Table></div>
          {visiblePage.next && visibleRequest && <Button variant="outline" disabled={shownBusy || shownExporting} onClick={() => void read({ ...visibleRequest, after: visiblePage.next })}>Next products</Button>}
          <p className="break-all text-[11px] text-muted-foreground">Read at {visiblePage.readAt} · Source {visiblePage.sourceRevision}</p></>}
        </div>}
      </div>
    </DialogContent>
  </Dialog>;
}
