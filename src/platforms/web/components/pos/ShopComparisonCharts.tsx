import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "@/lib/pos-store";
import type { StoreDayRow } from "@/lib/analytics-board";
import { comparisonGrain, comparisonPoints, comparisonShopSeries, type ComparisonShop } from "@/lib/shop-comparison";
import { canonicalBranchId } from "@/lib/branch-id";
import { compactChartNumber } from "@/lib/analytics-design";

/** Existing authorized data only: chart controls never issue another request. */
export function ShopComparisonCharts({ rows, directory, selectedIds, showProfit, grain = "daily", scopeLabel }:
  { rows: readonly StoreDayRow[]; directory: readonly ComparisonShop[]; selectedIds: readonly string[];
    showProfit: boolean; grain?: "daily" | "monthly"; scopeLabel: string }) {
  const [metric, setMetric] = useState<"revenue" | "profit">("revenue");
  const [kind, setKind] = useState<"line" | "bar">("line");
  const effectiveMetric = showProfit ? metric : "revenue";
  const effectiveGrain = useMemo(() => comparisonGrain(rows, grain), [rows, grain]);
  const series = useMemo(() => comparisonShopSeries(directory), [directory]);
  const data = useMemo(() => comparisonPoints(rows, series, selectedIds, effectiveMetric, effectiveGrain),
    [rows, series, selectedIds, effectiveMetric, effectiveGrain]);
  const selected = new Set(selectedIds.map(canonicalBranchId));
  const shown = series.filter(shop => selected.has(shop.id));
  const title = effectiveMetric === "profit" ? "Gross profit by shop" : "Net revenue by shop";
  const axes = <><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" fontSize={11} minTickGap={24} />
    <YAxis fontSize={11} width={66} tickFormatter={compactChartNumber} /><Tooltip formatter={value => money(Number(value ?? 0))} /></>;
  return <section aria-label={title} className="min-w-0 rounded-lg border border-border bg-card p-4">
    <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
      <div className="min-w-0"><h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{scopeLabel} · {effectiveGrain === "daily" ? "Daily" : "Monthly"}{effectiveGrain !== grain ? " (long range)" : ""} · net sales exclude tax and rounding</p></div>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Shop comparison metric" value={effectiveMetric} onChange={event => setMetric(event.target.value as "revenue" | "profit")} className="h-9 rounded-md border border-input bg-background px-2 text-xs">
          <option value="revenue">Net revenue</option>{showProfit && <option value="profit">Gross profit</option>}
        </select>
        <select aria-label="Shop comparison chart" value={kind} onChange={event => setKind(event.target.value as "line" | "bar")} className="h-9 rounded-md border border-input bg-background px-2 text-xs">
          <option value="line">Line</option><option value="bar">Bar</option>
        </select>
      </div>
    </div>
    {data.length ? <div className="h-72 min-w-0" data-shop-comparison="in-place">
      <ResponsiveContainer width="100%" height="100%">
        {kind === "line" ? <LineChart data={data}>{axes}{shown.map(shop => <Line key={shop.id} dataKey={shop.key} name={shop.name} stroke={shop.color} strokeWidth={2} dot={false} isAnimationActive={false} />)}</LineChart>
          : <BarChart data={data}>{axes}{shown.map(shop => <Bar key={shop.id} dataKey={shop.key} name={shop.name} fill={shop.color} maxBarSize={32} isAnimationActive={false} />)}</BarChart>}
      </ResponsiveContainer>
    </div> : <p role="status" className="py-8 text-center text-sm text-muted-foreground">No completed sales in this scope and date range.</p>}
    <ul aria-label="Shop colors" className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">{shown.map(shop => <li key={shop.id} className="flex min-w-0 items-center gap-1.5"><span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: shop.color }} /><span className="break-words">{shop.name}</span></li>)}</ul>
  </section>;
}
