import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { effectiveDatabaseMode, subscribeDatabaseMode } from "@/core/local-db/db-mode";
import { hasFeature } from "@/platform-config/features";
import { canonicalBranchId, sameBranchId } from "@/lib/branch-id";
import { createCatalogueVisibility } from "@/lib/branch-policy";
import { isManagementDevice } from "@/lib/management-device";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";
import { sessionEpoch } from "@/lib/session-epoch";
import { loadStockActivityPage } from "@/lib/stock-activity-client";
import { loadStockHistoryPage } from "@/lib/stock-history-client";
import { loadStockHistoryMovements } from "@/lib/stock-history-movements-client";
import { STOCK_MOVEMENT_PAGE_SIZE, type StockHistoryMovementCursor, type StockHistoryMovementPage } from "@/lib/stock-history-movements";
import { stockHistoryExplanation, type StockHistoryPage, type StockHistoryRow } from "@/lib/stock-history-report";
import { stockDateTimeInput } from "@/lib/stock-history-selection";
import { usesLocalStockHistory } from "@/lib/stock-report-desktop-reader";
import { STOCK_MOVEMENT_MAX_CALENDAR_DAYS, movementActivityWithinRange, stockMovementRange, verifiedMovementBreakdown, verifiedMovementSummary, verifiedMovementTimeline,
  type StockMovementDateRange } from "@/lib/stock-movement-report";
import { posTimeZone } from "@/lib/time-zone";
import { StatCard } from "./report-kit";
import { StockActivityTime } from "./StockReportActivity";
import { ThemedSelect } from "./ThemedSelect";
import { useStockReportActivityPage } from "./use-stock-report-activity";

const number = new Intl.NumberFormat();
const allProducts = "all-products";
const kinds: Record<string, string> = {
  sale: "Sale", refund: "Refund", return: "Return", customer_return: "Customer return", supplier_return: "Supplier return",
  receiving: "Stock received", receive: "Stock received", stock: "Stock adjustment", stock_adjustment: "Stock adjustment",
  adjustment: "Stock adjustment", product: "Product change", transfer: "Transfer", transfer_in: "Transfer in", transfer_out: "Transfer out",
  merge: "Product merge", sponsorship: "Sponsorship", missed_bill: "Missed bill", general: "Stock movement",
};
const kindLabel = (kind: string) => kinds[kind] ?? kind.replace(/[_-]/g, " ");
const showUnits = (value: string | number | bigint | null | undefined) => value == null ? "—" : number.format(BigInt(value));
const change = (value: string | number | null) => value === null ? "—" : `${BigInt(value) > 0n ? "+" : ""}${showUnits(value)}`;
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const unavailableOnDevice = () => hasFeature("localDb") && !usesLocalStockHistory();
const readLocalFirstActivity: typeof loadStockActivityPage = request => unavailableOnDevice()
  ? Promise.reject(new Error("This terminal’s local stock activity is unavailable.")) : loadStockActivityPage(request);

type ReportState<T> = { key: string; data: T | null; error: string };
type MovementSelection = { report: string; product: StockHistoryRow; after: StockHistoryMovementCursor | null; number: number };

