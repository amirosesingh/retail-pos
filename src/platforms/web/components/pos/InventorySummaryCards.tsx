import { Boxes } from "lucide-react";
import type { ReactNode } from "react";
import type { InventoryMetrics } from "@/lib/inventory-metrics";
import { formatMoney } from "@/lib/currency";
import { AnimatedMetric } from "./AnimatedMetric";
import { FinancialBreakdown, FinancialInfoTip } from "./FinancialInfo";
import { SummaryCardRail } from "./SummaryCardRail";

type InventoryValue = {
  label: string;
  value: number;
  moneyValue?: boolean;
  fractional?: boolean;
  tone?: "warning" | "danger";
  info?: ReactNode;
};

const hasValue = ({ value, moneyValue }: InventoryValue) =>
  Number.isFinite(value) && (moneyValue ? Math.abs(value) >= 0.005 : value !== 0);

/** Presentation only: values and visibility grants come from the current page. */
export function InventorySummaryCards({ metrics, ready, loadPhase, showStockValue, totalUnitCostValue, showPotentialProfit = false, productLabel = "Products", onReviewNegativeStock, onReviewLowStock }: {
  metrics: InventoryMetrics;
  ready: boolean;
  loadPhase?: "loading" | "ready" | "stalled" | "failed";
  showStockValue: boolean;
  totalUnitCostValue?: number | null;
  showPotentialProfit?: boolean;
  productLabel?: string;
  onReviewNegativeStock?: () => void;
  onReviewLowStock?: () => void;
}) {
  const values: InventoryValue[] = [
    { label: "On-hand units", value: metrics.units, fractional: true },
    ...(showStockValue ? [
      { label: "Purchase cost value", value: metrics.costValue, moneyValue: true, info: <FinancialBreakdown rows={[["On-hand purchase cost value", formatMoney(metrics.costValue)]]}><p>Current branch quantity valued at product purchase cost. This is inventory value, not cost of completed sales.</p></FinancialBreakdown> },
      ...(typeof totalUnitCostValue === "number" ? [{ label: "Total unit cost value", value: totalUnitCostValue, moneyValue: true, info: <FinancialBreakdown rows={[["On-hand total unit cost value", formatMoney(totalUnitCostValue)]]}><p>Current branch quantity valued using the saved Total Unit Cost rules. Purchase cost value is shown separately.</p></FinancialBreakdown> }] : []),
      { label: "Retail value", value: metrics.retailValue, moneyValue: true, info: <FinancialBreakdown rows={[["On-hand retail value", formatMoney(metrics.retailValue)]]}><p>Current branch quantity valued at current selling prices, before future discounts.</p></FinancialBreakdown> },
      ...(showPotentialProfit ? [{ label: "Potential profit", value: metrics.potentialProfit, moneyValue: true, info: <FinancialBreakdown rows={[["Retail value", formatMoney(metrics.retailValue)], ["Less purchase cost value", formatMoney(-metrics.costValue)], ["Potential profit", formatMoney(metrics.potentialProfit)]]}><p>Estimated difference at current prices. This is not realized sales profit.</p></FinancialBreakdown> }] : []),
    ] : []),
  ];
  const visibleValues = values.filter(hasValue);
  const hasCatalogue = metrics.products > 0 || metrics.categories > 0;
  return <section aria-label="Inventory summary" aria-busy={!ready} className="min-w-0 space-y-3">
    {!ready ? <p role={loadPhase === "failed" ? "alert" : "status"} className="col-span-full rounded-lg border border-border p-4 text-sm text-muted-foreground">
      {loadPhase === "failed" ? "Inventory summary unavailable. Reconnect to load the catalogue." : loadPhase === "stalled" ? "Inventory is taking longer to load…" : "Loading inventory summary…"}
    </p> : <>
      <SummaryCardRail label="Inventory metrics">
      {hasCatalogue && <div className="summary-card min-w-0 rounded-lg border border-primary/20 bg-linear-to-br from-primary/5 to-card px-4 py-3" aria-label="Products and categories">
        <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"><Boxes className="size-3.5 shrink-0" aria-hidden="true" />Catalogue</p>
        <dl className="flex min-w-0 flex-wrap gap-x-5 gap-y-2">
          {metrics.products > 0 && <div className="min-w-0 flex-1 basis-20"><dt className="text-[11px] text-muted-foreground">{productLabel}</dt><dd className="min-w-0 text-xl font-semibold leading-tight [overflow-wrap:anywhere]"><AnimatedMetric value={metrics.products} /></dd></div>}
          {metrics.categories > 0 && <div className="min-w-0 flex-1 basis-20"><dt className="text-[11px] text-muted-foreground">Categories</dt><dd className="min-w-0 text-xl font-semibold leading-tight [overflow-wrap:anywhere]"><AnimatedMetric value={metrics.categories} /></dd></div>}
        </dl>
      </div>}
      {(metrics.lowStock > 0 || metrics.negativeStock > 0) && <div className="summary-card min-w-0 rounded-lg border border-warning/30 bg-card px-4 py-3" aria-label="Stock alerts">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Stock alerts</p>
        <dl className="flex min-w-0 flex-wrap gap-x-5 gap-y-2">
          {([{ label: "Low stock", value: metrics.lowStock, action: onReviewLowStock, tone: "text-warning" }, { label: "Negative stock", value: metrics.negativeStock, action: onReviewNegativeStock, tone: "text-destructive" }]).filter(item => item.value > 0).map(({ label, value, action, tone }) => <div key={label} className="min-w-0 flex-1 basis-20">
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className={`min-w-0 text-xl font-semibold leading-tight [overflow-wrap:anywhere] ${tone}`}>{action ? <button type="button" className="rounded-sm text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Review ${value} ${label.toLowerCase()} products`} onClick={action}><AnimatedMetric value={value} /></button> : <AnimatedMetric value={value} />}</dd>
          </div>)}
        </dl>
      </div>}
      {visibleValues.map(({ label, value, moneyValue, fractional, tone, info }) => <div key={label} className="summary-card flex min-h-20 min-w-0 flex-col justify-center rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center justify-between gap-1"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>{info && <FinancialInfoTip label={label}>{info}</FinancialInfoTip>}</div>
        <p className={`min-w-0 text-xl font-semibold leading-tight [overflow-wrap:anywhere] ${tone === "danger" ? "text-destructive" : tone === "warning" ? "text-warning" : ""}`}>
          <AnimatedMetric value={value} format={moneyValue ? formatMoney : fractional ? current => current.toLocaleString(undefined, { maximumFractionDigits: 3 }) : undefined} />
        </p>
      </div>)}
      </SummaryCardRail>
      {!hasCatalogue && !visibleValues.length && <p role="status" className="col-span-full rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No active products at this branch.</p>}
      {showStockValue && totalUnitCostValue === null && <p role="status" className="col-span-full text-sm text-muted-foreground">Total unit cost value unavailable: review product costs and Total Unit Cost rules.</p>}
    </>}
  </section>;
}
