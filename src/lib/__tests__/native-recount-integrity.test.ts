import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { ShiftSyncJournal } = require("../../../electron/db/shift-sync-journal.cjs");
const registry = JSON.parse(readFileSync("database/sqlserver/schema-registry.json", "utf8"));
const main = readFileSync("electron/main.cjs", "utf8");
const start = main.indexOf("async function commitLocalShiftRecount("), end = main.indexOf("\nasync function approveLocalShiftVariance(", start);
type Row = Record<string, any>;
const shiftId = "11111111-1111-4111-8111-111111111111", originalId = "22222222-2222-4222-8222-222222222222";
const branch = "branch-a", terminal = "terminal-a", actor = "manager-a", now = "2026-11-02T03:00:00.000Z";
const sameKey = (a: unknown, b: unknown) => String(a ?? "").trimEnd().toLowerCase() === String(b ?? "").trimEnd().toLowerCase();
const copy = <T>(value: T): T => structuredClone(value);

function fixture() {
  const data: Record<string, Row[]> = Object.fromEntries(["shifts", "shift_cash_counts", "shift_reconciliations", "shift_close_events", "shift_notifications", "shift_variance_alerts"].map(table => [table, []]));
  const original = { id: originalId, shift_id: shiftId, store_id: branch, terminal_id: terminal, kind: "ORIGINAL", counted_cash: 100,
    counted_card: null, counted_digital: null, created_at: now, client_key: "original" };
  data.shifts.push({ id: shiftId, store_id: branch, terminal_id: terminal, status: "CLOSED", state: "CLOSED", closed_at: now,
    row_version: 3, counted_cash: 100, final_counted_cash: 100, counted_card: null, counted_digital: null,
    expected_cash: 100, expected_card: 0, expected_digital: 0, variance_cash: 0, variance_card: null, variance_digital: null, variance_total: 0, variance_status: "NO_VARIANCE" });
  data.shift_cash_counts.push(original);
  data.shift_reconciliations.push({ id: randomUUID(), shift_id: shiftId, store_id: branch, count_id: originalId,
    expected_cash: 100, expected_card: 0, expected_digital: 0, counted_cash: 100, counted_card: null, counted_digital: null,
    variance_cash: 0, variance_card: null, variance_digital: null, variance_total: 0, variance_status: "NO_VARIANCE", created_at: now });
  data.shift_notifications.push({ id: randomUUID(), shift_id: shiftId, store_id: branch, summary: "Original immutable summary" });
  const calls: string[] = [];
  class Transaction {
    image!: typeof data;
    async begin() { this.image = copy(data); calls.push("begin"); }
    async commit() { calls.push("commit"); }
    async rollback() { calls.push("rollback"); }
  }
  class Request {
    inputs: Row = {};
    constructor(readonly transaction: Transaction) {}
    input(name: string, ...values: unknown[]) { this.inputs[name] = values.at(-1); return this; }
    async query(sql: string) {
      calls.push(sql);
      const table = /FROM dbo\.\[?(\w+)\]?/.exec(sql)?.[1];
      if (!table || !this.transaction.image[table]) throw new Error("Unexpected fixture SQL: " + sql);
      return { recordset: copy(this.transaction.image[table].filter(row => table === "shifts"
        ? row.id === this.inputs.shift && row.store_id === this.inputs.branch
        : row.shift_id === this.inputs.shift && (!Object.hasOwn(this.inputs, "client_key") ||
          row.store_id === this.inputs.branch && sameKey(row.client_key, this.inputs.client_key)))) };
    }
  }
  const repository = { connectionManager: { pool: {}, sql: () => ({ Transaction, Request, UniqueIdentifier: "uuid", ISOLATION_LEVEL: { SERIALIZABLE: 4 } }) },
    tables: new Map(registry.tables.map((table: Row) => [table.sqlServerTable, table])) };
  const writer = new ShiftSyncJournal(repository);
  const totals = vi.fn(async () => ({ expected_cash: 100, expected_card: 0, expected_digital: 0 }));
  const fault: { error?: Error & { number?: number }; competing?: boolean; legacyIndex?: boolean } = {};
  const save = (ops: Row[]) => {
    for (const op of ops) {
      if (op.kind === "insert") data[op.table].push(...copy(op.rows));
      else Object.assign(data[op.table].find(row => row.id === op.match.id)!, copy(op.values), { row_version: Number(data.shifts[0].row_version) + 1 });
    }
  };
  const apply = vi.fn(async (_context: string, ops: Row[]) => {
    if (fault.competing) { fault.competing = false; save(ops); throw Object.assign(new Error("Competing client key"), { number: 2601 }); }
    if (fault.error) throw fault.error;
    const count = ops.find(op => op.table === "shift_cash_counts")!.rows[0];
    if (fault.legacyIndex || data.shift_cash_counts.some(row => sameKey(row.client_key, count.client_key)))
      throw Object.assign(new Error("Unrelated or mismatched unique index"), { number: 2627 });
    save(ops);
    return { ok: true };
  });
  const context: Row = { localBranchId: () => branch,
    operationsRepository: { query: vi.fn(async (_branch, table, options) => ({ rows: data[table].filter(row => row.store_id === _branch && Object.entries(options.match).every(([key, value]) => row[key] === value)) })), shiftExpectedTotals: totals },
    shiftSyncJournal: { recountReplay: (intent: Row) => writer.recountReplay(intent), apply },
    adminSession: { identity: () => ({ subject: actor }) }, guard: require("../../../electron/ipc-guard.cjs"),
    shiftMoney: (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100, randomUUID, Date,
    pendingShiftCloseSync: new Set(), publishBusinessChange: vi.fn(), scheduleAutomaticSync: vi.fn() };
  runInNewContext(main.slice(start, end) + "\nthis.recount=commitLocalShiftRecount;", context);
  const input = { shiftId, cash: 120, card: null, digital: null, reason: "Verified recount", clientKey: "recount-one", terminalId: terminal };
  return { data, calls, writer, apply, totals, fault, context, input, recount: (raw = input) => context.recount(raw) };
}

afterEach(() => vi.useRealTimers());

describe("native recount integrity", () => {
  it("saves multiple recounts while preserving the original count, summary and closing timestamp", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(now));
    const f = fixture(), original = copy(f.data.shift_cash_counts[0]), summary = copy(f.data.shift_notifications[0]);
    await expect(f.recount()).resolves.toMatchObject({ ok: true, state: "CLOSED" });
    await expect(f.recount({ ...f.input, cash: 130, clientKey: "recount-two" })).resolves.toMatchObject({ ok: true });
    expect(f.data.shift_cash_counts).toHaveLength(3);
    expect(f.data.shift_cash_counts[0]).toEqual(original);
    expect(f.data.shift_notifications[0]).toEqual(summary);
    expect(f.data.shifts[0]).toMatchObject({ counted_cash: 130, closed_at: now });
  });

  it("verifies an exact historical replay after later recounts without recalculating today's totals", async () => {
    const f = fixture();
    await f.recount();
    await f.recount({ ...f.input, cash: 130, clientKey: "recount-two" });
    const before = copy(f.data);
    f.totals.mockClear().mockResolvedValue({ expected_cash: 999, expected_card: 999, expected_digital: 999 });
    await expect(f.recount()).resolves.toMatchObject({ ok: true, replayed: true });
    expect(f.data).toEqual(before);
    expect(f.totals).not.toHaveBeenCalled();
    expect(f.apply).toHaveBeenCalledTimes(2);
  });

  it.each([2601, 2627])("does not turn unrelated SQL %i into a successful replay", async number => {
    const f = fixture(), before = copy(f.data);
    const error = Object.assign(new Error("Unrelated constraint"), { number }); f.fault.error = error;
    await expect(f.recount()).rejects.toBe(error);
    expect(f.data).toEqual(before);
    expect(f.context.pendingShiftCloseSync.size).toBe(0);
  });

  it("truthfully fails a recount under the old shift-wide uniqueness rule", async () => {
    const f = fixture(), before = copy(f.data); f.fault.legacyIndex = true;
    await expect(f.recount()).rejects.toMatchObject({ number: 2627 });
    expect(f.data).toEqual(before);
  });

  it("verifies the saved competing operation after a duplicate-key race", async () => {
    const f = fixture(); f.fault.competing = true;
    await expect(f.recount()).resolves.toMatchObject({ ok: true, replayed: true });
    expect(f.data.shift_cash_counts).toHaveLength(2);
    expect(f.context.pendingShiftCloseSync.has(shiftId)).toBe(true);
  });

  it.each([
    ["amount", (f: ReturnType<typeof fixture>) => { f.data.shift_cash_counts[1].counted_cash = 999; }],
    ["kind", (f: ReturnType<typeof fixture>) => { f.data.shift_cash_counts[1].kind = "ORIGINAL"; }],
    ["reason", (f: ReturnType<typeof fixture>) => { f.data.shift_cash_counts[1].reason = "different"; }],
    ["actor", (f: ReturnType<typeof fixture>) => { f.data.shift_cash_counts[1].counted_by_staff_id = "other"; }],
    ["terminal", (f: ReturnType<typeof fixture>) => { f.data.shift_cash_counts[1].terminal_id = "other"; }],
    ["exact client key", (f: ReturnType<typeof fixture>) => { f.data.shift_cash_counts[1].client_key = "RECOUNT-ONE"; }],
    ["reconciliation", (f: ReturnType<typeof fixture>) => { f.data.shift_reconciliations.pop(); }],
    ["event", (f: ReturnType<typeof fixture>) => { f.data.shift_close_events.pop(); }],
    ["event facts", (f: ReturnType<typeof fixture>) => { f.data.shift_close_events[0].detail.reason = "different"; }],
    ["variance", (f: ReturnType<typeof fixture>) => { f.data.shift_reconciliations[1].variance_cash = 99; }],
    ["time", (f: ReturnType<typeof fixture>) => { f.data.shift_reconciliations[1].created_at = "2026-10-01T00:00:00Z"; }],
  ] as const)("rejects incomplete/mismatched saved %s without accepting a new transaction", async (_name, corrupt) => {
    const f = fixture(); await f.recount(); corrupt(f); const before = copy(f.data);
    await expect(f.recount()).rejects.toBeDefined();
    expect(f.data).toEqual(before);
    expect(f.apply).toHaveBeenCalledOnce();
    expect(f.calls.at(-1)).toBe("rollback");
  });

  it("does not treat a foreign shift's colliding key as this shift's replay", async () => {
    const f = fixture();
    f.data.shift_cash_counts.push({ ...f.data.shift_cash_counts[0], id: randomUUID(), shift_id: randomUUID(), client_key: f.input.clientKey });
    await expect(f.recount()).rejects.toMatchObject({ number: 2627 });
    expect(f.data.shift_cash_counts).toHaveLength(2);
  });

  it("rejects another branch and an uncounted shift before accepting recount writes", async () => {
    const f = fixture(); f.data.shifts[0].store_id = "branch-b";
    await expect(f.recount()).rejects.toThrow("no longer exists");
    expect(f.apply).not.toHaveBeenCalled();
    f.data.shifts[0].store_id = branch; f.data.shifts[0].state = "ACTIVE";
    await expect(f.recount()).rejects.toThrow("not been counted");
    expect(f.apply).not.toHaveBeenCalled();
  });

  it("keeps canonical and generated installer definitions guarded and data preserving", () => {
    const sql = readFileSync("database/sqlserver/migrations/021_shift_count_original_uniqueness.sql", "utf8").replaceAll("\r\n", "\n");
    expect(sql.indexOf("Unexpected named shift count index")).toBeLessThan(sql.indexOf("DROP INDEX"));
    expect(sql.indexOf("data conflicts")).toBeLessThan(sql.indexOf("DROP INDEX"));
    expect(sql).toContain("WITH (TABLOCKX,HOLDLOCK)");
    expect(sql).toContain("WHERE [kind]=N'ORIGINAL'");
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE)\s+(?:FROM\s+)?dbo\./i);
    for (const file of ["schema.sql", "migrations/001_initial.sql", "retail-pos-local-database.sql"])
      expect(readFileSync("database/sqlserver/" + file, "utf8").replaceAll("\r\n", "\n")).toContain(sql.split("-- SHIFT34_HISTORY_BEGIN")[0]);
    expect(registry.tables.find((table: Row) => table.cloudTable === "shift_cash_counts").columns.find((column: Row) => column.cloudColumn === "shift_id").uniqueFilter).toBe("[kind]=N'ORIGINAL'");
  });
});
