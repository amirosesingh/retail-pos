import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { CloudClient } = require("../../../electron/sync/cloud-client.cjs");
const { ChangeReader } = require("../../../electron/sync/change-reader.cjs");
const { PullWorker } = require("../../../electron/sync/pull-worker.cjs");
const { refreshTable, runBootstrap } = require("../../../electron/jobs/bootstrap.cjs");
const { loadRegistry } = require("../../../electron/db/schema-registry.cjs");
type Row = Record<string, any>;
const branch = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const foreign = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const uuid = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const shift = uuid(1), count = uuid(2), reconciliation = uuid(3);
const graphNames = ["shifts", "shift_cash_counts", "shift_reconciliations", "shift_close_events", "shift_notifications", "shift_variance_alerts"];
const clone = <T>(value: T): T => structuredClone(value);
const key = (id: string) => JSON.stringify({ id });
const change = (table: string, row: Row, cursor = 1) => ({ table_name: table, entity_id: key(row.id), row_data: clone(row), cursor, tombstone: false });
const open = (version = 99) => ({ id: shift, store_id: branch, status: "OPEN", state: "ACTIVE", closed_at: null, row_version: version });
const closed = (version = 5, cash = 100) => ({ ...open(version), status: "CLOSED", state: "CLOSED", closed_at: "2026-11-02T01:00:00.000Z", counted_cash: cash });

/** Actual production modules, isolated in-memory SQL/transport only. The SQL
 * double models row policy and rollback, not physical SQL Server lock behavior. */
function fixture(parent: Row | null = open()) {
  const registry = loadRegistry();
  const data: Record<string, Row[]> = Object.fromEntries(registry.tables.map((table: Row) => [table.cloudTable, []]));
  if (parent) data.shifts.push(clone(parent));
  const journal: Row[] = [], tracked: Row[] = [], events: string[] = [], statements: string[] = [];
  const bounds: Record<string, Row> = Object.fromEntries(graphNames.map(name => [name, { checkpoint_version: 10, min_version: 1, current_version: 30 }]));
  const fault: { merge?: Error; zeroMerge?: boolean; falseOutput?: boolean } = {};
  let committedCursor = 0;
  class Transaction {
    image: Record<string, Row[]> = {};
    cursor = committedCursor;
    async begin(level: number) { expect(level).toBe(4); events.push("begin"); this.image = clone(data); }
    async commit() { events.push("commit"); Object.assign(data, clone(this.image)); committedCursor = this.cursor; }
    async rollback() { events.push("rollback"); }
  }
  class Request {
    inputs: Row = {};
    constructor(readonly owner: Transaction | object) {}
    input(name: string, value: unknown) { this.inputs[name] = value; return this; }
    async query(text: string) {
      statements.push(text);
      const rows = this.owner instanceof Transaction ? this.owner.image : data;
      if (text.includes("SELECT CHANGE_TRACKING_CURRENT_VERSION()")) return { recordset: [{ current_version: 30 }] };
      if (text.includes("AS checkpoint_version")) return { recordset: [clone(bounds[this.inputs.entity])] };
      if (text.includes("CHANGETABLE(CHANGES")) {
        const name = /CHANGES dbo\.\[([^\]]+)\]/.exec(text)![1];
        const ids = JSON.parse(this.inputs.ids);
        return { recordset: tracked.filter(row => row.table === name && row.version > this.inputs.since && row.context !== "CLOUD" && (ids.includes(row.id) || row.operation === "D")) };
      }
      if (text.includes("journal.entity_id")) {
        const ids = JSON.parse(this.inputs.ids);
        return { recordset: journal.filter(row => row.table === this.inputs.entity && [branch, "global"].includes(row.branch) &&
          (ids.includes(row.id) || !rows[row.table].some(saved => saved.id === row.id))).slice(0, 1) };
      }
      if (text.includes("FROM dbo.held_orders")) return { recordset: [] };
      const name = /(?:FROM|MERGE) dbo\.\[([^\]]+)\]/.exec(text)?.[1];
      if (!name) throw new Error(`Unexpected isolated SQL: ${text}`);
      if (text.includes("MERGE dbo.")) {
        if (fault.merge) throw fault.merge;
        const row = Object.fromEntries([...text.matchAll(/@(v\d+) AS \[([^\]]+)\]/g)].map(match => [match[2], this.inputs[match[1]]]));
        const prior = rows[name].find(saved => saved.id === row.id);
        let applied = !prior || !text.includes("WHEN MATCHED AND source.[row_version]>=target.[row_version]") || row.row_version >= prior.row_version;
        if (fault.zeroMerge) applied = false;
        if (applied && !fault.falseOutput) { if (prior) Object.assign(prior, row); else rows[name].push(row); }
        return { recordset: applied ? [{ sync_action: prior ? "UPDATE" : "INSERT" }] : [], rowsAffected: [applied ? 1 : 0] };
      }
      if (text.includes("DELETE FROM")) {
        const index = rows[name].findIndex(row => row.id === this.inputs.k0);
        if (index >= 0) rows[name].splice(index, 1);
        return { rowsAffected: [index >= 0 ? 1 : 0] };
      }
      if (this.inputs.shifts) return { recordset: clone(rows[name].filter(row => JSON.parse(this.inputs.shifts).includes(name === "shifts" ? row.id : row.shift_id))) };
      if (this.inputs.ids) return { recordset: clone(rows[name].filter(row => JSON.parse(this.inputs.ids).includes(row.id))) };
      const parameter = /\[id\]=@(v\d+)/.exec(text)?.[1];
      if (parameter) return { recordset: clone(rows[name].filter(row => row.id === this.inputs[parameter])) };
      throw new Error(`Unexpected isolated SQL: ${text}`);
    }
  }
  const pool = { request: () => new Request(pool) };
  const manager = { pool, sql: () => ({ Transaction, Request, ISOLATION_LEVEL: { SERIALIZABLE: 4 } }) };
  const reader = new ChangeReader(manager, registry);
  const cloud = new CloudClient({ configStore: {}, terminalStore: { read: () => ({}) }, connectionManager: manager });
  const pages: Row[] = [];
  cloud.pullBatch = vi.fn(async () => clone(pages.shift() ?? { rows: [], tombstones: [], cursor: committedCursor, count: 0 }));
  const checkpoints = { get: vi.fn(async () => ({ committed_cursor: committedCursor })), save: vi.fn(async (_branch: string, _table: string, _direction: string, patch: Row, tx?: Transaction) => { if (tx) tx.cursor = patch.committed_cursor; }) };
  const conflicts = { reconcileAcknowledged: vi.fn(), record: vi.fn() }, publish = vi.fn();
  const worker = new PullWorker({ connectionManager: manager, cloud, reader, registry, checkpoints, conflicts, publish });
  const page = (...changes: Row[]) => pages.push({ rows: changes, tombstones: [], cursor: Math.max(...changes.map(row => row.cursor)), count: changes.length });
  const apply = async (name: string, row: Row) => {
    const tx = new Transaction(); await tx.begin(4);
    return cloud.applyLocalBatch(tx, registry.tables.find((table: Row) => table.cloudTable === name), { rows: [change(name, row)], tombstones: [], branchId: branch });
  };
  const pull = () => worker.run({ branchId: branch, skipMembership: true });
  const snapshot = (name: string, row: Row) => {
    cloud.bootstrapPage = vi.fn(async () => ({ rows: [clone(row)], cursor: null }));
    return refreshTable({ registry, cloud, connectionManager: manager, reader, branchId: branch, tableName: name });
  };
  return { data, registry, manager, reader, cloud, worker, checkpoints, conflicts, publish, events, statements, journal, tracked, bounds, fault, page, apply, pull, snapshot,
    cursor: () => committedCursor };
}

