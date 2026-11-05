import { receiptAdjustmentLabel } from "@/lib/report-display";
import {useSponsorshipTotals} from "@/lib/use-sponsorship-totals";
import { CashierBillList } from "@/platforms/web/components/pos/CashierBillList";
import { HomeShortcuts } from "@/platforms/web/components/pos/HomeShortcuts";
import { createCatalogueVisibility } from "@/lib/branch-policy";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useReportSales } from "@/lib/use-report-sales";
import { dashboardDailyTrading } from "@/lib/dashboard-trading";
import { allShopsScope } from "@/lib/all-shops-scope";
import { terminalRuntimePlatform } from "@/core/activation/terminal-platform";
import { FinancialBreakdown, FinancialInfoTip, GrossProfitInfo, SalesTotalInfo } from "@/platforms/web/components/pos/FinancialInfo";
import { salesReconciliation } from "@/lib/sales-reconciliation";
import { InventorySummaryCards } from "@/platforms/web/components/pos/InventorySummaryCards";
import { SummaryCardRail } from "@/platforms/web/components/pos/SummaryCardRail";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle } from "lucide-react";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money, usePos } from "@/lib/pos-store";
import { useDrawerEvents } from "@/lib/drawer-events";
import { hourlyProfit, profitOf } from "@/core/pricing/profit";
import { paymentsLabel } from "@/core/types/pos-types";
import { formatTime, posDayKey, posHour, shiftCalendarDay } from "@/lib/time-zone";
import { defaultReviewThresholds } from "@/lib/pos-seed";
import { sameBranchId } from "@/lib/branch-id";
import { cashierReviewTotals, hasSplitPayments } from "@/lib/cashier-review";
import { inventoryMetrics } from "@/lib/inventory-metrics";
import { useAuth } from "@/lib/pos-auth";
import { useVisibility } from "@/lib/ui-visibility";
import { DisplayElement } from "@/components/shared/DisplayElement";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Live Dashboard — POS" },
      {
        name: "description",
        content:
          "Real-time till dashboard: today's revenue, profit margin, peak transaction hours, drawer opens and cashiers flagged for review.",
      },
      { property: "og:title", content: "Live Dashboard — POS" },
      {
        property: "og:description",
        content: "Daily revenue, margins, peak hours and cashier review flags.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const chartDay = (value: string, fallback: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
const hasMoney = (value: number) => Number.isFinite(value) && Math.abs(value) >= 0.005;

function Dashboard() {
  const { state, currentStore, ready: inventoryReady, loadPhase } = usePos();
  const { can, canSwitchStores, terminalStoreId, user } = useAuth();
  const { visible } = useVisibility();
  const showCostMargin = can("can_view_cost_margin");
  const showStockValue = showCostMargin && visible("inventory.stockValue");
  const drawer = useDrawerEvents();
  const thresholds = defaultReviewThresholds;

  const [today, setToday] = useState(() => posDayKey());
  const [revenuePeriod, setRevenuePeriod] = useState<"7" | "14" | "30" | "90" | "month" | "custom">("14");
  const [drawerColumnsTarget, setDrawerColumnsTarget] = useState<HTMLElement | null>(null);
  const [splitColumnsTarget, setSplitColumnsTarget] = useState<HTMLElement | null>(null);
  const [customFrom, setCustomFrom] = useState(() => shiftCalendarDay(posDayKey(), -13));
  const [customTo, setCustomTo] = useState(() => posDayKey());
  useEffect(() => {
    const refresh = () => setToday(posDayKey());
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  const unrestrictedManagement = canSwitchStores && !terminalStoreId && !user?.storeId;
  const reportStores = useMemo(() => allShopsScope(state.stores, terminalStoreId || user?.storeId || currentStore.id, unrestrictedManagement), [state.stores, terminalStoreId, user?.storeId, currentStore.id, unrestrictedManagement]);
  const storeIds = useMemo(() => reportStores.map(store => store.id), [reportStores]);
  const scopeLabel = unrestrictedManagement ? "All authorized shops" : reportStores[0]?.name || currentStore.name;
  const cloudHome = terminalRuntimePlatform() === "web";
  const revenueFrom = useMemo(() => {
    if (revenuePeriod === "custom") {
      const from = chartDay(customFrom, today);
      const to = chartDay(customTo, today);
      return from <= to ? from : to;
    }
    if (revenuePeriod === "month") return `${today.slice(0, 7)}-01`;
    return shiftCalendarDay(today, 1 - Number(revenuePeriod));
  }, [revenuePeriod, customFrom, customTo, today]);
  const revenueTo = revenuePeriod === "custom"
    ? (chartDay(customFrom, today) <= chartDay(customTo, today)
        ? chartDay(customTo, today) : chartDay(customFrom, today))
    : today;
  // Today's cards still need today's sales when the selected graph range is
  // entirely historical. Extend only the read window, not the graph buckets.
  const readFrom = revenueFrom < today ? revenueFrom : today;
  const readTo = revenueTo > today ? revenueTo : today;
  // The report reader scans a generous UTC boundary and filters exact business
  // days. Date-only keys must never pass through the viewing device's timezone.
  const { sales, loading: reportLoading, error: reportError } = useReportSales(state.sales, storeIds, readFrom, readTo, storeIds.length > 0, cloudHome ? "cloud" : "auto");
  const includeSponsorship=state.settings.integrations.includeSponsorshipInDailySales===true;
  const sponsorship=useSponsorshipTotals(storeIds,readFrom,readTo,includeSponsorship);
  const todaySponsorship = useMemo(() => sponsorship.rows.filter(row => row.day === today).reduce((sum, row) => sum + Number(row.value), 0), [sponsorship.rows, today]);
  const todaySales = useMemo(() => sales.filter((s) => posDayKey(s.createdAt) === today), [sales, today]);
  const live = useMemo(() => todaySales.filter((s) => !s.refunded), [todaySales]);
  const todayTotals = useMemo(() => salesReconciliation(live), [live]);

  const revenue = useMemo(() => live.reduce((a, s) => a + s.total, 0), [live]);
  // One shared profit helper, so this never drifts from the business report.
  const profit = useMemo(() => profitOf(live, state.products), [live, state.products]);
  const margin = profit.marginPct;
  const refunds = useMemo(() => todaySales.filter((s) => s.refunded), [todaySales]);
  const catalogueVisible = useMemo(() => createCatalogueVisibility(state.settings, state.stores, state.transfers), [state.settings, state.stores, state.transfers]);
  const stock = useMemo(
    () => inventoryMetrics(state.products.filter(product => catalogueVisible(product, currentStore.id)), currentStore.id),
    [state.products, catalogueVisible, currentStore.id],
  );

  const chartSales = useMemo(() => sales.filter(sale => {
    const day = posDayKey(sale.createdAt);
    return !sale.refunded && day >= revenueFrom && day <= revenueTo;
  }), [sales, revenueFrom, revenueTo]);
  const chartProfit = useMemo(() => profitOf(chartSales, state.products), [chartSales, state.products]);

  /** Revenue against gross profit, hour by hour in the selected range. */
  const profitByHour = useMemo(
    () => hourlyProfit(chartSales, state.products, posHour),
    [chartSales, state.products],
  );

  /** Revenue for the selected inclusive calendar range. */
  const daily = useMemo(() => dashboardDailyTrading(sales, sponsorship.rows, revenueFrom, revenueTo, includeSponsorship), [sales, sponsorship.rows, revenueFrom, revenueTo, includeSponsorship]);

  /** Transactions per hour across the selected calendar range. */
  const hourly = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: `${h}:00`, bills: 0, value: 0 }));
    chartSales.forEach((s) => {
      const h = posHour(s.createdAt);
      hours[h]!.bills += 1;
      hours[h]!.value = Number((hours[h]!.value + s.total).toFixed(2));
    });
    return hours;
  }, [chartSales]);
  const peak = hourly.reduce((a, h) => (h.bills > a.bills ? h : a), hourly[0]!);

  const todayDrawer = useMemo(() => drawer.filter(
    (d) => posDayKey(d.at) === today && storeIds.some(id => sameBranchId(d.storeId, id)),
  ), [drawer, today, storeIds]);
  const splitSales = useMemo(() => live.filter(sale => hasSplitPayments(sale.payments)), [live]);

  /** Per-cashier behaviour with fixed thresholds plus relative outliers. */
  const cashiers = useMemo(() => {
    const rows = cashierReviewTotals(todaySales, todayDrawer);
    const originalTotal = rows.reduce((sum, row) => sum + row.original, 0);
    const avgDiscountPct = originalTotal > 0
      ? rows.reduce((sum, row) => sum + row.discount, 0) / originalTotal * 100
      : 0;
    return rows.map((r) => {
      const discountPct = r.discountPct;
      const flags: string[] = [];
      if (r.refunds > thresholds.maxRefunds) flags.push(`${r.refunds} refunds`);
      if (r.refundValue > thresholds.maxRefundValue) flags.push(`${money(r.refundValue)} refunded`);
      if (r.noSale > thresholds.maxNoSaleOpens) flags.push(`${r.noSale} no-sale opens`);
      if (discountPct > thresholds.maxDiscountPct)
        flags.push(`${discountPct.toFixed(1)}% discounting`);
      // Relative outlier: well above the shift average, even under the fixed cap.
      if (avgDiscountPct > 0 && discountPct > avgDiscountPct * 2)
        flags.push("discounting far above peers");
      return { ...r, discountPct, flags };
    });
  }, [todaySales, todayDrawer, thresholds]);

  const flagged = cashiers.filter((c) => c.flags.length);
  const summaryReady = inventoryReady && !reportLoading && !reportError;
  const summaryCards = [
    includeSponsorship && !sponsorship.loading && !sponsorship.error && hasMoney(todaySponsorship) && hasMoney(revenue + todaySponsorship) && <Kpi key="daily-value" label="Sales value with sponsorship · not collections" value={money(revenue + todaySponsorship)} highlight info={can("can_view_sales_reports") && <SalesTotalInfo totals={todayTotals} adjustmentLabel={receiptAdjustmentLabel(live)} sponsorshipValue={todaySponsorship} />} />,
    includeSponsorship && !sponsorship.loading && !sponsorship.error && hasMoney(todaySponsorship) && <Kpi key="sponsorship" label="Sponsorship value included" value={money(todaySponsorship)} info={<FinancialBreakdown rows={[["Sponsorship value", money(todaySponsorship)]]}><p>Included under the saved daily-sales policy. Stock value is separate from customer payments.</p></FinancialBreakdown>} />,
    hasMoney(revenue) && <Kpi key="collected" label="Sales collected today" value={money(revenue)} highlight info={can("can_view_sales_reports") && <SalesTotalInfo totals={todayTotals} adjustmentLabel={receiptAdjustmentLabel(live)} />} />,
    hasMoney(profit.revenue) && <Kpi key="net" label="Net sales before receipt adjustments (ex tax)" value={money(profit.revenue)} info={can("can_view_sales_reports") && <SalesTotalInfo totals={todayTotals} adjustmentLabel={receiptAdjustmentLabel(live)} />} />,
    showCostMargin && hasMoney(profit.cogs) && <Kpi key="cogs" label="Total COGS" value={money(profit.cogs)} info={<GrossProfitInfo revenue={profit.revenue} cost={profit.cogs} profit={profit.profit} />} />,
    showCostMargin && Math.abs(margin) >= 0.05 && <Kpi key="margin" label="Gross margin" value={`${margin.toFixed(1)}%`} info={<GrossProfitInfo revenue={profit.revenue} cost={profit.cogs} profit={profit.profit} marginPct={margin} />} />,
    live.length !== 0 && <Kpi key="bills" label="Bills" value={String(live.length)} />,
    refunds.length !== 0 && <Kpi key="refunds" label="Refunds" value={`${refunds.length} · ${money(refunds.reduce((a, s) => a + Math.abs(s.total), 0))}`} />,
    todayDrawer.length !== 0 && <Kpi key="drawer" label="No-sale drawer opens" value={String(todayDrawer.length)} />,
  ].filter(Boolean);

  return (
    <AppShell>
      <div className="pos-page-container">
        <header className="min-w-0 space-y-2">
          <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
            <h1 className="min-w-0 text-2xl font-semibold">Live dashboard · {scopeLabel}</h1>
            <HomeShortcuts />
          </div>
          <p className="text-sm text-muted-foreground page-description">
            Today&apos;s revenue, margin, peak trading hours and behaviour flags.
          </p>
        </header>


        {reportError && <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">Report incomplete: {reportError}</p>}
        {reportLoading && <p role="status" className="text-sm text-muted-foreground">Loading the complete sales history for these shops…</p>}
        {includeSponsorship && sponsorship.loading && <p role="status" className="text-sm text-muted-foreground">Sponsorship values are loading; the combined summary is not complete yet.</p>}
        {includeSponsorship && sponsorship.error && <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">Sponsorship totals could not be loaded. Sales collections remain separate.</p>}
        <DisplayElement name="dashboard.revenueSummary">{summaryReady && (summaryCards.length ? <SummaryCardRail label="Revenue summary">
          {summaryCards}
        </SummaryCardRail> : <p role="status" className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No trading totals to show today.</p>)}</DisplayElement>

        <DisplayElement name="dashboard.inventorySummary"><section className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3">
            <h2 className="text-sm font-semibold">Inventory position · {currentStore.name}</h2>
            <p className="text-xs text-muted-foreground">
              Current active catalogue and on-hand value at this branch.
            </p>
          </div>
          <InventorySummaryCards metrics={stock} ready={inventoryReady} loadPhase={loadPhase} showStockValue={showStockValue} showPotentialProfit />
        </section></DisplayElement>

        <DisplayElement name="dashboard.tradingGraphs"><Carousel
          opts={{ align: "start", containScroll: "trimSnaps" }}
          aria-label="Live dashboard graphs"
          // Keep arrow keys inside charts available for Recharts data-point navigation.
          // Touch/pointer dragging moves between cards without navigation buttons.
          onKeyDownCapture={() => undefined}
          className="min-w-0"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Trading graphs</h2>
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Trading graphs period" value={revenuePeriod}
                  onChange={(event) => setRevenuePeriod(event.target.value as typeof revenuePeriod)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs">
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="month">This month</option>
                  <option value="custom">Custom dates</option>
                </select>
                {revenuePeriod === "custom" && <>
                  <Input aria-label="Graphs from date" type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="h-8 w-36 text-xs" />
                  <Input aria-label="Graphs to date" type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="h-8 w-36 text-xs" />
                </>}
              </div>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">{revenueFrom} to {revenueTo} · applies to all trading graphs</p>
          <CarouselContent className="touch-pan-y">
          <CarouselItem className="basis-[92%] sm:basis-3/4 lg:basis-[48%] 2xl:basis-1/3">
          <section className="flex h-88 min-w-0 flex-col rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 shrink-0 text-sm font-semibold">{includeSponsorship ? "Sales value including sponsorship" : "Sales collected"}</h2>
            {includeSponsorship && <p className="mb-2 text-xs text-muted-foreground">Sponsorship is product value, not money collected.</p>}
            <div className="min-h-0 min-w-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="day" fontSize={11} stroke="var(--muted-foreground)" />
                  <YAxis fontSize={11} stroke="var(--muted-foreground)" />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="total"
                    name={includeSponsorship ? "Sales value" : "Sales collected"}
                    stroke="var(--primary)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
          </CarouselItem>

          <CarouselItem className="basis-[92%] sm:basis-3/4 lg:basis-[48%] 2xl:basis-1/3">
          <section className="flex h-88 min-w-0 flex-col rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 min-h-10 shrink-0 text-sm font-semibold">
              Transactions by hour · peak {peak.bills > 0 ? peak.hour : "—"}
            </h2>
            <div className="min-h-0 min-w-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="hour"
                    fontSize={10}
                    interval={2}
                    stroke="var(--muted-foreground)"
                  />
                  <YAxis fontSize={11} allowDecimals={false} stroke="var(--muted-foreground)" />
                  <Tooltip />
                  <Bar dataKey="bills" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
          </CarouselItem>

        {showCostMargin && <CarouselItem className="basis-[92%] sm:basis-3/4 lg:basis-[48%] 2xl:basis-1/3">
          <section className="flex h-88 min-w-0 flex-col rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 min-h-10 shrink-0 text-sm font-semibold">
            Profit by hour · gross profit {money(chartProfit.profit)}
            <FinancialInfoTip label="Selected-period gross profit"><GrossProfitInfo revenue={chartProfit.revenue} cost={chartProfit.cogs} profit={chartProfit.profit} marginPct={chartProfit.marginPct} /></FinancialInfoTip>
          </h2>
          <div className="min-h-0 min-w-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={profitByHour}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="hour" fontSize={10} interval={2} stroke="var(--muted-foreground)" />
                <YAxis fontSize={11} stroke="var(--muted-foreground)" />
                <Tooltip />
                <Bar
                  dataKey="revenue"
                  name="Revenue"
                  fill="var(--muted-foreground)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="profit"
                  name="Gross profit"
                  fill="var(--primary)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
          </CarouselItem>}

          </CarouselContent>
        </Carousel></DisplayElement>

        <DisplayElement name="dashboard.cashierReview"><section className="rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 px-5 py-3">
            <AlertTriangle className="size-4 text-warning" />
            <h2 className="text-sm font-semibold">Cashier review · today</h2>
            {flagged.length > 0 && (
              <Badge variant="outline" className="border-destructive/50 text-destructive">
                {flagged.length} flagged
              </Badge>
            )}
          </div>
          <p className="px-5 pb-3 text-xs text-muted-foreground">
            Completed sales only. Discount % = total discount ÷ original bill value before discounts.
            Final totals include applicable tax and rounding; refunded bills are shown separately.
          </p>
          <Separator />
          <div className="divide-y divide-border" aria-busy={reportLoading}>
            {cashiers.map((c) => (
              <article key={c.name} className="space-y-4 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{c.name}</h3>
                  {c.flags.length > 0 && <span className="text-xs text-destructive">Cashier review flag: {c.flags.join(" · ")}</span>}
                </div>
                <CashierBillList sales={todaySales} cashier={c.name} />
                <dl className="grid grid-cols-2 gap-3">
                  <div><dt className="text-xs text-muted-foreground">Cashier total · completed bills</dt><dd className="numeric text-base font-semibold">{money(c.revenue)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Cashier discount · completed bills</dt><dd className="numeric text-base font-semibold">{money(c.discount)} <span className="text-xs font-normal">({c.discountPct.toFixed(1)}%)</span></dd></div>
                </dl>
                <details className="rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium">More totals</summary>
                  <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div><dt className="text-xs text-muted-foreground">Completed bills</dt><dd className="numeric text-sm">{c.bills}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Original bill value</dt><dd className="numeric text-sm">{money(c.original)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Refunds</dt><dd className="numeric text-sm">{c.refunds} · {money(c.refundValue)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">No-sale drawer opens</dt><dd className="numeric text-sm">{c.noSale}</dd></div>
                  </dl>
                </details>
              </article>
            ))}
            {!cashiers.length && <p className="p-6 text-center text-sm text-muted-foreground">{reportLoading ? "Loading cashier review…" : "No trading recorded today."}</p>}
          </div>
        </section></DisplayElement>

        <DisplayElement name="dashboard.drawerHistory"><section className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between gap-2 px-5 py-3"><h2 className="min-w-0 flex-1 text-sm font-semibold">Cash drawer opens without a sale</h2><div ref={setDrawerColumnsTarget} className="ml-auto flex shrink-0 items-center justify-end" /></div>
          <Separator />
          <Table tableId="routes/dashboard#1" loading={reportLoading} controlsTarget={drawerColumnsTarget}>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Approved by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {todayDrawer.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="text-muted-foreground">{formatTime(d.at)}</TableCell>
                  <TableCell>
                    {d.staffName}{" "}
                    <span className="text-[11px] text-muted-foreground">({d.role})</span>
                  </TableCell>
                  <TableCell>{d.reason}</TableCell>
                  <TableCell className="text-muted-foreground">{d.note || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{d.approvedBy ?? "—"}</TableCell>
                </TableRow>
              ))}
              {!todayDrawer.length && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    The drawer has not been opened outside a sale today.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </section></DisplayElement>

        <DisplayElement name="dashboard.splitPayments"><section className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between gap-2 px-5 pt-3"><h2 className="min-w-0 flex-1 text-sm font-semibold">Split payments today</h2><div ref={setSplitColumnsTarget} className="ml-auto flex shrink-0 items-center justify-end" /></div>
          <p className="px-5 pb-3 pt-1 text-xs text-muted-foreground">Bills paid in two or more parts, such as cash and card.</p>
          <Separator />
          <Table tableId="routes/dashboard#2" loading={reportLoading} controlsTarget={splitColumnsTarget}>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Tenders</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {splitSales.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="numeric">{s.receiptNo}</TableCell>
                  <TableCell className="text-muted-foreground">{formatTime(s.createdAt)}</TableCell>
                  <TableCell>{paymentsLabel(s.payments)}</TableCell>
                  <TableCell className="numeric text-right">{money(s.total)}</TableCell>
                </TableRow>
              ))}
              {!splitSales.length && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    No split-tender bills today.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </section></DisplayElement>
      </div>
    </AppShell>
  );
}

function Kpi({
  label,
  value,
  highlight,
  danger,
  info,
}: {
  label: string;
  value: ReactNode;
  highlight?: boolean;
  danger?: boolean;
  info?: ReactNode;
}) {
  return (
    <div className="summary-card flex h-full min-h-24 min-w-0 snap-start flex-col rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex min-h-10 items-start justify-between gap-1">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        {info && <FinancialInfoTip label={label}>{info}</FinancialInfoTip>}
      </div>
      <p
        className={`numeric mt-auto min-w-0 pt-1 text-xl font-semibold [overflow-wrap:anywhere] ${highlight ? "text-primary" : ""} ${danger ? "text-destructive" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
