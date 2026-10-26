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
import { SalesReconciliation } from "@/platforms/web/components/pos/SalesReconciliation";
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
import { AnimatedMetric } from "@/platforms/web/components/pos/AnimatedMetric";
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

function Dashboard() {
  const { state, currentStore } = usePos();
  const { can, canSwitchStores, terminalStoreId, user } = useAuth();
  const { visible } = useVisibility();
  const showCostMargin = can("can_view_cost_margin");
  const showStockValue = showCostMargin && visible("inventory.stockValue");
  const drawer = useDrawerEvents();
  const thresholds = defaultReviewThresholds;

  const [today, setToday] = useState(() => posDayKey());
  const [revenuePeriod, setRevenuePeriod] = useState<"7" | "14" | "30" | "90" | "month" | "custom">("14");
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
  const chartSponsorship = useMemo(() => includeSponsorship && !sponsorship.error ? sponsorship.rows.filter(row => row.day >= revenueFrom && row.day <= revenueTo).reduce((sum, row) => sum + Number(row.value), 0) : 0, [includeSponsorship, sponsorship.error, sponsorship.rows, revenueFrom, revenueTo]);

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
        <DisplayElement name="dashboard.revenueSummary"><div role="region" aria-label="Revenue summary" tabIndex={0} className="dashboard-swipe-row no-scrollbar grid min-w-0 grid-flow-col auto-cols-[minmax(10rem,72%)] snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:grid-flow-row md:auto-cols-auto md:grid-cols-4 md:overflow-visible xl:grid-cols-7">
          {includeSponsorship && !sponsorship.loading && !sponsorship.error && todaySponsorship > 0 && <><Kpi label="Daily sales value" value={money(revenue+todaySponsorship)} highlight/><Kpi label="Sponsorship value included" value={money(todaySponsorship)}/></>}
          <Kpi label="Sales collected today" value={money(revenue)} highlight />
          <Kpi label="Net sales excluding tax" value={money(profit.revenue)} />
          {showCostMargin && <Kpi label="Total COGS" value={money(profit.cogs)} />}
          {showCostMargin && <Kpi label="Gross margin" value={`${margin.toFixed(1)}%`} />}
          <Kpi label="Bills" value={String(live.length)} />
          <Kpi
            label="Refunds"
            value={`${refunds.length} · ${money(refunds.reduce((a, s) => a + Math.abs(s.total), 0))}`}
          />
          <Kpi label="No-sale drawer opens" value={String(todayDrawer.length)} />
        </div></DisplayElement>

        {can("can_view_sales_reports") && <DisplayElement name="dashboard.tradingGraphs"><SalesReconciliation sales={chartSales} sponsorshipValue={chartSponsorship} title={`Sales breakdown · ${revenueFrom} to ${revenueTo}`} /></DisplayElement>}

        <DisplayElement name="dashboard.inventorySummary"><section className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3">
            <h2 className="text-sm font-semibold">Inventory position · {currentStore.name}</h2>
            <p className="text-xs text-muted-foreground">
              Current active catalogue and on-hand value at this branch.
            </p>
          </div>
          <div role="region" aria-label="Inventory summary" tabIndex={0} className="dashboard-swipe-row no-scrollbar grid min-w-0 grid-flow-col auto-cols-[minmax(9rem,65%)] snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:grid-flow-row md:auto-cols-auto md:grid-cols-4 md:overflow-visible xl:grid-cols-8">
            <Kpi label="Products" value={<AnimatedMetric value={stock.products} />} />
            <Kpi label="Categories" value={<AnimatedMetric value={stock.categories} />} />
            <Kpi label="On-hand units" value={<AnimatedMetric value={stock.units} />} />
            <Kpi label="Low stock" value={<AnimatedMetric value={stock.lowStock} />} />
            <Kpi
              label="Negative stock"
              value={<AnimatedMetric value={stock.negativeStock} />}
              danger={stock.negativeStock > 0}
            />
            {showStockValue && (
              <>
                <Kpi label="Cost value" value={money(stock.costValue)} />
                <Kpi label="Retail value" value={money(stock.retailValue)} />
                <Kpi label="Potential profit" value={money(stock.potentialProfit)} highlight />
              </>
            )}
          </div>
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
          <h2 className="px-5 py-3 text-sm font-semibold">Cash drawer opens without a sale</h2>
          <Separator />
          <Table tableId="routes/dashboard#1" loading={reportLoading}>
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
          <h2 className="px-5 pt-3 text-sm font-semibold">Split payments today</h2>
          <p className="px-5 pb-3 pt-1 text-xs text-muted-foreground">Bills paid in two or more parts, such as cash and card.</p>
          <Separator />
          <Table tableId="routes/dashboard#2" loading={reportLoading}>
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
}: {
  label: string;
  value: ReactNode;
  highlight?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="summary-card min-w-0 snap-start rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`numeric text-xl font-semibold ${highlight ? "text-primary" : ""} ${danger ? "text-destructive" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
