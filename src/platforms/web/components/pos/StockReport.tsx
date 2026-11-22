import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ThemedSelect } from "./ThemedSelect";
import { useAuth } from "@/lib/pos-auth";
import { stockAt, usePos } from "@/lib/pos-store";
import { createCatalogueVisibility } from "@/lib/branch-policy";
import { sameBranchId } from "@/lib/branch-id";
import { TablePagination, usePagination } from "./TablePagination";
import { effectiveTimeZone } from "@/lib/time-zone";
import { useReportShifts } from "@/lib/use-report-shifts";
import { sessionEpoch } from "@/lib/session-epoch";
import { loadStockHistoryPage } from "@/lib/stock-history-client";
import { loadStockHistoryMovements } from "@/lib/stock-history-movements-client";
import { STOCK_MOVEMENT_PAGE_SIZE, type StockHistoryMovementCursor, type StockHistoryMovementPage } from "@/lib/stock-history-movements";
import { exportStockHistoryXlsx, stockHistoryForExport } from "@/lib/stock-history-export";
import { stockDateTimeInput, stockEndOfDay, stockTimeChoices, type StockTimeChoice } from "@/lib/stock-history-selection";
import { stockHistoryExplanation, type StockHistoryPage, type StockHistoryRequest, type StockHistoryRow } from "@/lib/stock-history-report";
import { stockReportDay } from "../../../../../electron/shared/stock-report-day.mjs";
import { canonicalStockInstant, stockInstant } from "@/lib/stock-as-of";

const zeroQuantity = (row: StockHistoryRow) => row.quantity === "0" || row.quantity === "-0";
type MovementProduct = { productId: string; name: string };
type MovementView = { product: MovementProduct; page: StockHistoryMovementPage | null; number: number; identity: string; error: string };
const movementLabels: Record<StockHistoryMovementPage["rows"][number]["kind"], string> = {
  sale: "Sale", refund: "Refund", receiving: "Receiving", stock: "Stock adjustment", product: "Product change",
  transfer: "Transfer", sponsorship: "Sponsorship", missed_bill: "Missed bill", general: "Stock movement",
};

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

function CurrentStock({ branchId, zeroOnly }: { branchId: string; zeroOnly: boolean }) {
  const { state, ready, loadPhase } = usePos();
  const catalogueReady = ready && loadPhase === "ready" && sameBranchId(state.currentStoreId, branchId);
  const products = useMemo(() => {
    if (!catalogueReady) return [];
    const visible = createCatalogueVisibility(state.settings, state.stores, state.transfers);
    return state.products.filter(product => visible(product, branchId) && (!zeroOnly || stockAt(product, branchId) === 0));
  }, [catalogueReady, branchId, state.settings, state.stores, state.transfers, state.products, zeroOnly]);
  const { pageItems, setPage, setPageSize, ...pagination } = usePagination(products, 50);

  return <section className="space-y-3" aria-label="Current stock">
    <h2 className="text-lg font-semibold">Current stock</h2>
    {!catalogueReady ? <p role="status" className="text-sm text-muted-foreground">
      {loadPhase === "failed" ? "Current inventory could not be loaded." : "Loading current inventory…"}
    </p> : <>
      <div className="overflow-x-auto rounded-md border">
        <Table aria-label="Current inventory">
          <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>SKU / barcode</TableHead><TableHead className="text-right">Stock available</TableHead></TableRow></TableHeader>
          <TableBody>{pageItems.length ? pageItems.map(product => {
            const quantity = stockAt(product, branchId);
            return <TableRow key={product.id}>
              <TableCell className="min-w-40 max-w-80 whitespace-normal break-words">{product.name}</TableCell>
              <TableCell className="max-w-52 whitespace-normal break-all text-xs">{product.sku || "—"}<br />{product.barcode || "—"}</TableCell>
              <TableCell className={`numeric whitespace-nowrap text-right ${quantity < 0 ? "text-destructive" : ""}`}>{quantity}{quantity < 0 && <span className="block text-xs">Negative stock</span>}</TableCell>
            </TableRow>;
          }) : <TableRow><TableCell colSpan={3}>{zeroOnly ? "No products with zero stock at this location." : "No products in the current inventory for this location."}</TableCell></TableRow>}</TableBody>
        </Table>
      </div>
      <TablePagination {...pagination} onPage={setPage} onPageSize={setPageSize} label="products" />
    </>}
  </section>;
}