export function StockMovementReport({ branchId: branch, branchName, refreshToken = 0 }: {
  branchId: string; branchName: string; refreshToken?: number;
}) {
  const { can, user, authUserId, appUser, terminalUser, terminalStoreId } = useAuth();
  const { state, ready, loadPhase } = usePos();
  const mode = useSyncExternalStore(subscribeDatabaseMode, effectiveDatabaseMode, () => "online");
  const timeZone = state.settings.integrations.timeZone || posTimeZone() || "Asia/Brunei";
  const today = stockDateTimeInput(new Date(), timeZone).slice(0, 10);
  const branchId = canonicalBranchId(branch);
  const bound = canonicalBranchId(terminalStoreId || user?.storeId);
  const allowed = can("can_view_inventory") && Boolean(branchId) && (!bound || bound === branchId);
  const management = isManagementDevice();
  const blocked = unavailableOnDevice();
  const identity = JSON.stringify([branchId, timeZone, mode, management, allowed, blocked, sessionEpoch(),
    authUserId, appUser?.id, terminalUser?.cashierId, user?.staffId]);
  const current = useRef(identity); current.current = identity;
  const [dates, setDates] = useState<StockMovementDateRange>({ from: today, to: today });
  const [product, setProduct] = useState({ identity, id: allProducts });
  const [submitted, setSubmitted] = useState<{ identity: string; dates: StockMovementDateRange; generation: number; productId?: string } | null>(null);
  const [position, setPosition] = useState<{ key: string; after: string; revision: string } | null>(null);
  const [snapshot, setSnapshot] = useState<ReportState<StockHistoryPage> | null>(null);
  const [movement, setMovement] = useState<MovementSelection | null>(null);
  const [details, setDetails] = useState<ReportState<StockHistoryMovementPage> | null>(null);
  const [formError, setFormError] = useState("");
  const movementHeading = useId();
  const selected = submitted?.identity === identity && allowed && !blocked ? submitted : null;
  const anchored = useMemo(() => selected ? { selected, refreshToken, now: new Date() } : null, [selected, refreshToken]);
  const selection = useMemo(() => {
    if (!anchored) return null;
    try { return { range: stockMovementRange(anchored.selected.dates, branchId, timeZone, anchored.now), error: "" }; }
    catch (error) { return { range: null, error: message(error, "The report range is unavailable.") }; }
  }, [anchored, branchId, timeZone]);
  const range = selection?.range ?? null;
  const rangeKey = JSON.stringify([identity, selected?.dates, selected?.productId, selected?.generation, range?.cutoff, anchored?.refreshToken]);
  const cursor = position?.key === rangeKey ? position : null;
  const reportKey = JSON.stringify([rangeKey, cursor?.after]);
  const result = snapshot?.key === reportKey ? snapshot : null;
  const activity = useStockReportActivityPage(rangeKey, range ? branchId : undefined, range?.cutoff, "through-cutoff", selected?.productId, readLocalFirstActivity);
  const activityRange = useMemo(() => movementActivityWithinRange(activity.page, range), [activity.page, range]);
  const verified = result?.data?.status === "complete" ? result.data : null;
  const totals = !selected?.productId ? verifiedMovementSummary(verified, cursor?.after ?? null) : null;
  const reportRows = verified?.rows.filter(row => !selected?.productId || row.productId === selected.productId) ?? [];
  const detail = movement?.report === reportKey && verified?.sourceRevision && !blocked ? movement : null;
  const detailKey = JSON.stringify([reportKey, detail?.product.productId, detail?.after]);
  const detailResult = details?.key === detailKey ? details : null;
  const format = useMemo(() => new Intl.DateTimeFormat(undefined, {
    timeZone, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }), [timeZone]);

  const products = useMemo(() => {
    const options = new Map<string, string>();
    if (allowed && !blocked && ready && loadPhase === "ready" && sameBranchId(state.currentStoreId, branchId)) {
      const visible = createCatalogueVisibility(state.settings, state.stores, state.transfers);
      for (const item of state.products) if (visible(item, branchId)) {
        const identifiers = [item.sku, item.barcode, ...(item.barcodes ?? [])].filter(Boolean).join(" · ");
        options.set(item.id.toLowerCase(), identifiers ? `${item.name} · ${identifiers}` : item.name);
      }
    }
    for (const row of verified?.rows ?? []) options.set(row.productId, options.get(row.productId) ?? `${row.name}${row.sku ? ` · ${row.sku}` : ""}`);
    for (const row of activityRange.rows) options.set(row.productId, options.get(row.productId) ?? row.productName ?? row.productId);
    return [{ value: allProducts, label: "All products" }, ...[...options].map(([value, label]) => ({ value, label }))];
  }, [allowed, blocked, ready, loadPhase, branchId, state.currentStoreId, state.settings, state.stores, state.transfers, state.products,
    verified, activityRange.rows]);
  const productNames = useMemo(() => new Map(products.map(option => [option.value, option.label])), [products]);

  useEffect(() => {
    if (!range?.aggregateRequest || unavailableOnDevice()) return;
    const request = { ...range.aggregateRequest, after: cursor?.after, sourceRevision: cursor?.revision };
    const epoch = sessionEpoch();
    let live = true;
    const stillCurrent = () => live && current.current === identity && sessionEpoch() === epoch && !unavailableOnDevice();
    void loadStockHistoryPage(request).then(page => {
      if (!stillCurrent()) return;
      if (page.cutoff !== request.cutoff || page.branchId !== request.branchId || page.timeZone !== request.timeZone ||
          (page.status !== "unavailable" && page.period?.start !== request.periodStart) ||
          (request.sourceRevision && request.sourceRevision !== page.sourceRevision)) throw new Error("The report source changed. Generate the report again.");
      setSnapshot({ key: reportKey, data: page, error: "" });
    }).catch(error => {
      if (stillCurrent()) setSnapshot({ key: reportKey, data: null, error: message(error, "Verified movements could not be loaded.") });
    });
    return () => { live = false; };
  }, [range, cursor, identity, reportKey]);

  useEffect(() => {
    if (!detail || !verified?.sourceRevision || !verified.period || unavailableOnDevice()) return;
    const epoch = sessionEpoch();
    let live = true;
    const stillCurrent = () => live && current.current === identity && sessionEpoch() === epoch && !unavailableOnDevice();
    void loadStockHistoryMovements({ branchId, productId: detail.product.productId, cutoff: verified.cutoff,
      timeZone, periodStart: verified.period.start, sourceRevision: verified.sourceRevision, after: detail.after, limit: STOCK_MOVEMENT_PAGE_SIZE })
      .then(page => {
        if (!stillCurrent()) return;
        if (page.status === "complete" && page.baselineAt !== verified.baselineAt) throw new Error("The verified opening changed. Generate the report again.");
        setDetails({ key: detailKey, data: page, error: "" });
      }).catch(error => {
        if (stillCurrent()) setDetails({ key: detailKey, data: null, error: message(error, "Product movement details could not be loaded.") });
      });
    return () => { live = false; };
  }, [branchId, detail, detailKey, identity, timeZone, verified]);

  if (!allowed) return <p role="status" className="text-sm text-muted-foreground">Inventory permission is required for this location.</p>;
  if (blocked) return <p role="status" className="rounded-lg border p-4 text-sm text-muted-foreground">Connect the saved local SQL Server database to read Stock Movement on this terminal.</p>;

  function generate() {
    const selectedId = product.identity === identity ? product.id : allProducts;
    const productId = selectedId !== allProducts && products.some(item => item.value === selectedId) ? selectedId : undefined;
    try {
      stockMovementRange(dates, branchId, timeZone);
      setFormError(""); setPosition(null); setMovement(null); setSnapshot(null);
      setSubmitted(previous => ({ identity, dates: { ...dates }, productId, generation: (previous?.generation ?? 0) + 1 }));
    } catch (error) { setFormError(message(error, "Choose a valid date range.")); }
  }

  function reset() {
    setDates({ from: today, to: today }); setProduct({ identity, id: allProducts });
    setSubmitted(null); setPosition(null); setMovement(null); setSnapshot(null); setDetails(null); setFormError("");
  }

  const timeline = detail && detail.number === 1 ? verifiedMovementTimeline(detail.product.openingQuantity, detail.product.quantity, detailResult?.data ?? null) : null;
  const breakdown = detail && detail.number === 1 ? verifiedMovementBreakdown(detail.product, detailResult?.data ?? null) : null;
  return <section className="min-w-0 space-y-5" aria-label="Stock Movement">
    <form className="grid items-end gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={event => { event.preventDefault(); generate(); }}>
      <Label className="space-y-1"><span>From date</span><Input type="date" value={dates.from} max={today}
        onChange={event => setDates(previous => ({ ...previous, from: event.target.value }))} /></Label>
      <Label className="space-y-1"><span>To date</span><Input type="date" value={dates.to} max={today}
        onChange={event => setDates(previous => ({ ...previous, to: event.target.value }))} /></Label>
      <div className="min-w-0 space-y-1"><Label htmlFor={`${movementHeading}-product`}>Product</Label>
        <ThemedSelect id={`${movementHeading}-product`} ariaLabel="Movement product" options={products}
          value={product.identity === identity && products.some(option => option.value === product.id) ? product.id : allProducts}
          onChange={id => setProduct({ identity, id })} /></div>
      <div className="flex flex-wrap gap-2"><Button type="submit">Generate Report</Button><Button type="button" variant="ghost" onClick={reset}>Reset Filters</Button></div>
    </form>
    {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
    {selection?.error && <p role="alert" className="text-sm text-destructive">{selection.error}</p>}
    {range && selected && <>
      <p className="text-sm text-muted-foreground" data-stock-report-locations={branchName}
        data-stock-report-filters={`${selected.dates.from} through ${selected.dates.to} · ${timeZone} · Inclusive cutoff ${range.cutoff}${selected.productId ? ` · ${productNames.get(selected.productId) ?? selected.productId}` : ""}`}>
        {branchName} · {selected.dates.from} through {selected.dates.to} · {timeZone}</p>
      {totals ? <div className="grid gap-3 sm:grid-cols-2" data-stock-report-print-summary>
        <StatCard label="Total stock in" value={showUnits(totals.incoming)} />
        <StatCard label="Total stock out" value={showUnits(totals.outgoing)} />
      </div> : verified && !selected.productId && (cursor || verified.next)
        ? <p className="text-sm text-muted-foreground" data-stock-report-print-summary>Location totals require a complete product set. Verified product totals are available on each page.</p>
        : <p className="sr-only" data-stock-report-print-summary>{verified ? "Verified product balances" : "Recorded activity, incomplete coverage"}</p>}
      {range.aggregateRequest ? <section className="space-y-3" aria-label="Verified movement balances">
        <h3 className="font-semibold">Verified movement balances</h3>
        {!result && <p role="status" className="text-sm text-muted-foreground">Loading verified movement balances…</p>}
        {result?.error && <p role="alert" className="text-sm text-destructive">{result.error}</p>}
        {result?.data && !verified && <p role="status" className="rounded-lg border p-4 text-sm text-muted-foreground">
          {result.data.reasons.map(stockHistoryExplanation).join(" ") || "Verified balances are unavailable for this date range."}</p>}
        {verified && <>
          <div className="max-h-[28rem] overflow-auto rounded-lg border"><Table aria-label="Verified product movement balances"
            data-stock-report-print-table={reportRows.length ? true : undefined}>
            <TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead>Product</TableHead><TableHead>Location</TableHead>
              <TableHead className="text-right">Opening stock</TableHead><TableHead className="text-right">Total stock in</TableHead>
              <TableHead className="text-right">Total stock out</TableHead><TableHead className="text-right">Closing stock</TableHead><TableHead>Details</TableHead>
            </TableRow></TableHeader>
            <TableBody>{reportRows.length ? reportRows.map(row => <TableRow key={row.productId}>
              <TableCell className="min-w-36 whitespace-normal">{row.name}{row.sku && <span className="block text-xs text-muted-foreground">{row.sku}</span>}</TableCell>
              <TableCell>{branchName}</TableCell><TableCell className="numeric text-right">{showUnits(row.openingQuantity)}</TableCell>
              <TableCell className="numeric text-right">{showUnits(row.inQuantity)}</TableCell><TableCell className="numeric text-right">{showUnits(row.outQuantity)}</TableCell>
              <TableCell className="numeric text-right">{showUnits(row.quantity)}</TableCell>
              <TableCell><Button type="button" size="sm" variant="ghost" aria-expanded={detail?.product.productId === row.productId}
                onClick={() => { setDetails(null); setMovement(detail?.product.productId === row.productId ? null : { report: reportKey, product: row, after: null, number: 1 }); }}>View movements</Button></TableCell>
            </TableRow>) : <TableRow><TableCell colSpan={7}>No matching balances on this page.</TableCell></TableRow>}</TableBody>
          </Table></div>
          {(cursor || verified.next) && <div className="flex flex-wrap gap-2">
            {cursor && <Button type="button" variant="outline" size="sm" onClick={() => setPosition(null)}>First balances page</Button>}
            {verified.next && verified.sourceRevision && <Button type="button" variant="outline" size="sm" onClick={() => setPosition({ key: rangeKey, after: verified.next!, revision: verified.sourceRevision! })}>Next balances page</Button>}
          </div>}
        </>}
      </section> : <p role="status" className="rounded-lg border p-4 text-sm text-muted-foreground">
        Choose up to {STOCK_MOVEMENT_MAX_CALENDAR_DAYS} calendar days to verify balances and totals. You can browse activity recorded for the selected dates below.
      </p>}
      {detail && <section className="space-y-3 rounded-lg border p-4" aria-labelledby={movementHeading}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 id={movementHeading} className="font-semibold">Movements for {detail.product.name}</h3>
          <Button type="button" variant="ghost" size="sm" onClick={() => setMovement(null)}>Close details</Button></div>
        {!detailResult && <p role="status" className="text-sm text-muted-foreground">Loading product movements…</p>}
        {detailResult?.error && <p role="alert" className="text-sm text-destructive">{detailResult.error}</p>}
        {detailResult?.data?.status === "complete" && <>
          {timeline && <figure><figcaption className="mb-2 text-sm text-muted-foreground">Stock quantity through the {detailResult.data.next ? "movement entries shown" : "selected date"}</figcaption>
            <div className="h-56 min-w-0" role="img" aria-label={`Stock history chart for ${detail.product.name}`}>
              <ResponsiveContainer width="100%" height="100%"><LineChart data={timeline}>
                <CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="label" minTickGap={32} tickFormatter={value => format.format(new Date(value))} />
                <YAxis allowDecimals={false} width={55} /><Tooltip labelFormatter={value => format.format(new Date(String(value)))} />
                <Line name="Stock quantity" type="stepAfter" dataKey="quantity" stroke="var(--primary)" strokeWidth={2} isAnimationActive={false} />
              </LineChart></ResponsiveContainer>
            </div></figure>}
          {breakdown && breakdown.length > 0 && <div className="overflow-auto rounded-lg border"><Table aria-label="Verified product movement totals by type">
            <TableHeader><TableRow><TableHead>Movement type</TableHead><TableHead className="text-right">Stock in</TableHead><TableHead className="text-right">Stock out</TableHead></TableRow></TableHeader>
            <TableBody>{breakdown.map(item => <TableRow key={item.kind}><TableCell>{kindLabel(item.kind)}</TableCell>
              <TableCell className="numeric text-right">{showUnits(item.incoming)}</TableCell><TableCell className="numeric text-right">{showUnits(item.outgoing)}</TableCell></TableRow>)}</TableBody>
          </Table></div>}
          {detailResult.data.rows.length > 0 ? <div className="max-h-[22rem] overflow-auto rounded-lg border"><Table aria-label="Verified movement records">
            <TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead>Effective time</TableHead><TableHead>Recorded time</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Change</TableHead></TableRow></TableHeader>
            <TableBody>{detailResult.data.rows.map(row => <TableRow key={row.id}><TableCell><StockActivityTime value={row.effectiveAt} format={format} /></TableCell>
              <TableCell><StockActivityTime value={row.recordedAt} format={format} /></TableCell><TableCell>{kindLabel(row.kind)}</TableCell><TableCell className="numeric text-right">{change(row.delta)}</TableCell></TableRow>)}</TableBody>
          </Table></div> : <p className="text-sm text-muted-foreground">No verified movements for this product in the date range.</p>}
          <div className="flex flex-wrap gap-2">
            {detail.number > 1 && <Button type="button" variant="outline" size="sm" onClick={() => setMovement({ ...detail, after: null, number: 1 })}>First movements page</Button>}
            {detailResult.data.next && <Button type="button" variant="outline" size="sm" onClick={() => setMovement({ ...detail, after: detailResult.data?.next ?? null, number: detail.number + 1 })}>Next movements page</Button>}
          </div>
        </>}
        {detailResult?.data && detailResult.data.status !== "complete" && <p role="status" className="text-sm text-muted-foreground">{detailResult.data.reasons.map(stockHistoryExplanation).join(" ") || "Verified movement details are unavailable."}</p>}
      </section>}
      <section className="space-y-3" aria-label="Recorded movement activity">
        <h3 className="font-semibold">Recorded movement activity</h3>
        <p className="text-sm text-muted-foreground">Activity shows recorded changes and references. The log can be incomplete and this reader has no transfer destination or in-transit balance.</p>
        {activity.loading && <p role="status" className="text-sm text-muted-foreground">Loading recorded activity…</p>}
        {activity.error && <p role="alert" className="text-sm text-destructive">{activity.error} <Button type="button" size="sm" variant="link" onClick={activity.firstPage}>Retry activity</Button></p>}
        {activity.page && <>
          <div className="max-h-[29rem] overflow-auto rounded-lg border"><Table aria-label="Recorded stock movements by date"
            data-stock-report-print-table={!verified && activityRange.rows.length ? true : undefined}>
            <TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead>Time</TableHead><TableHead>Product</TableHead><TableHead>Movement</TableHead>
              <TableHead className="text-right">Change</TableHead><TableHead className="text-right">Before</TableHead><TableHead className="text-right">After</TableHead><TableHead>Reference</TableHead>
            </TableRow></TableHeader>
            <TableBody>{activityRange.rows.length ? activityRange.rows.map(row => <TableRow key={row.id}>
              <TableCell><StockActivityTime value={row.occurredAt} format={format} /></TableCell><TableCell className="min-w-36 whitespace-normal">{row.productName ?? productNames.get(row.productId) ?? row.productId}</TableCell>
              <TableCell>{kindLabel(row.kind)}</TableCell><TableCell className="numeric text-right">{change(row.delta)}</TableCell>
              <TableCell className="numeric text-right">{showUnits(row.before)}</TableCell><TableCell className="numeric text-right">{showUnits(row.after)}</TableCell>
              <TableCell className="max-w-52 whitespace-normal break-all">{row.reference ?? "—"}</TableCell>
            </TableRow>) : <TableRow><TableCell colSpan={7}>No recorded movements in this date range.</TableCell></TableRow>}</TableBody>
          </Table></div>
          {(activity.number > 1 || activityRange.hasEarlierPage) && <div className="flex flex-wrap gap-2">
            {activity.number > 1 && <Button type="button" variant="outline" size="sm" disabled={activity.loading} onClick={activity.firstPage}>First activity page</Button>}
            {activityRange.hasEarlierPage && <Button type="button" variant="outline" size="sm" disabled={activity.loading} onClick={activity.nextPage}>Earlier activity</Button>}
          </div>}
        </>}
      </section>
    </>}
  </section>;
}
