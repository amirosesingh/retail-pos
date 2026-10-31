import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { currentBranchStockColumnQuantity, inventoryColumnsMatch } from "../inventory-column-filter";
import { branchInventoryArchived } from "../inventory-branch-view";
import { displayedStockQuantity } from "../stock-quantity-display";
describe("Inventory column filtering", () => {
  it("matches the actual JSX heading's extra spaces without skipping stock filtering", () => {
    const rows = [1, 2, 10, -1, 0].map(qty => ({ "Stock · HC": `${qty} in stock` }));
    expect(rows.filter(row => inventoryColumnsMatch(row, { "Stock ·  HC": "2" }))).toEqual([{ "Stock · HC": "2 in stock" }]);
    expect(rows.filter(row => inventoryColumnsMatch(row, { " Stock ·   HC ": "1" }))).toEqual([{ "Stock · HC": "1 in stock" }]);
    expect(inventoryColumnsMatch({ "Stock · HC": "1e-7 in stock" }, { "Stock ·  HC": "1" })).toBe(false);
    expect(inventoryColumnsMatch({ "Stock · HC": "1e-7 in stock" }, { "Stock ·  HC": "0.0000001" })).toBe(true);
  });
  it.each([1, -1, 0, 0.5])("matches stock %s exactly rather than a numeric substring", wanted => {
    const quantities = [-10, -1, 0, 0.5, 1, 10, 101];
    const matches = quantities.filter(qty => inventoryColumnsMatch({ "Stock · HC": `${qty} in stock${qty < 0 ? " Negative stock" : ""}` }, { "Stock · HC": String(wanted) }));
    expect(matches).toEqual([wanted]);
  });
  it("retains text stock warnings and combines exact stock with other column filters", () => {
    expect(inventoryColumnsMatch({ "Stock · HC": "-1 in stock Negative stock", Product: "Shoe" }, { "Stock · HC": "negative", Product: "shoe" })).toBe(true);
    expect(inventoryColumnsMatch({ "Stock · HC": "1 in stock", Product: "Shoe" }, { "Stock · HC": "1.0", Product: "racket" })).toBe(false);
    expect(inventoryColumnsMatch({ "Stock · HC": "0 in stock" }, { "Stock · HC": "-0" })).toBe(true);
  });
  it("matches only the named column, with AND between independent filters", () => {
    const values = { Product: "Blue court shoe SKU-20", Category: "Running", Price: "20 MYR20.00" };
    expect(inventoryColumnsMatch(values, { Product: "blue" })).toBe(true);
    expect(inventoryColumnsMatch(values, { Category: "blue" })).toBe(false);
    expect(inventoryColumnsMatch(values, { Product: " BLUE ", Category: "running" })).toBe(true);
    expect(inventoryColumnsMatch(values, { Product: "blue", Category: "court" })).toBe(false);
    expect(inventoryColumnsMatch(values, { Price: "20.00" })).toBe(true);
    expect(inventoryColumnsMatch(values, { Category: " " })).toBe(true);
  });
  it("finds matches beyond the initial table page before pagination", () => {
    const all = Array.from({ length: 100 }, (_, i) => ({ Product: `Item ${i}`, Category: i === 80 ? "Target" : "Other" }));
    const filtered = all.filter(row => inventoryColumnsMatch(row, { Category: "target" }));
    expect(filtered).toEqual([{ Product: "Item 80", Category: "Target" }]);
    expect(filtered.slice(0, 25)).toHaveLength(1);
  });
  it.each([-1, 0, 1, 2, 0.25])("compares typed scoped stock %s, not source counts, names or code digits", wanted => {
    const quantities = [-1, 0, 1, 2, 0.25, 10, 12];
    for (const label of ["Stock · HC", "Other stores"]) {
      const result = quantities.filter(quantity => inventoryColumnsMatch({ [label]: "Other Sources: 1 Total Available: 2 Store 0 SKU-12" }, { [label]: String(wanted) }, { [label]: quantity }));
      expect(result).toEqual([wanted]);
    }
  });
  it("uses the same typed 3-decimal available quantity as Other Sources displays", () => {
    const total = displayedStockQuantity(1.23456);
    expect(total).toBe(1.235);
    expect(inventoryColumnsMatch({ "Other stores": "Other Sources: 1 Total Available: 1.235 pcs" }, { "Other stores": "1.235" }, { "Other stores": total })).toBe(true);
    expect(inventoryColumnsMatch({ "Other stores": "Other Sources: 1 Total Available: 1.235 pcs" }, { "Other stores": "1" }, { "Other stores": total })).toBe(false);
    expect(inventoryColumnsMatch({ "Other stores": "No available sources" }, { "Other stores": "0" }, { "Other stores": 0 })).toBe(true);
  });
  it.each([-1, 0, 1, 2, 0.25])("searches exact current-branch stock %s across both views without changing the selected mode", wanted => {
    const products = [-10, -1, 0, 0.25, 1, 2, 10].map(qty => ({ qty, cluster: "own" }));
    products.push({ qty: wanted, cluster: "other" });
    const before = JSON.stringify(products);
    const filters = { " Stock ·  HC ": String(wanted) };
    const quantity = currentBranchStockColumnQuantity(filters, "HC");
    for (const archived of [false, true]) {
      const matches = products.filter(product => product.cluster === "own" &&
        (quantity !== null || branchInventoryArchived({ stockByStore: { hc: product.qty } }, "hc") === archived) &&
        inventoryColumnsMatch({ "Stock · HC": `${product.qty} in stock` }, filters, { "Stock · HC": product.qty }));
      expect(matches.map(row => row.qty)).toEqual([wanted]);
      const restored = products.filter(product => product.cluster === "own" && (currentBranchStockColumnQuantity({}, "HC") !== null || branchInventoryArchived({ stockByStore: { hc: product.qty } }, "hc") === archived));
      expect(restored.every(row => (row.qty <= 0) === archived)).toBe(true);
    }
    expect(JSON.stringify(products)).toBe(before);
  });
  it("does not cross views for broad/text/Other stores/another branch's filters or invalid numeric input", () => {
    const nonNumericFilters: Record<string, string>[] = [{ Product: "0" }, { "Other stores": "0" }, { "Stock · OTHER": "0" }, { "Stock · HC": "negative" }, { "Stock · HC": "" }, { "Stock · HC": "Infinity" }, { "Stock · HC": "9".repeat(500) }];
    for (const filters of nonNumericFilters)
      expect(currentBranchStockColumnQuantity(filters, "HC")).toBeNull();
    expect(currentBranchStockColumnQuantity({ "Stock · HC": "-0" }, "HC")).toEqual(-0);
    expect(branchInventoryArchived({ stockByStore: { hc: -1 } }, "hc")).toBe(true);
    expect(branchInventoryArchived({ stockByStore: { hc: 2 } }, "hc")).toBe(false);
  });
  it("opts Inventory into complete-data filtering without changing the default table path", () => {
    const source = readFileSync("src/routes/inventory.tsx", "utf8");
    const table = readFileSync("src/components/ui/table.tsx", "utf8");
    expect(source).toContain("onColumnFiltersChange={setColumnFilters}");
    expect(source.indexOf("inventoryColumnsMatch(columnValues, columnFilters,")).toBeGreaterThan(-1);
    expect(source.indexOf("inventoryColumnsMatch(columnValues, columnFilters,")).toBeLessThan(source.indexOf("usePagination(rows, 25)"));
    expect(table).toContain("clientDataControls && !onColumnFiltersChange");
    expect(source).toContain('aria-label="Search products"');
    expect(source).toContain("currentStockColumnQuantity === null && branchInventoryArchived(p, state.currentStoreId) !== showArchived");
    expect(source).toContain("disabled={currentStockColumnQuantity !== null}");
    expect(source).toContain("searching Active and Archive");
    expect(source).toContain("Other filters still apply.");
  });
});
