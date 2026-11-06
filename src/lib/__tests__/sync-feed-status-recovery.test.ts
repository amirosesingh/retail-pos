import { describe, expect, it, vi } from "vitest";
import { nativeSyncSummary } from "../sync-status-summary";
const { SyncCoordinator } = require("../../../electron/sync/coordinator.cjs");
const { PullWorker } = require("../../../electron/sync/pull-worker.cjs");
const { posFeedEvidence } = require("../../../electron/sync/status-evidence.cjs");
const { tagBootstrapDiagnostic, bootstrapDiagnostic } = require("../../../electron/diagnostics.cjs");
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const empty = () => ({ rows: [], tombstones: [], count: 0, cursor: 0 });
const network = () => tagBootstrapDiagnostic(new TypeError("fetch failed"), {
  transportOperation: "feed", transportStage: "fetch", transportCode: "EAI_AGAIN", transportErrorName: "TypeError",
});
function fixture() {
  const state = { membershipDeferred: true, checkpointError: null as Error | null, pending: false, held: false };
  const writes = vi.fn(() => { throw Error("Unexpected data/checkpoint write"); });
  const transactions = { begin: vi.fn(async () => {}), rollback: vi.fn(async () => {}), commit: writes };
  class Transaction {
    begin = transactions.begin; rollback = transactions.rollback; commit = transactions.commit;
  }
  const cloud = {
    pullBatch: vi.fn(async () => state.pending ? {
      rows: state.held ? [] : [{ table_name: "products", entity_id: "pending-product", row_data: { id: "pending-product" }, cursor: 1 }],
      tombstones: state.held ? [{ table_name: "held_orders", entity_id: "pending-product", tombstone: true, cursor: 1 }] : [], count: 1, cursor: 1,
    } : empty()),
    membershipDirectory: vi.fn(async () => state.membershipDeferred ? { ok: false } : { ok: true, nextRevision: 0, hasMore: false }),
    applyLocalBatch: writes,
  };
  const checkpoints = {
    get: vi.fn(async (_branch: string, table: string) => {
      if (table === "__membership_directory__" && state.checkpointError) throw state.checkpointError;
      return null;
    }), save: writes,
  };
  const reader = { unacknowledged: vi.fn(async () => new Set(["pending-product"])), connectionManager: { pool: {} },
    pendingSummary: vi.fn(async () => ({ pending: 0, failed: 0, conflicts: 0, queuedTables: [] })) };
  const manager = { pool: { request: writes }, sql: () => ({ Transaction, ISOLATION_LEVEL: { SERIALIZABLE: "fixture" } }) };
  const pull = new PullWorker({ connectionManager: manager, cloud, checkpoints,
    registry: { tables: [{ cloudTable: "products", dependencyOrder: 0 }, { cloudTable: "held_orders", dependencyOrder: 1 }] }, reader,
    conflicts: { reconcileAcknowledged: vi.fn(async () => {}) } });
  const push = vi.fn(async () => ({}));
  const coordinator = new SyncCoordinator({ pushWorker: { run: push, reader }, pullWorker: pull });
  return { state, writes, transactions, cloud, checkpoints, reader, pull, push, coordinator,
    run: (options = {}) => coordinator.runNow({ branchId: A, ...options }) };
}

