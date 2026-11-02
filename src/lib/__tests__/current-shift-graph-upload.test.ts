import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { ChangeReader } = require("../../../electron/sync/change-reader.cjs");
const { PushWorker } = require("../../../electron/sync/push-worker.cjs");
const { stableUuid } = require("../../../electron/db/repositories/aggregates.cjs");
const { loadRegistry } = require("../../../electron/db/schema-registry.cjs");
type Row = Record<string, unknown>;
type Change = { entity_type: string; entity_id: string; operation: string; key: { id: string } };
type Acknowledgement = { ok: boolean; shift_closure_ack_version?: number;
  shift_closures?: { id: unknown; store_id: unknown; row_version: number; requested_row_version: unknown }[] };
const branch = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const foreign = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const uuid = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const shiftId = uuid(1), countId = uuid(11), recountId = uuid(12), reconciliationId = uuid(21), recountReconciliationId = uuid(22);
const graphTables = ["shifts", "shift_cash_counts", "shift_reconciliations", "shift_close_events", "shift_notifications", "shift_variance_alerts"];
const clone = <T>(value: T): T => structuredClone(value);
const sameId = (a: unknown, b: unknown) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
const change = (table: string, id: string): Change => ({ entity_type: table, entity_id: JSON.stringify({ id }),
  key: { id }, operation: table === "shifts" ? "update" : "insert" });
const money = (cash: number) => ({ counted_cash: cash, counted_card: null, counted_digital: null,
  expected_cash: 100, expected_card: 0, expected_digital: 0, variance_cash: cash - 100,
  variance_card: null, variance_digital: null, variance_total: cash - 100,
  variance_status: cash === 100 ? "NO_VARIANCE" : "OVER" });

/** The SQL double models SERIALIZABLE locks with a detached transaction image;
 * this verifies requests/order/coherence, not physical SQL Server locking. */
