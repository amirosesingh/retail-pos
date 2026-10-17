import { describe, expect, it } from "vitest";
import type { Product } from "@/core/types/pos-types";
import { inventoryMetrics, isLowStock, needsCostReview, productMargin } from "../inventory-metrics";

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
      lowStock: 1,
      outOfStock: 1,
      negativeStock: 0,
      costValue: 10,
      retailValue: 20,
      potentialProfit: 10,
    });
  });
});


describe("inventory stock categories and cost review", () => {
  it("keeps low, zero and negative totals disjoint at reorder boundaries", () => {
    const quantities = [-2, 0, 0.5, 1, 2];
    const metrics = inventoryMetrics(quantities.map(quantity => product({ stockByStore: { [branch]: quantity } })), branch);
    expect(metrics).toMatchObject({ lowStock: 2, outOfStock: 1, negativeStock: 1, units: 1.5 });
    expect(quantities.filter(quantity => isLowStock(quantity, 1))).toEqual([0.5, 1]);
    expect(isLowStock(0, 0)).toBe(false);
    expect(isLowStock(1, 0)).toBe(false);
  });
  it("flags unknown/zero/invalid costs for review without mutating products", () => {
    for (const cost of [0, -1, NaN, Infinity]) {
      expect(needsCostReview(cost)).toBe(true);
      expect(productMargin(20, cost)).toBeNull();
    }
    expect(needsCostReview(0.01)).toBe(false);
    expect(productMargin(20, 10)).toBe(50);
    expect(productMargin(10, 20)).toBe(-100);
    expect(productMargin(0, 10)).toBeNull();
    const original = product({ cost: 0 });
    inventoryMetrics([original], branch);
    expect(original.cost).toBe(0);
  });
});
