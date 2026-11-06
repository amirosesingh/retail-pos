import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "@/lib/pos-store";
import type { StoreDayRow } from "@/lib/analytics-board";
import { comparisonGrain, comparisonHourPoints, comparisonPoints, comparisonShopSeries, type ComparisonPoint, type ComparisonShop, type FinancialShopRow, type StoreHourRow } from "@/lib/shop-comparison";
import { canonicalBranchId } from "@/lib/branch-id";
import { ANALYTICS_COLORS, compactChartNumber } from "@/lib/analytics-design";
import { TradingChartCard, TradingChartGrid } from "./TradingChartLayout";

const hasValue = (data: readonly ComparisonPoint[], keys: readonly string[]) =>
  data.some(point => keys.some(key => typeof point[key] === "number" && Math.abs(point[key] as number) >= 0.005));

/** Presentation of already confirmed, authorized rows; controls issue no database reads. */
export function ShopComparisonCharts({ rows, directory, selectedIds, showProfit, grain = "daily", scopeLabel,
  transactionHours, profitHours, hourlyError, financialRows, range, children }:
  { rows: readonly StoreDayRow[]; directory: readonly ComparisonShop[]; selectedIds: readonly string[];
    showProfit: boolean; grain?: "daily" | "monthly"; scopeLabel: string;
    transactionHours?: readonly StoreHourRow[]; profitHours?: readonly StoreHourRow[] | null;
    hourlyError?: string; financialRows?: readonly FinancialShopRow[]; range?: { from: string; to: string }; children?: ReactNode }) {
  const [grouping, setGrouping] = useState(grain);
  const [kind, setKind] = useState<"line" | "bar">("line");
  const [financialView, setFinancialView] = useState<"compare" | "revenue" | "cost" | "profit" | "marginPct">("compare");
  const effectiveFinancialView = showProfit ? financialView : "revenue";
  const effectiveGrain = useMemo(() => comparisonGrain(rows, grouping, range), [rows, grouping, range]);
  const series = useMemo(() => comparisonShopSeries(directory), [directory]);
  const selected = new Set(selectedIds.map(canonicalBranchId));
  const shown = series.filter(shop => selected.has(shop.id));
  const keys = shown.map(shop => shop.key);
  const revenue = useMemo(() => comparisonPoints(rows, series, selectedIds, "revenue", effectiveGrain, range), [rows, series, selectedIds, effectiveGrain, range]);
  const profit = useMemo(() => comparisonPoints(rows, series, selectedIds, "profit", effectiveGrain, range), [rows, series, selectedIds, effectiveGrain, range]);
  const transactions = useMemo(() => comparisonHourPoints(transactionHours ?? [], series, selectedIds, "bills"), [transactionHours, series, selectedIds]);
  const hourlyProfit = useMemo(() => comparisonHourPoints(profitHours ?? [], series, selectedIds, "profit"), [profitHours, series, selectedIds]);
  const financial = (financialRows ?? []).filter(row => selected.has(canonicalBranchId(row.id)));
  const financialVisible = financial.some(row => Math.abs(row.revenue) >= 0.005 ||
    (showProfit && (Math.abs(row.cost) >= 0.005 || Math.abs(row.profit) >= 0.005)));
  const legend = <ul aria-label="Shop colors" className="flex flex-wrap gap-x-4 gap-y-2">{shown.map(shop =>
    <li key={shop.id} className="flex min-w-0 items-center gap-1.5"><span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: shop.color }} /><span className="break-words">{shop.name}</span></li>)}</ul>;
  const axes = (hourly = false, counts = false) => <><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
    <XAxis dataKey="label" fontSize={11} minTickGap={24} interval={hourly ? 3 : "preserveStartEnd"} />
    <YAxis fontSize={11} width={58} allowDecimals={!counts} tickFormatter={compactChartNumber} />
    <Tooltip formatter={value => counts ? Number(value ?? 0).toLocaleString() : money(Number(value ?? 0))} /></>;
  const plot = (data: ComparisonPoint[], hourly = false, counts = false) =>
    <ResponsiveContainer width="100%" height="100%">
      {hourly || kind === "bar" ? <BarChart data={data}>{axes(hourly, counts)}{shown.map(shop =>
        <Bar key={shop.id} dataKey={shop.key} name={shop.name} fill={shop.color} maxBarSize={28} isAnimationActive={false} />)}</BarChart>
        : <LineChart data={data}>{axes()}{shown.map(shop =>
          <Line key={shop.id} dataKey={shop.key} name={shop.name} stroke={shop.color} strokeWidth={2.5} dot={false} isAnimationActive={false} />)}</LineChart>}
    </ResponsiveContainer>;
  const revenueVisible = hasValue(revenue, keys), profitVisible = showProfit && hasValue(profit, keys);
  const transactionsVisible = !!transactionHours && hasValue(transactions, keys);
  const hourlyProfitVisible = showProfit && !!profitHours && hasValue(hourlyProfit, keys);
  const description = `${scopeLabel} · ${effectiveGrain === "daily" ? "Daily" : "Monthly"}${effectiveGrain !== grouping ? " (long range)" : ""} · net sales exclude tax and rounding`;
  return <section className="min-w-0 space-y-3" aria-label="Shop comparison charts">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <p className="text-muted-foreground">{scopeLabel} · Scroll vertically for more graphs.</p>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Shop chart grouping" value={grouping} onChange={event => setGrouping(event.target.value as "daily" | "monthly")} className="h-9 rounded-md border border-input bg-background px-2 text-xs">
          <option value="daily">Daily</option><option value="monthly">Monthly</option>
        </select>
        <select aria-label="Shop comparison chart" value={kind} onChange={event => setKind(event.target.value as "line" | "bar")} className="h-9 rounded-md border border-input bg-background px-2 text-xs">
          <option value="line">Line</option><option value="bar">Bar</option>
        </select>
      </div>
    </div>
    {showProfit && hourlyError && <p role="status" className="text-xs text-muted-foreground">Hourly gross profit unavailable: {hourlyError} Daily figures remain separate.</p>}
    <TradingChartGrid label={`${scopeLabel} trading graphs`}>
      {revenueVisible && <TradingChartCard title="Revenue trend" description={description} footer={legend}>{plot(revenue)}</TradingChartCard>}
      {profitVisible && <TradingChartCard title="Gross profit trend" description={description} footer={legend}>{plot(profit)}</TradingChartCard>}
      {financialVisible && <TradingChartCard title="Financial performance by shop" description={showProfit ? "Cost + gross profit = net revenue. Margin % uses the right axis." : "Net revenue for the selected shops and dates."}
        controls={<select aria-label="Financial chart measure" value={effectiveFinancialView} onChange={event => setFinancialView(event.target.value as typeof financialView)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
          {([['compare', 'Compare'], ['revenue', 'Revenue'], ['cost', 'Cost'], ['profit', 'Gross profit'], ['marginPct', 'Margin %']] as const)
            .filter(([value]) => showProfit || value === "revenue").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>}
        footer={showProfit && (effectiveFinancialView === "compare" || effectiveFinancialView === "marginPct") &&
          <ul aria-label="Gross margin by shop" className="flex flex-wrap gap-x-4 gap-y-1">{financial.filter(row => Number.isFinite(row.marginPct)).map(row =>
            <li key={row.id} className="min-w-0 break-words">{row.name} · <span className="numeric whitespace-nowrap">{row.marginPct.toFixed(1)}% margin</span></li>)}</ul>}>
        <ResponsiveContainer width="100%" height="100%"><ComposedChart data={financial}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={11} minTickGap={20} />
          <YAxis yAxisId="money" width={58} fontSize={11} tickFormatter={compactChartNumber} />
          {showProfit && (effectiveFinancialView === "compare" || effectiveFinancialView === "marginPct") && <YAxis yAxisId="margin" orientation="right" unit="%" width={44} fontSize={11} />}
          <Tooltip formatter={(value, name) => name === "Margin %" ? `${Number(value ?? 0).toFixed(1)}%` : money(Number(value ?? 0))} />
          {effectiveFinancialView === "compare" ? <><Bar yAxisId="money" dataKey="cost" stackId="net-revenue" name="Cost" fill={ANALYTICS_COLORS.cost} maxBarSize={40} isAnimationActive={false} />
            <Bar yAxisId="money" dataKey="profit" stackId="net-revenue" name="Gross profit" fill={ANALYTICS_COLORS.profit} maxBarSize={40} isAnimationActive={false} />
            <Line yAxisId="margin" dataKey="marginPct" name="Margin %" stroke={ANALYTICS_COLORS.margin} strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} /></>
            : effectiveFinancialView === "marginPct" ? <Line yAxisId="margin" dataKey="marginPct" name="Margin %" stroke={ANALYTICS_COLORS.margin} strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
              : <Bar yAxisId="money" dataKey={effectiveFinancialView} name={effectiveFinancialView === "profit" ? "Gross profit" : effectiveFinancialView === "cost" ? "Cost" : "Net revenue"}
                fill={effectiveFinancialView === "profit" ? ANALYTICS_COLORS.profit : effectiveFinancialView === "cost" ? ANALYTICS_COLORS.cost : ANALYTICS_COLORS.revenue} maxBarSize={40} isAnimationActive={false} />}
        </ComposedChart></ResponsiveContainer>
      </TradingChartCard>}
      {transactionsVisible && <TradingChartCard title="Transactions by hour" description={`${scopeLabel} · completed bills by actual trading hour across the selected dates`} footer={legend}>{plot(transactions, true, true)}</TradingChartCard>}
      {hourlyProfitVisible && <TradingChartCard title="Gross profit by hour" description={`${scopeLabel} · net revenue less reported item cost, by recorded trading hour`} footer={legend}>{plot(hourlyProfit, true)}</TradingChartCard>}
      {children}
    </TradingChartGrid>
    {!revenueVisible && !profitVisible && !financialVisible && !transactionsVisible && !hourlyProfitVisible && !children &&
      <p role="status" className="text-sm text-muted-foreground">No trading values to graph in this scope and date range.</p>}
  </section>;
}
