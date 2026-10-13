import type { Sale } from "@/core/types/pos-types";

/** Retained tender amounts: cash change is not revenue. */
export function dailyPaymentSummary(sales: Sale[]) {
  const totals = new Map<string, number>();
  for (const sale of sales) {
    if (sale.refunded) continue;
    const payments = sale.payments?.length
      ? sale.payments
      : [{ method: sale.method, amount: sale.paid }];
    // Single tenders may already store retained cash; split tenders can
    // include change. Only subtract the overpayment represented here.
    const entered = payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
    let change = Math.min(Math.max(0, sale.change || 0), Math.max(0, entered - sale.total));
    for (const payment of payments) {
      let amount = Number(payment.amount) || 0;
      if (payment.method === "cash") {
        const returned = Math.min(Math.max(0, amount), change);
        amount -= returned;
        change -= returned;
      }
      totals.set(payment.method, (totals.get(payment.method) ?? 0) + amount);
    }
  }
  return [...totals]
    .map(([method, amount]) => ({ method, amount: Math.round(amount * 100) / 100 }))
    .filter((payment) => payment.amount > 0);
}