function fixture() {
  const registry = loadRegistry();
  const data: Record<string, Row[]> = Object.fromEntries(registry.tables.map((table: { sqlServerTable: string }) => [table.sqlServerTable, []]));
  data.shifts = [{ id: shiftId, store_id: branch, terminal_id: null, status: "CLOSED", state: "CLOSED",
    closed_at: "2026-11-01T01:00:00.000Z", row_version: 2, final_counted_cash: 100, closing_float: 100, ...money(100) }];
  data.shift_cash_counts = [{ id: countId, shift_id: shiftId, store_id: branch, kind: "ORIGINAL", counted_cash: 100, counted_card: null, counted_digital: null }];
  data.shift_reconciliations = [{ id: reconciliationId, shift_id: shiftId, store_id: branch, count_id: countId, ...money(100) }];
  data.shift_close_events = [{ id: uuid(31), shift_id: shiftId, store_id: branch, event: "reconciled" }];
  data.shift_notifications = [{ id: uuid(41), shift_id: shiftId, store_id: branch, counted_cash: 100 }];
  const events: string[] = [];
  const queries: { table: string; text: string; inputs: Record<string, unknown> }[] = [];
  const faults: { table?: string; error?: Error; onRead?: () => void } = {};
  class Transaction {
    image: Record<string, Row[]> = {};
    async begin(level: number) { expect(level).toBe(4); events.push("begin"); this.image = clone(data); }
    async commit() { events.push("commit"); }
    async rollback() { events.push("rollback"); }
  }
  class Request {
    inputs: Record<string, unknown> = {};
    constructor(readonly transaction: Transaction) {}
    input(name: string, value: unknown) { this.inputs[name] = value; return this; }
    async query(text: string) {
      const table = /FROM dbo\.\[([a-z_]+)\]/.exec(text)?.[1];
      if (!table) throw new Error("Unexpected read statement");
      expect(text).toContain("WITH (UPDLOCK,HOLDLOCK)");
      queries.push({ table, text, inputs: clone(this.inputs) });
      events.push(`read:${table}`);
      if (faults.table === table) throw faults.error;
      const rows = this.transaction.image[table].filter(row => table === "shifts"
        ? sameId(row.id, this.inputs.shift) && sameId(row.store_id, this.inputs.branch)
        : sameId(row.shift_id, this.inputs.shift));
      const hook = faults.onRead; faults.onRead = undefined; hook?.();
      return { recordset: clone(rows) };
    }
  }
  const manager = { sql: () => ({ Transaction, Request, ISOLATION_LEVEL: { SERIALIZABLE: 4 } }), pool: {} };
  const reader = new ChangeReader(manager, registry);
  reader.rows = vi.fn(async (table: { cloudTable: string }, changes: Change[]) => clone(data[table.cloudTable].filter(row => changes.some(item => sameId(item.key.id, row.id)))));
  const groups = [{ aggregateId: "original", changes: [change("shifts", shiftId), change("shift_cash_counts", countId), change("shift_reconciliations", reconciliationId)] }];
  const acknowledged: string[] = [], failed: { id: string; error: Error }[] = [];
  reader.pendingAggregates = vi.fn(async (_branch: string, limit: number, excluded: string[]) => groups.filter(group => !acknowledged.includes(group.aggregateId) && !excluded.includes(group.aggregateId)).slice(0, limit));
  reader.acknowledgeAggregate = vi.fn(async (id: string) => { acknowledged.push(id); });
  reader.failAggregate = vi.fn(async (id: string, error: Error) => { failed.push({ id, error }); });
  const recount = () => {
    Object.assign(data.shifts[0], money(110), { row_version: 3, final_counted_cash: 110, closing_float: 110 });
    data.shift_cash_counts.push({ id: recountId, shift_id: shiftId, store_id: branch, kind: "RECOUNT", counted_cash: 110, counted_card: null, counted_digital: null });
    data.shift_reconciliations.push({ id: recountReconciliationId, shift_id: shiftId, store_id: branch, count_id: recountId, ...money(110) });
    groups.push({ aggregateId: "recount", changes: [change("shifts", shiftId), change("shift_cash_counts", recountId), change("shift_reconciliations", recountReconciliationId)] });
  };
  const uploads: { batchId: string; operations: { table: string; rows: Row[]; changes: Change[]; dependencyOrder: number; deletePhase: boolean }[] }[] = [];
  const cloud = { pushAggregate: vi.fn(async (packet: typeof uploads[number]): Promise<Acknowledgement> => {
    uploads.push(clone(packet));
    return { ok: true, shift_closure_ack_version: 2, shift_closures: packet.operations.filter(op => op.table === "shifts").flatMap(op => op.rows)
      .filter(row => row.status === "CLOSED").map(row => ({ id: row.id, store_id: row.store_id, row_version: 2, requested_row_version: row.row_version })) };
  }) };
  return { data, registry, reader, events, queries, faults, groups, acknowledged, failed, recount, uploads, cloud,
    worker: () => new PushWorker({ reader, cloud, registry }) };
}

