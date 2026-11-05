import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { createLegacyShiftRecoveryRuntime } = require("../../../electron/sync/legacy-shift-recovery-runtime.cjs");
const { SyncCoordinator } = require("../../../electron/sync/coordinator.cjs");
const branch = "00000000-0000-4000-8000-000000000001";
function fixture() {
  let supported = true, source = "profile/project/backend/proof/v1", active = branch;
  const base = { connectionManager: { pool: {} }, pendingSummary: vi.fn(async () => ({ pending: 0, failed: 0, queuedTables: [] })) };
  const recovery = { pendingSummary: vi.fn(async () => ({ available: true, pending: 0 })), pushPending: vi.fn(async () => ({ pushed: 0, pending: 0 })) };
  const ordinary = vi.fn(async (_options: object) => ({ pushed: 2 }));
  const runtime = createLegacyShiftRecoveryRuntime({ reader: base, recovery: () => recovery, enabled: () => supported, activeBranch: () => active,
    captureSource: () => { const captured = source; return () => { if (captured !== source) throw Object.assign(Error("source changed"), { code: "SYNC_BRANCH_FORBIDDEN" }); }; } });
  const coordinator = new SyncCoordinator({ pushWorker: { reader: runtime.reader, run: (options: object) => runtime.run(options, ordinary) }, pullWorker: { run: vi.fn(async () => ({})) }, publish: vi.fn() });
  return { base, recovery, ordinary, runtime, coordinator, supported: (value: boolean) => { supported = value; }, source: (value: string) => { source = value; }, branch: (value: string) => { active = value; } };
}
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
});
