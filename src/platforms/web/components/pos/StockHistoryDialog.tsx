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

export function StockHistoryDialog({ open, onOpenChange, branchId, branchName }: {
  open: boolean; onOpenChange: (open: boolean) => void; branchId: string; branchName: string;
}) {
  const { can, isAdmin } = useAuth(), { state } = usePos(), timeZone = effectiveTimeZone();
  const mayRead = can("can_view_inventory"), mayExport = can("can_export_reports");
  const mayReadShifts = isAdmin || can("can_shift_closing_history_view");
  const [value, setValue] = useState(() => stockDateTimeInput(new Date(), timeZone));
  const [mode, setMode] = useState("time"), [shiftId, setShiftId] = useState("");
  const [choices, setChoices] = useState<StockTimeChoice[]>([]), [choice, setChoice] = useState("");
  const [page, setPage] = useState<StockHistoryPage | null>(null), [request, setRequest] = useState<StockHistoryRequest | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [exporting, setExporting] = useState(false);
  const generation = useRef(0), identity = JSON.stringify([open, branchId, timeZone, mayRead, sessionEpoch()]);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  useEffect(() => {
    generation.current++; setPage(null); setRequest(null); setError(""); setBusy(false); setExporting(false);
    setChoices([]); setChoice(""); setShiftId(""); setMode("time");
    if (open) setValue(stockDateTimeInput(new Date(), timeZone));
  }, [open, branchId, timeZone, mayRead]);
  const day = value.slice(0, 10);
  const shifts = useReportShifts(state.shifts, branchId, day, day, open && mayRead && mayReadShifts && mode === "shift");
  const shiftOptions = useMemo(() => shifts.shifts.filter(shift =>
    ["closed", "completed"].includes(String(shift.status).toLowerCase()) && !!shift.closedAt)
    .map(shift => ({ value: shift.id, label: `${shift.id.slice(0, 8)} · ${shift.cashier || "Shift"}` })), [shifts.shifts]);
  function invalidate() { generation.current++; setPage(null); setRequest(null); setError(""); setBusy(false); setExporting(false); }
  function context() {
    const captured = ++generation.current, epoch = sessionEpoch(), key = currentIdentity.current;
    return () => {
      if (captured !== generation.current || key !== currentIdentity.current || sessionEpoch() !== epoch)
        throw new Error("The report context changed. Open the report again.");
    };
  }
  async function read(next?: StockHistoryRequest) {
    const assertCurrent = context(); setBusy(true); setError("");
    try {
      let selected = next;
      if (!selected) {
        const options = stockTimeChoices(value, timeZone);
        if (!options.length) throw new Error("This local date/time does not exist in this time zone. Choose another time.");
        setChoices(options);
        const cutoff = options.length === 1 ? options[0].instant : options.find(item => item.instant === choice)?.instant;
        if (!cutoff) throw new Error("This local time occurs twice. Choose the UTC offset below.");
        if (mode === "shift" && (!mayReadShifts || !shiftId)) throw new Error("Select a closed shift from this location.");
        selected = { cutoff, timeZone, branchId, ...(mode === "shift" ? { closedShiftId: shiftId } : {}) };
      }
      const result = await loadStockHistoryPage(selected); assertCurrent();
      setPage(result); setRequest({ ...selected, cutoff: result.cutoff, after: null, sourceRevision: result.sourceRevision });
    } catch (failure) {
      try { assertCurrent(); setError(failure instanceof Error ? failure.message : "The stock report could not be loaded."); } catch { /* Stale read has no visible result. */ }
    } finally { try { assertCurrent(); setBusy(false); } catch { /* New context owns its state. */ } }
  }
  async function download() {
    if (!request || !mayExport || page?.status !== "complete") return;
    const assertCurrent = context(); setExporting(true); setError("");
    try {
      const report = await stockHistoryForExport(request, loadStockHistoryPage, assertCurrent); assertCurrent();
      await exportStockHistoryXlsx(report, branchName, assertCurrent); assertCurrent();
    } catch (failure) {
      try { assertCurrent(); setError(failure instanceof Error ? failure.message : "The stock report could not be exported."); } catch { /* Context changed. */ }
    } finally { try { assertCurrent(); setExporting(false); } catch { /* Context changed. */ } }
  }
  return <Dialog open={open && mayRead} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1rem)] max-w-4xl flex-col overflow-hidden">
      <DialogHeader><DialogTitle>Stock at selected time · {branchName}</DialogTitle></DialogHeader>
      <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <p className="text-sm text-muted-foreground">Quantities at the original movement time. Late offline uploads may update an earlier report.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Label className="space-y-1"><span>Date and time · {timeZone}</span><Input aria-label="Stock report date and time" type="datetime-local" step="1" value={value} onChange={event => { invalidate(); setChoices([]); setChoice(""); setShiftId(""); setValue(event.target.value); }} /></Label>
          <Label className="space-y-1"><span>Cutoff</span><ThemedSelect ariaLabel="Stock cutoff method" value={mode} onChange={next => { invalidate(); setMode(next); }} options={[
            { value: "time", label: "Selected date and time" }, ...(mayReadShifts ? [{ value: "shift", label: "After a closed shift" }] : []),
          ]} /></Label>
          {choices.length > 1 && <Label className="space-y-1"><span>Repeated local time</span><ThemedSelect ariaLabel="Stock cutoff UTC offset" value={choice} onChange={next => { invalidate(); setChoice(next); }} placeholder="Choose an offset" options={choices.map(item => ({ value: item.instant, label: `${item.label} · ${item.instant}` }))} /></Label>}
          {mode === "shift" && <Label className="space-y-1 sm:col-span-2"><span>Closed shift opened on {day}</span><ThemedSelect ariaLabel="Closed shift stock cutoff" value={shiftId} onChange={next => { invalidate(); setShiftId(next); }} placeholder={shifts.loading ? "Loading closed shifts…" : "Choose a closed shift"} disabled={shifts.loading} options={shiftOptions} />
            <span className="block text-xs text-muted-foreground">The saved closing instant is resolved by the database, including its exact time.</span>
            {shifts.error && <span role="alert" className="block text-xs text-destructive">{shifts.error}</span>}
          </Label>}
        </div>
        <div className="flex flex-wrap gap-2"><Button disabled={busy || exporting} onClick={() => void read()}>{busy && <Loader2 className="size-4 animate-spin" />}Show stock</Button>
          {mayExport && <Button variant="outline" disabled={busy || exporting || page?.status !== "complete"} onClick={() => void download()}>{exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}Export Excel</Button>}
        </div>
        {error && <p role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
        {page && <div className="space-y-3" aria-live="polite">
          <div className="rounded-md border p-3 text-sm"><p className="font-medium">{page.status === "complete" ? "Verified stock quantities" : "Historical quantities are not yet verified"}</p><p className="break-words text-xs text-muted-foreground">Exact cutoff: {page.cutoff} · {page.timeZone}</p>
            {page.baselineAt && <p className="break-words text-xs text-muted-foreground">Verified opening: {page.baselineAt}</p>}
            {page.reasons.map(reason => <p key={reason} className="mt-1 text-sm">{stockHistoryExplanation(reason)}</p>)}
          </div>
          {page.status === "complete" && <><div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>SKU / barcode</TableHead><TableHead className="text-right">Quantity</TableHead></TableRow></TableHeader><TableBody>
            {page.rows.length ? page.rows.map(row => <TableRow key={row.productId}><TableCell className="min-w-40 max-w-80 whitespace-normal break-words">{row.name}</TableCell><TableCell className="max-w-52 whitespace-normal break-all text-xs">{row.sku || "—"}<br />{row.barcode || "—"}</TableCell><TableCell className={`numeric text-right ${row.negative ? "text-destructive" : ""}`}>{row.quantity}{row.negative && <span className="block text-xs">Negative stock</span>}</TableCell></TableRow>) : <TableRow><TableCell colSpan={3}>No products in the verified opening for this location.</TableCell></TableRow>}
          </TableBody></Table></div>
          {page.next && request && <Button variant="outline" disabled={busy || exporting} onClick={() => void read({ ...request, after: page.next })}>Next products</Button>}
          <p className="break-all text-[11px] text-muted-foreground">Read at {page.readAt} · Source {page.sourceRevision}</p></>}
        </div>}
      </div>
    </DialogContent>
  </Dialog>;
}
