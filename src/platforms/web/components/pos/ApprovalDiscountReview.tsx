import { ticketDiscounts, discountApprovalPercent, ticketDiscountApprovalPercent, type AuthPayload } from "@/lib/authorization";

export function ApprovalDiscountReview({ payload, approvedPayload }: { payload: AuthPayload; approvedPayload: AuthPayload }) {
  const requested = ticketDiscounts(payload);
  const decisions = ticketDiscounts(approvedPayload, "approved_discounts");
  return <section className="space-y-3" aria-label="Requested discounts">
    <h3 className="text-sm font-semibold">Requested discounts</h3>
    {requested.length > 0 && <p className="rounded-xl bg-muted/30 p-3 text-sm">
      Highest combined item and bill discount: <strong>{ticketDiscountApprovalPercent(requested).toFixed(2)}%</strong>.
      Item discounts below are applied first; the extra bill discount applies to the remaining balance.
    </p>}
    <div className="grid gap-3 sm:grid-cols-2">
      {requested.map(entry => {
        const decision = decisions.find(value => value.index === entry.index);
        const format = (value: number) => entry.type === "percent" ? `${value}%` : `$${value.toFixed(2)}`;
        return <article key={entry.index} className="min-w-0 space-y-3 rounded-xl border border-border/60 bg-muted/15 p-4">
          <div><p className="break-words font-medium">{entry.name || (entry.index < 0 ? "Bill discount" : "Item discount")}</p><p className="text-xs text-muted-foreground">{entry.index < 0 ? "Whole bill" : `${entry.qty} × $${entry.price.toFixed(2)}`}</p></div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">{entry.index < 0 ? "Extra bill discount" : "Item discount"}</dt><dd className="font-semibold">{format(entry.value)}{entry.type === "amount" && entry.index >= 0 ? " per unit" : ""}{entry.type === "amount" && <span className="block text-xs font-normal text-muted-foreground">{discountApprovalPercent(entry).toFixed(2)}% of {entry.index < 0 ? "remaining bill" : "item price"}</span>}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Status</dt><dd>{decision ? decision.value === 0 ? "Rejected" : `Approved ${format(decision.value)}` : entry.requiresApproval ? "Needs approval" : "Within cashier limit"}</dd></div>
          </dl>
        </article>;
      })}
    </div>
    {!requested.length && <p role="alert" className="text-sm text-destructive">The requested discount details could not be read. Ask the requesting branch to check this request.</p>}
  </section>;
}
