import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { LegacyShiftRecoveryService } = require("../../../electron/sync/legacy-shift-recovery-service.cjs");
const { rememberGraph, parseExactJson, stringifyExactJson } = require("../../../electron/sync/shift-recovery-exact.cjs");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BRANCH = uuid(1), TERMINAL = uuid(2), SHIFT = uuid(3), DATABASE = uuid(4), RECOVERY = uuid(5);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  const context = { branchId: BRANCH, terminalId: TERMINAL, backendOriginHash: "a".repeat(64), profileKey: "project/backend/proof/profile-v1" };
  const pool = {}, cm = { pool, sql: () => sql };
  let open = 0, guid = DATABASE, epoch = 1, admin = true, schema: boolean | "partial" = true, pending = "1";
  const statements: string[] = [], transactions: object[] = [];
  class Transaction {
    async begin() { open++; transactions.push(this); }
    async commit() { open--; }
    async rollback() { open--; }
  }
  class Request {
    constructor(_tx: object) {}
    input() { return this; }
    async query(text: string) {
      statements.push(text);
      if (text.includes("sys.database_recovery_status")) return { recordset: [{ database_guid: guid }] };
      if (text.includes("OBJECT_ID")) return { recordset: [{ evidence_id: 1, event_id: schema ? 2 : null, receipt_id: schema === true ? 3 : null }] };
      if (text.includes("COUNT_BIG")) return { recordset: [{ pending_count: pending }] };
      if (text.includes("SELECT store_id,terminal_id")) return { recordset: [{ store_id: BRANCH, terminal_id: TERMINAL }] };
      if (text.includes("SELECT TOP(@limit)")) return { recordset: [{ id: SHIFT, status: "CLOSED", state: "CLOSED", opened_at: "2026-01-01T00:00:00Z", closed_at: "2026-01-01T08:00:00Z" }] };
      throw Error("Unexpected fixture SQL: " + text);
    }
  }
  const sql = { Transaction, Request, ISOLATION_LEVEL: { SERIALIZABLE: "SERIALIZABLE" } };
  const parent = { id: SHIFT, store_id: BRANCH, terminal_id: TERMINAL, status: "CLOSED", opened_at: "2026-01-01T00:00:00.1234567Z", closed_at: "2026-01-01T08:00:00.1234567Z",
    counted_cash: "100.1234567890123456789", counted_card: null, counted_digital: null, expected_cash: "100.1234567890123456789", expected_card: "0.00", expected_digital: "0.00" };
  const tables = [{ table: "shifts", rows: [parent] }, ...["shift_cash_counts", "shift_reconciliations", "shift_close_events", "shift_notifications", "shift_variance_alerts"].map(table => ({ table, rows: [] }))];
  const raw = JSON.stringify({ ok: true, shiftGraphVersion: 1, branchId: BRANCH, shiftId: SHIFT, graphToken: "b".repeat(64), closedAtRaw: parent.closed_at, tables })
    .replaceAll('"100.1234567890123456789"', "100.1234567890123456789");
  const branded = () => rememberGraph(JSON.parse(raw), raw, "1");
  const cloud = { shiftGraph: vi.fn(async () => { expect(open).toBe(0); return branded(); }), pushLegacyRecovery: vi.fn(async (_event: object) => { expect(open).toBe(0); return Object.freeze({}); }) };
  const authority = {
    capture: vi.fn(() => { if (!admin) throw Object.assign(Error("Denied"), { code: "PERMISSION_DENIED" }); const saved = epoch; return { assertCurrent: () => { if (!admin || saved !== epoch) throw Object.assign(Error("Session changed"), { code: "PERMISSION_DENIED" }); } }; }),
    prepare: vi.fn(async (capture: { assertCurrent: () => void }) => { capture.assertCurrent(); return Object.freeze({}); }),
  };
  const event = Object.freeze({ recoveryId: RECOVERY });
  const evidenceStore = { preflight: vi.fn(async () => undefined), capture: vi.fn(async (tx: object, input: { scope: object; cloudGraphText: string }) => { expect(service.assertScope(tx, input.scope)).toBe(true); expect(input.cloudGraphText).toContain("100.1234567890123456789"); return { captureKey: "c".repeat(64), classification: "legacy-local-closing-needs-review" }; }) };
  const outbox = { preflight: vi.fn(async () => undefined), localGraph: vi.fn(async () => tables), assertOwnedGraphs: vi.fn(),
    create: vi.fn(async () => event), pending: vi.fn(async () => [event]),
    acknowledge: vi.fn(async (tx: object, input: { scope: object }) => { expect(service.assertScope(tx, input.scope)).toBe(true); pending = "0"; return { acknowledged: true }; }) };
  const service = new LegacyShiftRecoveryService({ connectionManager: cm, registry: {}, cloud, evidenceStore, outbox, authority, readContext: () => context });
  return { service, context, cm, cloud, authority, outbox, evidenceStore, statements, transactions, branded, tables,
    setGuid: (value: string) => { guid = value; }, setEpoch: () => { epoch++; }, setAdmin: (value: boolean) => { admin = value; }, setSchema: (value: boolean | "partial") => { schema = value; }, setPending: (value: string) => { pending = value; }, open: () => open };
}
describe("native legacy recovery coordinator", () => {
  it("releases SQL locks before network and retains exact financial/time text in minimal preview", async () => {
    const f = fixture(), result = await f.service.preview(SHIFT);
    expect(result.cloud.countedCash).toBe("100.1234567890123456789"); expect(result.local.closedAt).toBe("2026-01-01T08:00:00.1234567Z");
    expect(result.canApprove).toBe(true); expect(result.captureKey).toHaveLength(64);
    expect(JSON.stringify(result)).not.toMatch(/payloadJson|proof|localGraphText|cloudGraphText|signature|profileKey/);
    expect(f.transactions).toHaveLength(2); expect(f.open()).toBe(0);
    expect(f.statements.every(sql => !/\b(UPDATE|INSERT|DELETE|ALTER|TRUNCATE)\b/.test(sql))).toBe(true);
  });
  it("rejects a parsed response without Main's exact transport witness", async () => {
    const f = fixture(); f.cloud.shiftGraph.mockResolvedValue(JSON.parse(JSON.stringify(f.branded())));
    await expect(f.service.preview(SHIFT)).rejects.toMatchObject({ code: "ELEGACY_RECOVERY_EXACT_GRAPH_REQUIRED" }); expect(f.evidenceStore.capture).not.toHaveBeenCalled();
  });
  it.each(["branch", "profile", "pool", "session", "database"])("holds preview if %s changes during cloud read", async change => {
    const f = fixture(), started = deferred<void>(), reply = deferred<object>();
    f.cloud.shiftGraph.mockImplementation(async () => { expect(f.open()).toBe(0); started.resolve(); return reply.promise; });
    const pending = f.service.preview(SHIFT); await started.promise;
    if (change === "branch") f.context.branchId = uuid(99);
    if (change === "profile") f.context.profileKey = "changed backend/project/proof";
    if (change === "pool") f.cm.pool = {};
    if (change === "session") f.setEpoch();
    if (change === "database") f.setGuid(uuid(99));
    reply.resolve(f.branded()); await expect(pending).rejects.toThrow(); expect(f.evidenceStore.capture).not.toHaveBeenCalled(); expect(f.open()).toBe(0);
  });
  it("does not prepare or expose author keys without current Administrator authority", async () => {
    const f = fixture(); f.setAdmin(false);
    await expect(f.service.approve({ captureKey: "c".repeat(64), recoveryId: RECOVERY, reason: "Reviewed old closing" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.authority.prepare).not.toHaveBeenCalled(); expect(f.outbox.create).not.toHaveBeenCalled();
  });
  it("rechecks session after key preparation and before the durable decision", async () => {
    const f = fixture(); f.authority.prepare.mockImplementation(async () => { f.setEpoch(); return {}; });
    await expect(f.service.approve({ captureKey: "c".repeat(64), recoveryId: RECOVERY, reason: "Reviewed old closing" })).rejects.toThrow(); expect(f.outbox.create).not.toHaveBeenCalled();
  });
  it("approved UI result contains no payload, signing proof or implicit acceptance", async () => {
    const f = fixture(); expect(await f.service.approve({ captureKey: "c".repeat(64), recoveryId: RECOVERY, reason: "Reviewed old closing" })).toEqual({ recoveryId: RECOVERY, state: "PENDING", financialVerification: "UNVERIFIED_HISTORICAL" });
    expect(f.cloud.pushLegacyRecovery).not.toHaveBeenCalled();
  });
  it("missing optional metadata is skipped without touching ordinary checkout or upload state", async () => {
    const f = fixture(); f.setSchema(false);
    expect(await f.service.pushPending({ branchId: BRANCH })).toEqual({ skipped: true, reason: "UPGRADE_REQUIRED", acknowledged: 0, pushed: 0, pending: 0 });
    expect(f.outbox.pending).not.toHaveBeenCalled(); expect(f.cloud.pushLegacyRecovery).not.toHaveBeenCalled();
    expect(await f.service.list()).toEqual({ available: false, reason: "UPGRADE_REQUIRED", items: [] });
  });
  it("365-day pending replay and lost ACK stay durable, with no network held inside SQL", async () => {
    const f = fixture(); f.cloud.pushLegacyRecovery.mockRejectedValueOnce(Object.assign(Error("response lost"), { code: "ECONNRESET" }));
    await expect(f.service.pushPending({ branchId: BRANCH })).rejects.toMatchObject({ code: "ECONNRESET" }); expect(f.outbox.acknowledge).not.toHaveBeenCalled();
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 365 * 86400000);
    try { expect(await f.service.pushPending({ branchId: BRANCH })).toEqual({ skipped: false, acknowledged: 1, pushed: 1, pending: 0, downloadRecoveryComplete: false }); } finally { clock.mockRestore(); }
    expect(f.outbox.pending).toHaveBeenCalledTimes(2); expect(f.outbox.acknowledge).toHaveBeenCalledTimes(1); expect(f.open()).toBe(0);
  });
  it("coalesces duplicate sync invocations and rejects a changed source while upload awaits", async () => {
    const f = fixture(), started = deferred<void>(), reply = deferred<object>(); f.cloud.pushLegacyRecovery.mockImplementation(async () => { started.resolve(); return reply.promise; });
    const first = f.service.pushPending({ branchId: BRANCH }); await started.promise; expect(f.service.pushPending({ branchId: BRANCH })).toBe(first);
    f.context.profileKey = "changed profile"; reply.resolve({}); await expect(first).rejects.toMatchObject({ code: "SYNC_BRANCH_FORBIDDEN" });
    expect(f.cloud.pushLegacyRecovery).toHaveBeenCalledTimes(1); expect(f.outbox.acknowledge).not.toHaveBeenCalled();
  });
  it("validates cursor/branch boundaries and requires real Main context", async () => {
    const f = fixture(); await expect(f.service.list({ afterId: "forged" })).rejects.toThrow();
    await expect(f.service.pushPending({ branchId: uuid(99) })).rejects.toThrow(); f.context.profileKey = "";
    await expect(f.service.preview(SHIFT)).rejects.toThrow(); expect(f.cloud.shiftGraph).not.toHaveBeenCalled();
    expect(stringifyExactJson(parseExactJson('{"amount":123.000000000000001}'))).toBe('{"amount":123.000000000000001}');
  });
  it("counts pending approvals read-only and distinguishes missing capability from partial/corrupt state", async () => {
    const f = fixture(); expect(await f.service.pendingSummary()).toEqual({ available: true, pending: 1 });
    f.setSchema(false); expect(await f.service.pendingSummary()).toEqual({ available: false, pending: 0 });
    f.setSchema("partial"); await expect(f.service.pendingSummary()).rejects.toMatchObject({ code: "ELEGACY_RECOVERY_SCHEMA" });
    f.setSchema(true); f.setPending("NaN"); await expect(f.service.pendingSummary()).rejects.toMatchObject({ code: "ELEGACY_RECOVERY_PENDING_STATE" });
    f.setPending("9007199254740992"); await expect(f.service.pendingSummary()).rejects.toMatchObject({ code: "ELEGACY_RECOVERY_PENDING_STATE" });
    expect(f.statements.every(sql => !/\b(UPDATE|INSERT|DELETE|ALTER|TRUNCATE)\b/.test(sql))).toBe(true);
  });
  it("old schema skips the optional flow without requiring new cloud configuration and reuses its live-pool probe", async () => {
    const f = fixture(); f.setSchema(false);
    f.service.readContext = () => { throw Error("Old offline profile has no new protocol configuration"); };
    expect(await f.service.pendingSummary()).toEqual({ available: false, pending: 0 });
    expect(await f.service.pushPending({ branchId: BRANCH })).toMatchObject({ skipped: true, pushed: 0, pending: 0 });
    expect(await f.service.pendingSummary()).toEqual({ available: false, pending: 0 });
    expect(f.statements.filter(sql => sql.includes("OBJECT_ID"))).toHaveLength(1);
    expect(f.transactions).toHaveLength(0); expect(f.outbox.pending).not.toHaveBeenCalled();
    f.cm.pool = {};
    expect(await f.service.pendingSummary()).toEqual({ available: false, pending: 0 });
    expect(f.statements.filter(sql => sql.includes("OBJECT_ID"))).toHaveLength(2);
  });
  it("a reviewed schema refresh invalidates the old absence result without weakening protocol scope", async () => {
    const f = fixture(); f.setSchema(false); expect((await f.service.pendingSummary()).available).toBe(false);
    f.setSchema(true); expect((await f.service.pendingSummary()).available).toBe(false);
    f.service.invalidateCapability(); expect((await f.service.pendingSummary()).available).toBe(true);
    f.service.readContext = () => { throw Object.assign(Error("Management is not Operations"), { code: "SYNC_BRANCH_FORBIDDEN" }); };
    await expect(f.service.pushPending({ branchId: BRANCH })).rejects.toMatchObject({ code: "SYNC_BRANCH_FORBIDDEN" });
    expect(f.outbox.pending).not.toHaveBeenCalled();
  });
  it("failed/partial capability reads are errors and never cached as an empty pending queue", async () => {
    const f = fixture(); f.setSchema("partial");
    await expect(f.service.pendingSummary()).rejects.toMatchObject({ code: "ELEGACY_RECOVERY_SCHEMA" });
    f.setSchema(true); expect((await f.service.pendingSummary()).pending).toBe(1);
    const originalQuery = f.service.query.bind(f.service); f.service.invalidateCapability();
    f.service.query = async () => { throw Error("SQL temporarily unavailable"); };
    await expect(f.service.pendingSummary()).rejects.toMatchObject({ code: "ELEGACY_RECOVERY_CAPABILITY_UNAVAILABLE", retryable: true });
    f.service.query = originalQuery; expect((await f.service.pendingSummary()).pending).toBe(1);
  });
});
