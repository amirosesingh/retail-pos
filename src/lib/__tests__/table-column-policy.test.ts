import { describe, expect, it } from "vitest";
import { catalogColumnPositions, tableColumnHidden, withTableColumnRule } from "../table-column-policy";

it("keeps inventory rules aligned when cost and web columns are permission-gated", () => {
  expect(catalogColumnPositions("routes/inventory#1", ["", "Product", "Category", "Price", "Margin", "Stock · STR1", "Other stores"]))
    .toEqual([0, 1, 2, 6, 7, 9, 10]);
});

describe("table column settings", () => {
  it("applies all, role, and individual restrictions independently", () => {
    let rules = withTableColumnRule({}, "inventory/products", 3, "role:cashier", true);
    rules = withTableColumnRule(rules, "inventory/products", 4, "user:alice", true);
    expect(tableColumnHidden(rules, "inventory/products", 3, "cashier", "bob")).toBe(true);
    expect(tableColumnHidden(rules, "inventory/products", 3, "admin", "bob")).toBe(false);
    expect(tableColumnHidden(rules, "inventory/products", 4, "admin", "alice")).toBe(true);
    rules = withTableColumnRule(rules, "inventory/products", 2, "all", true);
    expect(tableColumnHidden(rules, "inventory/products", 2, "admin", "bob")).toBe(true);
    expect(tableColumnHidden(rules, "inventory/products", 2, "cashier", "alice")).toBe(true);
  });
  it("removes just the selected restriction", () => {
    const rules = withTableColumnRule({ "table:a:1": ["all", "role:cashier"] }, "a", 1, "all", false);
    expect(rules["table:a:1"]).toEqual(["role:cashier"]);
  });
});
