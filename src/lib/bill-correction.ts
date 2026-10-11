import { cartTotals } from "@/lib/pos-store";
import { r2, type Sale, type CartLine, type DiscountType } from "@/core/types/pos-types";

/** Retain the historical bill's tax basis, rather than today's settings. */
export function billCorrectionTotals(
  sale: Sale,
  lines: CartLine[],
  discount: number,
  type: DiscountType,
) {
  const net = r2(sale.subtotal - sale.discount);
  const inclusive = Math.abs(sale.total - (sale.roundingAdjustment ?? 0) - net) < 0.01;
  const base = inclusive ? net - sale.tax : net;
  const rate = base > 0 ? (100 * sale.tax) / base : 0;
  return cartTotals(
    lines,
    discount,
    type,
    { enabled: sale.tax > 0, rate, mode: inclusive ? "inclusive" : "exclusive" },
    sale.couponScope === "bill" ? (sale.couponDiscount ?? 0) : 0,
  );
}
