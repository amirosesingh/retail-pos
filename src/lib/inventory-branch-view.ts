import type { Product } from "@/core/types/pos-types";
import { canonicalBranchId, canonicalStockMap } from "./branch-id";

/** Inventory view only. Never replace the persisted company-wide archive flag. */
export function branchInventoryArchived(product: Pick<Product, "stockByStore">, branchId: string): boolean {
  return (canonicalStockMap(product.stockByStore)[canonicalBranchId(branchId)] ?? 0) <= 0;
}

export function branchInventoryCounts(products: readonly Product[], branchId: string) {
  let archived = 0;
  let negative = 0;
  for (const product of products) {
    const quantity = canonicalStockMap(product.stockByStore)[canonicalBranchId(branchId)] ?? 0;
    if (quantity <= 0) archived++;
    if (quantity < 0) negative++;
  }
  return { active: products.length - archived, archived, negative };
}
