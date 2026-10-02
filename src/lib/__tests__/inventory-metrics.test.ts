import { describe, expect, it } from "vitest";
import type { Product } from "@/core/types/pos-types";
import { inventoryMetrics } from "../inventory-metrics";

const branch = "15a19c3f-1805-428b-8606-e82e474f0db3";
const product = (overrides: Partial<Product>): Product => ({
  id: crypto.randomUUID(),
  name: "Item",
  sku: "SKU",
  barcode: "BAR",
  category: "Shoes",
  price: 20,
  cost: 10,
  stockByStore: { [branch]: 2 },
  reorderLevel: 1,
  taxRate: 0,
  ...overrides,
});

describe("inventory metrics", () => {
  it("summarizes only active products and merges case-variant branch stock", () => {
    const metrics = inventoryMetrics(
      [
        product({ stockByStore: { [branch]: 2, [branch.toUpperCase()]: -1 } }),
        product({ category: "Clothing", stockByStore: { [branch]: 0 } }),
        product({ archived: true, stockByStore: { [branch]: 99 } }),
      ],
      branch.toUpperCase(),
    );
    expect(metrics).toMatchObject({
      products: 2,
      categories: 2,
      units: 1,
      lowStock: 2,
      outOfStock: 1,
      negativeStock: 0,
      costValue: 10,
      retailValue: 20,
      potentialProfit: 10,
    });
  });
});
