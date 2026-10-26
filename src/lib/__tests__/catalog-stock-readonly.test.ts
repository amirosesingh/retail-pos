import { expect, it } from "vitest";
import { catalogProductRow } from "@/core/api/pos-db";
import type { Product } from "@/core/types/pos-types";
it("omits all stock columns from catalog saves, including a stale cross-branch draft", () => {
  const product = {id:"p1",name:"Item",sku:"1",barcode:"1",price:12,cost:5,category:"Default",taxRate:0,reorderLevel:2,stockByStore:{branchA:999,branchB:-30}} as Product;
  const row = catalogProductRow(product);
  expect(row).not.toHaveProperty("stock_quantity");
  expect(row).not.toHaveProperty("stock_by_store");
  expect(row.selling_price).toBe(12);
  expect(product.stockByStore).toEqual({branchA:999,branchB:-30});
});

it("preserves restricted price fields by omitting them from a catalog update", () => {
  const product = {id:"p1",name:"Item",sku:"1",barcode:"1",price:12,cost:5,ecomPrice:20,ecomVisible:true,category:"Default",taxRate:0,reorderLevel:2,stockByStore:{a:2}} as Product;
  const row = catalogProductRow(product,{ecommerce:false,cost:false});
  expect(row).not.toHaveProperty("cost_price");expect(row).not.toHaveProperty("ecom_price");expect(row).not.toHaveProperty("ecom_visible");expect(row.selling_price).toBe(12);
});
