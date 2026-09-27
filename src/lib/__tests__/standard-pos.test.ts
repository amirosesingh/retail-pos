import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { frequentRecentProducts } from "@/lib/standard-pos";
import type { Product, Sale } from "@/core/types/pos-types";

const product = (id: string, archived = false) =>
  ({
    id,
    name: id,
    sku: id,
    category: "General",
    price: 1,
    cost: 0,
    stockByStore: {},
    reorderLevel: 0,
    taxRate: 0,
    archived,
  }) as Product;

const sale = (storeId: string, ids: string[]) =>
  ({
    id: crypto.randomUUID(),
    receiptNo: "R-1",
    storeId,
    shiftId: "shift-1",
    lines: ids.map((productId) => ({
      productId,
      name: productId,
      price: 1,
      qty: 1,
      taxRate: 0,
      discount: 0,
    })),
    subtotal: ids.length,
    discount: 0,
    tax: 0,
    total: ids.length,
    paid: ids.length,
    change: 0,
    method: "cash",
    cashier: "Cashier",
    createdAt: new Date().toISOString(),
  }) as Sale;

describe("Standard POS recommendations", () => {
  it("ranks only recent products sold by the active branch", () => {
    const products = [product("a"), product("b"), product("c")];
    const result = frequentRecentProducts(
      products,
      [sale("branch-1", ["b", "b", "a"]), sale("branch-2", ["c", "c", "c"])],
      "branch-1",
    );
    expect(result.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("returns a bounded shelf and omits archived products", () => {
    const products = [product("a", true), product("b"), product("c")];
    const result = frequentRecentProducts(
      products,
      [sale("branch-1", ["a", "b", "c"])],
      "branch-1",
      1,
    );
    expect(result.map((item) => item.id)).toEqual(["b"]);
  });
});

describe("Standard POS presentation", () => {
  it("uses product lookup plus one larger current-sale workspace", () => {
    const register = readFileSync("src/routes/index.tsx", "utf8");
    expect(register).toContain("Product lookup stays deliberately smaller than the sale");
    expect(register).toContain("Current sale owns the remaining width");
    expect(register).toContain('label="Resize product lookup"');
    expect(register).not.toContain('label="Resize the register actions column"');
  });

  it("keeps frequent actions visible and secondary actions grouped", () => {
    const register = readFileSync("src/routes/index.tsx", "utf8");
    for (const label of ["Hold order", "Held bills", "Apply coupon", "Receipt", "More actions"]) {
      expect(register).toContain(label);
    }
  });
});
