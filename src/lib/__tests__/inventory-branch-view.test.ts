import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Product } from "@/core/types/pos-types";
import { branchInventoryArchived, branchInventoryCounts } from "../inventory-branch-view";

const product = (stockByStore: Record<string, number>, archived = false): Product => ({
  id: "p", name: "Item", sku: "SKU-1", barcode: "1", category: "Default", cost: 2,
  price: 4, taxRate: 0, reorderLevel: 1, stockByStore, archived,
});
describe("branch Inventory Active and Archive views", () => {
  it("classifies zero and negative locally without changing another branch or global flags", () => {
    const rows = [product({ a: 0, b: 4 }), product({ a: -2, b: 3 }), product({ a: 1, b: 0 }, true)];
    const before = JSON.stringify(rows);
    expect(branchInventoryCounts(rows, "a")).toEqual({ active: 1, archived: 2, negative: 1 });
    expect(branchInventoryCounts(rows, "b")).toEqual({ active: 2, archived: 1, negative: 0 });
    expect(branchInventoryArchived(rows[0], "a")).toBe(true);
    expect(branchInventoryArchived(rows[0], "b")).toBe(false);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("preserves fractions and canonical UUID quantities", () => {
    const branch = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    expect(branchInventoryArchived(product({ [branch]: 2, [branch.toUpperCase()]: -2 }), branch)).toBe(true);
    expect(branchInventoryArchived(product({ a: 0.25 }), "a")).toBe(false);
    expect(branchInventoryArchived(product({}), "a")).toBe(true);
  });
  it("counts the complete scoped catalogue rather than one table page", () => {
    const rows = Array.from({ length: 2169 }, (_, i) => product({ a: i < 600 ? 0 : 1, b: 0 }));
    expect(branchInventoryCounts(rows, "a")).toEqual({ active: 1569, archived: 600, negative: 0 });
    expect(branchInventoryCounts(rows, "b")).toEqual({ active: 0, archived: 2169, negative: 0 });
  });
  it("uses the branch view for rows, counts and exports and labels global actions separately", () => {
    const source = readFileSync("src/routes/inventory.tsx", "utf8");
    expect(source).toContain("branchInventoryArchived(p, state.currentStoreId) !== showArchived");
    expect(source).toContain('scope === "all" ? catalogProducts : catalogProducts.filter');
    expect(source).toContain("Warning:");
    expect(source).toContain("Negative stock");
    expect(source).toContain("Archive shared product globally");
    expect(source).toContain("Restore shared product status");
  });
});
