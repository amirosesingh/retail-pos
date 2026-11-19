import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { LocalDataLifecycle } = require("../../../electron/jobs/lifecycle.cjs");
const { bootstrapDiagnostic, tagBootstrapDiagnostic } = require("../../../electron/diagnostics.cjs");
const registry = { tables: [{ cloudTable: "products", sqlServerTable: "products", dependencyOrder: 0, columns: [] }] };

function fixture(failure: Record<string, unknown>) {
  const f = Object.create(LocalDataLifecycle.prototype);
  const coordinator = { runNow: vi.fn(async () => failure), recordVerification: vi.fn() };
  const service = { transition: vi.fn(), markReady: vi.fn() };
  Object.assign(f, { registry, cloud: {}, connectionManager: {}, databaseService: service,
    jobRepository: { completed: vi.fn(async () => ({ status: "completed" })) }, syncCoordinator: coordinator,
    cachedSnapshotReady: vi.fn(async () => false), unavailableHistoryPolicy: vi.fn(async () => null),
    resume: vi.fn(async () => undefined), pushWithGapRecovery: vi.fn(async () => ({ recovered: [] })),
    retain: vi.fn(async () => undefined), reconcileAndRecover: vi.fn(async () => []), historyPending: vi.fn(() => false),
  });
  return { f, coordinator, service };
}
function failed(extra: Record<string, unknown> = {}) {
  return { ok: false, code: "EREQUEST", error: "The statement has been terminated.", sqlNumber: 547,
    table: "products", ...extra };
}
async function rejection(work: Promise<unknown>) {
  try { await work; throw Error("Expected the lifecycle operation to remain blocked"); }
  catch (error) { return error as Error & { code?: string; sqlNumber?: number; table?: string }; }
}

