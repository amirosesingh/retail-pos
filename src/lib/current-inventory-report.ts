import type { Product, Store } from "@/core/types/pos-types";
import { canonicalBranchId, canonicalStockMap, sameBranchId } from "./branch-id";
import { isLowStock, needsCostReview } from "./inventory-metrics";

export const ALL_INVENTORY_LOCATIONS = "report:all-authorized-locations";

export type CurrentInventoryFilters = {
  query: string;
  location: string;
  locationType: string;
  brand: string;
  category: string;
  subCategory: string;
  status: string;
  availability: string;
};

export const currentInventoryDefaults = (branch: string): CurrentInventoryFilters => ({
  query: "", location: canonicalBranchId(branch), locationType: "", brand: "",
  category: "", subCategory: "", status: "", availability: "",
});

export const currentInventoryLocations = (directory: readonly Store[], filters: CurrentInventoryFilters) =>
  directory.filter(location => (filters.location === ALL_INVENTORY_LOCATIONS || sameBranchId(location.id, filters.location)) &&
    (!filters.locationType || (location.locationType ?? "store") === filters.locationType));

export type CurrentInventoryRow = {
  key: string;
  product: Product;
  location: Store;
  quantity: number;
  unitCost: number | null;
  stockCost: number | null;
  retailPrice: number | null;
  stockRetail: number | null;
};

export function productBarcodes(product: Product): string[] {
  return [...new Set([product.barcode, ...(product.barcodes ?? []), ...(product.variants ?? []).map(variant => variant.code)].filter(Boolean))];
}

function stockValue(quantity: number, price: number | null, allowed: boolean) {
  if (!allowed) return null;
  if (quantity === 0) return 0;
  if (price === null) return null;
  const value = quantity * price;
  return Number.isFinite(value) ? value : null;
}

function valueTotal(total: number | null, value: number | null) {
  if (total === null || value === null) return null;
  const sum = total + value;
  return Number.isFinite(sum) ? sum : null;
}

export function buildCurrentInventory(
  products: readonly Product[],
  locations: readonly Store[],
  filters: CurrentInventoryFilters,
  visibleAt: (product: Product, locationId: string) => boolean,
  priceLocation: string,
  mayValue: boolean,
) {
  const rows: CurrentInventoryRow[] = [];
  const productIds = new Set<string>();
  const terms = filters.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  let quantityTotal = 0, low = 0, zero = 0, costTotal: number | null = mayValue ? 0 : null;
  let retailTotal: number | null = mayValue ? 0 : null;
  for (const product of products) {
    if ((filters.brand && product.brand !== filters.brand) ||
      (filters.category && product.category !== filters.category) ||
      (filters.subCategory && product.subCategory !== filters.subCategory) ||
      (filters.status && (product.archived ? "archived" : "active") !== filters.status)) continue;
    if (terms.length) {
      const searchable = [product.name, product.id, product.sku, ...productBarcodes(product)].join(" ").toLocaleLowerCase();
      if (!terms.every(term => searchable.includes(term))) continue;
    }
    const stock = canonicalStockMap(product.stockByStore);
    const unitCost = mayValue && !needsCostReview(product.cost) ? product.cost : null;
    for (const location of locations) {
      if (!visibleAt(product, location.id)) continue;
      const locationId = canonicalBranchId(location.id);
      const quantity = stock[locationId] ?? 0;
      const lowStock = isLowStock(quantity, product.reorderLevel);
      if ((filters.availability === "positive" && quantity <= 0) ||
        (filters.availability === "zero" && quantity !== 0) ||
        (filters.availability === "negative" && quantity >= 0) ||
        (filters.availability === "low" && !lowStock)) continue;
      // The catalogue supplies the selected branch/terminal selling price only.
      const retailPrice = mayValue && sameBranchId(locationId, priceLocation) &&
        Number.isFinite(product.price) && product.price >= 0 ? product.price : null;
      const stockCost = stockValue(quantity, unitCost, mayValue);
      const stockRetail = stockValue(quantity, retailPrice, mayValue);
      rows.push({ key: JSON.stringify([product.id, locationId]), product, location, quantity, unitCost, stockCost, retailPrice, stockRetail });
      productIds.add(product.id);
      quantityTotal += quantity;
      if (lowStock) low++;
      if (quantity === 0) zero++;
      costTotal = valueTotal(costTotal, stockCost);
      retailTotal = valueTotal(retailTotal, stockRetail);
    }
  }
  return { rows, products: productIds.size, quantity: quantityTotal, low, zero, cost: costTotal, retail: retailTotal };
}
