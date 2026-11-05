import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { ReviewedShiftAdoption, precisionEquivalent } = require("../../../electron/sync/reviewed-shift-adoption.cjs");
const { loadRegistry } = require("../../../electron/db/schema-registry.cjs");
const { parseExactJson, stringifyExactJson, rememberGraph } = require("../../../electron/sync/shift-recovery-exact.cjs");
type Cell = unknown;
type Row = Record<string, Cell>;
type Column = { cloudColumn: string; cloudType: string; nullable: boolean };
type Table = { cloudTable: string; columns: Column[] };
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { databaseGuid: uid(9), branchId: uid(1), terminalId: uid(2), backendOriginHash: "a".repeat(64) };
const shift = uid(3), at = "2026-01-01T00:00:00.1234567Z";
function fixture() {
  const registry: { tables: Table[] } = loadRegistry(), names = ["shifts", "shift_cash_counts", "shift_reconciliations", "shift_close_events", "shift_notifications", "shift_variance_alerts"];
  const zero = () => parseExactJson("0");
  const row = (table: string, id: string): Row => Object.fromEntries(registry.tables.find(t => t.cloudTable === table)!.columns.map(c => [c.cloudColumn, c.cloudColumn === "id" ? id : c.cloudColumn === "store_id" ? scope.branchId : c.cloudColumn === "shift_id" ? shift : c.nullable ? null : c.cloudType === "uuid" ? uid(8) : /^(numeric|bigint|integer|smallint|real|double)/.test(c.cloudType) ? zero() : c.cloudType === "boolean" ? false : /^time/.test(c.cloudType) ? at : c.cloudType === "jsonb" ? {} : c.cloudType.endsWith("[]") ? [] : "fixture"]));
  const parent = { ...row("shifts", shift), terminal_id: scope.terminalId, status: "CLOSED", state: "CLOSED", opened_at: at, closed_at: at, counted_cash: zero(), final_counted_cash: zero(), expected_cash: zero(), expected_card: zero(), expected_digital: zero(), variance_cash: zero(), variance_total: zero(), variance_status: "NO_VARIANCE" };
  const count = { ...row("shift_cash_counts", uid(4)), terminal_id: scope.terminalId, kind: "ORIGINAL", counted_cash: zero() };
  const recon = { ...row("shift_reconciliations", uid(5)), count_id: uid(4), counted_cash: zero(), expected_cash: zero(), expected_card: zero(), expected_digital: zero(), variance_cash: zero(), variance_total: zero(), variance_status: "NO_VARIANCE" };
  const tables = names.map(table => ({ table, rows: table === "shifts" ? [parent] : table === "shift_cash_counts" ? [count] : table === "shift_reconciliations" ? [recon] : [] }));
  const response = (closed = true) => {
    const data = closed ? tables : names.map(table => ({ table, rows: table === "shifts" ? [{ ...parent, status: "OPEN", state: "ACTIVE", closed_at: null }] : [] }));
    const raw = stringifyExactJson({ ok: true, shiftGraphVersion: parseExactJson("1"), branchId: scope.branchId, shiftId: shift, graphToken: closed ? "b".repeat(64) : null, closedAtRaw: closed ? at : null, tables: data });
    return rememberGraph(JSON.parse(raw), raw, "1");
  };
  let active = true;
  const reviewer = Object.freeze({ binding: { authorId: uid(6), terminalId: scope.terminalId }, branchId: scope.branchId, subject: "current.actual.admin" });
  const authority = { assertPrepared: (candidate: object) => { if (!active || candidate !== reviewer) throw Object.assign(Error("No current Main authority"), { code: "PERMISSION_DENIED" }); } };
  const adopter = new ReviewedShiftAdoption({ connectionManager: {}, registry, evidenceStore: {}, outbox: {}, authority, assertScope: () => true,
    assertReceipt: () => { throw Object.assign(Error("No native receipt"), { code: "ELEGACY_RECOVERY_RECEIPT" }); } });
  return { adopter, reviewer, response, invalidate: () => { active = false; } };
}
describe("Main-only reviewed adoption preparation", () => {
  it("admits only the current actual Administrator and a fresh exact transport graph", () => {
    const f = fixture(); expect(f.adopter.prepareAdmin({ scope, reviewer: f.reviewer, graph: f.response(), reason: "Choose accepted cloud closing" })).toEqual({ mode: "ADMIN_ACCEPTED_CLOUD", shiftId: shift });
    expect(() => f.adopter.prepareAdmin({ scope, reviewer: { ...f.reviewer }, graph: f.response(), reason: "Choose accepted cloud closing" })).toThrow();
    expect(() => f.adopter.prepareAdmin({ scope, reviewer: f.reviewer, graph: JSON.parse(JSON.stringify(f.response())), reason: "Choose accepted cloud closing" })).toThrow();
  });
  it.each(["", "no", "x".repeat(401), "reason\ncontrol"])("does not accept invalid reason %j", reason => {
    const f = fixture(); expect(() => f.adopter.prepareAdmin({ scope, reviewer: f.reviewer, graph: f.response(), reason })).toThrow();
  });
  it("preserves OPEN proof semantics instead of fabricating a closing token", () => {
    const f = fixture(); expect(f.adopter.prepareAdmin({ scope, reviewer: f.reviewer, graph: f.response(false), reason: "Choose accepted OPEN precision" }).shiftId).toBe(shift);
  });
  it("denies another branch or registered terminal", () => {
    const f = fixture(); for (const alternate of [{ ...scope, branchId: uid(99) }, { ...scope, terminalId: uid(99) }]) expect(() => f.adopter.prepareAdmin({ scope: alternate, reviewer: f.reviewer, graph: f.response(), reason: "Choose cloud" })).toThrow();
  });
  it("forged, mutated or expired approval cannot reach any SQL writes", async () => {
    const f = fixture(), graph = f.response(), plan = f.adopter.prepareAdmin({ scope, reviewer: f.reviewer, graph, reason: "Choose accepted cloud" });
    await expect(f.adopter.apply({}, { scope, plan: { ...plan }, captureKey: "a".repeat(64), decisionId: uid(8) })).rejects.toMatchObject({ code: "EREVIEWED_APPROVAL_REQUIRED" });
    graph.tables[0].rows[0].status = "OPEN";
    await expect(f.adopter.apply({}, { scope, plan, captureKey: "a".repeat(64), decisionId: uid(8) })).rejects.toMatchObject({ code: "EREVIEWED_EXACT_GRAPH_REQUIRED" });
    const next = fixture(), valid = next.adopter.prepareAdmin({ scope, reviewer: next.reviewer, graph: next.response(), reason: "Choose accepted cloud" }); next.invalidate();
    await expect(next.adopter.apply({}, { scope, plan: valid, captureKey: "a".repeat(64), decisionId: uid(8) })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
  it("a renderer accepted flag never supplies the private server receipt", () => {
    const f = fixture(); expect(() => f.adopter.prepareReceipt({ scope, event: {}, witness: { accepted: true }, graph: f.response() })).toThrow();
  });
});

describe("OPEN timestamp precision bounds", () => {
  it.each([
    ["2026-01-01T00:00:00.1234567Z", "2026-01-01T00:00:00.123457Z", true],
    ["2026-01-01T00:00:00.1234565Z", "2026-01-01T00:00:00.123456Z", true],
    ["2026-01-01T00:00:00.1234567Z", "2026-01-01T00:00:00.1234567Z", true],
    ["2026-01-01T00:00:00.1234567Z", "2026-01-01T00:00:00.1234568Z", false],
    ["2026-01-01T00:00:00.1234567Z", "2026-01-02T00:00:00.123457Z", false],
    ["2026-01-01T00:00:00.1234567Z", "2026-01-01T00:00:00.123458Z", false],
    [null, null, true],
    [null, "2026-01-01T00:00:00Z", false],
  ])("preserves source %s target %s decision %s", (source, target, expected) => {
    expect(precisionEquivalent(source, target)).toBe(expected);
  });
});
