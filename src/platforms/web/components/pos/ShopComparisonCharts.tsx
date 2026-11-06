import { useAuth } from "@/lib/pos-auth";
import { pageDataScope } from "@/lib/page-data-cache";
import { useChartTransition } from "@/lib/use-chart-transition";
import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { money } from "@/lib/pos-store";
import type { StoreDayRow } from "@/lib/analytics-board";
import { comparisonGrain, comparisonHourPoints, comparisonPoints, comparisonShopSeries, type ComparisonPoint, type ComparisonShop, type FinancialShopRow, type StoreHourRow } from "@/lib/shop-comparison";
import { canonicalBranchId } from "@/lib/branch-id";
import { ANALYTICS_COLORS, compactChartNumber } from "@/lib/analytics-design";
import { ChartPlotScope, TradingTooltip, ChartPlotStage, TradingChartCard, TradingChartGrid } from "./TradingChartLayout";

const hasValue = (data: readonly ComparisonPoint[], keys: readonly string[]) =>
  data.some(point => keys.some(key => typeof point[key] === "number" && Math.abs(point[key] as number) >= 0.005));

type GraphControls = { grouping: "daily" | "monthly"; kind: "line" | "bar";
  onGroupingChange: (value: "daily" | "monthly") => void; onKindChange: (value: "line" | "bar") => void };

export function TradingGraphControls({ grouping, kind, onGroupingChange, onKindChange }: GraphControls) {
  return <>
    <select aria-label="Shop chart grouping" value={grouping} onChange={event => onGroupingChange(event.target.value as "daily" | "monthly")} className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"><option value="daily">Daily</option><option value="monthly">Monthly</option></select>
    <select aria-label="Shop comparison chart" value={kind} onChange={event => onKindChange(event.target.value as "line" | "bar")} className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"><option value="line">Line</option><option value="bar">Bar</option></select>
  </>;
}

