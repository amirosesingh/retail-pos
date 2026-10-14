import { describe, expect, it } from "vitest";
import { withRelativeStock } from "../sync-stock";
import type { SyncOp } from "../sync-outbox";

describe("stock count cloud movements", () => {
  it("keeps adjustment IDs stable and strips absolute stock from cloud product writes", () => {
    const ops: SyncOp[] = [
      {
        kind: "upsert",
        table: "products",
        rows: [{ id: "p", stock_by_store: { branch: 1 }, stock_quantity: 1, name: "Shirt" }],
      },
      {
        kind: "upsert",
        table: "stock_adjustments",
        rows: [
          {
            id: "adjustment-1",
            product_id: "p",
            store_id: "branch",
            previous_stock: 0,
            updated_stock: 1,
            delta: 1,
          },
        ],
      },
    ];
    const converted = withRelativeStock(ops);
    expect(converted.deltas).toEqual([
      { movementId: "adjustment-1", productId: "p", storeId: "branch", delta: 1 },
    ]);
    expect(converted.ops[0]).toEqual({
      kind: "upsert",
      table: "products",
      rows: [{ id: "p", name: "Shirt" }],
    });
    expect(converted.ops[1]).toBe(ops[1]);
    expect(withRelativeStock(ops).deltas).toEqual(converted.deltas);
    expect(ops[0]).toHaveProperty("rows.0.stock_by_store.branch", 1);
  });
  it("supports negative counts and simultaneous sale movements without changing their identities", () => {
    const converted = withRelativeStock([
      {
        kind: "insert",
        table: "stock_adjustments",
        rows: [{ id: "count", product_id: "p", store_id: "b", delta: -2 }],
      },
      {
        kind: "insert",
        table: "item_activity_logs",
        rows: [{ id: "sale", product_id: "q", store_id: "b", quantity_delta: -1 }],
      },
    ]);
    expect(converted.deltas.map((row) => [row.movementId, row.delta])).toEqual([
      ["count", -2],
      ["sale", -1],
    ]);
  });
});
