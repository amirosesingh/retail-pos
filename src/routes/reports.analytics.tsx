import { useChartTransition } from "@/lib/use-chart-transition";
import { useAuth } from "@/lib/pos-auth";
import { ReportTable as Table } from "@/platforms/web/components/pos/report-kit";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { ChartPlotScope, TradingTooltip, TradingChartCard, TradingChartGrid } from "@/platforms/web/components/pos/TradingChartLayout";
import { ConfirmedMetricCards } from "@/platforms/web/components/pos/ConfirmedMetricCards";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money, usePos } from "@/lib/pos-store";
import { savingsOf, soldLines, sumLines } from "@/lib/sales-analytics";
import { pageDataScope } from "@/lib/page-data-cache";
import { useConfirmedPresentation } from "@/lib/use-confirmed-presentation";
import { canonicalBranchId } from "@/lib/branch-id";
import { comparisonShopSeries } from "@/lib/shop-comparison";
import { useReportSales } from "@/lib/use-report-sales";
import { saleNetRevenue } from "@/core/pricing/profit";
import {
  ReportHeader,
  StatCard,
  defaultRange,
  inRange,
  isoDay,
} from "@/platforms/web/components/pos/report-kit";
import { branchDisplayName } from "@/lib/human-readable";
import { ANALYTICS_COLORS, compactChartNumber } from "@/lib/analytics-design";

