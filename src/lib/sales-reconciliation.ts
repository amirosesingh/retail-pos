import { lineDiscountTotal, r2, type Sale } from "@/core/types/pos-types";
import { saleNetRevenue } from "@/core/pricing/profit";
import { uniqueSales } from "./sale-identity";

/** Display-only reconciliation of stored bills, including mixed tax modes. */
export function salesReconciliation(sales: Sale[]) {
  const included = uniqueSales(sales).filter(sale => !sale.refunded);
  let subtotal = 0, net = 0, discounts = 0, tax = 0, rounding = 0, collected = 0;
  let itemDiscounts = 0, includedTax = 0, recordDifference = 0, splitDiscounts = true;
  for (const sale of included) {
    subtotal += sale.subtotal;
    net += saleNetRevenue(sale);
    discounts += sale.discount;
    tax += sale.tax;
    rounding += sale.roundingAdjustment ?? 0;
    collected += sale.total;
    const taxBasis = r2(sale.subtotal - sale.discount - saleNetRevenue(sale));
    if (Math.abs(taxBasis - sale.tax) <= 0.011) includedTax += sale.tax;
    else if (Math.abs(taxBasis) > 0.011) recordDifference += taxBasis;
    const lineSubtotal = r2(sale.lines.reduce((sum, line) => sum + line.price * line.qty, 0));
    const lineDiscount = r2(sale.lines.reduce((sum, line) => sum + lineDiscountTotal(line) * (line.qty < 0 ? -1 : 1), 0));
    if (Math.abs(lineSubtotal - sale.subtotal) > 0.011 || !Number.isFinite(lineDiscount) || r2(sale.discount - lineDiscount) < -0.011) splitDiscounts = false;
    itemDiscounts += lineDiscount;
  }
  return {
    bills: included.length,
    // Keep recorded discounts on their original tax basis. Inclusive bills
    // need a separate tax extraction row, rather than inventing an ex-tax
    // discount allocation from a bill-level snapshot.
    subtotal: r2(subtotal), includedTax: r2(includedTax), recordDifference: r2(recordDifference),
    itemDiscounts: splitDiscounts ? r2(itemDiscounts) : null,
    billDiscounts: splitDiscounts ? r2(discounts - itemDiscounts) : null,
    discounts: r2(discounts), net: r2(net), tax: r2(tax),
    rounding: r2(rounding), collected: r2(collected),
  };
}
