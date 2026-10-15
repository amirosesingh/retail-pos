import type { Product } from "@/core/types/pos-types";
import { canonicalBranchId, canonicalStockMap } from "./branch-id";
import { recordId } from "./sale-identity";

/** One physical count per product, regardless of UUID presentation. */
export function stockCountChanges(products: Product[], entries: { productId: string; counted: number }[], storeId: string) {
  const target = canonicalBranchId(storeId);
  const byId = new Map(products.map(product => [recordId(product.id), product]));
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.counted) || entry.counted < 0)
      throw new Error("Stock counts must contain non-negative whole quantities.");
    const id = recordId(entry.productId);
    if (counts.has(id) && counts.get(id) !== entry.counted)
      throw new Error("One product has conflicting stock counts. Review the duplicate count lines.");
    counts.set(id, entry.counted);
  }
  return [...counts].flatMap(([id, quantity]) => {
    const product = byId.get(id);
    if (!product) throw new Error("A counted item is missing from inventory. Refresh the count before posting.");
    const before = canonicalStockMap(product.stockByStore)[target] ?? 0;
    const counted = quantity;
    return counted === before ? [] : [{ product, before, counted, delta: counted - before }];
  });
}