describe("current shift graph capture", () => {
  it("uses one SERIALIZABLE parent-first transaction for all sorted parents and returns detached JSON rows", async () => {
    const f = fixture(), second = uuid(2);
    f.data.shifts.push({ ...f.data.shifts[0], id: second });
    f.data.shift_cash_counts.push({ ...f.data.shift_cash_counts[0], id: uuid(13), shift_id: second });
    f.data.shift_reconciliations.push({ ...f.data.shift_reconciliations[0], id: uuid(23), shift_id: second, count_id: uuid(13) });
    const graph = await f.reader.closedShiftGraphs(branch, [second.toUpperCase(), shiftId, second]);
    expect(f.events.filter(value => value === "begin")).toHaveLength(1);
    expect(f.events.at(-1)).toBe("commit");
    expect(f.queries.slice(0, 2).map(row => [row.table, row.inputs.shift])).toEqual([["shifts", shiftId], ["shifts", second]]);
    expect(f.queries.slice(0, 2).every(row => row.text.startsWith("SELECT id"))).toBe(true);
    expect(f.queries.slice(2, 8).map(row => row.table)).toEqual(graphTables);
    f.data.shifts[0].counted_cash = 999;
    expect(graph.find((row: { table: string }) => row.table === "shifts").rows[0].counted_cash).toBe(100);
    expect(JSON.parse(JSON.stringify(graph))).toEqual(graph);
  });

  it("keeps a recount coherent if it is committed after the read transaction starts", async () => {
    const f = fixture(); f.faults.onRead = f.recount;
    const before = await f.reader.closedShiftGraphs(branch, [shiftId]);
    expect(before.find((item: { table: string }) => item.table === "shifts").rows[0].counted_cash).toBe(100);
    expect(before.find((item: { table: string }) => item.table === "shift_cash_counts").rows).toHaveLength(1);
    const after = await f.reader.closedShiftGraphs(branch, [shiftId]);
    expect(after.find((item: { table: string }) => item.table === "shifts").rows[0].counted_cash).toBe(110);
    expect(after.find((item: { table: string }) => item.table === "shift_cash_counts").rows).toHaveLength(2);
  });

  it("rolls back an unavailable or foreign graph without uploading or acknowledging", async () => {
    const f = fixture(); const error = new Error("isolated count read failed");
    f.faults.table = "shift_cash_counts"; f.faults.error = error;
    await expect(f.reader.closedShiftGraphs(branch, [shiftId])).rejects.toBe(error);
    expect(f.events).toContain("rollback"); expect(f.events).not.toContain("commit");
    f.faults.table = undefined;
    f.data.shift_cash_counts[0].store_id = foreign;
    await expect(f.reader.closedShiftGraphs(branch, [shiftId])).rejects.toMatchObject({ code: "SYNC_BRANCH_FORBIDDEN" });
    await expect(f.reader.closedShiftGraphs(foreign, [shiftId])).rejects.toMatchObject({ code: "ESHIFT_CLOSURE_SNAPSHOT" });
    expect(f.cloud.pushAggregate).not.toHaveBeenCalled(); expect(f.acknowledged).toEqual([]);
  });

  it("refuses an oversized graph without committing the read or changing its data", async () => {
    const f = fixture();
    f.data.shift_close_events = Array.from({ length: 2001 }, (_, index) => ({ id: uuid(index + 100), store_id: branch, shift_id: shiftId }));
    await expect(f.reader.closedShiftGraphs(branch, [shiftId])).rejects.toMatchObject({ code: "ESHIFT_CLOSURE_SNAPSHOT" });
    expect(f.events).toContain("rollback"); expect(f.events).not.toContain("commit");
    expect(f.data.shift_close_events).toHaveLength(2001); expect(f.acknowledged).toEqual([]);
  });
});