describe("truthful native closing adoption", () => {
  it("retains OPEN99/CLOSED5 and its complete feed page, without publishing or fabricating application", async () => {
    const f = fixture(); f.page(change("shifts", closed()));
    f.page(change("shift_cash_counts", { id: count, shift_id: shift, store_id: branch, kind: "ORIGINAL", counted_cash: 100 }, 2));
    await expect(f.pull()).rejects.toMatchObject({ code: "ESYNC_APPLY_DEFERRED", table: "shifts" });
    expect(f.data.shifts[0]).toEqual(open()); expect(f.cursor()).toBe(0);
    expect(f.checkpoints.save).not.toHaveBeenCalled(); expect(f.publish).not.toHaveBeenCalled();
    expect(f.events).toEqual(["begin", "rollback"]); expect(f.cloud.pullBatch).toHaveBeenCalledTimes(1);
  });
  it("recognizes equal facts across independent revisions and SQL dates/decimal/null representations", async () => {
    const local = { ...closed(99), closed_at: new Date("2026-11-02T01:00:00Z"), counted_cash: "100.00", expected_cash: null };
    const f = fixture(local); f.page(change("shifts", { ...closed(5), expected_cash: null }));
    const result = await f.pull();
    expect(result.merged).toBe(0); expect(f.cursor()).toBe(1); expect(f.data.shifts[0].row_version).toBe(99);
    expect(f.statements.some(text => text.includes("MERGE dbo.[shifts]"))).toBe(false);
  });
  it.each([[open(1), { ...open(2), opening_float: 100 }], [open(1), closed(2)], [null, closed(2)]])("preserves an existing allowed higher-revision/fresh bootstrap path", async (saved, remote) => {
    const f = fixture(saved); const result = await f.snapshot("shifts", remote!);
    expect(result.completed).toBe(1); expect(f.data.shifts[0]).toEqual(remote);
  });
  it("records a CLOSED→OPEN conflict outside the rolled-back page and never advances it", async () => {
    const f = fixture(closed()); f.page(change("shifts", open(999)));
    await expect(f.pull()).rejects.toMatchObject({ code: "ESYNC_APPLY_CONFLICT" });
    expect(f.data.shifts[0]).toEqual(closed()); expect(f.cursor()).toBe(0); expect(f.publish).not.toHaveBeenCalled();
    expect(f.conflicts.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entityType: "shifts", branchId: branch, entityId: key(shift) }));
    expect(f.events).toEqual(["begin", "rollback", "begin", "commit"]);
  });
  it("retains a differing lower-revision CLOSED correction without pretending convergence", async () => {
    const f = fixture(closed(99, 110)); f.page(change("shifts", closed(5, 120)));
    await expect(f.pull()).rejects.toMatchObject({ code: "ESYNC_APPLY_DEFERRED" });
    expect(f.data.shifts[0].counted_cash).toBe(110); expect(f.cursor()).toBe(0);
  });
  it.each(graphNames.slice(1, 5))("does not overwrite or reparent saved %s history", async name => {
    const f = fixture(closed()); const field = name === "shift_close_events" ? "event" : "counted_cash";
    const saved = { id: count, store_id: branch, shift_id: shift, [field]: name === "shift_close_events" ? "closed" : 100 };
    f.data[name].push(saved);
    expect(await f.apply(name, { ...saved, [field]: name === "shift_close_events" ? "reopened" : 110 })).toMatchObject({ applied: 0, conflicts: 1 });
    expect(await f.apply(name, { ...saved, shift_id: uuid(88) })).toMatchObject({ applied: 0, conflicts: 1 });
    expect(f.data[name]).toEqual([saved]);
  });
  it("preserves mutable alert delivery updates while denying reparenting", async () => {
    const f = fixture(closed()); const saved = { id: count, store_id: branch, shift_id: shift, delivery_status: "pending" };
    f.data.shift_variance_alerts.push(saved);
    expect(await f.apply("shift_variance_alerts", { ...saved, delivery_status: "sent" })).toMatchObject({ applied: 1, conflicts: 0 });
    expect(await f.apply("shift_variance_alerts", { ...saved, shift_id: uuid(88) })).toMatchObject({ applied: 0, conflicts: 1 });
  });
  it("reports a zero-action SQL merge as deferred, rolls back other page rows, and supports interrupted retry", async () => {
    const f = fixture(open(1)); f.fault.zeroMerge = true; f.page(change("shifts", closed(2)));
    await expect(f.pull()).rejects.toMatchObject({ code: "ESYNC_APPLY_DEFERRED" });
    expect(f.cursor()).toBe(0); expect(f.data.shifts[0]).toEqual(open(1));
    f.fault.zeroMerge = false; f.page(change("shifts", closed(2)));
    expect(await f.pull()).toMatchObject({ merged: 1 }); expect(f.cursor()).toBe(1);
  });
  it("rolls back an interrupted local write without checkpointing", async () => {
    const f = fixture(open(1)); f.fault.merge = new Error("isolated interruption"); f.page(change("shifts", closed(2)));
    await expect(f.pull()).rejects.toThrow("isolated interruption"); expect(f.cursor()).toBe(0); expect(f.data.shifts[0]).toEqual(open(1));
  });
  it("requires saved facts after a reported SQL action before confirming application", async () => {
    const f = fixture(open(1)); f.fault.falseOutput = true; f.page(change("shifts", closed(2)));
    await expect(f.pull()).rejects.toMatchObject({ code: "ESYNC_APPLY_DEFERRED" });
    expect(f.cursor()).toBe(0); expect(f.data.shifts[0]).toEqual(open(1));
  });
  it("denies a foreign download branch without applying or advancing", async () => {
    const f = fixture(); f.page(change("shifts", { ...closed(100), store_id: foreign }));
    await expect(f.pull()).rejects.toMatchObject({ code: "SYNC_BRANCH_FORBIDDEN" }); expect(f.cursor()).toBe(0); expect(f.data.shifts[0]).toEqual(open());
  });
});

