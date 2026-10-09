import { describe, expect, it } from "vitest";
import type { Product } from "@/core/types/pos-types";
import { searchSellingProducts, sellingCodeMatches } from "@/lib/register/product-search";

const product = (id: string, extras: Partial<Product> = {}): Product => ({
  id, name: "Shuttle", sku: `SKU-${id}`, barcode: `BAR-${id}`, category: "Sport",
  price: 10, cost: 5, stockByStore: {}, reorderLevel: 0, taxRate: 0, ...extras,
});
const barcode = "552533608-5B2500053000174";
describe("selling product lookup", () => {
  it("searches beyond both former result limits and ranks an exact code first", () => {
    const catalogue = Array.from({length: 150}, (_, i) => product(String(i), {name: `Shuttle ${barcode} ${i}`}));
    const target = product("target", {barcode}); catalogue.push(target);
    expect(searchSellingProducts(catalogue, barcode)).toHaveLength(151);
    expect(searchSellingProducts(catalogue, barcode)[0]).toBe(target);
    expect(sellingCodeMatches(catalogue, ` ${barcode.toLowerCase()} `)).toEqual([target]);
    expect(sellingCodeMatches(catalogue, "5B2500053000174")).toEqual([]);
  });
  it("finds variants, aliases, labels and groups in the same catalogue as inventory", () => {
    const target = product("a", {barcodes: ["ALIAS"], group: "Rackets", variants: [{code: barcode, label: "Blue grip"}]});
    for (const query of ["alias", "blue grip", "rackets", "Shuttle"]) expect(searchSellingProducts([target], query)).toEqual([target]);
    expect(searchSellingProducts([target], barcode, "barcode")).toEqual([target]);
    expect(searchSellingProducts([target], "rackets", "name")).toEqual([]);
  });
  it("returns every duplicate owner for explicit selection and excludes archived products", () => {
    const a = product("a", {barcode}); const b = product("b", {sku: barcode});
    const archived = product("old", {barcode, archived: true});
    expect(sellingCodeMatches([archived, a, b], barcode)).toEqual([a, b]);
    expect(searchSellingProducts([archived, a, b], "")).toEqual([a, b]);
  });
});
