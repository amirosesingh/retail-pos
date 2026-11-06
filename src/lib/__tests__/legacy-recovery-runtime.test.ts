import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { createLegacyShiftRecoveryRuntime } = require("../../../electron/sync/legacy-shift-recovery-runtime.cjs");
const { SyncCoordinator } = require("../../../electron/sync/coordinator.cjs");
const session = require("../../../electron/admin-session.cjs");
const branch = "00000000-0000-4000-8000-000000000001";
function fixture() {
  let supported = true, source = "profile/project/backend/proof/v1", active = branch;
  const base = { connectionManager: { pool: {} }, pendingSummary: vi.fn(async () => ({ pending: 0, failed: 0, queuedTables: [] })) };
  const recovery = { pendingSummary: vi.fn(async (): Promise<{ available: boolean; pending: number; uploadPending?: number; convergencePending?: number }> => ({ available: true, pending: 0 })), pushPending: vi.fn(async () => ({ pushed: 0, pending: 0 })) };
  const ordinary = vi.fn(async (_options: object) => ({ pushed: 2 }));
  const runtime = createLegacyShiftRecoveryRuntime({ reader: base, recovery: () => recovery, enabled: () => supported, activeBranch: () => active,
    captureSource: () => { const captured = source; return () => { if (captured !== source) throw Object.assign(Error("source changed"), { code: "SYNC_BRANCH_FORBIDDEN" }); }; } });
  const coordinator = new SyncCoordinator({ pushWorker: { reader: runtime.reader, run: (options: object) => runtime.run(options, ordinary) }, pullWorker: { run: vi.fn(async () => ({})) }, publish: vi.fn() });
  return { base, recovery, ordinary, runtime, coordinator, supported: (value: boolean) => { supported = value; }, source: (value: string) => { source = value; }, branch: (value: string) => { active = value; } };
}

function mainConsumers() {
  const f = fixture(), source = readFileSync("electron/main.cjs", "utf8");
  const part = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const original = { tokenId: "old-fixture-terminal", branchId: branch }, config = { tokenId: "replacement-fixture-terminal", branchId: branch };
  const runFinal = vi.fn(async () => ({ ok: true })), health = vi.fn(async () => ({ online: false, ready: false, code: "EOFFLINE" }));
  const context = {
    adminSession: session, terminalStore: { lastBinding: () => original }, activationBoundary: { binding: (value: object) => value, sameBinding: (a: typeof original, b: typeof original) => a.tokenId === b.tokenId },
    databaseManager: { isConnected: () => true }, changeReader: f.base, legacyRecoveryRuntime: f.runtime,
    conflictRepository: { unresolved: async () => [] }, localBranchId: () => branch,
    syncCoordinator: { paused: false, resume() {}, pause() {}, runFinal }, syncCloud: { health },
    pendingShiftCloseSync: new Set(["saved-closing"]), mandatoryShiftSyncRun: null,
    SHUTDOWN_SYNC_TIMEOUT_MS: 1000, reportCloseProgress() {},
    settleWithin: async (work: () => Promise<unknown>) => { try { return { ok: true, value: await work() }; } catch (error) { return { ok: false, error }; } },
    require: (name: string) => { expect(name).toBe("./sync/shutdown-sync.cjs"); return require("../../../electron/sync/shutdown-sync.cjs"); },
    probes: {} as { assertSafeRegistrationChange(config: object): Promise<void>; flushSyncBeforeShutdown(options?: object): Promise<Record<string, unknown>>; synchronizeClosingShifts(): Promise<Record<string, unknown>> },
  };
  runInNewContext(part("async function assertSafeRegistrationChange(", "\nfunction recordRegistrationChange(") + "\n" +
    part("async function flushSyncBeforeShutdown(", "\nfunction reportCloseProgress(") + "\n" +
    part("async function synchronizeClosingShifts(", "\nasync function restoreShiftCloseGuard(") +
    "\nthis.probes={assertSafeRegistrationChange,flushSyncBeforeShutdown,synchronizeClosingShifts};", context);
  return { ...f, ...context.probes, config, original, runFinal, health };
}

afterEach(() => session.clear());

