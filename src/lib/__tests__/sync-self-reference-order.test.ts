import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { orderSelfReferencingRows } = require("../../../electron/sync/self-reference-order.cjs");
const registry = require("../../../database/sqlserver/schema-registry.json");
const table = (name: string) => registry.tables.find((entry: { cloudTable: string }) => entry.cloudTable === name);
const change = (row: Record<string, unknown>) => ({ row_data: row });

const childId = "00000000-0000-4000-8000-000000000001";
const parentId = "aaaaaaaa-0000-4000-8000-000000000002";
const grandparentId = "bbbbbbbb-0000-4000-8000-000000000003";

describe("same-page foreign-key ordering", () => {
  it.each([
    ["product_categories", "parent_id"],
    ["stores", "parent_id"],
    ["stock_transfers", "source_request_id"],
  ])("orders the same-page %s hierarchy before child upserts", (name, foreignKey) => {
    const child = change({ id: childId, [foreignKey]: parentId.toUpperCase() });
    const parent = change({ id: parentId, [foreignKey]: grandparentId });
    const grandparent = change({ id: grandparentId, [foreignKey]: null });
    const rows = [child, parent, grandparent];

    expect(orderSelfReferencingRows(table(name), rows)).toEqual([grandparent, parent, child]);
    expect(rows).toEqual([child, parent, grandparent]);
    expect(child.row_data[foreignKey]).toBe(parentId.toUpperCase());
  });

  it("keeps every duplicate operation in its original per-ID order", () => {
    const child = change({ id: childId, parent_id: parentId, row_version: 1 });
    const laterChild = change({ id: childId, parent_id: null, row_version: 2 });
    const parent = change({ id: parentId, parent_id: null, row_version: 1 });
    const laterParent = change({ id: parentId.toUpperCase(), parent_id: null, row_version: 2 });

    expect(orderSelfReferencingRows(table("product_categories"), [child, laterChild, parent, laterParent]))
      .toEqual([parent, child, laterChild, laterParent]);
  });

  it("keeps an off-page parent reference for the existing SQL check", () => {
    const child = change({ id: childId, parent_id: parentId });
    const other = change({ id: grandparentId, parent_id: null });
    const rows = [child, other];

    expect(orderSelfReferencingRows(table("product_categories"), rows)).toEqual(rows);
    expect(child.row_data.parent_id).toBe(parentId);
  });

  it("leaves a cycle to the existing database foreign-key checks", () => {
    const rows = [change({ id: childId, parent_id: parentId }), change({ id: parentId, parent_id: childId })];

    expect(orderSelfReferencingRows(table("product_categories"), rows)).toBe(rows);
  });

  it("keeps the original array for a table without self references", () => {
    const rows = [change({ id: childId, product_id: parentId }), change({ id: grandparentId, product_id: childId })];

    expect(orderSelfReferencingRows(table("sale_items"), rows)).toBe(rows);
  });
});
