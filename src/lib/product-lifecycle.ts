import type { Product } from "@/core/types/pos-types";

/** Company-wide stock, rather than the quantity at only the current branch. */
export function hasCompanyStock(product: Pick<Product, "stockByStore">): boolean {
  return (
    Object.values(product.stockByStore ?? {}).reduce(
      (total, quantity) => total + (Number.isFinite(quantity) ? quantity : 0),
      0,
    ) > 0
  );
}

/**
 * Keep a zero-stock item out of every normal catalogue surface immediately.
 * The matching database trigger persists the same decision centrally.
 */
export function applyZeroStockLifecycle<T extends Product>(product: T, enabled: boolean): T {
  if (!enabled || hasCompanyStock(product) || product.archived) return product;
  return { ...product, archived: true };
}

export function applyZeroStockLifecycleToProducts<T extends Product>(
  products: T[],
  enabled: boolean,
): T[] {
  if (!enabled) return products;
  return products.map((product) => applyZeroStockLifecycle(product, true));
}
