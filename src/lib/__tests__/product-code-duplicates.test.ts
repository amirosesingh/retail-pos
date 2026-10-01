import { describe, expect, it } from "vitest";
import type { Product } from "@/core/types/pos-types";
import { findDuplicateProductCodes, productCodeProblems } from "@/lib/product-lookup";

const product = (
  id: string,
  sku: string,
  barcode: string,
  extras: Partial<Product> = {},
): Product => ({
  id,
  name: `Product ${id}`,
  sku,
  barcode,
  category: "General",
  price: 10,
  cost: 5,
  stockByStore: {},
  reorderLevel: 1,
  taxRate: 0,
  ...extras,
});

describe("catalogue code duplicate audit", () => {
  it("finds clashes across SKU, primary, alias and variant barcodes", () => {
    const rows = [
      product("a", "SKU-1", "BAR-1", { barcodes: ["ALIAS-1"] }),
      product("b", "sku-1", "BAR-2", { variants: [{ code: "alias-1" }] }),
    ];
    expect(findDuplicateProductCodes(rows).map((entry) => entry.code)).toEqual([
      "alias-1",
      "sku-1",
    ]);
  });

  it("blocks codes repeated within an edit or owned by another product", () => {
    const existing = product("a", "SKU-1", "BAR-1");
    const draft = product("b", "sku-1", "NEW", { barcodes: ["NEW"] });
    expect(productCodeProblems([existing], draft)).toEqual([
      "NEW is repeated on this product.",
      "sku-1 already belongs to Product a (SKU-1).",
    ]);
  });
});
