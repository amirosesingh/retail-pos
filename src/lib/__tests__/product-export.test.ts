import { describe, expect, it, vi } from "vitest";
import type { Product } from "@/core/types/pos-types";
const exportMocks = vi.hoisted(() => ({ rows: vi.fn(), write: vi.fn() }));
vi.mock("xlsx", () => ({ utils: { json_to_sheet: exportMocks.rows, book_new: () => ({}), book_append_sheet: vi.fn() }, writeFile: exportMocks.write }));
import { productsForExport, exportProductsXlsx } from "@/lib/product-export";

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

it("omits cost and e-commerce columns from exports when those controls are unavailable", async () => {
  const item={...product("item",false,2),cost:15,ecomPrice:25};
  await exportProductsXlsx([item],[],"safe",false,false);
  const rows=exportMocks.rows.mock.calls.at(-1)?.[0];
  expect(rows[0]).not.toHaveProperty("cost");expect(rows[0]).not.toHaveProperty("ecom_price");expect(rows[0].price).toBe(2);
  await exportProductsXlsx([item],[],"management",true,true);
  expect(exportMocks.rows.mock.calls.at(-1)?.[0][0]).toMatchObject({cost:15,ecom_price:25});
});
