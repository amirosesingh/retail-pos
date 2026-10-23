import { describe, expect, it } from "vitest";
import type { Product } from "@/core/types/pos-types";
import { productsForExport } from "@/lib/product-export";

const product = (id: string, archived: boolean, stock: number): Product => ({
  id, name: id, sku: id, barcode: id, category: "Test", cost: 1, price: 2,
  taxRate: 0, reorderLevel: 0, archived, stockByStore: { branch: stock },
});

describe("inventory Excel export scope", () => {
  const products = [product("available", false, 2), product("zero", false, 0), product("archived", true, 9)];

  it("exports the requested catalogue group rather than the current visible page", () => {
    expect(productsForExport(products, "all", "branch").map(p => p.id)).toEqual(["available", "zero", "archived"]);
    expect(productsForExport(products, "active", "branch").map(p => p.id)).toEqual(["available", "zero"]);
    expect(productsForExport(products, "active-in-stock", "branch").map(p => p.id)).toEqual(["available"]);
    expect(productsForExport(products, "archived", "branch").map(p => p.id)).toEqual(["archived"]);
  });
});
