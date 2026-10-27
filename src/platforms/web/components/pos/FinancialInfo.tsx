import { useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatMoney } from "@/lib/currency";
import type { salesReconciliation } from "@/lib/sales-reconciliation";

/** Financial detail from the current summary; opening this never loads data. */
export function FinancialInfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <TooltipProvider delayDuration={250}>
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${label} information`}
          aria-expanded={open}
          className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full align-middle text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerDown={(event) => {
            // Radix normally dismisses on pointer-down. Keep touch activation
            // under the same explicit toggle as mouse and keyboard clicks.
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen(value => !value);
          }}
        >
          <Info className="size-3" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="z-[100] max-w-[min(20rem,calc(100vw-2rem))] whitespace-normal break-words text-xs font-normal normal-case leading-relaxed tracking-normal">
        {children}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>;
}

export function FinancialBreakdown({ rows, children }: {
  rows: readonly (readonly [string, string])[];
  children?: ReactNode;
}) {
  return <div className="space-y-2">
    <dl className="space-y-1">
      {rows.map(([label, value]) => <div key={label} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
        <dt>{label}</dt><dd className="max-w-40 break-words text-right font-medium tabular-nums">{value}</dd>
      </div>)}
    </dl>
    {children && <div className="space-y-1 border-t border-current/20 pt-2">{children}</div>}
  </div>;
}

export function SalesTotalInfo({ totals, sponsorshipValue = 0 }: {
  totals: ReturnType<typeof salesReconciliation>;
  sponsorshipValue?: number;
}) {
  const rows: [string, string][] = [
    ["Subtotal before discounts", formatMoney(totals.subtotal)],
    ...(totals.itemDiscounts !== null && totals.billDiscounts !== null
      ? [["Less item discounts", formatMoney(-totals.itemDiscounts)], ["Less bill discounts", formatMoney(-totals.billDiscounts)]] as [string, string][]
      : [["Less recorded discounts", formatMoney(-totals.discounts)]] as [string, string][]),
    ...(Math.abs(totals.includedTax) >= 0.005 ? [["Less tax included in subtotal", formatMoney(-totals.includedTax)] as [string, string]] : []),
    ...(Math.abs(totals.recordDifference) >= 0.005 ? [["Recorded bill difference", formatMoney(-totals.recordDifference)] as [string, string]] : []),
    ["Net sales excluding tax", formatMoney(totals.net)],
    ...(Math.abs(totals.tax) >= 0.005 ? [["Tax collected", formatMoney(totals.tax)] as [string, string]] : []),
    ...(Math.abs(totals.rounding) >= 0.005 ? [["Rounding adjustment", formatMoney(totals.rounding)] as [string, string]] : []),
    ["Total collected", formatMoney(totals.collected)],
    ...(Math.abs(sponsorshipValue) >= 0.005 ? [
      ["Sponsorship value", formatMoney(sponsorshipValue)],
      ["Sales summary including sponsorship", formatMoney(totals.collected + sponsorshipValue)],
    ] as [string, string][] : []),
  ];
  return <FinancialBreakdown rows={rows}>
    <p>Discounts and applicable coupons are counted once. Refunded bills are excluded.</p>
    {totals.itemDiscounts === null && <p>Some historical lines are unavailable; recorded bill discounts are retained.</p>}
    {Math.abs(totals.recordDifference) >= 0.005 && <p>Some saved bill subtotals differ from their collected amounts. Stored values are preserved.</p>}
    {Math.abs(sponsorshipValue) >= 0.005 && <p>Sponsorship is stock value, separate from customer payments.</p>}
  </FinancialBreakdown>;
}

export function GrossProfitInfo({ revenue, cost, profit, marginPct }: {
  revenue: number;
  cost: number;
  profit: number;
  marginPct?: number;
}) {
  return <FinancialBreakdown rows={[
    ["Net sales excluding tax", formatMoney(revenue)],
    ["Less cost of goods sold", formatMoney(-cost)],
    ["Gross profit", formatMoney(profit)],
    ...(marginPct === undefined ? [] : [["Gross margin", `${marginPct.toFixed(1)}%`]] as [string, string][]),
  ]}>
    <p>Gross profit is net sales less cost of goods; other operating expenses are excluded.</p>
    <p>Saved sale-line costs are used where available. Missing costs use the current product cost, or zero when unavailable.</p>
    {marginPct !== undefined && <p>Margin is gross profit ÷ net sales × 100.</p>}
  </FinancialBreakdown>;
}