describe("lifecycle coordinator failure diagnostics", () => {
  it("keeps the existing successful startup path and readiness result", async () => {
    const { f, coordinator, service } = fixture({ ok: true });
    expect(await f.ensure({ branchId: "fixture-branch" })).toMatchObject({ ok: true, branchId: "fixture-branch", historyPending: false });
    expect(coordinator.runNow).toHaveBeenCalledTimes(1); expect(f.retain).toHaveBeenCalledTimes(1);
    expect(service.markReady).toHaveBeenCalledWith({ phase: "ready", branchId: "fixture-branch", historyDays: 90 });
  });
  it("preserves the actual final sync failure through startup without granting readiness", async () => {
    const source = tagBootstrapDiagnostic(failed(), { table: "products", phase: "local_apply", origin: "refresh", httpStatus: 503 });
    const { f, coordinator, service } = fixture(source);
    const error = await rejection(f.ensure({ branchId: "fixture-branch" }));
    expect(error).toMatchObject({ code: "EREQUEST", sqlNumber: 547, table: "products", message: source.error });
    expect(bootstrapDiagnostic(error, ["products"])).toEqual({ table: "products", bootstrapPhase: "local_apply", bootstrapOrigin: "refresh", httpStatus: 503 });
    expect(coordinator.runNow).toHaveBeenCalledTimes(1); expect(service.markReady).not.toHaveBeenCalled();
    expect(f.retain).not.toHaveBeenCalled(); expect(f.reconcileAndRecover).not.toHaveBeenCalled();
    expect(source).toMatchObject({ code: "EREQUEST", sqlNumber: 547 });
  });

  it.each(["HTTP_403", "ESYNC_SHIFT_AUTHOR_DENIED", "ECHANGEGAP", "57014"])("keeps %s failures blocked and retains their code", async code => {
    const { f, service } = fixture(failed({ code, sqlNumber: undefined }));
    const error = await rejection(f.ensure({ branchId: "fixture-branch" }));
    expect(error.code).toBe(code); expect(error).not.toHaveProperty("sqlNumber");
    expect(service.markReady).not.toHaveBeenCalled(); expect(f.retain).not.toHaveBeenCalled();
  });

  it.each(["before", "after"])("keeps the original error and diagnostic when repair fails %s its reads", async stage => {
    const source = failed(), { f, coordinator } = fixture(source);
    f.historyStep = vi.fn(async () => undefined); f.reconcile = vi.fn(async () => []);
    f.registry = { tables: [...registry.tables, { cloudTable: "change_history" }] };
    if (stage === "after") coordinator.runNow.mockResolvedValueOnce({ ok: true });
    const error = await rejection(f.repair("fixture-branch", 90, ["change_history"]));
    expect(error).toMatchObject({ code: "EREQUEST", sqlNumber: 547, table: "products", message: source.error });
    expect(f.reconcile).not.toHaveBeenCalled();
    expect(f.historyStep).toHaveBeenCalledTimes(stage === "after" ? 1 : 0);
    expect(coordinator.runNow).toHaveBeenCalledTimes(stage === "after" ? 2 : 1);
  });

  it("keeps a reconciliation catch-up failure without repairing, ACKing or publishing verification", async () => {
    const { f, coordinator } = fixture(failed());
    f.reconciliationIdentity = vi.fn(() => ({})); f.assertReconciliationIdentity = vi.fn();
    f.reconcile = vi.fn(async () => [{ table: "products", local: "0", cloud: "1" }]);
    f.historyIndexAvailable = vi.fn(() => false);
    const error = await rejection(LocalDataLifecycle.prototype.reconcileAndRecover.call(f, "fixture-branch"));
    expect(error).toMatchObject({ code: "EREQUEST", sqlNumber: 547, table: "products" });
    expect(f.reconcile).toHaveBeenCalledTimes(1); expect(coordinator.recordVerification).not.toHaveBeenCalled();
  });

  it("preserves failure details when protected history must remain unavailable", async () => {
    const { f, service } = fixture(failed());
    f.unavailableHistoryPolicy.mockResolvedValueOnce({ code: "EHISTORY_POLICY_UNAVAILABLE" });
    f.prepareWithoutHistoryReader = vi.fn(async () => undefined);
    f.deferHistoryPolicy = vi.fn();
    const error = await rejection(f.ensure({ branchId: "fixture-branch" }));
    expect(error).toMatchObject({ code: "EREQUEST", sqlNumber: 547, table: "products" });
    expect(service.markReady).not.toHaveBeenCalled(); expect(f.deferHistoryPolicy).not.toHaveBeenCalled();
  });

  it.each([
    { sqlNumber: -1, table: "private_unknown_table" },
    { sqlNumber: "PRIVATE", table: "https://private.invalid?password=PRIVATE" },
    { sqlNumber: { valueOf: (): number => 547 }, table: { toString: (): string => "products" } },
  ])("does not copy unverified SQL/table metadata or raw payloads into a lifecycle error", async metadata => {
    const source = { ok: false, error: "Unchanged public error", ...metadata, query: "PRIVATE SQL", parameters: { password: "PRIVATE" }, pending: 99, credentialsInvalid: true };
    const { f } = fixture(source);
    const error = await rejection(f.ensure({ branchId: "fixture-branch" }));
    expect(error).toMatchObject({ code: "ESYNC", message: "Unchanged public error" });
    for (const field of ["sqlNumber", "table", "query", "parameters", "pending", "credentialsInvalid", "cause"]) expect(error).not.toHaveProperty(field);
    expect(JSON.stringify(error)).not.toContain("PRIVATE"); expect(bootstrapDiagnostic(error, ["products"])).toEqual({});
  });

  it("does not invoke diagnostic table getters and retains only registered tagged metadata", () => {
    const getter = vi.fn(() => { throw Error("PRIVATE getter must not execute"); });
    const source = tagBootstrapDiagnostic(Object.defineProperty(failed(), "table", { get: getter }),
      { table: "products", phase: "local_apply", origin: "refresh" });
    const { f } = fixture(source);
    const error = f.syncFailure(source, source.error);
    expect(error).toMatchObject({ table: "products", sqlNumber: 547 }); expect(getter).not.toHaveBeenCalled();
    expect(bootstrapDiagnostic(error, ["products"])).toEqual({ table: "products", bootstrapPhase: "local_apply", bootstrapOrigin: "refresh" });
  });
});
