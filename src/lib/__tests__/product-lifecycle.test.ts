import { describe, expect, it } from "vitest";
import type { Product } from "@/core/types/pos-types";
import {
  applyZeroStockLifecycle,
  applyZeroStockLifecycleToProducts,
  hasCompanyStock,
} from "../product-lifecycle";

const product = (stockByStore: Record<string, number>, archived = false): Product => ({
  id: "p1",
  name: "Shuttlecock",
  sku: "S1",
  barcode: "S1",
  category: "General",
  price: 2,
  cost: 1,
  stockByStore,
  reorderLevel: 1,
  taxRate: 0,
  archived,
});

describe("zero-stock catalogue lifecycle", () => {
  it("treats stock as company-wide across every branch", () => {
    expect(hasCompanyStock(product({ a: 0, b: 2 }))).toBe(true);
    expect(hasCompanyStock(product({ a: 0, b: 0 }))).toBe(false);
    expect(hasCompanyStock(product({ a: -2, b: 0 }))).toBe(false);
  });

  it("deactivates zero-stock products when the lifecycle is enabled", () => {
    expect(applyZeroStockLifecycle(product({ a: 0 }), true).archived).toBe(true);
    expect(applyZeroStockLifecycle(product({ a: 0 }), false).archived).toBe(false);
  });

  it("does not reactivate a deliberately archived product that has stock", () => {
    expect(applyZeroStockLifecycle(product({ a: 3 }, true), true).archived).toBe(true);
  });

  it("normalizes a stale initial catalogue snapshot", () => {
    const result = applyZeroStockLifecycleToProducts(
      [product({ a: 0 }), { ...product({ a: 4 }), id: "p2" }],
      true,
    );
    expect(result.map((entry) => entry.archived)).toEqual([true, false]);
  });
});
