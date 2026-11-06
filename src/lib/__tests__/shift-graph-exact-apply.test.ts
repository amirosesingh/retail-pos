import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { applyShiftGraphs } = require("../../../electron/sync/shift-graph.cjs");
const { ShiftIntentStore } = require("../../../electron/db/shift-intents.cjs");
const { loadRegistry } = require("../../../electron/db/schema-registry.cjs");
const { parseExactJson, stringifyExactJson, rememberGraph, exactGraph } = require("../../../electron/sync/shift-recovery-exact.cjs");
type Row = Record<string, unknown>;
type Column = { cloudColumn: string; sqlServerColumn: string; cloudType: string; nullable: boolean };
type Table = { cloudTable: string; columns: Column[] };
type Statement = { text: string; inputs: Map<string, unknown[]> };
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const branch = uid(1), shift = uid(2), at = "2026-01-01T00:00:00.1234567Z";
const names = ["shifts", "shift_cash_counts", "shift_reconciliations", "shift_close_events", "shift_notifications", "shift_variance_alerts"];

function fixture() {
  const registry = loadRegistry(), tables: Table[] = registry.tables.filter((t: Table) => names.includes(t.cloudTable));
  const row = (table: string, id: string): Row => Object.fromEntries(tables.find(t => t.cloudTable === table)!.columns.map(c => [c.cloudColumn,
    c.cloudColumn === "id" ? id : c.cloudColumn === "store_id" ? branch : c.cloudColumn === "shift_id" ? shift : c.nullable ? null : c.cloudType === "uuid" ? uid(8) : /^(numeric|bigint|integer|smallint|real|double)/.test(c.cloudType) ? parseExactJson("0") : c.cloudType === "boolean" ? false : /^time/.test(c.cloudType) ? at : c.cloudType === "jsonb" ? {} : c.cloudType.endsWith("[]") ? [] : "fixture"]));
  const cash = () => parseExactJson("1234567890.123456789012");
  const parent = { ...row("shifts", shift), status: "CLOSED", state: "CLOSED", closed_at: at, opened_at: at, counted_cash: cash(), final_counted_cash: cash(), expected_cash: cash(), expected_card: parseExactJson("0"), expected_digital: parseExactJson("0"), variance_cash: parseExactJson("0"), variance_total: parseExactJson("0"), variance_status: "NO_VARIANCE" };
  const count = { ...row("shift_cash_counts", uid(3)), kind: "ORIGINAL", counted_cash: cash(), created_at: at };
  const recon = { ...row("shift_reconciliations", uid(4)), count_id: uid(3), counted_cash: cash(), expected_cash: cash(), expected_card: parseExactJson("0"), expected_digital: parseExactJson("0"), variance_cash: parseExactJson("0"), variance_total: parseExactJson("0"), variance_status: "NO_VARIANCE" };
  const raw = stringifyExactJson({ ok: true, shiftGraphVersion: parseExactJson("1"), branchId: branch, shiftId: shift, graphToken: "d".repeat(64), closedAtRaw: at,
    tables: names.map(table => ({ table, rows: table === "shifts" ? [parent] : table === "shift_cash_counts" ? [count] : table === "shift_reconciliations" ? [recon] : [] })) });
  const graph = rememberGraph(JSON.parse(raw), raw, "1"), exact = exactGraph(graph, branch, shift);
  const local = new Map<string, Row[]>();
  for (const table of tables) local.set(table.cloudTable, exact.tables.find((part: { table: string }) => part.table === table.cloudTable).rows.map((item: Row) => Object.fromEntries(table.columns.map(column => {
    const value = item[column.cloudColumn], type = column.cloudType;
    return [column.sqlServerColumn, value !== null && (/^(numeric|bigint|integer|smallint|real|double)/.test(type) || type === "jsonb" || type.endsWith("[]")) ? stringifyExactJson(value) : value];
  }))));
  const expected = new Map([...local].map(([table, rows]) => [table, rows.map(item => ({ ...item }))]));
  const statements: Statement[] = [], tx = {}, marker = Symbol("explicit nvarchar"), sql = { MAX: -1, NVarChar: (_: unknown) => marker, Request: class {
    inputs = new Map<string, unknown[]>();
    constructor(candidate: object) { expect(candidate).toBe(tx); }
    input(name: string, ...args: unknown[]) { this.inputs.set(name, args); return this; }
    async query(text: string) {
      statements.push({ text, inputs: this.inputs });
      const table = /dbo\.\[(\w+)\]/.exec(text)?.[1];
      if (/MERGE dbo\.\[/.test(text) && table) { local.set(table, expected.get(table)!); return { recordset: [] }; }
      return { recordset: table ? local.get(table) : [] };
    }
  } };
  const cm = { sql: () => sql }, reader = { unacknowledged: async () => new Set(), exactShiftGraphNoop: () => false };
  const apply = (options = {}) => applyShiftGraphs({ transaction: tx, connectionManager: cm, registry, reader, branchId: branch, prepared: { graphs: new Map([[shift, graph]]) }, ...options });
  return { graph, raw, local, expected, statements, reader, cm, registry, tx, marker, apply };
}

describe("exact protected closing application", () => {
  it("updates only the changed column and saves an exact baseline", async () => {
    const f = fixture(); f.local.get("shifts")![0].note = "Old local note";
    expect(await f.apply()).toBe(1);
    const dml = f.statements.find(statement => /MERGE dbo\.\[shifts\]/.test(statement.text))!;
    expect(dml.text).toContain("target.[note]=source.[note]");
    expect(dml.text).not.toContain("target.[counted_cash]");
    expect(dml.text).not.toContain("WHEN NOT MATCHED");
    expect([...dml.inputs.values()].every(args => args[0] === f.marker && args.length === 2)).toBe(true);
    const baseline = f.statements.find(statement => statement.text.includes("MERGE dbo.pos_sync_shift_baselines"))!;
    expect(baseline.inputs.get("graph")![0]).toBe(f.raw);
    expect(baseline.inputs.get("graph")![0]).toContain("1234567890.123456789012");
    expect(baseline.inputs.get("closed")![0]).toBe(at);
  });

  it("uses unrounded values and explicit registered casts for a missing parent", async () => {
    const f = fixture(); f.local.set("shifts", []); await f.apply();
    const insert = f.statements.find(statement => /MERGE dbo\.\[shifts\]/.test(statement.text))!;
    expect(insert.text).toContain("WHEN NOT MATCHED THEN INSERT"); expect(insert.text).not.toContain("WHEN MATCHED THEN UPDATE");
    expect(insert.text).toContain("CONVERT(decimal(38,12),"); expect(insert.text).toContain("CONVERT(datetimeoffset(7),");
    expect([...insert.inputs.values()].some(args => args[1] === "1234567890.123456789012")).toBe(true);
    expect([...insert.inputs.values()].some(args => args[1] === at)).toBe(true);
  });

  it("does not silently treat a 100ns immutable mismatch as equal", async () => {
    const f = fixture(); f.local.get("shift_cash_counts")![0].created_at = "2026-01-01T00:00:00.1234566Z";
    await expect(f.apply()).rejects.toMatchObject({ code: "ESYNC_APPLY_CONFLICT" });
    expect(f.statements.some(statement => statement.text.includes("MERGE dbo."))).toBe(false);
  });

  it("requires exact readback before accepting a mutable timestamp update", async () => {
    const f = fixture(); f.local.get("shifts")![0].opened_at = "2026-01-01T00:00:00.1234566Z";
    f.expected.get("shifts")![0].opened_at = "2026-01-01T00:00:00.1234566Z";
    await expect(f.apply()).rejects.toMatchObject({ code: "ESYNC_APPLY_DEFERRED" });
    expect(f.statements.some(statement => statement.text.includes("MERGE dbo.pos_sync_shift_baselines"))).toBe(false);
  });

  it("retains branch, pending-intent, expired-history and no-delete guards", async () => {
    const pending = fixture(); pending.reader.unacknowledged = async () => new Set([shift]);
    await expect(pending.apply()).rejects.toMatchObject({ code: "ELOCAL_UPLOAD_PENDING" }); expect(pending.statements).toEqual([]);
    const gap = fixture(); await expect(gap.apply({ recovery: { requiresExact: () => true } })).rejects.toMatchObject({ code: "ELOCAL_PENDING_UNVERIFIED" });
    const deleted = fixture(); deleted.local.get("shift_close_events")!.push({ id: uid(99), store_id: branch });
    await expect(deleted.apply()).rejects.toMatchObject({ code: "ESYNC_APPLY_CONFLICT" });
    const branchChange = fixture(); await expect(branchChange.apply({ branchId: uid(90) })).rejects.toMatchObject({ code: "ESYNC_GRAPH" });
  });

  it("does not let a mutated witness silently become an ordinary graph", async () => {
    const f = fixture(); f.graph.tables[0].rows[0].note = "Changed after response";
    await expect(f.apply()).rejects.toMatchObject({ code: "ESYNC_GRAPH" }); expect(f.statements).toEqual([]);
  });

  it("rechecks private witness identity after awaited reader validation", async () => {
    const f = fixture(); f.reader.unacknowledged = async () => { f.graph.tables[0].rows[0].note = "Changed while awaiting"; return new Set(); };
    await expect(f.apply()).rejects.toMatchObject({ code: "ESYNC_GRAPH" });
    expect(f.statements.some(statement => statement.text.includes("MERGE dbo.pos_sync_shift_baselines"))).toBe(false);
  });
});

describe("exact baseline storage and compatibility", () => {
  it("stores exact tokens only when the private witness remains valid", async () => {
    const f = fixture(), store = new ShiftIntentStore(f.cm, f.registry); await store.adopt(f.tx, f.graph);
    expect(f.statements[0].inputs.get("graph")![0]).toBe(f.raw);
    f.graph.tables[0].rows[0].note = "Tampered";
    await expect(store.adopt(f.tx, f.graph)).rejects.toMatchObject({ code: "ESYNC_GRAPH" }); expect(f.statements).toHaveLength(1);
  });
  it("keeps genuine unbranded graphs on the existing legacy baseline path", async () => {
    const f = fixture(), ordinary = JSON.parse(JSON.stringify(f.graph)), store = new ShiftIntentStore(f.cm, f.registry);
    await store.adopt(f.tx, ordinary); expect(f.statements[0].inputs.get("graph")![0]).toBe(JSON.stringify(ordinary));
  });
});
