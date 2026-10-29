import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { inventoryColumnsMatch } from "../inventory-column-filter";
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
  it("opts Inventory into complete-data filtering without changing the default table path", () => {
    const source = readFileSync("src/routes/inventory.tsx", "utf8");
    const table = readFileSync("src/components/ui/table.tsx", "utf8");
    expect(source).toContain("onColumnFiltersChange={setColumnFilters}");
    expect(source.indexOf("inventoryColumnsMatch(columnValues, columnFilters)")).toBeLessThan(source.indexOf("usePagination(rows, 25)"));
    expect(table).toContain("clientDataControls && !onColumnFiltersChange");
    expect(source).toContain('aria-label="Search products"');
  });
});
