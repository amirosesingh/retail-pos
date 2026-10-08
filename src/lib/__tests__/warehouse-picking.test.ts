import { describe, expect, it } from "vitest";
import { availableAt, planDeduction } from "../locations";
import type { Product, Store } from "@/core/types/pos-types";
const locations = [
  { id: "hub", name: "Hub", active: true },
  {
    id: "primary",
    name: "Primary",
    parentId: "hub",
    locationType: "sub_warehouse",
    isPrimarySub: true,
    active: true,
  },
  {
    id: "secondary",
    name: "Secondary",
    parentId: "hub",
    locationType: "sub_warehouse",
    active: true,
  },
  {
    id: "archived",
    name: "Archived",
    parentId: "hub",
    locationType: "sub_warehouse",
    active: false,
  },
  { id: "other", name: "Other branch", locationType: "sub_warehouse", active: true },
] as Store[];
const product: Product = {
  id: "p",
  name: "Product",
  sku: "p",
  barcode: "p",
  category: "Test",
  price: 1,
  cost: 1,
  reorderLevel: 0,
  taxRate: 0,
  stockByStore: { primary: 1.5, secondary: 3, archived: 100, other: 1000 },
};
describe("warehouse stock isolation", () => {
  it("picks the primary then secondary warehouse without taking another branch's stock", () => {
    expect(planDeduction(product, locations, "hub", 2.5)).toEqual({
      picks: [
        { storeId: "primary", name: "Primary", qty: 1.5 },
        { storeId: "secondary", name: "Secondary", qty: 1 },
      ],
      taken: 2.5,
      shortBy: 0,
    });
  });
  it("excludes archived warehouses from availability", () => {
    expect(availableAt(product, locations, "hub")).toBe(4.5);
    expect(planDeduction(product, locations, "hub", 5).shortBy).toBe(0.5);
  });
  it("never picks stock from an archived or missing root warehouse", () => {
    const archived = locations.map((location) =>
      location.id === "hub" ? { ...location, active: false } : location,
    );
    expect(
      planDeduction(
        { ...product, stockByStore: { ...product.stockByStore, hub: 10 } },
        archived,
        "hub",
        2,
      ),
    ).toEqual({ picks: [], taken: 0, shortBy: 2 });
    expect(planDeduction(product, locations, "missing", 2)).toEqual({
      picks: [],
      taken: 0,
      shortBy: 2,
    });
  });

  it("rejects invalid quantities", () => {
    expect(() => planDeduction(product, locations, "hub", Infinity)).toThrow();
    expect(() => planDeduction(product, locations, "hub", -1)).toThrow();
  });
});