describe("actual Main pending consumers include durable legacy recovery", () => {
  it("holds reassignment while only legacy convergence remains and permits an unchanged registration", async () => {
    const f = mainConsumers(); session.grant("admin", "synthetic.admin", {}, "pos", branch);
    f.recovery.pendingSummary.mockResolvedValue({ available: true, pending: 2, uploadPending: 0, convergencePending: 2 });
    await expect(f.assertSafeRegistrationChange(f.config)).rejects.toThrow("pending transactions");
    expect(f.recovery.pendingSummary).toHaveBeenCalledOnce();
    await expect(f.assertSafeRegistrationChange(f.original)).resolves.toBeUndefined();
    expect(f.recovery.pendingSummary).toHaveBeenCalledOnce();
  });
  it.each([true, false])("retains truthful pending counts on signed-out/offline exit (signed out=%s)", async signedOut => {
    const f = mainConsumers(); if (!signedOut) session.grant("admin", "synthetic.admin", {}, "pos", branch);
    f.recovery.pendingSummary.mockResolvedValue({ available: true, pending: 2, uploadPending: 1, convergencePending: 1 });
    expect(await f.flushSyncBeforeShutdown({ allowSignedOutExit: true })).toMatchObject({ ok: true, pending: 2, synchronized: false });
    expect(f.runFinal).not.toHaveBeenCalled(); expect(f.health).toHaveBeenCalledTimes(signedOut ? 0 : 1);
  });
  it("includes legacy pending in the offline mandatory-closing response", async () => {
    const f = mainConsumers(); f.recovery.pendingSummary.mockResolvedValue({ available: true, pending: 2 });
    expect(await f.synchronizeClosingShifts()).toMatchObject({ ok: false, offline: true, pending: 2, code: "EOFFLINE" });
    expect(f.runFinal).not.toHaveBeenCalled();
  });
  it("keeps ordinary no-legacy semantics and never treats a failed count as empty", async () => {
    const f = mainConsumers(); session.grant("admin", "synthetic.admin", {}, "pos", branch); f.supported(false);
    await expect(f.assertSafeRegistrationChange(f.config)).resolves.toBeUndefined();
    f.base.pendingSummary.mockResolvedValue({ pending: 3, failed: 0, queuedTables: [] });
    expect(await f.flushSyncBeforeShutdown()).toMatchObject({ ok: true, offline: true, pending: 3, synchronized: false });
    expect(f.recovery.pendingSummary).not.toHaveBeenCalled();
    f.supported(true); f.recovery.pendingSummary.mockRejectedValue(Object.assign(Error("Unavailable legacy queue count"), { code: "ELEGACY_RECOVERY_PENDING_STATE" }));
    await expect(f.assertSafeRegistrationChange(f.config)).rejects.toMatchObject({ code: "ELEGACY_RECOVERY_PENDING_STATE" });
    expect(await f.flushSyncBeforeShutdown()).toMatchObject({ ok: false, code: "ELEGACY_RECOVERY_PENDING_STATE" });
  });
});
describe("existing coordinator legacy recovery runtime adapter", () => {
  it("adds only verified new-queue counts and refuses final close while the historical event remains pending", async () => {
    const f = fixture(); f.recovery.pendingSummary.mockResolvedValue({ available: true, pending: 1 });
    f.recovery.pushPending.mockRejectedValue(Object.assign(Error("private revoked author detail"), { code: "ELEGACY_RECOVERY_ADMIN_REVIEW_REQUIRED" }));
    expect(await f.coordinator.runFinal({ branchId: branch })).toMatchObject({ ok: false, code: "ESYNC_PENDING", pending: 1 });
    expect(f.ordinary).toHaveBeenCalledTimes(1);
    expect(f.runtime.status(f.coordinator.snapshot())).toMatchObject({ legacyRecovery: { held: true, downloadRecoveryComplete: false } });
    expect(JSON.stringify(f.runtime.status(f.coordinator.snapshot()))).not.toContain("private revoked");
  });
  it("a failed count cannot become false zero through the coordinator's swallowed refresh error", async () => {
    const f = fixture(); f.recovery.pendingSummary.mockRejectedValue(Object.assign(Error("sensitive SQL detail"), { code: "ELEGACY_RECOVERY_PENDING_STATE" }));
    const refreshed = await f.coordinator.refresh(branch);
    expect(refreshed.pending).toBe(0); // Existing coordinator retains its old snapshot.
    expect(f.runtime.status(refreshed)).toMatchObject({ pending: null, pendingVerified: false, legacyRecovery: { pendingVerified: false } });
    await expect(f.runtime.reader.pendingSummary(branch)).rejects.toMatchObject({ code: "ELEGACY_RECOVERY_PENDING_STATE" });
    await expect(f.coordinator.runFinal({ branchId: branch })).rejects.toMatchObject({ code: "ELEGACY_RECOVERY_PENDING_STATE" });
    expect(JSON.stringify(f.runtime.status(refreshed))).not.toContain("sensitive SQL");
  });
  it("recovers the status only after a verified count and never claims graph adoption", async () => {
    const f = fixture(); f.recovery.pendingSummary.mockRejectedValueOnce(Error("lost count"));
    await f.coordinator.refresh(branch); expect(f.runtime.status(f.coordinator.snapshot()).pendingVerified).toBe(false);
    await f.coordinator.refresh(branch); expect(f.runtime.status(f.coordinator.snapshot()).pendingVerified).not.toBe(false);
    f.recovery.pushPending.mockResolvedValue({ pushed: 1, pending: 0 });
    const result = await f.runtime.run({ branchId: branch }, f.ordinary); expect(result.pushed).toBe(3); expect(result.downloadRecoveryComplete).not.toBe(true);
  });
  it.each(["ELEGACY_RECOVERY_ADMIN_REVIEW_REQUIRED", "HTTP_403", "HTTP_503", "ECONNRESET"])("continues eligible ordinary uploads when historical recovery is held by %s", async code => {
    const f = fixture(); f.recovery.pushPending.mockRejectedValue(Object.assign(Error("private historical error"), { code }));
    const result = await f.runtime.run({ branchId: branch }, f.ordinary);
    expect(result).toMatchObject({ pushed: 2, legacyRecoveryHeld: true }); expect(f.ordinary).toHaveBeenCalledTimes(1);
    expect(f.runtime.status({ pending: 1 })).toMatchObject({ pending: 1, legacyRecovery: { held: true } });
  });
  it("tries historical events before the original CT reader and keeps the original ECHANGEGAP failure", async () => {
    const f = fixture(), order: string[] = [];
    f.recovery.pushPending.mockImplementation(async () => { order.push("legacy"); return { pushed: 1, pending: 0 }; });
    f.ordinary.mockImplementation(async () => { order.push("ordinary"); throw Object.assign(Error("retained CT gap"), { code: "ECHANGEGAP" }); });
    expect(await f.coordinator.runNow({ branchId: branch, pushOnly: true })).toMatchObject({ ok: false, code: "ECHANGEGAP" });
    expect(order).toEqual(["legacy", "ordinary"]);
  });
  it.each(["SYNC_BRANCH_FORBIDDEN", "ELEGACY_RECOVERY_SCOPE", "ESYNC_SHIFT_AUTHOR_CHANGED"])("does not continue unsafe source/scope failure %s into ordinary uploads", async code => {
    const f = fixture(); f.recovery.pushPending.mockRejectedValue(Object.assign(Error("scope mismatch"), { code }));
    await expect(f.runtime.run({ branchId: branch }, f.ordinary)).rejects.toMatchObject({ code }); expect(f.ordinary).not.toHaveBeenCalled();
  });
  it("rechecks source after asynchronous recovery even when the error itself appears transient", async () => {
    const f = fixture(); f.recovery.pushPending.mockImplementation(async () => { f.source("new backend or SQL profile"); throw Object.assign(Error("connection failed"), { code: "HTTP_503" }); });
    await expect(f.runtime.run({ branchId: branch }, f.ordinary)).rejects.toMatchObject({ code: "SYNC_BRANCH_FORBIDDEN" }); expect(f.ordinary).not.toHaveBeenCalled();
  });
  it("Management/no-SQL/non-Operations skip leaves original readers/uploads unchanged", async () => {
    const f = fixture(); f.supported(false);
    expect(await f.runtime.reader.pendingSummary(branch)).toEqual({ pending: 0, failed: 0, queuedTables: [] });
    expect(await f.runtime.run({ branchId: branch }, f.ordinary)).toEqual({ pushed: 2 });
    expect(f.runtime.status({ pending: 0 })).toEqual({ pending: 0 }); expect(f.recovery.pendingSummary).not.toHaveBeenCalled(); expect(f.recovery.pushPending).not.toHaveBeenCalled();
  });
  it("different branch does not inherit another branch's private hold flags", async () => {
    const f = fixture(); f.recovery.pushPending.mockRejectedValue(Error("held old branch")); await f.runtime.run({ branchId: branch }, f.ordinary);
    f.branch("00000000-0000-4000-8000-000000000099"); expect(f.runtime.status({ pending: 0 })).toEqual({ pending: 0 });
  });
  it("counts ACKed local convergence as pending without claiming another cloud upload", async () => {
    const f = fixture(); f.recovery.pendingSummary.mockResolvedValue({ available: true, pending: 2, uploadPending: 0, convergencePending: 2 });
    expect(await f.runtime.reader.pendingSummary(branch)).toMatchObject({ pending: 2, queuedTables: [{ table: "legacy_closing_local_convergence", pending: 2 }] });
    f.recovery.pushPending.mockResolvedValue({ pushed: 0, pending: 2 });
    expect(await f.coordinator.runFinal({ branchId: branch })).toMatchObject({ ok: false, code: "ESYNC_PENDING", pending: 2 });
  });
});
