import { describe, expect, it } from "vitest";
import type { Product } from "@/core/types/pos-types";
import {
  findDuplicateProductCodes,
  productCodeProblems,
  variantForBarcode,
} from "@/lib/product-lookup";

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

  it("allows unrelated edits when an existing legacy code is duplicated", () => {
    const first = product("a", "DUPLICATE", "BAR-1");
    const second = product("b", "duplicate", "BAR-2");
    expect(productCodeProblems([first, second], { ...second, name: "Renamed" })).toEqual([]);
    expect(productCodeProblems([first, second], { ...second, barcode: "DUPLICATE" })).toEqual([
      "duplicate is repeated on this product.",
      "duplicate already belongs to Product a (DUPLICATE).",
    ]);
  });

  it("ignores malformed persisted variant codes instead of throwing", () => {
    const draft = product("a", "SKU-1", "BAR-1", {
      variants: [{ code: undefined as unknown as string }],
    });
    expect(productCodeProblems([], draft)).toEqual([]);
  });

  it("resolves the exact barcode variation with its own cost and selling price", () => {
    const row = product("a", "SKU-1", "BAR-1", {
      variants: [{ code: "BLUE-1", label: "Blue", cost: 7.5, price: 12.9 }],
    });
    expect(variantForBarcode(row, " blue-1 ")).toEqual({
      code: "BLUE-1",
      label: "Blue",
      cost: 7.5,
      price: 12.9,
    });
    expect(variantForBarcode(row, "BAR-1")).toBeUndefined();
  });
});
