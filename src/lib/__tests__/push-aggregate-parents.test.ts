import { describe, expect, it, vi } from "vitest";

const tables = [
  { cloudTable: "purchase_orders", sqlServerTable: "purchase_orders", dependencyOrder: 1 },
  { cloudTable: "purchase_order_items", sqlServerTable: "purchase_order_items", dependencyOrder: 3 },
];

describe("queued receiving aggregate recovery", () => {
  const aggregate = {
    aggregateId: "00000000-0000-4000-8000-000000000001",
    changes: [{ entity_type: "purchase_order_items", entity_id: '{"id":"line"}',
      operation: "insert", key: { id: "line" } }],
  };

  it("sends the branch-owned header before a child-only queued change", async () => {
    const reader = {
      pendingAggregates: vi.fn().mockResolvedValueOnce([aggregate]).mockResolvedValueOnce([]),
      rows: vi.fn(async (table: { cloudTable: string }) => table.cloudTable === "purchase_orders"
        ? [{ id: "order", store_id: "B1" }]
        : [{ id: "line", po_id: "order" }]),
      acknowledgeAggregate: vi.fn(), failAggregate: vi.fn(),
    };
    const cloud = { pushAggregate: vi.fn().mockResolvedValue({ ok: true }), terminalId: () => "T1" };
    const { PushWorker } = await import("../../../electron/sync/push-worker.cjs");
    await new PushWorker({ reader, cloud, checkpoints: {}, registry: { tables } })
      .pushAggregates("B1", 100);
    expect(cloud.pushAggregate.mock.calls[0][0].operations.map((op: { table: string }) => op.table))
      .toEqual(["purchase_orders", "purchase_order_items"]);
    expect(reader.acknowledgeAggregate).toHaveBeenCalledWith(aggregate.aggregateId);
  });

  it("refuses a parent belonging to another branch", async () => {
    const reader = {
      pendingAggregates: vi.fn().mockResolvedValueOnce([aggregate]),
      rows: vi.fn(async (table: { cloudTable: string }) => table.cloudTable === "purchase_orders"
        ? [{ id: "order", store_id: "B2" }]
        : [{ id: "line", po_id: "order" }]),
      acknowledgeAggregate: vi.fn(), failAggregate: vi.fn(),
    };
    const cloud = { pushAggregate: vi.fn(), terminalId: () => "T1" };
    const { PushWorker } = await import("../../../electron/sync/push-worker.cjs");
    await expect(new PushWorker({ reader, cloud, checkpoints: {}, registry: { tables } })
      .pushAggregates("B1", 100)).rejects.toThrow(/no purchase_orders parent/);
    expect(cloud.pushAggregate).not.toHaveBeenCalled();
  });
});

describe.each([
  ["booking_payments", "bookings", "booking_id", { store_id: "B1" }],
  ["payment_transactions", "bookings", "booking_id", { store_id: "B1" }],
  ["payment_transactions", "sales", "sale_id", { store_id: "B1" }],
  ["sale_items", "sales", "sale_id", { store_id: "B1" }],
  ["stock_transfer_items", "stock_transfers", "transfer_id", { from_store_id: "B1", to_store_id: "B2" }],
])("%s parent recovery", (childName, parentName, foreignKey, parentScope) => {
  it("includes the scoped parent before uploading the child", async () => {
    const reader = {
      pendingAggregates: vi.fn().mockResolvedValueOnce([{
        aggregateId: "00000000-0000-4000-8000-000000000002",
        changes: [{ entity_type: childName, entity_id: '{"id":"child"}',
          operation: "insert", key: { id: "child" } }],
      }]).mockResolvedValueOnce([]),
      rows: vi.fn(async (table: { cloudTable: string }) => table.cloudTable === parentName
        ? [{ id: "parent", ...parentScope }]
        : [{ id: "child", [foreignKey]: "parent" }]),
      acknowledgeAggregate: vi.fn(), failAggregate: vi.fn(),
    };
    const cloud = { pushAggregate: vi.fn().mockResolvedValue({ ok: true }), terminalId: () => "T1" };
    const { PushWorker } = await import("../../../electron/sync/push-worker.cjs");
    await new PushWorker({ reader, cloud, checkpoints: {}, registry: { tables: [
      { cloudTable: parentName, sqlServerTable: parentName, dependencyOrder: 1 },
      { cloudTable: childName, sqlServerTable: childName, dependencyOrder: 3 },
    ] } }).pushAggregates("B1", 100);
    expect(cloud.pushAggregate.mock.calls[0][0].operations.map((op: { table: string }) => op.table))
      .toEqual([parentName, childName]);
  });
});
