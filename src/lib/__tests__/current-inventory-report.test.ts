import { describe, expect, it } from "vitest";
import type { Product, Store } from "@/core/types/pos-types";
import { stockDisplayLocations } from "../all-shops-stock";
import { ALL_INVENTORY_LOCATIONS, buildCurrentInventory, currentInventoryDefaults, currentInventoryLocations, productBarcodes } from "../current-inventory-report";

const location = (id: string, locationType: Store["locationType"] = "store"): Store => ({
  id, name: id, code: id, address: "", phone: "", locationType,
});
const branch = location("branch");
const warehouse = location("warehouse", "central_warehouse");
const product = (id: string, patch: Partial<Product> = {}): Product => ({
  id, name: "Trail shoe", sku: id, barcode: "0012345", category: "Shoes", subCategory: "Trail",
  brand: "Fleet", price: 11.25, cost: 4, stockByStore: { branch: 2, warehouse: 3 },
  reorderLevel: 2, taxRate: 0, ...patch,
});
const defaults = currentInventoryDefaults(branch.id);
const all = { ...defaults, location: ALL_INVENTORY_LOCATIONS };

describe("current inventory reporting", () => {
  it("keeps product and location identity with barcode aliases and branch-limited valuation", () => {
    const first = product("p1", { variants: [{ code: "0000007", label: "Blue" }], barcodes: ["0012345", "0000007"] });
    const second = product("p2");
    const allRows = buildCurrentInventory([first, second], [branch, warehouse], all, () => true, branch.id, true);
    expect(productBarcodes(first)).toEqual(["0012345", "0000007"]);
    expect(allRows).toMatchObject({ products: 2, quantity: 10, cost: 40, retail: null });
    expect(new Set(allRows.rows.map(row => row.key)).size).toBe(4);
    expect(allRows.rows.filter(row => row.location.id === warehouse.id)).toEqual([
      expect.objectContaining({ retailPrice: null, stockRetail: null }),
      expect.objectContaining({ retailPrice: null, stockRetail: null }),
    ]);
    const matching = buildCurrentInventory([first, second], [branch], { ...defaults, query: "0000007" }, () => true, branch.id, true);
    expect(matching).toMatchObject({ products: 1, quantity: 2, cost: 8, retail: 22.5 });
  });

  it("uses the registered branch even when the supplied directory also includes a warehouse", () => {
    const authorized = stockDisplayLocations([branch, warehouse], {
      currentStoreId: warehouse.id, terminalStoreId: branch.id, canSwitchStores: true,
    });
    const selected = currentInventoryLocations(authorized, all);
    expect(selected).toEqual([branch]);
    expect(currentInventoryLocations(authorized, { ...all, locationType: "central_warehouse" })).toEqual([]);
    const report = buildCurrentInventory([product("p1")], selected, all, () => true, branch.id, false);
    expect(report).toMatchObject({ quantity: 2, cost: null, retail: null });
    expect(report.rows[0]).toMatchObject({ unitCost: null, stockCost: null, retailPrice: null, stockRetail: null });
  });

  it("checks filters before totals and preserves missing cost, exact zero, and negative stock", () => {
    const filters = { ...defaults, brand: "Fleet", category: "Shoes", subCategory: "Trail", status: "archived" };
    const rows = [
      product("hidden", { archived: true, stockByStore: { branch: 250 } }),
      product("positive", { archived: true, cost: 0 }),
      product("zero", { archived: true, cost: 0, stockByStore: { branch: 0 } }),
      product("negative", { archived: true, stockByStore: { branch: -1 } }),
      product("other-brand", { archived: true, brand: "Other" }),
      product("active"),
    ];
    const allowed = (row: Product) => row.id !== "hidden";
    const allRows = buildCurrentInventory(rows, [branch], filters, allowed, branch.id, true);
    expect(allRows).toMatchObject({ products: 3, quantity: 1, low: 1, zero: 1, cost: null, retail: 11.25 });
    const zeros = buildCurrentInventory(rows, [branch], { ...filters, availability: "zero" }, allowed, branch.id, true);
    expect(zeros).toMatchObject({ products: 1, quantity: 0, cost: 0, retail: 0, rows: [{ unitCost: null }] });
    const negative = buildCurrentInventory(rows, [branch], { ...filters, availability: "negative" }, allowed, branch.id, true);
    expect(negative).toMatchObject({ products: 1, quantity: -1, cost: -4, retail: -11.25 });
  });
});
