import { z } from "zod";
import { compareActivityPosition, stockActivityScopeSchema, stockActivityRowSchema } from "./stock-activity-query";

export const STOCK_ACTIVITY_BALANCE_PAGE_SIZE = 50;
const productId = stockActivityRowSchema.shape.productId;

export const stockActivityBalancesRequestSchema = stockActivityScopeSchema.extend({
  productIds: z.array(productId).min(1).max(STOCK_ACTIVITY_BALANCE_PAGE_SIZE)
    .refine(ids => new Set(ids).size === ids.length, "Each product must be requested once."),
}).strict();

const productActivity = z.object({
  productId,
  through: z.array(stockActivityRowSchema).max(6),
  after: z.array(stockActivityRowSchema).max(4),
}).strict();

const balancesPage = stockActivityScopeSchema.extend({
  products: z.array(productActivity).max(STOCK_ACTIVITY_BALANCE_PAGE_SIZE),
}).strict();

export type StockActivityBalancesRequest = z.infer<typeof stockActivityBalancesRequestSchema>;
export type StockActivityBalances = z.infer<typeof balancesPage>;

export function checkedStockActivityBalances(value: unknown, expected: StockActivityBalancesRequest): StockActivityBalances {
  const request = stockActivityBalancesRequestSchema.parse(expected);
  const page = balancesPage.parse(value);
  if (page.branchId !== request.branchId || page.cutoff !== request.cutoff || page.products.length !== request.productIds.length) {
    throw new Error("The balance evidence belongs to a different stock report.");
  }
  const outstanding = new Set(request.productIds);
  for (const product of page.products) {
    if (!outstanding.delete(product.productId)) throw new Error("The balance evidence contains a different product.");
    const ids = new Set<string>();
    for (const side of ["through", "after"] as const) {
      let previous: typeof product.through[number] | undefined;
      for (const row of product[side]) {
        const through = side === "through";
        const order = previous ? compareActivityPosition(row, previous) : 0;
        if (row.branchId !== request.branchId || row.productId !== product.productId || ids.has(row.id) ||
            (through ? row.occurredAt > request.cutoff : row.occurredAt <= request.cutoff) ||
            (previous && (through ? order >= 0 : order <= 0))) {
          throw new Error("The balance evidence did not match the selected product, time, and location.");
        }
        ids.add(row.id);
        previous = row;
      }
    }
  }
  return page;
}