export const Route = createFileRoute("/reports/analytics")({
  head: () => ({
    meta: [
      { title: "Business Analytics Board — Retail" },
      {
        name: "description",
        content:
          "Top selling items, revenue share per shop, daily and monthly revenue with averages, discounts given away and gross profit per branch.",
      },
      { property: "og:title", content: "Business Analytics Board — Retail" },
      {
        property: "og:description",
        content: "Top items, revenue per shop, daily and monthly trends, savings and profit.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AnalyticsBoard,
});

const monthKey = (iso: string) => isoDay(new Date(iso)).slice(0, 7);
const tooltipStyle = {
  background: "var(--card)",
  color: "var(--card-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  maxWidth: 280,
};

function AnalyticsBoard() {
  const { can, ready: authReady, user } = useAuth();
  const showCostMargin = can('can_view_cost_margin');
  const { state, stores, ready: databaseReady } = usePos();
  const init = defaultRange(30);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [topBy, setTopBy] = useState<"revenue" | "units">("revenue");
  const history = useReportSales(
    state.sales,
    stores.map((store) => store.id),
    from,
    to,
  );
  const [trend, setTrend] = useState<"daily" | "monthly">("daily");
  const reportScope = authReady && user ? JSON.stringify([pageDataScope(user), stores.map(store => store.id).sort(), from, to]) : null;
  const reportData=useMemo(()=>({sales:history.sales,products:state.products}),[history.sales,state.products]);
  const confirmedReport = useConfirmedPresentation(reportScope, reportData, databaseReady && !history.loading && !history.error);
  const shopColors = useMemo(() => new Map(comparisonShopSeries(state.stores ?? stores).map(shop => [shop.id, shop.color])), [state.stores, stores]);


  const bills = useMemo(
    () => (confirmedReport?.sales ?? []).filter((s) => inRange(s.createdAt, from, to) && !s.refunded),
    [confirmedReport, from, to],
  );
  const lines = useMemo(() => soldLines(bills, confirmedReport?.products ?? []), [bills, confirmedReport]);
  const totals = useMemo(()=>sumLines(lines),[lines]);
  const savings = useMemo(()=>savingsOf(bills, lines),[bills,lines]);
  const storeName = useCallback(
    (id: string) => branchDisplayName(stores, id, "Unassigned branch"),
    [stores],
  );

  const topItems = useMemo(() => {
    const by = new Map<string, { name: string; revenue: number; units: number }>();
    for (const l of lines) {
      const key = l.productId || l.name;
      const cur = by.get(key) ?? { name: l.name, revenue: 0, units: 0 };
      cur.revenue += l.revenue;
      cur.units += l.qty;
      by.set(key, cur);
    }
    return [...by.values()]
      .map((x) => ({ ...x, revenue: Math.round(x.revenue * 100) / 100 }))
      .sort((a, b) => b[topBy] - a[topBy])
      .slice(0, 10);
  }, [lines, topBy]);

  const byStore = useMemo(() => {
    const by = new Map<string, { id: string; name: string; revenue: number; cost: number }>();
    for (const l of lines) {
      const cur = by.get(l.storeId) ?? {
        id: l.storeId,
        name: storeName(l.storeId),
        revenue: 0,
        cost: 0,
      };
      cur.revenue += l.revenue;
      cur.cost += l.cost;
      by.set(l.storeId, cur);
    }
    return [...by.values()]
      .map((s) => ({
        ...s,
        revenue: Math.round(s.revenue * 100) / 100,
        cost: Math.round(s.cost * 100) / 100,
        profit: Math.round((s.revenue - s.cost) * 100) / 100,
        marginPct: s.revenue ? ((s.revenue - s.cost) / s.revenue) * 100 : 0,
        sharePct: 0,
      }))
      .map((s) => ({ ...s, sharePct: totals.revenue ? (s.revenue / totals.revenue) * 100 : 0 }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [lines, totals.revenue, storeName]);

  const series = useMemo(() => {
    const by = new Map<string, number>();
    for (const s of bills) {
      const key = trend === "daily" ? isoDay(new Date(s.createdAt)) : monthKey(s.createdAt);
      by.set(key, (by.get(key) ?? 0) + saleNetRevenue(s));
    }
    return [...by.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 }));
  }, [bills, trend]);

  const graphAuthority=authReady&&user?JSON.stringify([pageDataScope(user),stores.map(store=>store.id).sort(),showCostMargin]):null;
  const graphTarget=JSON.stringify([{from,to},topBy,trend]);
  const graphRaw=useMemo(()=>({topItems,byStore,series,savings,topBy,trend,range:{from,to}}),[topItems,byStore,series,savings,topBy,trend,from,to]);
  const graphFrame=useConfirmedPresentation(graphAuthority,graphRaw,!!confirmedReport);
  const graphIncoming=useMemo(()=>confirmedReport?{key:graphTarget,value:graphRaw,signature:JSON.stringify(graphRaw)}:null,[confirmedReport,graphTarget,graphRaw]);
  const graphTransition=useChartTransition(graphAuthority,graphTarget,graphIncoming);
  const graphs=graphTransition.data??graphFrame;

  const dayCount = new Set(bills.map((s) => isoDay(new Date(s.createdAt)))).size || 1;
  const monthCount = new Set(bills.map((s) => monthKey(s.createdAt))).size || 1;
  const revenue = Math.round(bills.reduce((a, s) => a + saleNetRevenue(s), 0) * 100) / 100;

  return (
    <AppShell>
      <div className="pos-page-container">
        <ReportHeader
          title="Business Analytics"
          subtitle="Top sellers, shop performance, trends, savings and profit for your accessible shops and selected dates."
          from={from}
          to={to}
          onFrom={setFrom}
          onTo={setTo}
        />

        {history.loading ? (
          <p className="text-sm text-muted-foreground">Updating report data…</p>
        ) : null}
        {history.error ? <p className="text-sm text-destructive">{history.error}</p> : null}

        <ConfirmedMetricCards label="Business analytics totals" scope={JSON.stringify([from,to,stores.map(store=>store.id).sort()])} ready={!history.loading && !history.error}>
          <StatCard
            tone="revenue"
            label="Revenue" metricValue={revenue} moneyValue
            value={money(revenue)}
            hint={`${bills.length} completed bills · before tax`}
          />
          <StatCard
            label="Avg / day" metricValue={revenue / dayCount} moneyValue
            tone="revenue"
            value={money(revenue / dayCount)}
            hint={`${dayCount} trading days`}
          />
          <StatCard
            label="Avg / month" metricValue={revenue / monthCount} moneyValue
            tone="revenue"
            value={money(revenue / monthCount)}
            hint={`${monthCount} months`}
          />
          <StatCard
            label="Gross profit" metricValue={showCostMargin ? totals.profit : 0} moneyValue
            tone={showCostMargin && totals.profit < 0 ? "loss" : "profit"}
            value={showCostMargin ? money(totals.profit) : "Restricted"}
            hint={showCostMargin ? `${totals.marginPct.toFixed(1)}% margin` : "Cost-view permission required"}
          />
          <StatCard
            label="Given away" metricValue={savings.total} moneyValue
            tone="discount"
            value={money(savings.total)}
            hint="Discounts, coupons and free items"
          />
        </ConfirmedMetricCards>

        <section
          aria-label="Analytics color meanings"
          className="flex flex-wrap gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 text-xs"
        >
          {(
            [
              ["revenue", "Revenue"],
              ["profit", "Profit"],
              ["cost", "Cost"],
              ["discount", "Discounts / giveaways"],
              ["units", "Units sold"],
              ["loss", "Loss / negative result"],
            ] as const
          ).map(([key, label]) => (
            <span key={key} className="inline-flex items-center gap-2">
              <span
                className="size-2.5 rounded-full"
                style={{ background: ANALYTICS_COLORS[key] }}
              />
              {label}
            </span>
          ))}
        </section>
        {!bills.length && !history.loading && !history.error && (
          <p
            role="status"
            className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground"
          >
            No completed sales in this date range. Choose different dates in Filters.
          </p>
        )}

        <ConfirmedMetricCards label="Discount and giveaway totals" scope={JSON.stringify([from,to,stores.map(store=>store.id).sort()])} ready={!history.loading && !history.error}>
              <StatCard
                tone="discount"
                label="Item discounts" metricValue={savings.lineDiscount} moneyValue
                value={money(savings.lineDiscount)}
              />
              <StatCard
                tone="discount"
                label="Bill discounts" metricValue={savings.billDiscount} moneyValue
                value={money(savings.billDiscount)}
              />
              <StatCard tone="discount" label="Coupons & vouchers" metricValue={savings.coupon} moneyValue value={money(savings.coupon)} />
              <StatCard tone="discount" label="Free items" metricValue={savings.focValue} moneyValue value={money(savings.focValue)} />
            </ConfirmedMetricCards>
        {graphs && <ChartPlotScope phase={graphTransition.phase} stamp={graphTransition.stamp} previousLabel={graphTransition.data?`${graphTransition.data.range.from} to ${graphTransition.data.range.to}`:undefined}>
        <TradingChartGrid label="Business analytics graphs">
          {graphs.topItems.length > 0 && <TradingChartCard title="Top selling items" controls={<div className="flex gap-1">
                <Button
                  size="sm"
                  variant={topBy === "revenue" ? "default" : "outline"}
                  onClick={() => setTopBy("revenue")}
                >
                  Revenue
                </Button>
                <Button
                  size="sm"
                  variant={topBy === "units" ? "default" : "outline"}
                  onClick={() => setTopBy("units")}
                >
                  Units
                </Button>
              </div>}>
            <div className="trading-chart-scroll h-full overflow-y-auto overscroll-contain" tabIndex={0} aria-label="Top selling items chart">
            <ResponsiveContainer
              width="100%"
              height={Math.max(240, graphs.topItems.length * 36)}
              minWidth={0}
            >
              <BarChart data={graphs.topItems} layout="vertical" margin={{ left: 24, right: 16 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  fontSize={12}
                  tickFormatter={compactChartNumber}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={110}
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) =>
                    String(value).length > 18 ? String(value).slice(0, 17) + "…" : String(value)
                  }
                />
                <TradingTooltip
                  contentStyle={tooltipStyle}
                  itemStyle={{ color: "var(--card-foreground)" }}
                  formatter={(v) =>
                    graphs.topBy === "revenue" ? money(Number(v ?? 0)) : `${Number(v ?? 0)} units`
                  }
                />
                <Bar
                  isAnimationActive={false}
                  name={graphs.topBy === "revenue" ? "Net revenue" : "Units sold"}
                  dataKey={graphs.topBy}
                  fill={graphs.topBy === "revenue" ? ANALYTICS_COLORS.revenue : ANALYTICS_COLORS.units}
                  radius={[0, 5, 5, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
            </div>

          </TradingChartCard>}
          {graphs.byStore.some(shop => Math.abs(shop.revenue) >= 0.005) && <TradingChartCard title="Revenue by shop" footer={<><p className="mb-2 text-xs text-muted-foreground">
              Colors identify branches and stay the same when their ranking changes.
            </p>
            <ul tabIndex={0} aria-label="Shop revenue shares" className=" space-y-2 text-xs">
              {graphs.byStore.map((shop) => (
                <li key={shop.id} className="flex min-w-0 items-start gap-2">
                  <span
                    className="mt-1.5 size-2.5 shrink-0 rounded-full"
                    style={{ background: shopColors.get(canonicalBranchId(shop.id)) }}
                  />
                  <span className="min-w-0 flex-1 break-words">{shop.name}</span>
                  <span className="shrink-0 tabular-nums">{money(shop.revenue)} · {shop.sharePct.toFixed(1)}%</span>
                </li>
              ))}
            </ul></>}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <PieChart>
                <Pie
                  isAnimationActive={false}
                  data={graphs.byStore}
                  dataKey="revenue"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={88}
                  paddingAngle={2}
                  cornerRadius={4}
                >
                  {graphs.byStore.map((s) => (
                    <Cell key={s.id} fill={shopColors.get(canonicalBranchId(s.id))} />
                  ))}
                </Pie>
                <TradingTooltip
                  contentStyle={tooltipStyle}
                  itemStyle={{ color: "var(--card-foreground)" }}
                  formatter={(v) => money(Number(v ?? 0))}
                />
              </PieChart>
            </ResponsiveContainer>
          </TradingChartCard>}
          {graphs.series.some(row => Math.abs(row.value) >= 0.005) && <TradingChartCard title={trend === "daily" ? "Daily revenue" : "Monthly revenue"} controls={<div className="flex gap-1">
              <Button
                size="sm"
                variant={trend === "daily" ? "default" : "outline"}
                onClick={() => setTrend("daily")}
              >
                Daily
              </Button>
              <Button
                size="sm"
                variant={trend === "monthly" ? "default" : "outline"}
                onClick={() => setTrend("monthly")}
              >
                Monthly
              </Button>
            </div>}>
          <ResponsiveContainer width="100%" height="100%">
            {graphs.trend === "daily" ? (
              <BarChart data={graphs.series}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  fontSize={12}
                  minTickGap={30}
                  interval="preserveStartEnd"
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  fontSize={12}
                  tickFormatter={compactChartNumber}
                  tickLine={false}
                  axisLine={false}
                />
                <TradingTooltip
                  contentStyle={tooltipStyle}
                  itemStyle={{ color: "var(--card-foreground)" }}
                  formatter={(v) => money(Number(v ?? 0))}
                />
                <Bar
                  isAnimationActive={false}
                  name="Net revenue"
                  dataKey="value"
                  fill={ANALYTICS_COLORS.revenue}
                  radius={[5, 5, 0, 0]}
                />
              </BarChart>
            ) : (
              <LineChart data={graphs.series}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  fontSize={12}
                  minTickGap={30}
                  interval="preserveStartEnd"
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  fontSize={12}
                  tickFormatter={compactChartNumber}
                  tickLine={false}
                  axisLine={false}
                />
                <TradingTooltip
                  contentStyle={tooltipStyle}
                  itemStyle={{ color: "var(--card-foreground)" }}
                  formatter={(v) => money(Number(v ?? 0))}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={ANALYTICS_COLORS.revenue}
                  name="Net revenue"
                  isAnimationActive={false}
                  strokeWidth={2}
                  strokeLinecap="round" strokeLinejoin="round"
                  dot={false}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
          </TradingChartCard>}
          {Math.abs(graphs.savings.total) >= 0.005 && <TradingChartCard title="What we gave away" description="Discounts, coupons and free items for the selected dates.">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  { label: "Item", value: graphs.savings.lineDiscount },
                  { label: "Bill", value: graphs.savings.billDiscount },
                  { label: "Coupons", value: graphs.savings.coupon },
                  { label: "Free items", value: graphs.savings.focValue },
                ]}
              >
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  fontSize={12}
                  minTickGap={30}
                  interval="preserveStartEnd"
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  fontSize={12}
                  tickFormatter={compactChartNumber}
                  tickLine={false}
                  axisLine={false}
                />
                <TradingTooltip
                  contentStyle={tooltipStyle}
                  itemStyle={{ color: "var(--card-foreground)" }}
                  formatter={(v) => money(Number(v ?? 0))}
                />
                <Bar
                  isAnimationActive={false}
                  name="Given away"
                  dataKey="value"
                  fill={ANALYTICS_COLORS.discount}
                  radius={[5, 5, 0, 0]}
                >{[ANALYTICS_COLORS.revenue,ANALYTICS_COLORS.cost,ANALYTICS_COLORS.discount,ANALYTICS_COLORS.margin].map((color,index)=><Cell key={index} fill={color}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </TradingChartCard>}
        </TradingChartGrid>
        </ChartPlotScope>}
        <div>
          <section className="min-w-0 rounded-2xl border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Profit by shop</h2>
            <Table tableId="routes/reports.analytics#1" loading={history.loading}>
              <TableHeader>
                <TableRow>
                  <TableHead>Shop</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byStore.map((s) => (
                  <TableRow key={s.name}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="numeric text-right">{money(s.revenue)}</TableCell>
                    <TableCell className="numeric text-right">{s.sharePct.toFixed(1)}%</TableCell>
                    <TableCell className="numeric text-right">{showCostMargin ? money(s.cost) : "Restricted"}</TableCell>
                    <TableCell
                      className={
                        "numeric text-right font-semibold " +
                        (showCostMargin ? (s.profit < 0 ? "text-destructive" : "text-success") : "text-muted-foreground")
                      }
                    >
                      {showCostMargin ? money(s.profit) : "Restricted"}
                    </TableCell>
                    <TableCell className="numeric text-right">{showCostMargin ? `${s.marginPct.toFixed(1)}%` : "Restricted"}</TableCell>
                  </TableRow>
                ))}
                {!byStore.length && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No sales in this window.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
