import type { Payment } from "@/core/types/pos-types";

/** The register exchanges 100 loyalty points for one currency unit. */
export function redeemedPoints(sale: { method: string; paid: number; payments?: Pick<Payment, "method" | "amount">[] }): number {
  const amount = sale.payments?.length
    ? sale.payments.filter(payment => payment.method === "points").reduce((sum, payment) => sum + Math.max(0, payment.amount), 0)
    : sale.method === "points" ? Math.max(0, sale.paid) : 0;
  return Math.round(amount * 100);
}