describe("journal and legacy Change Tracking closing protection", () => {
  it.each(graphNames)("retains the page when %s has pending local journal work", async name => {
    const f = fixture(open(1)); const id = name === "shifts" ? shift : count;
    if (name !== "shifts") f.data[name].push({ id, store_id: branch, shift_id: shift });
    f.journal.push({ table: name, id, branch }); f.page(change("shifts", closed(2)));
    expect(await f.pull()).toMatchObject({ merged: 0, deferredLocalChanges: true });
    expect(f.cursor()).toBe(0); expect(f.journal).toHaveLength(1); expect(f.publish).not.toHaveBeenCalled();
  });
  it.each(graphNames)("surfaces unjournaled local %s CT work and retains its graph/page", async name => {
    const f = fixture(open(1)); const id = name === "shifts" ? shift : count;
    if (name !== "shifts") f.data[name].push({ id, store_id: branch, shift_id: shift });
    f.tracked.push({ table: name, id, version: 11, operation: "U", context: null }); f.page(change("shifts", closed(2)));
    await expect(f.pull()).rejects.toMatchObject({ code: "ELOCAL_CT_PENDING", table: name });
    expect(f.cursor()).toBe(0); expect(f.tracked).toHaveLength(1); expect(f.data.shifts[0]).toEqual(open(1));
  });
  it("does not mistake the CLOUD context or acknowledged CT version for pending work", async () => {
    const f = fixture(open(1));
    f.tracked.push({ table: "shifts", id: shift, version: 11, operation: "U", context: "CLOUD" }, { table: "shifts", id: shift, version: 10, operation: "U", context: null });
    f.page(change("shifts", closed(2))); expect(await f.pull()).toMatchObject({ merged: 1 }); expect(f.cursor()).toBe(1);
  });
  it("does not block a different saved shift's journal or CT edit", async () => {
    const f = fixture(open(1)); const other = uuid(77);
    f.data.shifts.push({ ...open(), id: other });
    f.journal.push({ table: "shifts", id: other, branch });
    f.tracked.push({ table: "shifts", id: other, version: 11, operation: "U" });
    f.page(change("shifts", closed(2))); expect(await f.pull()).toMatchObject({ merged: 1 });
  });
  it("retains an unknown local graph deletion and non-CLOUD context", async () => {
    const f = fixture(open(1)); f.tracked.push({ table: "shift_cash_counts", id: uuid(88), version: 11, operation: "D", context: "OTHER" });
    f.page(change("shifts", closed(2)));
    await expect(f.pull()).rejects.toMatchObject({ code: "ELOCAL_CT_PENDING", table: "shift_cash_counts" }); expect(f.cursor()).toBe(0);
  });
  it.each([null, 0, 31])("fails closed with actionable missing/expired/future CT checkpoint %s", async checkpoint => {
    const f = fixture(open(1)); f.bounds.shifts.checkpoint_version = checkpoint; f.page(change("shifts", closed(2)));
    await expect(f.pull()).rejects.toMatchObject({ code: "ELOCAL_PENDING_UNVERIFIED" }); expect(f.cursor()).toBe(0);
  });
  it("protects the parent from child-page application and retains a pending tombstone", async () => {
    const f = fixture(closed()); f.tracked.push({ table: "shifts", id: shift, version: 11, operation: "U" });
    f.page(change("shift_cash_counts", { id: count, shift_id: shift, store_id: branch, kind: "RECOUNT", counted_cash: 110 }));
    await expect(f.pull()).rejects.toMatchObject({ code: "ELOCAL_CT_PENDING" }); expect(f.data.shift_cash_counts).toEqual([]);
  });
  it("does not skip pending rows or overwrite the push baseline during scoped bootstrap", async () => {
    const f = fixture(open(1)); f.journal.push({ table: "shifts", id: shift, branch });
    f.cloud.bootstrapPage = vi.fn(async () => ({ rows: [closed(2)], cursor: "next" }));
    const context = { job: { dependency_index: 0, completed_rows: 0 }, checkpoint: vi.fn(), waitWhilePaused: vi.fn() };
    await expect(runBootstrap({ registry: { tables: [f.registry.tables.find((table: Row) => table.cloudTable === "shifts")] }, cloud: f.cloud,
      connectionManager: f.manager, reader: f.reader, checkpoints: f.checkpoints, branchId: branch, context })).rejects.toMatchObject({ code: "ELOCAL_UPLOAD_PENDING" });
    expect(f.checkpoints.save).not.toHaveBeenCalled(); expect(context.checkpoint).toHaveBeenCalledTimes(1);
    expect(f.cloud.bootstrapPage).toHaveBeenCalledTimes(1); expect(f.events).toEqual(["begin", "rollback"]);
  });
  it("protects the public pool snapshot entry point and leaves pending CT unchanged", async () => {
    const f = fixture(open(1)); f.tracked.push({ table: "shifts", id: shift, version: 11, operation: "U" });
    const table = f.registry.tables.find((item: Row) => item.cloudTable === "shifts");
    await expect(f.cloud.applyLocalBatchToPool(f.manager, table, [change("shifts", closed(2))], { branchId: branch })).rejects.toMatchObject({ code: "ELOCAL_CT_PENDING" });
    expect(f.events).toEqual(["begin", "rollback"]); expect(f.tracked).toHaveLength(1);
  });
});
