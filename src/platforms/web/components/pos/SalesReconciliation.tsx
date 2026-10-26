import { useMemo } from "react";
import { formatMoney } from "@/lib/currency";
import { salesReconciliation } from "@/lib/sales-reconciliation";
import type { Sale } from "@/core/types/pos-types";

export function SalesReconciliation({ sales, sponsorshipValue = 0, title = "Sales breakdown", showBillCount = true }: {
  sales: Sale[]; sponsorshipValue?: number; title?: string; showBillCount?: boolean;
}) {
  const totals = useMemo(() => salesReconciliation(sales), [sales]);
  const rows: [string, number][] = [
    ["Subtotal · before discounts", totals.subtotal],
    ...(totals.itemDiscounts !== null && totals.billDiscounts !== null
      ? [["Item discounts", -totals.itemDiscounts], ["Bill discounts", -totals.billDiscounts]] as [string, number][]
      : [["Discounts · recorded total", -totals.discounts]] as [string, number][]),
    ...(Math.abs(totals.includedTax) >= 0.005 ? [["Less tax already included in subtotal", -totals.includedTax] as [string, number]] : []),
    ...(Math.abs(totals.recordDifference) >= 0.005 ? [["Recorded bill difference", -totals.recordDifference] as [string, number]] : []),
    ["Net sales", totals.net],
    ...(Math.abs(totals.tax) >= 0.005 ? [["Tax collected", totals.tax] as [string, number]] : []),
    ...(Math.abs(totals.rounding) >= 0.005 ? [["Rounding adjustment", totals.rounding] as [string, number]] : []),
  ];
  return <section aria-label={title} className="rounded-xl border border-border bg-card p-4 sm:p-5">
    <h2 className="text-sm font-semibold">{title}</h2>
    <p className="mt-1 text-xs text-muted-foreground">{showBillCount && <>{totals.bills} completed bills. </>}Discounts include applicable coupons and promotions once. Refunded bills are excluded.</p>
    {totals.itemDiscounts === null && <p className="mt-1 text-xs text-muted-foreground">Some historical bill lines are unavailable; their recorded total discount is preserved.</p>}
    {Math.abs(totals.recordDifference) >= 0.005 && <p role="status" className="mt-1 text-xs text-warning">Some recorded bills do not reconcile with their stored subtotal. Their saved collected amounts are preserved for review.</p>}
    {Math.abs(totals.includedTax) >= 0.005 && <p className="mt-1 text-xs text-muted-foreground">Tax included in prices is removed for Net sales and added back to the collected total.</p>}
    {sponsorshipValue > 0 && <div className="mt-3 rounded-lg bg-muted/50 p-3 text-sm">
      <p>Sponsorship value: <span className="font-medium tabular-nums">{formatMoney(sponsorshipValue)}</span></p>
      <p className="mt-1 text-xs text-muted-foreground">The reporting summary includes {formatMoney(totals.collected + sponsorshipValue)} with sponsorship. Sponsorship is a stock value, separate from customer payments.</p>
    </div>}
    <dl className="mt-3 space-y-2 text-sm">
      {rows.map(([label, value]) => <div key={label} className="flex items-start justify-between gap-4">
        <dt className="min-w-0 text-muted-foreground">{label}</dt><dd className="shrink-0 tabular-nums">{formatMoney(value)}</dd>
      </div>)}
      <div className="flex items-start justify-between gap-4 border-t border-border pt-3 text-base font-semibold">
        <dt>Total collected</dt><dd className="shrink-0 tabular-nums">{formatMoney(totals.collected)}</dd>
      </div>
    </dl>
  </section>;
}
