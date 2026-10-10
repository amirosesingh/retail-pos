import { describe, expect, it, vi } from "vitest";

const tables = [
  { cloudTable: "purchase_orders", sqlServerTable: "purchase_orders", dependencyOrder: 1,
    scope: "branch", columns: [{ cloudColumn: "store_id", sqlServerColumn: "store_id" }] },
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

  it.each([null, "", " b1 "])("repairs legacy parent branch %s before a child-only retry", async (store_id) => {
    const reader = {
      pendingAggregates: vi.fn().mockResolvedValueOnce([aggregate]).mockResolvedValueOnce([]),
      rows: vi.fn(async (table: { cloudTable: string }) => table.cloudTable === "purchase_orders"
        ? [{ id: "order", store_id }]
        : [{ id: "line", po_id: "order" }]),
      acknowledgeAggregate: vi.fn(), failAggregate: vi.fn(),
    };
    const cloud = { pushAggregate: vi.fn().mockResolvedValue({ ok: true }), terminalId: () => "T1" };
    const { PushWorker } = await import("../../../electron/sync/push-worker.cjs");
    await new PushWorker({ reader, cloud, checkpoints: {}, registry: { tables } })
      .pushAggregates("B1", 100);
    expect(cloud.pushAggregate.mock.calls[0][0].operations[0]).toMatchObject({
      table: "purchase_orders", rows: [{ id: "order", store_id: "B1" }],
    });
    expect(reader.acknowledgeAggregate).toHaveBeenCalledWith(aggregate.aggregateId);
  });
});

describe("queued global settings while a cashier is signed in", () => {
  it("defers the settings aggregate but still uploads later branch sales", async () => {
    const settings = { aggregateId: "settings-1", changes: [{ entity_type: "pos_settings",
      entity_id: '{"id":1}', operation: "insert", key: { id: 1 } }] };
    const sale = { aggregateId: "sale-1", changes: [{ entity_type: "sales",
      entity_id: '{"id":"sale"}', operation: "insert", key: { id: "sale" } }] };
    const reader = {
      pendingAggregates: vi.fn(async (_branch: string, _limit: number, excluded: string[]) =>
        [settings, sale].filter((entry) => !excluded.includes(entry.aggregateId) &&
          !(entry.aggregateId === "sale-1" && reader.acknowledgeAggregate.mock.calls.length))),
      rows: vi.fn(async () => [{ id: "sale", store_id: "B1" }]),
      acknowledgeAggregate: vi.fn(), failAggregate: vi.fn(),
    };
    const cloud = { hasAuthorizationProof: () => false,
      pushAggregate: vi.fn().mockResolvedValue({ ok: true }), terminalId: () => "T1" };
    const { PushWorker } = await import("../../../electron/sync/push-worker.cjs");
    await new PushWorker({ reader, cloud, checkpoints: {}, registry: { tables: [
      { cloudTable: "pos_settings", sqlServerTable: "pos_settings", dependencyOrder: 1 },
      { cloudTable: "sales", sqlServerTable: "sales", dependencyOrder: 2 },
    ] } }).pushAggregates("B1", 100);
    expect(cloud.pushAggregate).toHaveBeenCalledTimes(1);
    expect(cloud.pushAggregate.mock.calls[0][0].operations).toEqual([expect.objectContaining({ table: "sales", rows: [{ id: "sale", store_id: "B1" }] })]);
    expect(reader.acknowledgeAggregate).toHaveBeenCalledWith("sale-1");
    expect(reader.acknowledgeAggregate).not.toHaveBeenCalledWith("settings-1");
  });

  it("still uploads an ordinary branch price without POS settings proof", async () => {
    const price = { aggregateId: "price-1", changes: [{ entity_type: "settings_scoped",
      entity_id: '{"scope":"BRANCH","scope_id":"B1","key":"product_price:P1"}',
      operation: "insert", key: { scope: "BRANCH", scope_id: "B1", key: "product_price:P1" } }] };
    const reader = {
      pendingAggregates: vi.fn().mockResolvedValueOnce([price]).mockResolvedValueOnce([]),
      rows: vi.fn().mockResolvedValue([{ scope: "BRANCH", scope_id: "B1",
        key: "product_price:P1", value: { selling_price: 5 } }]),
      acknowledgeAggregate: vi.fn(), failAggregate: vi.fn(),
    };
    const cloud = { hasAuthorizationProof: () => false,
      pushAggregate: vi.fn().mockResolvedValue({ ok: true }), terminalId: () => "T1" };
    const { PushWorker } = await import("../../../electron/sync/push-worker.cjs");
    await new PushWorker({ reader, cloud, checkpoints: {}, registry: { tables: [
      { cloudTable: "settings_scoped", sqlServerTable: "settings_scoped", dependencyOrder: 1 },
    ] } }).pushAggregates("B1", 100);
    expect(cloud.pushAggregate).toHaveBeenCalledOnce();
    expect(reader.acknowledgeAggregate).toHaveBeenCalledWith("price-1");
  });

  it("defers a global POS field without proof", async () => {
    const field = { aggregateId: "field-1", changes: [{ entity_type: "settings_scoped",
      entity_id: '{"scope":"GLOBAL","scope_id":"","key":"pos_field:company_name"}',
      operation: "insert", key: { scope: "GLOBAL", scope_id: "", key: "pos_field:company_name" } }] };
    const reader = {
      pendingAggregates: vi.fn().mockResolvedValueOnce([field]).mockResolvedValueOnce([]),
      rows: vi.fn(), acknowledgeAggregate: vi.fn(), failAggregate: vi.fn(),
    };
    const cloud = { hasAuthorizationProof: () => false,
      pushAggregate: vi.fn(), terminalId: () => "T1" };
    const { PushWorker } = await import("../../../electron/sync/push-worker.cjs");
    await new PushWorker({ reader, cloud, checkpoints: {}, registry: { tables: [
      { cloudTable: "settings_scoped", sqlServerTable: "settings_scoped", dependencyOrder: 1 },
    ] } }).pushAggregates("B1", 100);
    expect(cloud.pushAggregate).not.toHaveBeenCalled();
    expect(reader.acknowledgeAggregate).not.toHaveBeenCalled();
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