/** Presentation of already confirmed, authorized rows; controls issue no database reads. */
export function ShopComparisonCharts({ rows: incomingRows, directory, selectedIds, showProfit, grain = "daily", scopeLabel,
  transactionHours: incomingHours, profitHours: incomingProfitHours, hourlyError, financialRows: incomingFinancial, range: incomingRange, requestedRange, children, childrenFirst = false, controls, showToolbar = true }:
  { rows: readonly StoreDayRow[]; directory: readonly ComparisonShop[]; selectedIds: readonly string[];
    showProfit: boolean; grain?: "daily" | "monthly"; scopeLabel: string;
    transactionHours?: readonly StoreHourRow[]; profitHours?: readonly StoreHourRow[] | null;
    hourlyError?: string; financialRows?: readonly FinancialShopRow[]; range?: { from: string; to: string }; children?: ReactNode; childrenFirst?: boolean; controls?: GraphControls; showToolbar?: boolean; requestedRange?: {from:string;to:string} }) {
  const [localGrouping, setGrouping] = useState(grain);
  const requestedGrouping = controls?.grouping ?? localGrouping;
  const [localKind, setKind] = useState<"line" | "bar">("line");
  const requestedKind = controls?.kind ?? localKind;
  const [financialView, setFinancialView] = useState<"compare" | "revenue" | "cost" | "profit" | "marginPct">("compare");
  const requestedFinancialView = showProfit ? financialView : "revenue";
  const {user,ready:authReady}=useAuth();
  const authority=authReady&&user?JSON.stringify([pageDataScope(user),selectedIds.slice().sort(),showProfit]):null;
  const target=JSON.stringify([requestedRange??incomingRange,requestedGrouping,requestedKind,requestedFinancialView]);
  const rangeFrom=incomingRange?.from,rangeTo=incomingRange?.to;
  const stableRange=useMemo(()=>rangeFrom!==undefined&&rangeTo!==undefined?{from:rangeFrom,to:rangeTo}:undefined,[rangeFrom,rangeTo]);
  const directorySeries=useMemo(()=>comparisonShopSeries(directory),[directory]);
  const selectedKey=JSON.stringify(selectedIds.map(canonicalBranchId).sort());
  const prepared=useMemo(()=>{
    const selected=new Set<string>(JSON.parse(selectedKey));
    const shown=directorySeries.filter(shop=>selected.has(shop.id));
    const effectiveGrain=comparisonGrain(incomingRows,requestedGrouping,stableRange);
    return {shown,effectiveGrain,grouping:requestedGrouping,kind:requestedKind,financialView:requestedFinancialView,range:stableRange,
      revenue:comparisonPoints(incomingRows,directorySeries,[...selected],"revenue",effectiveGrain,stableRange),
      profit:showProfit?comparisonPoints(incomingRows,directorySeries,[...selected],"profit",effectiveGrain,stableRange):[],
      transactions:comparisonHourPoints(incomingHours??[],directorySeries,[...selected],"bills"),
      hourlyProfit:showProfit?comparisonHourPoints(incomingProfitHours??[],directorySeries,[...selected],"profit"):[],
      hasTransactions:!!incomingHours,hasProfitHours:!!incomingProfitHours,
      financial:(incomingFinancial??[]).filter(row=>selected.has(canonicalBranchId(row.id))).map(({id,name,revenue,cost,profit,marginPct})=>({id,name,revenue,cost,profit,marginPct})),
    };
  },[selectedKey,directorySeries,incomingRows,incomingHours,incomingProfitHours,incomingFinancial,requestedGrouping,requestedKind,requestedFinancialView,stableRange,showProfit]);
  // Exact semantic signature of bounded plot DTOs, never raw sales/history.
  const incoming=useMemo(()=>({key:JSON.stringify([stableRange,requestedGrouping,requestedKind,requestedFinancialView]),value:prepared,signature:JSON.stringify(prepared)}),[prepared,stableRange,requestedGrouping,requestedKind,requestedFinancialView]);
  const transition=useChartTransition(authority,target,incoming);
  const source=transition.data??prepared;
  const {revenue,profit,transactions,hourlyProfit,financial,range,grouping,kind,shown,effectiveGrain}=source;
  const effectiveFinancialView=source.financialView;
  const keys=shown.map(shop=>shop.key);
  const stage=(plot:ReactNode)=><ChartPlotStage phase={transition.phase} stamp={transition.stamp} previousLabel={transition.data?.range?`${transition.data.range.from} to ${transition.data.range.to}`:undefined}>{plot}</ChartPlotStage>;
  const financialTrend=useMemo(()=>{const profits=new Map(profit.map(point=>[point.label,point]));return revenue.map(point=>({...point,...(showProfit?Object.fromEntries(shown.map(shop=>[`${shop.key}_profit`,profits.get(point.label)?.[shop.key]??0])):{})}));},[profit,revenue,showProfit,shown]);
  const financialVisible = financial.some(row => Math.abs(row.revenue) >= 0.005 ||
    (showProfit && (Math.abs(row.cost) >= 0.005 || Math.abs(row.profit) >= 0.005)));
  const legend = <ul aria-label="Shop colors" className="flex flex-wrap gap-x-4 gap-y-2">{shown.map(shop =>
    <li key={shop.id} className="flex min-w-0 items-center gap-1.5"><span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: shop.color }} /><span className="break-words">{shop.name}</span></li>)}</ul>;
  const axes = (hourly = false, counts = false) => <><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
    <XAxis dataKey="label" fontSize={11} minTickGap={24} interval={hourly ? 3 : "preserveStartEnd"} />
    <YAxis fontSize={11} width={58} allowDecimals={!counts} tickFormatter={compactChartNumber} />
    <TradingTooltip formatter={value => counts ? Number(value ?? 0).toLocaleString() : money(Number(value ?? 0))} /></>;
  const plot = (data: ComparisonPoint[], hourly = false, counts = false) =>
    stage(<ResponsiveContainer width="100%" height="100%">
      {hourly || kind === "bar" ? <BarChart data={data}>{axes(hourly, counts)}{shown.map(shop =>
        <Bar key={shop.id} dataKey={shop.key} name={shop.name} fill={shop.color} radius={4} maxBarSize={28} isAnimationActive={false} />)}</BarChart>
        : <LineChart data={data}>{axes()}{shown.map(shop =>
          <Line key={shop.id} type="monotone" dataKey={shop.key} name={shop.name} stroke={shop.color} strokeDasharray={shop.revenueDash} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" dot={false} isAnimationActive={false} />)}</LineChart>}
    </ResponsiveContainer>);
  const revenueVisible = hasValue(revenue, keys), profitVisible = showProfit && hasValue(profit, keys);
  const transactionsVisible = source.hasTransactions && hasValue(transactions, keys);
  const hourlyProfitVisible = showProfit && source.hasProfitHours && hasValue(hourlyProfit, keys);
  const description = `${scopeLabel} · ${effectiveGrain === "daily" ? "Daily" : "Monthly"}${effectiveGrain !== grouping ? " (long range)" : ""} · net sales exclude tax and rounding`;
  return <section className="min-w-0 space-y-3" aria-label="Shop comparison charts">
    {showToolbar && <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <p className="text-muted-foreground">{scopeLabel} · Swipe or scroll horizontally for more graphs.</p>
      <div className="flex flex-wrap gap-2"><TradingGraphControls grouping={requestedGrouping} kind={requestedKind}
        onGroupingChange={controls?.onGroupingChange ?? setGrouping} onKindChange={controls?.onKindChange ?? setKind} /></div>
    </div>}
    {showProfit && hourlyError && <p role="status" className="text-xs text-muted-foreground">Hourly gross profit unavailable: {hourlyError} Daily figures remain separate.</p>}
    <TradingChartGrid label={`${scopeLabel} trading graphs`}>
      {childrenFirst && children}
      {(revenueVisible || profitVisible) && <TradingChartCard title={showProfit ? "Revenue and gross profit" : "Revenue trend"} description={description}
        footer={<ul aria-label="Revenue and profit series" className="flex flex-wrap gap-x-4 gap-y-2">{shown.flatMap(shop => [
          <li key={`${shop.id}:revenue`} className="flex min-w-0 items-center gap-1.5"><span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{backgroundColor:shop.color}} />{shop.name} · Revenue</li>,
          ...(showProfit ? [<li key={`${shop.id}:profit`} className="flex min-w-0 items-center gap-1.5"><span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm" style={{backgroundColor:shop.profitColor}} />{shop.name} · Gross profit</li>] : []),
        ])}</ul>}>
        {stage(<ResponsiveContainer width="100%" height="100%">
          {kind === "bar" ? <BarChart data={financialTrend}>{axes()}{shown.flatMap(shop => [
            <Bar key={`${shop.id}:revenue`} dataKey={shop.key} name={`${shop.name} · Revenue`} fill={shop.color} radius={4} maxBarSize={28} isAnimationActive={false} />,
            ...(showProfit ? [<Bar key={`${shop.id}:profit`} dataKey={`${shop.key}_profit`} name={`${shop.name} · Gross profit`} fill={shop.profitColor} radius={4} maxBarSize={28} isAnimationActive={false} />] : []),
          ])}</BarChart> : <LineChart data={financialTrend}>{axes()}{shown.flatMap(shop => [
            <Line key={`${shop.id}:revenue`} type="monotone" dataKey={shop.key} name={`${shop.name} · Revenue`} stroke={shop.color} strokeDasharray={shop.revenueDash} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" dot={financialTrend.length === 1 ? {r:3} : false} isAnimationActive={false} />,
            ...(showProfit ? [<Line key={`${shop.id}:profit`} type="monotone" dataKey={`${shop.key}_profit`} name={`${shop.name} · Gross profit`} stroke={shop.profitColor} strokeDasharray={shop.profitDash ?? "6 3"} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" dot={financialTrend.length === 1 ? {r:3} : false} isAnimationActive={false} />] : []),
          ])}</LineChart>}
        </ResponsiveContainer>)}
      </TradingChartCard>}
      {financialVisible && <TradingChartCard title="Financial performance by shop" description={showProfit ? "Cost + gross profit = net revenue. Margin % uses the right axis." : "Net revenue for the selected shops and dates."}
        controls={<select aria-label="Financial chart measure" value={requestedFinancialView} onChange={event => setFinancialView(event.target.value as typeof financialView)} className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground">
          {([['compare', 'Compare'], ['revenue', 'Revenue'], ['cost', 'Cost'], ['profit', 'Gross profit'], ['marginPct', 'Margin %']] as const)
            .filter(([value]) => showProfit || value === "revenue").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>}
        footer={transition.phase !== "waiting" && showProfit && (effectiveFinancialView === "compare" || effectiveFinancialView === "marginPct") &&
          <ul aria-label="Gross margin by shop" className="flex flex-wrap gap-x-4 gap-y-1">{financial.filter(row => Number.isFinite(row.marginPct)).map(row =>
            <li key={row.id} className="min-w-0 break-words">{row.name} · <span className="numeric whitespace-nowrap">{row.marginPct.toFixed(1)}% margin</span></li>)}</ul>}>
        {stage(<ResponsiveContainer width="100%" height="100%"><ComposedChart data={financial}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={11} minTickGap={20} />
          <YAxis yAxisId="money" width={58} fontSize={11} tickFormatter={compactChartNumber} />
          {showProfit && (effectiveFinancialView === "compare" || effectiveFinancialView === "marginPct") && <YAxis yAxisId="margin" orientation="right" unit="%" width={44} fontSize={11} />}
          <TradingTooltip formatter={(value, name) => name === "Margin %" ? `${Number(value ?? 0).toFixed(1)}%` : money(Number(value ?? 0))} />
          {effectiveFinancialView === "compare" ? <><Bar yAxisId="money" dataKey="cost" stackId="net-revenue" name="Cost" fill={ANALYTICS_COLORS.cost} radius={4} maxBarSize={40} isAnimationActive={false} />
            <Bar yAxisId="money" dataKey="profit" stackId="net-revenue" name="Gross profit" fill={ANALYTICS_COLORS.profit} radius={4} maxBarSize={40} isAnimationActive={false} />
            <Line yAxisId="margin" type="monotone" dataKey="marginPct" name="Margin %" stroke={ANALYTICS_COLORS.margin} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" dot={{ r: 3 }} isAnimationActive={false} /></>
            : effectiveFinancialView === "marginPct" ? <Line yAxisId="margin" type="monotone" dataKey="marginPct" name="Margin %" stroke={ANALYTICS_COLORS.margin} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" dot={{ r: 3 }} isAnimationActive={false} />
              : <Bar yAxisId="money" dataKey={effectiveFinancialView} name={effectiveFinancialView === "profit" ? "Gross profit" : effectiveFinancialView === "cost" ? "Cost" : "Net revenue"}
                fill={effectiveFinancialView === "profit" ? ANALYTICS_COLORS.profit : effectiveFinancialView === "cost" ? ANALYTICS_COLORS.cost : ANALYTICS_COLORS.revenue} radius={4} maxBarSize={40} isAnimationActive={false} />}
        </ComposedChart></ResponsiveContainer>)}
      </TradingChartCard>}
      {transactionsVisible && <TradingChartCard title="Transactions by hour" description={`${scopeLabel} · completed bills by actual trading hour across the selected dates`} footer={legend}>{plot(transactions, true, true)}</TradingChartCard>}
      {hourlyProfitVisible && <TradingChartCard title="Gross profit by hour" description={`${scopeLabel} · net revenue less reported item cost, by recorded trading hour`} footer={legend}>{plot(hourlyProfit, true)}</TradingChartCard>}
      {!childrenFirst && <ChartPlotScope phase={transition.phase} stamp={transition.stamp} previousLabel={transition.data?.range?`${transition.data.range.from} to ${transition.data.range.to}`:undefined}>{children}</ChartPlotScope>}
    </TradingChartGrid>
    {!revenueVisible && !profitVisible && !financialVisible && !transactionsVisible && !hourlyProfitVisible && !children &&
      <p role="status" className="text-sm text-muted-foreground">No trading values to graph in this scope and date range.</p>}
  </section>;
}