describe("actual POS feed recovery status independently of Membership deferral", () => {
  it("clears a proven recovered feed DNS error while preserving the separate Membership deferral", async () => {
    const f = fixture(); const failure = network(); f.cloud.pullBatch.mockRejectedValueOnce(failure);
    const failed = await f.run();
    expect(failed).toMatchObject({ ok: false, lastError: "fetch failed" });
    expect(bootstrapDiagnostic(failed, [])).toMatchObject({ transportOperation: "feed", transportCode: "EAI_AGAIN" });
    const recovered = await f.run();
    expect(recovered).toMatchObject({ ok: true, lastError: null, membershipDeferred: true, pending: 0, failed: 0, conflicts: 0 });
    expect(recovered.lastPullAt).toEqual(expect.any(String));
    expect(nativeSyncSummary(recovered, { enabled: true, connected: true, tradingReady: true }).label).toBe("Journal queue clear");
    expect(f.cloud.membershipDirectory).toHaveBeenCalledTimes(1);
    expect((await f.run()).lastError).toBeNull();
    expect(f.writes).not.toHaveBeenCalled(); expect(f.transactions.begin).not.toHaveBeenCalled();
  });
  it("retains a repeated active feed failure and only clears it after an actual complete retry", async () => {
    const f = fixture(); f.cloud.pullBatch.mockRejectedValueOnce(network()).mockRejectedValueOnce(network());
    expect((await f.run()).lastError).toBe("fetch failed");
    expect((await f.run()).lastError).toBe("fetch failed");
    expect((await f.run()).lastError).toBeNull();
  });
  it.each([false, true])("does not turn a pending local %s feed barrier into successful recovery", async held => {
    const f = fixture(); f.cloud.pullBatch.mockRejectedValueOnce(network()); await f.run();
    f.state.membershipDeferred = false; f.state.pending = true; f.state.held = held;
    const partial = await f.run();
    expect(partial).toMatchObject({ ok: true, deferredLocalChanges: true, deferredHeldDeletion: held, lastError: "fetch failed" });
    expect(f.transactions.rollback).toHaveBeenCalledTimes(1); expect(f.writes).not.toHaveBeenCalled();
    f.state.pending = false; expect((await f.run()).lastError).toBeNull();
  });
  it("cannot clear branch A's feed error with branch B or upload-only success", async () => {
    const f = fixture(); f.cloud.pullBatch.mockRejectedValueOnce(network()); await f.run();
    expect((await f.run({ pushOnly: true })).lastError).toBe("fetch failed");
    expect((await f.run({ branchId: B })).lastError).toBeNull();
    expect((await f.run({ pushOnly: true })).lastError).toBe("fetch failed");
    expect((await f.run()).lastError).toBeNull();
  });
  it("can clear only a proven POS-feed failure with an explicitly POS-only complete pass", async () => {
    const f = fixture(); f.cloud.pullBatch.mockRejectedValueOnce(network()); await f.run();
    expect((await f.run({ skipMembership: true })).lastError).toBeNull();
    expect(f.cloud.membershipDirectory).not.toHaveBeenCalled();
  });
  it("retains unknown/full-scope failures rather than laundering them through a marked feed failure", async () => {
    const f = fixture(), actual = f.coordinator.pullWorker;
    f.coordinator.pullWorker = { run: async () => { throw Error("unknown full download failure"); } }; await f.run();
    f.coordinator.pullWorker = actual; f.cloud.pullBatch.mockRejectedValueOnce(network()); await f.run();
    expect(f.coordinator.unresolved().size).toBe(2);
    const result = await f.run();
    expect(result.lastError).toBe("unknown full download failure");
    expect(f.coordinator.unresolved().size).toBe(1);
    expect((await f.run({ skipMembership: true })).lastError).toBe("unknown full download failure");
    f.state.membershipDeferred = false; expect((await f.run()).lastError).toBeNull();
  });
  it("does not classify Membership metadata failures as POS-feed failures", async () => {
    const f = fixture(); f.state.checkpointError = Error("Membership checkpoint unavailable");
    expect((await f.run()).lastError).toBe("Membership checkpoint unavailable");
    f.state.checkpointError = null;
    expect((await f.run()).lastError).toBe("Membership checkpoint unavailable");
    expect((await f.run({ skipMembership: true })).lastError).toBe("Membership checkpoint unavailable");
    f.state.membershipDeferred = false; expect((await f.run()).lastError).toBeNull();
  });
  it("preserves actual feed authorization denial until the matching feed succeeds", async () => {
    const f = fixture(); f.cloud.pullBatch.mockRejectedValueOnce(Object.assign(Error("denied"), { status: 403 }));
    expect(await f.run()).toMatchObject({ ok: false, credentialsInvalid: true });
    expect(await f.run({ pushOnly: true })).toMatchObject({ credentialsInvalid: true });
    expect(await f.run()).toMatchObject({ ok: true, credentialsInvalid: false, lastError: null, membershipDeferred: true });
  });
  it("does not clear a push/activity failure through a successful POS download", async () => {
    const f = fixture(); f.push.mockRejectedValueOnce(Error("activity upload unavailable")); await f.run({ includeActivity: true });
    expect((await f.run({ includeActivity: false })).lastError).toBe("activity upload unavailable");
    expect((await f.run({ includeActivity: true })).lastError).toBeNull();
  });
  it("ignores forged, serialized, copied and wrong-branch completion claims", async () => {
    const f = fixture(); f.cloud.pullBatch.mockRejectedValueOnce(network()); await f.run();
    const actual = f.coordinator.pullWorker;
    f.coordinator.pullWorker = { run: async () => ({ posFeedComplete: true, completedScopes: ["pos_feed"], membershipDeferred: true }) };
    expect((await f.run()).lastError).toBe("fetch failed");
    f.coordinator.pullWorker = actual;
    const completed = await f.pull.run({ branchId: B, skipMembership: true });
    expect(posFeedEvidence(completed, A)).toBeNull(); expect(posFeedEvidence(completed, B)).toBe("complete");
    expect(posFeedEvidence(JSON.parse(JSON.stringify(completed)), B)).toBeNull();
    expect(posFeedEvidence({ ...completed }, B)).toBeNull();
    f.coordinator.pullWorker = { run: async () => completed };
    expect((await f.run()).lastError).toBe("fetch failed");
    f.coordinator.pullWorker = actual; expect((await f.run()).lastError).toBeNull();
  });
  it.each([undefined, null, false, "fetch failed", 2])("does not treat primitive evidence %s as success", value => {
    expect(posFeedEvidence(value, A)).toBeNull();
  });
});
