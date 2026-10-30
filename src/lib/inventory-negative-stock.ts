import type { Product } from "@/core/types/pos-types";
import { canonicalBranchId, canonicalStockMap, sameBranchId } from "./branch-id";
import { recordId } from "./sale-identity";

/** Review projection only; never changes quantities or shared product status. */
export function negativeStockProducts(products: readonly Product[], branchId: string, visible: (product: Product, branchId: string) => boolean): Product[] {
  const branch = canonicalBranchId(branchId);
  const seen = new Set<string>();
  return products.filter(product => {
    const id = recordId(product.id);
    const qty = canonicalStockMap(product.stockByStore)[branch] ?? 0;
    if (seen.has(id) || !visible(product, branch) || !Number.isFinite(qty) || qty >= 0) return false;
    seen.add(id);
    return true;
  });
}

export function negativeStockCountAllowed(requestedBranch: string | undefined, currentBranch: string, canAdjustStock: boolean): boolean {
  return canAdjustStock && !!requestedBranch && !!currentBranch && sameBranchId(requestedBranch, currentBranch);
}

/** Every seeded line requires a deliberate physical count, including explicit 0. */
export function reviewedPhysicalCounts(ids: readonly string[], values: Record<string, string>): { productId: string; counted: number }[] {
  if (!ids.length) throw new Error("No products are available for this count.");
  return ids.map(productId => {
    const value = values[productId]?.trim() ?? "";
    const counted = Number(value);
    if (!value || !Number.isSafeInteger(counted) || counted < 0)
      throw new Error("Enter a non-negative whole physical count for every product. Enter 0 only when you counted none.");
    return { productId, counted };
  });
}
