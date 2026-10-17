import type { Sale } from "@/core/types/pos-types";
import { r2 } from "@/core/types/pos-types";

type ReviewSale = Pick<Sale, "cashier" | "subtotal" | "discount" | "total" | "refunded">;
type ReviewDrawer = { staffName: string };

/** Reporting only: stored sale totals stay authoritative and are never rewritten. */
export function cashierReviewTotals(sales: ReviewSale[], drawer: ReviewDrawer[]) {
  const map = new Map<string, { name: string; bills: number; original: number; revenue: number;
    refunds: number; refundValue: number; discount: number; noSale: number }>();
  const get = (name: string) => {
    let row = map.get(name);
    if (!row) {
      row = { name, bills: 0, original: 0, revenue: 0, refunds: 0, refundValue: 0, discount: 0, noSale: 0 };
      map.set(name, row);
    }
    return row;
  };
  for (const sale of sales) {
    const row = get(sale.cashier || "Unknown");
    if (sale.refunded) {
      row.refunds += 1;
      row.refundValue = r2(row.refundValue + Math.abs(sale.total));
    } else {
      row.bills += 1;
      row.original = r2(row.original + sale.subtotal);
      row.discount = r2(row.discount + sale.discount);
      row.revenue = r2(row.revenue + sale.total);
    }
  }
  for (const event of drawer) get(event.staffName || "Unknown").noSale += 1;
  return [...map.values()].map(row => ({ ...row,
    discountPct: row.original > 0 ? row.discount / row.original * 100 : 0,
  }));
}
