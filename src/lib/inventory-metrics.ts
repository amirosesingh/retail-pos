import type { Product } from "@/core/types/pos-types";
import { canonicalBranchId, canonicalStockMap } from "./branch-id";

export const isLowStock = (quantity: number, reorderLevel: number): boolean =>
  quantity > 0 && quantity <= reorderLevel;

/** Legacy empty costs normalize to zero; zero-cost items require review, not automatic edits. */
export const needsCostReview = (cost: number): boolean => !Number.isFinite(cost) || cost <= 0;

export const productMargin = (price: number, cost: number): number | null =>
  price > 0 && Number.isFinite(price) && !needsCostReview(cost) ? ((price - cost) / price) * 100 : null;

export type InventoryMetrics = {
  products: number;
  categories: number;
  units: number;
  lowStock: number;
  outOfStock: number;
  negativeStock: number;
  costValue: number;
  retailValue: number;
  potentialProfit: number;
};

export function inventoryMetrics(products: readonly Product[], branchId: string): InventoryMetrics {
  const id = canonicalBranchId(branchId);
  const active = products.filter((product) => product.archived !== true);
  const categories = new Set<string>();
  const metrics: InventoryMetrics = {
    products: active.length,
    categories: 0,
    units: 0,
    lowStock: 0,
    outOfStock: 0,
    negativeStock: 0,
    costValue: 0,
    retailValue: 0,
    potentialProfit: 0,
  };

  for (const product of active) {
    const quantity = canonicalStockMap(product.stockByStore)[id] ?? 0;
    if (product.category.trim()) categories.add(product.category.trim().toLowerCase());
    metrics.units += quantity;
    metrics.costValue += product.cost * quantity;
    metrics.retailValue += product.price * quantity;
    if (quantity < 0) metrics.negativeStock += 1;
    if (quantity === 0) metrics.outOfStock += 1;
    if (isLowStock(quantity, product.reorderLevel)) metrics.lowStock += 1;
  }
  metrics.categories = categories.size;
  metrics.potentialProfit = metrics.retailValue - metrics.costValue;
  return metrics;
}