describe("shift upload binding before receipt hashing", () => {
  it("includes the latest recount graph in an older original group and retains original queue identities", async () => {
    const f = fixture(); f.recount();
    f.cloud.pushAggregate.mockImplementation(async packet => {
      f.uploads.push(clone(packet));
      if (f.uploads.length > 1) throw Object.assign(new Error("isolated next group failure"), { status: 422 });
      const parent = packet.operations.find(op => op.table === "shifts")!.rows[0];
      return { ok: true, shift_closure_ack_version: 2, shift_closures: [{ id: parent.id, store_id: branch, row_version: 2, requested_row_version: Number(parent.row_version) }] };
    });
    await expect(f.worker().pushAggregates(branch, 1, false)).rejects.toThrow("next group failure");
    const sent = f.uploads[0].operations;
    expect(sent.find(op => op.table === "shifts")!.rows[0]).toMatchObject({ counted_cash: 110, row_version: 3, terminal_id: null });
    expect(sent.find(op => op.table === "shift_cash_counts")!.rows.map(row => row.counted_cash)).toEqual([100, 110]);
    expect(sent.find(op => op.table === "shift_reconciliations")!.rows).toEqual(expect.arrayContaining([expect.objectContaining({ count_id: recountId, counted_cash: 110 })]));
    expect(sent.find(op => op.table === "shift_notifications")!.rows[0].counted_cash).toBe(100);
    expect(f.acknowledged).toEqual(["original"]);
    expect(f.failed.at(-1)?.id).toBe("recount");
    expect(f.groups.map(group => group.aggregateId)).toEqual(["original", "recount"]);
    expect(f.uploads[0].batchId).toBe(stableUuid({ branchId: branch, aggregateId: "original", operations: sent }));
  });

  it("keeps an in-flight snapshot immutable and gives changed recount facts a new receipt after a timeout", async () => {
    const f = fixture();
    const original = f.cloud.pushAggregate.getMockImplementation()!;
    f.cloud.pushAggregate.mockImplementationOnce(async packet => {
      f.uploads.push(clone(packet)); f.recount();
      expect(packet.operations.find(op => op.table === "shifts")!.rows[0].counted_cash).toBe(100);
      throw Object.assign(new Error("isolated lost response"), { code: "ETIMEDOUT" });
    }).mockImplementation(original);
    expect(await f.worker().pushAggregates(branch, 1, true)).toBe(0);
    expect(f.acknowledged).toEqual([]);
    await f.worker().pushAggregates(branch, 1, false);
    expect(f.uploads[0].batchId).not.toBe(f.uploads[1].batchId);
    expect(f.uploads[0].operations.find(op => op.table === "shifts")!.rows[0].counted_cash).toBe(100);
    expect(f.uploads[1].operations.find(op => op.table === "shifts")!.rows[0].counted_cash).toBe(110);
    expect(f.uploads[1].operations.find(op => op.table === "shift_cash_counts")!.rows).toHaveLength(2);
    expect(f.acknowledged).toEqual(["original", "recount"]);
  });

  it.each(["missing capability", "capture failure", "missing proof"])("keeps all journal rows pending on %s", async mode => {
    const f = fixture();
    if (mode === "missing capability") f.reader.closedShiftGraphs = undefined;
    if (mode === "capture failure") { f.faults.table = "shift_close_events"; f.faults.error = new Error("isolated graph failure"); }
    if (mode === "missing proof") f.cloud.pushAggregate.mockResolvedValue({ ok: true });
    expect(await f.worker().pushAggregates(branch, 1, true)).toBe(0);
    expect(f.acknowledged).toEqual([]); expect(f.failed).toHaveLength(1);
    if (mode !== "missing proof") expect(f.cloud.pushAggregate).not.toHaveBeenCalled();
  });

  it.each(["missing table", "duplicate parent", "wrong count parent"])("does not upload an incomplete capture response: %s", async fault => {
    const f = fixture(), capture = f.reader.closedShiftGraphs.bind(f.reader);
    f.reader.closedShiftGraphs = async (...args: unknown[]) => {
      const graph = await capture(...args);
      if (fault === "missing table") return graph.filter((item: { table: string }) => item.table !== "shift_reconciliations");
      if (fault === "duplicate parent") graph.find((item: { table: string }) => item.table === "shifts").rows.push(clone(f.data.shifts[0]));
      else graph.find((item: { table: string }) => item.table === "shift_reconciliations").rows[0].count_id = uuid(999);
      return graph;
    };
    expect(await f.worker().pushAggregates(branch, 1, true)).toBe(0);
    expect(f.cloud.pushAggregate).not.toHaveBeenCalled(); expect(f.acknowledged).toEqual([]);
    expect(f.failed).toHaveLength(1); expect(f.failed[0].error).toMatchObject({ code: "ESHIFT_CLOSURE_SNAPSHOT" });
  });

  it.each([
    { status: "OPEN", state: "CLOSED", closed_at: null },
    { status: "OPEN", state: "ACTIVE", closed_at: "2026-11-01T01:00:00.000Z" },
  ])("cannot bypass graph capture with partial closing flags: %j", async patch => {
    const f = fixture(); Object.assign(f.data.shifts[0], patch);
    expect(await f.worker().pushAggregates(branch, 1, true)).toBe(0);
    expect(f.cloud.pushAggregate).not.toHaveBeenCalled(); expect(f.acknowledged).toEqual([]);
  });

  it.each(["parent", "child"])("does not send a foreign-branch %s", async kind => {
    const f = fixture(); f.data[kind === "parent" ? "shifts" : "shift_cash_counts"][0].store_id = foreign;
    expect(await f.worker().pushAggregates(branch, 1, true)).toBe(0);
    expect(f.cloud.pushAggregate).not.toHaveBeenCalled(); expect(f.acknowledged).toEqual([]);
    expect(f.failed).toHaveLength(1);
  });

  it("keeps authorized original terminal attribution when another terminal captures its branch closure", async () => {
    const f = fixture(); f.data.shifts[0].terminal_id = uuid(99);
    await f.worker().pushAggregates(branch, 1, false);
    expect(f.uploads[0].operations.find(op => op.table === "shifts")!.rows[0].terminal_id).toBe(uuid(99));
  });

  it("captures the same current graph for a CT closure before hashing and advancing its checkpoint", async () => {
    const f = fixture(); f.recount(); let version = 0;
    f.reader.pendingAggregates = vi.fn(async () => []);
    f.reader.changedIds = vi.fn(async (table: { cloudTable: string }) => table.cloudTable === "shifts" && !version
      ? [{ operation: "U", version: 55, key: { id: shiftId } }] : []);
    const checkpoints = { list: vi.fn(async () => [{ entity_type: "shifts", change_tracking_version: version }]),
      save: vi.fn(async (_branch: string, _table: string, _direction: string, patch: { change_tracking_version: number }) => { version = patch.change_tracking_version; }) };
    const worker = new PushWorker({ reader: f.reader, cloud: f.cloud, checkpoints, registry: f.registry });
    await expect(worker.run({ branchId: branch })).resolves.toMatchObject({ pushed: 1 });
    const packet = f.uploads[0];
    expect(packet.operations.find(op => op.table === "shifts")!.rows[0].counted_cash).toBe(110);
    expect(packet.operations.find(op => op.table === "shift_cash_counts")!.rows).toHaveLength(2);
    const recovery = stableUuid({ branchId: branch, table: "shifts", from: 0, operations: packet.operations,
      changes: [{ version: 55, operation: "U", key: { id: shiftId } }] });
    expect(packet.batchId).toBe(stableUuid({ branchId: branch, recovery, operations: packet.operations }));
    expect(version).toBe(55); expect(f.acknowledged).toEqual([]);
  });

  it("does not change nonclosing payload bytes, receipt identity or reader access", async () => {
    const f = fixture(); f.groups[0].changes = [change("sales", uuid(90))];
    f.data.sales = [{ id: uuid(90), store_id: branch, total_amount: 120 }];
    const snapshot = vi.spyOn(f.reader, "closedShiftGraphs");
    await f.worker().pushAggregates(branch, 1, false);
    const metadata = f.registry.tables.find((table: { cloudTable: string }) => table.cloudTable === "sales");
    const operations = [{ table: "sales", dependencyOrder: metadata.dependencyOrder, deletePhase: false,
      changes: f.groups[0].changes, rows: f.data.sales }];
    expect(JSON.stringify(f.uploads[0].operations)).toBe(JSON.stringify(operations));
    expect(f.uploads[0].batchId).toBe(stableUuid({ branchId: branch, aggregateId: "original", operations }));
    expect(snapshot).not.toHaveBeenCalled(); expect(f.events).toEqual([]);
  });

  it("preserves the nonclosing CT batch payload and receipt identity without capturing a shift", async () => {
    const f = fixture(); let version = 0;
    const sale = { id: uuid(90), store_id: branch, total_amount: 120 };
    const changes = [{ operation: "U", version: 55, key: { id: sale.id } }];
    f.data.sales = [sale];
    f.reader.pendingAggregates = vi.fn(async () => []);
    f.reader.changedIds = vi.fn(async (table: { cloudTable: string }) => table.cloudTable === "sales" && !version ? changes : []);
    const checkpoints = { list: vi.fn(async () => [{ entity_type: "sales", change_tracking_version: version }]),
      save: vi.fn(async (_branch: string, _table: string, _direction: string, patch: { change_tracking_version: number }) => { version = patch.change_tracking_version; }) };
    const pushBatch = vi.fn(async () => ({ ok: true }));
    const snapshot = vi.spyOn(f.reader, "closedShiftGraphs");
    await new PushWorker({ reader: f.reader, cloud: { ...f.cloud, pushBatch }, checkpoints, registry: f.registry }).run({ branchId: branch });
    expect(pushBatch).toHaveBeenCalledExactlyOnceWith({ branchId: branch, table: "sales", changes, rows: [sale],
      batchId: stableUuid({ branchId: branch, table: "sales", from: 0, rows: [sale], changes }) });
    expect(f.cloud.pushAggregate).not.toHaveBeenCalled(); expect(snapshot).not.toHaveBeenCalled();
    expect(version).toBe(55); expect(f.events).toEqual([]);
  });
});