export function StockReport({ branchId, branchName }: { branchId: string; branchName: string }) {
  const { can, isAdmin, authUserId, appUser, terminalUser, user } = useAuth();
  const { state } = usePos();
  const timeZone = effectiveTimeZone();
  const mayRead = can("can_view_inventory"), mayExport = can("can_export_reports");
  const mayReadShifts = isAdmin || can("can_shift_closing_history_view");
  const [showCurrent, setShowCurrent] = useState(true);
  const [zeroOnly, setZeroOnly] = useState(false);
  const [value, setValue] = useState(() => stockDateTimeInput(new Date(), timeZone));
  const [mode, setMode] = useState("time"), [shiftId, setShiftId] = useState("");
  const [showPeriod, setShowPeriod] = useState(false);
  const periodId = useId(), quantityFilterId = useId(), movementHeadingId = useId();
  const [choices, setChoices] = useState<StockTimeChoice[]>([]), [choice, setChoice] = useState("");
  const [page, setPage] = useState<StockHistoryPage | null>(null), [request, setRequest] = useState<StockHistoryRequest | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [exporting, setExporting] = useState(false);
  const [pageIdentity, setPageIdentity] = useState(""), [activityIdentity, setActivityIdentity] = useState("");
  const [movement, setMovement] = useState<MovementView | null>(null);
  const movementHeading = useRef<HTMLHeadingElement>(null), movementTrigger = useRef<HTMLButtonElement | null>(null);
  const returnMovementFocus = useRef(false);
  const generation = useRef(0), mounted = useRef(false);
  const identity = JSON.stringify([branchId, timeZone, mayRead, mayExport, mayReadShifts, sessionEpoch(),
    authUserId, appUser?.id, terminalUser?.cashierId, user?.staffId]);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  // Render-time scope ownership hides protected rows before effects can run.
  const visiblePage = !showCurrent && mayRead && pageIdentity === identity ? page : null;
  const visibleRequest = visiblePage ? request : null;
  const active = activityIdentity === identity;
  const shownBusy = active && busy, shownExporting = active && exporting, shownError = active ? error : "";
  const grade = stockReportDisplayGrade(visiblePage);
  const visibleRows = zeroOnly ? visiblePage?.rows.filter(zeroQuantity) : visiblePage?.rows;
  const canOpenMovements = grade === "verified" && Boolean(visiblePage?.sourceRevision && visiblePage.baselineAt);
  const visibleMovement = canOpenMovements && movement?.identity === identity ? movement : null;
  const movementProductId = visibleMovement?.product.productId, movementPageNumber = visibleMovement?.number;
  useEffect(() => {
    if (movementProductId) movementHeading.current?.focus();
    else if (returnMovementFocus.current) {
      returnMovementFocus.current = false;
      movementTrigger.current?.focus();
    }
  }, [movementProductId, movementPageNumber]);
  useEffect(() => { mounted.current = true; const lifecycle = { mounted, generation };
    return () => { lifecycle.mounted.current = false; lifecycle.generation.current++; }; }, []);
  useEffect(() => {
    generation.current++; setPage(null); setRequest(null); setMovement(null); setError(""); setBusy(false); setExporting(false);
    setPageIdentity(""); setActivityIdentity(identity);
    setChoices([]); setChoice(""); setShiftId(""); setMode("time"); setShowPeriod(false);
    setShowCurrent(true);
    setZeroOnly(false);
    // Identity includes every permission/account/scope used by this view.
  }, [identity]);
  useEffect(() => {
    if (showCurrent) setValue(stockDateTimeInput(new Date(), timeZone));
  }, [identity, showCurrent, state.products, timeZone]);
  const day = value.slice(0, 10);
  const shifts = useReportShifts(state.shifts, branchId, day, day, mayRead && mayReadShifts && mode === "shift");
  const shiftOptions = useMemo(() => shifts.shifts.filter(shift =>
    ["closed", "completed"].includes(String(shift.status).toLowerCase()) && !!shift.closedAt)
    .map(shift => ({ value: shift.id, label: `${shift.id.slice(0, 8)} · ${shift.cashier || "Shift"}` })), [shifts.shifts]);
  function invalidate() { generation.current++; setPage(null); setRequest(null); setMovement(null); setPageIdentity(""); setActivityIdentity(identity); setError(""); setBusy(false); setExporting(false); }
  function context() {
    const captured = ++generation.current, epoch = sessionEpoch(), key = currentIdentity.current;
    return () => {
      if (!mounted.current || captured !== generation.current || key !== currentIdentity.current || sessionEpoch() !== epoch)
        throw new Error("The report context changed. Open the report again.");
    };
  }
  async function read(next?: StockHistoryRequest, filterZero = zeroOnly) {
    if (!mayRead) return;
    const now = new Date();
    const today = !next && mode === "day" && day === stockDateTimeInput(now, timeZone).slice(0, 10);
    if (today && !showPeriod) {
      invalidate();
      setShowCurrent(true);
      return;
    }
    setShowCurrent(false);
    const assertCurrent = context(); setActivityIdentity(identity); setMovement(null); setBusy(true); setError("");
    try {
      let selected = next;
      if (!selected) {
        if (mode === "shift") {
          if (!mayReadShifts || !shiftId) throw new Error("Select a closed shift from this location.");
          // Required transport field only: the authorized source exclusively
          // resolves this CLOSED shift's saved instant, including exact digits.
          selected = { cutoff: "1970-01-01T00:00:00.0000000Z", timeZone, branchId, closedShiftId: shiftId };
        } else if (mode === "day") {
          const { cutoff, start } = stockEndOfDay(day, timeZone);
          selected = { cutoff: today ? canonicalStockInstant(now.toISOString()) : cutoff, timeZone, branchId,
            ...(showPeriod ? { periodStart: start } : {}) };
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
      let pageRequest = selectedRequest;
      let result: StockHistoryPage;
      const cursors = new Set([selectedRequest.after ?? null]);
      for (let scanned = 0; ; scanned++) {
        result = await loadStockHistoryPage(pageRequest); assertCurrent();
        if (result.branchId !== pageRequest.branchId || result.timeZone !== pageRequest.timeZone
          || ((!pageRequest.closedShiftId || pageRequest.sourceRevision) && stockInstant(result.cutoff) !== stockInstant(pageRequest.cutoff))
          || (pageRequest.sourceRevision && result.sourceRevision !== pageRequest.sourceRevision)
          || Boolean(result.period) !== Boolean(pageRequest.periodStart)
          || (pageRequest.periodStart && stockInstant(result.period!.start) !== stockInstant(pageRequest.periodStart)))
          throw new Error("The stock report returned a different scope, time, or revision. Refresh the report.");
        if (!filterZero || stockReportDisplayGrade(result) === "unavailable" || result.rows.some(zeroQuantity) || !result.next) break;
        if (cursors.has(result.next) || !result.sourceRevision)
          throw new Error("The stock report could not continue at the same verified position.");
        // Look beyond the first unfiltered page without turning one click into
        // an unbounded branch-wide request. The next page can continue the scan.
        if (scanned === 4) break;
        cursors.add(result.next);
        pageRequest = { ...selectedRequest, cutoff: result.cutoff, after: result.next, sourceRevision: result.sourceRevision };
      }
      setPage(result); setPageIdentity(identity);
      setRequest({ ...selectedRequest, cutoff: result.cutoff, after: null, sourceRevision: result.sourceRevision });
    } catch (failure) {
      try { assertCurrent(); setError(failure instanceof Error ? failure.message : "The stock report could not be loaded."); } catch { /* Stale read has no visible result. */ }
    } finally { try { assertCurrent(); setBusy(false); } catch { /* New context owns its state. */ } }
  }
  async function readMovements(product: MovementProduct, after: StockHistoryMovementCursor | null = null, number = 1) {
    if (!canOpenMovements || !visibleRequest || !visiblePage?.sourceRevision || shownBusy || shownExporting) return;
    const assertCurrent = context();
    const view = { product, page: null, number, identity, error: "" };
    setMovement(view); setActivityIdentity(identity); setBusy(true);
    try {
      const result = await loadStockHistoryMovements({
        branchId: visiblePage.branchId, productId: product.productId, cutoff: visiblePage.cutoff,
        timeZone: visiblePage.timeZone, sourceRevision: visiblePage.sourceRevision,
        periodStart: visiblePage.period?.start, closedShiftId: visibleRequest.closedShiftId,
        after, limit: STOCK_MOVEMENT_PAGE_SIZE,
      });
      assertCurrent();
      if (result.status === "complete" && result.baselineAt !== visiblePage.baselineAt) {
        throw new Error("The verified opening changed. Refresh the stock report before continuing.");
      }
      setMovement({ ...view, page: result });
    } catch (failure) {
      try {
        assertCurrent();
        setMovement({ ...view, error: failure instanceof Error ? failure.message : "Stock movements could not be loaded." });
      } catch { /* A new report context owns the visible result. */ }
    } finally {
      try { assertCurrent(); setBusy(false); } catch { /* A new report context owns its state. */ }
    }
  }
  function closeMovements() {
    if (shownBusy) { generation.current++; setBusy(false); }
    returnMovementFocus.current = true;
    setMovement(null);
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
  if (!mayRead) return null;
  return <section className="min-w-0 space-y-4" aria-label="Stock report data">
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (!shownBusy && !shownExporting) void read(); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label className="space-y-1"><span>{mode === "day" ? "Date" : "Date and time"} · {timeZone}</span>
          <Input aria-label={mode === "day" ? "Stock report date" : "Stock report date and time"}
            type={mode === "day" ? "date" : "datetime-local"} step={mode === "day" ? undefined : 1}
            value={mode === "day" ? day : value} onChange={event => {
              invalidate(); setShowCurrent(false); setChoices([]); setChoice(""); setShiftId("");
              const input = event.target.value;
              setValue(mode === "day" && input ? input + (value.slice(10) || "T00:00:00") : input);
            }} />
        </Label>
        <Label className="space-y-1"><span>Cutoff</span><ThemedSelect ariaLabel="Stock cutoff method" value={mode} onChange={next => { invalidate(); setShowCurrent(false); setMode(next); setShowPeriod(false); }} options={[
          { value: "time", label: "Selected date and time" }, { value: "day", label: "End of selected date" }, ...(mayReadShifts ? [{ value: "shift", label: "After a closed shift" }] : []),
        ]} /></Label>
        {mode === "time" && choices.length > 1 && <Label className="space-y-1"><span>Repeated local time</span><ThemedSelect ariaLabel="Stock cutoff UTC offset" value={choice} onChange={next => { invalidate(); setChoice(next); }} placeholder="Choose an offset" options={choices.map(item => ({ value: item.instant, label: `${item.label} · ${item.instant}` }))} /></Label>}
        {mode === "shift" && <Label className="space-y-1 sm:col-span-2"><span>Closed shift opened on {day}</span><ThemedSelect ariaLabel="Closed shift stock cutoff" value={shiftId} onChange={next => { invalidate(); setShiftId(next); }} placeholder={shifts.loading ? "Loading closed shifts…" : "Choose a closed shift"} disabled={shifts.loading} options={shiftOptions} />
          <span className="block text-xs text-muted-foreground">The saved closing instant is resolved by the database, including its exact time.</span>
          {shifts.error && <span role="alert" className="block text-xs text-destructive">{shifts.error}</span>}
        </Label>}
      </div>
      {mode !== "shift" && <div className="flex items-start gap-2 text-sm"><Switch id={periodId} className="mt-0.5" checked={showPeriod}
        onCheckedChange={checked => { invalidate(); setShowCurrent(false); setShowPeriod(checked); }} /><Label htmlFor={periodId} className="block leading-normal">Show inventory changes for this day<span className="block text-xs text-muted-foreground">Opening stock, stock in and stock out through the same selected time.</span></Label></div>}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={shownBusy || shownExporting}>{shownBusy && <Loader2 className="size-4 animate-spin" />}Show stock at selected time</Button>
        {!showCurrent && <Button type="button" variant="outline" onClick={() => { invalidate(); setChoices([]); setChoice(""); setShiftId(""); setMode("time"); setShowPeriod(false); setShowCurrent(true); }}>Return to current stock</Button>}
        <div className="flex items-center gap-2">
          <Switch id={quantityFilterId} checked={zeroOnly} onCheckedChange={checked => {
            setZeroOnly(checked);
            if (visibleRequest) void read(visibleRequest, checked);
          }} disabled={shownBusy || shownExporting} />
          <Label htmlFor={quantityFilterId}>Zero stock only</Label>
        </div>
        {!showCurrent && mayExport && <Button type="button" variant="outline" disabled={shownBusy || shownExporting || grade !== "verified" || visiblePage?.status !== "complete"} onClick={() => void download()}>{shownExporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}{zeroOnly ? "Export full report" : "Export Excel"}</Button>}
      </div>
    </form>
    {shownError && <p role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{shownError}</p>}
    {showCurrent && <CurrentStock key={branchId} branchId={branchId} zeroOnly={zeroOnly} />}
    {visiblePage && <div className="space-y-3" aria-live="polite">
      {grade === "provisional" && <div role="alert" className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-foreground"><p className="font-semibold">Provisional recorded stock</p><p>Some terminals have not confirmed uploads; this recorded balance may change.</p><p className="mt-1 text-xs">This report is not eligible for complete-report export.</p></div>}
      <div className="rounded-md border p-3 text-sm"><p className="font-medium">{grade === "unavailable" ? "Historical quantities are not yet verified" : "Stock available at selected time"}</p><p className="break-words text-xs text-muted-foreground">Exact cutoff: {visiblePage.cutoff} · {visiblePage.timeZone}</p>
        {visiblePage.baselineAt && <p className="break-words text-xs text-muted-foreground">Verified opening: {visiblePage.baselineAt}</p>}
        {visiblePage.period && <p className="break-words text-xs text-muted-foreground">Inventory changes from {visiblePage.period.start} through the selected time (inclusive).</p>}
        {visiblePage.coverage && visiblePage.coverage.timeGrade !== "recorded" && <p className="mt-1 text-xs text-muted-foreground">Movement times include authorized arrival-time entries.</p>}
        {visiblePage.reasons.filter(reason => grade !== "provisional" || !["WRITER_COVERAGE_PENDING", "WRITER_COVERAGE_UNKNOWN"].includes(reason)).map(reason => <p key={reason} className="mt-1 text-sm">{stockHistoryExplanation(reason)}</p>)}
      </div>
      {grade !== "unavailable" && <><div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>SKU / barcode</TableHead>{visiblePage.period && <TableHead className="text-right">Opening stock</TableHead>}{visiblePage.period && <TableHead className="text-right">Stock in</TableHead>}{visiblePage.period && <TableHead className="text-right">Stock out</TableHead>}<TableHead className="text-right">Stock available</TableHead></TableRow></TableHeader><TableBody>
        {visibleRows?.length ? visibleRows.map(row => <TableRow key={row.productId}>
          <TableCell className="min-w-40 max-w-80 whitespace-normal break-words"><span>{row.name}</span>
            {canOpenMovements && <Button variant="link" size="sm" className="block h-auto px-0 py-1" disabled={shownBusy || shownExporting}
              aria-label={`View movements for ${row.name}`} aria-expanded={movementProductId === row.productId}
              aria-controls={movementProductId === row.productId ? `${movementHeadingId}-panel` : undefined}
              onClick={event => { movementTrigger.current = event.currentTarget; void readMovements(row); }}>View movements</Button>}
          </TableCell>
          <TableCell className="max-w-52 whitespace-normal break-all text-xs">{row.sku || "—"}<br />{row.barcode || "—"}</TableCell>
          {visiblePage.period && <TableCell className="numeric whitespace-nowrap text-right">{row.openingQuantity}</TableCell>}
          {visiblePage.period && <TableCell className="numeric whitespace-nowrap text-right">{row.inQuantity}</TableCell>}
          {visiblePage.period && <TableCell className="numeric whitespace-nowrap text-right">{row.outQuantity}</TableCell>}
          <TableCell className={`numeric whitespace-nowrap text-right ${row.negative ? "text-destructive" : ""}`}>{row.quantity}{row.negative && <span className="block text-xs">Negative stock</span>}</TableCell>
        </TableRow>) : <TableRow><TableCell colSpan={visiblePage.period ? 6 : 3}>{zeroOnly ? "No zero-stock products on this page." : "No products in the verified opening for this location."}</TableCell></TableRow>}
      </TableBody></Table></div>
      {visiblePage.next && visibleRequest && <Button variant="outline" disabled={shownBusy || shownExporting} onClick={() => void read({ ...visibleRequest, after: visiblePage.next })}>Next products</Button>}
      <p className="break-all text-[11px] text-muted-foreground">Read at {visiblePage.readAt} · Source {visiblePage.sourceRevision}</p></>}
      {visibleMovement && <section id={`${movementHeadingId}-panel`} className="space-y-3 rounded-md border p-3" aria-labelledby={movementHeadingId} aria-busy={shownBusy}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 ref={movementHeading} id={movementHeadingId} tabIndex={-1} className="break-words text-sm font-semibold">Stock movements · {visibleMovement.product.name}</h3>
          <Button variant="ghost" size="sm" disabled={shownExporting} onClick={closeMovements}>Close movements</Button>
        </div>
        <p className="break-words text-xs text-muted-foreground">{visiblePage.period ? `From ${visiblePage.period.start}` : `After the verified opening at ${visiblePage.baselineAt}`} through {visiblePage.cutoff} (inclusive).</p>
        {shownBusy && <p role="status" className="text-sm text-muted-foreground">Loading stock movements…</p>}
        {visibleMovement.error && <p role="alert" className="text-sm text-destructive">{visibleMovement.error}</p>}
        {visibleMovement.page && (visibleMovement.page.status === "complete" ? <>
          {visibleMovement.page.rows.length ? <div className="overflow-x-auto"><Table aria-label="Verified stock movements">
            <TableHeader><TableRow><TableHead data-sortable={false}>Effective time (UTC)</TableHead><TableHead>Movement</TableHead><TableHead className="text-right">Quantity change</TableHead></TableRow></TableHeader>
            <TableBody>{visibleMovement.page.rows.map(row => <TableRow key={row.id}>
              <TableCell className="break-all text-xs"><time dateTime={row.effectiveAt}>{row.effectiveAt}</time></TableCell>
              <TableCell>{movementLabels[row.kind]}</TableCell>
              <TableCell className="numeric whitespace-nowrap text-right">{row.delta.startsWith("-") ? row.delta : `+${row.delta}`}</TableCell>
            </TableRow>)}</TableBody>
          </Table></div> : <p className="text-sm text-muted-foreground">No recorded stock movements in this interval.</p>}
          {(visibleMovement.page.next || visibleMovement.number > 1) && <div className="flex flex-wrap items-center gap-2" aria-label="Stock movement pages">
            <span role="status" className="text-xs text-muted-foreground">Page {visibleMovement.number}</span>
            {visibleMovement.number > 1 && <Button variant="outline" size="sm" disabled={shownBusy || shownExporting} onClick={() => void readMovements(visibleMovement.product)}>First movement page</Button>}
            {visibleMovement.page.next && <Button variant="outline" size="sm" disabled={shownBusy || shownExporting}
              onClick={() => void readMovements(visibleMovement.product, visibleMovement.page!.next, visibleMovement.number + 1)}>Next movements</Button>}
          </div>}
        </> : <p role="alert" className="text-sm text-muted-foreground">Movement details are unavailable for this report.{visibleMovement.page.reasons.length > 0 && ` ${stockHistoryExplanation(visibleMovement.page.reasons[0]!)}`}</p>)}
      </section>}
    </div>}
  </section>;
}
