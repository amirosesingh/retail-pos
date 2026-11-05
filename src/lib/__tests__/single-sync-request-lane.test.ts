import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { CloudClient } = require("../../../electron/sync/cloud-client.cjs");
const { SyncRequestLane } = require("../../../electron/sync/request-lane.cjs");

const gate = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function fixture() {
  const terminal = { tokenId: "11111111-1111-4111-8111-111111111111", branchId: "branch-a", locationId: "branch-a", deviceUse: "operations", deviceBindingProof: "a".repeat(64) };
  const manager = { pool: {}, profile: { id: "profile-a", host: "SQL-A", database: "POS_A" } };
  const backend = { value: "https://pos.test" }, project = { value: "https://project.test" };
  const client = new CloudClient({ configStore: { get: () => backend.value }, terminalStore: { read: () => terminal }, connectionManager: manager,
    financialBasisContext: () => ({ branchId: terminal.branchId, projectOrigin: project.value }) });
  return { terminal, manager, backend, project, client };
}
type Pending = { body: Record<string, unknown>; url: string; response: ReturnType<typeof gate<Response>>; signal: AbortSignal };
let pending: Pending[];
beforeEach(() => {
  pending = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => {
    const response = gate<Response>(); pending.push({ url, body: init.body ? JSON.parse(String(init.body)) : {}, response, signal: init.signal! }); return response.promise;
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const respond = (index: number, value: unknown = {}) => pending[index]!.response.resolve(Response.json(value));

describe("one coordinated CloudClient data request lane", () => {
  it("serializes real upload/download/bootstrap/count requests and alternates fairly between directions", async () => {
    const { client } = fixture();
    const first = client.pushBatch({ batchId: "u1", branchId: "branch-a", table: "products", rows: [{ id: "p1" }] });
    const second = client.pushBatch({ batchId: "u2", branchId: "branch-a", table: "stock_adjustments", rows: [] });
    const third = client.pullBatch({ branchId: "branch-a", cursor: 10, limit: 100 });
    const fourth = client.bootstrapPage({ branchId: "branch-a", table: "products", historyDays: 90, cursor: null, limit: 100 });
    const fifth = client.counts({ branchId: "branch-a" });
    expect(pending).toHaveLength(1);
    respond(0); await first; await tick();
    expect(pending[1]!.body).toHaveProperty("sqlServerPull");
    respond(1, []); await third; await tick();
    expect(pending[2]!.body).toHaveProperty("sqlServerBatch.batchId", "u2");
    respond(2); await second; await tick();
    expect(pending[3]!.body).toHaveProperty("sqlServerBootstrap.table", "products");
    respond(3); await fourth; await tick(); respond(4); await fifth;
  });
  it("holds the lane through response-body consumption instead of releasing it at headers", async () => {
    const { client } = fixture(), body = gate<unknown>();
    const first = client.counts({ branchId: "branch-a" }), second = client.bootstrapPage({ table: "products", branchId: "branch-a", limit: 10 });
    pending[0]!.response.resolve({ ok: true, json: () => body.promise } as Response);
    await tick(); expect(pending).toHaveLength(1);
    body.resolve({ products: 1 }); await first; await tick(); expect(pending).toHaveLength(2);
    respond(1); await second;
  });
  it("preserves body-timeout errors and permits the next request without acknowledging the timed-out one", async () => {
    const { client } = fixture(), body = gate<unknown>();
    const first = client.pushBatch({ batchId: "unchanged-id", branchId: "branch-a", table: "products", rows: [] });
    const caught = first.catch((error: Error & { code: string }) => error);
    const second = client.pullBatch({ branchId: "branch-a", cursor: 10, limit: 10 });
    pending[0]!.response.resolve({ ok: true, json: () => body.promise } as Response);
    body.reject(Object.assign(new Error("body timeout"), { name: "TimeoutError" }));
    expect(await caught).toMatchObject({ code: "ETIMEDOUT" }); await tick();
    expect(pending).toHaveLength(2); respond(1, []); await second;
    const retry = client.pushBatch({ batchId: "unchanged-id", branchId: "branch-a", table: "products", rows: [] }); await tick();
    expect(pending[2]!.body).toEqual(pending[0]!.body); respond(2); await retry;
  });
  it("preserves HTTP permission denials and still releases the lane", async () => {
    const { client } = fixture();
    const first = client.counts({ branchId: "branch-a" }).catch((error: unknown) => error);
    const second = client.bootstrapPage({ table: "products", branchId: "branch-a", limit: 10 });
    pending[0]!.response.resolve(Response.json({ ok: false, code: "FORBIDDEN", error: "Denied" }, { status: 403 }));
    expect(await first).toMatchObject({ code: "FORBIDDEN", status: 403 }); await tick(); respond(1); await second;
  });
  it.each(["backend", "project", "branch", "proof", "pool", "profile"])("rejects queued and active old-context results when %s changes without sending stale data", async field => {
    const f = fixture();
    const first = f.client.counts({ branchId: "branch-a" }).catch((error: unknown) => error);
    const second = f.client.pushBatch({ batchId: "saved", table: "products", rows: [] }).catch((error: unknown) => error);
    if (field === "backend") f.backend.value = "https://other.test";
    if (field === "project") f.project.value = "https://other-project.test";
    if (field === "branch") f.terminal.branchId = "branch-b";
    if (field === "proof") f.terminal.deviceBindingProof = "b".repeat(64);
    if (field === "pool") f.manager.pool = {};
    if (field === "profile") f.manager.profile.database = "OTHER";
    respond(0);
    expect(await first).toMatchObject({ code: "ESYNC_REQUEST_CONTEXT_CHANGED" });
    expect(await second).toMatchObject({ code: "ESYNC_REQUEST_CONTEXT_CHANGED" }); expect(pending).toHaveLength(1);
  });
  it("captures payload bytes before queueing and never substitutes a new governance operator", async () => {
    const { client } = fixture(); client.setAuthorizationProof({ accessToken: "first-operator" });
    const first = client.counts({ branchId: "branch-a" });
    const batch = { batchId: "original", table: "products", rows: [{ value: 1 }] };
    const ordinary = client.pushBatch(batch); batch.batchId = "mutated"; batch.rows[0]!.value = 99;
    const governed = client.pushBatch({ batchId: "settings", table: "pos_store_settings", rows: [] }).catch((error: unknown) => error);
    client.setAuthorizationProof({ accessToken: "second-operator" });
    respond(0); await first; await tick();
    expect(pending[1]!.body).toMatchObject({ sqlServerBatch: { batchId: "original", rows: [{ value: 1 }] } });
    respond(1); await ordinary;
    expect(await governed).toMatchObject({ code: "ESYNC_REQUEST_CONTEXT_CHANGED" }); expect(pending).toHaveLength(2);
  });
  it("keeps health and branch-admission control requests independent of a waiting data body", async () => {
    const { client } = fixture(), body = gate<unknown>();
    const data = client.counts({ branchId: "branch-a" });
    pending[0]!.response.resolve({ ok: true, json: () => body.promise } as Response);
    const health = client.health(), branches = client.managementBranches();
    expect(pending).toHaveLength(3); expect(pending[1]!.url).toContain("sync-health");
    respond(1, { serviceKey: true, posUrl: true }); respond(2, []);
    expect(await health).toMatchObject({ ready: true }); await branches;
    body.resolve({}); await data;
  });
  it("does not let a mixed control/data payload bypass the data lane", async () => {
    const { client } = fixture(); const first = client.counts({ branchId: "branch-a" });
    const second = client.request({ managementSyncBranches: true, sqlServerPull: { branchId: "branch-a" } });
    expect(pending).toHaveLength(1); respond(0); await first; await tick(); respond(1); await second;
  });
  it("does not let a data operation selector bypass the lane with an otherwise control-only body", async () => {
    const { client } = fixture(); const first = client.counts({ branchId: "branch-a" });
    const second = client.request({ managementSyncBranches: true }, "membership_directory");
    expect(pending).toHaveLength(1); respond(0); await first; await tick();
    expect(pending[1]!.url).toContain("operation=membership_directory"); respond(1); await second;
  });
  it("preserves exact financial strings, signatures and the existing network timeout at actual dispatch", async () => {
    const { client, terminal } = fixture();
    const raw = '{"amount":9007199254740993.123456789012}';
    const first = client.counts({ branchId: "branch-a" });
    const second = client.pushFinancialEvent({ branchId: "branch-a", operationJson: raw, proof: { signature: "opaque-proof" } });
    respond(0); await first; await tick();
    expect(pending[1]!.body).toMatchObject({ sqlServerFinancialEvent: { operationJson: raw, proof: { signature: "opaque-proof" } }, deviceBindingProof: terminal.deviceBindingProof });
    expect(pending[1]!.signal).toBeInstanceOf(AbortSignal); expect(pending[1]!.signal.aborted).toBe(false);
    respond(1); await second;
  });
  it("starts the existing thirty-second HTTP deadline only when the waiting request is actually sent", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
    const { client } = fixture();
    const first = client.counts({ branchId: "branch-a" });
    const second = client.pullBatch({ branchId: "branch-a", cursor: 0, limit: 10 });
    expect(timeout.mock.calls).toEqual([[30_000]]);
    respond(0); await first; await tick(); expect(timeout.mock.calls).toEqual([[30_000], [30_000]]);
    respond(1, []); await second;
  });
});

describe("bounded scheduling helper", () => {
  it("bounds waiting payloads, does not start an excess item and releases after rejection", async () => {
    const lane = new SyncRequestLane({ maxPending: 1, maxQueuedBytes: 10 }), firstGate = gate<unknown>();
    const first = lane.run("upload", 20, () => firstGate.promise).catch((error: unknown) => error);
    const next = vi.fn(async () => "next"), second = lane.run("download", 5, next);
    await expect(lane.run("download", 5, vi.fn())).rejects.toMatchObject({ code: "ESYNC_LANE_BUSY" });
    expect(next).not.toHaveBeenCalled(); firstGate.reject(new Error("lost acknowledgement")); await first;
    expect(await second).toBe("next");
  });
  it("does not starve uploads behind queued downloads and never overlaps work", async () => {
    const lane = new SyncRequestLane(), firstGate = gate<void>(); let active = 0, maximum = 0; const order: string[] = [];
    const task = (id: string) => async () => { active++; maximum = Math.max(maximum, active); order.push(id); await Promise.resolve(); active--; };
    const first = lane.run("download", 1, () => firstGate.promise);
    const d1 = lane.run("download", 1, task("d1")), d2 = lane.run("download", 1, task("d2")), u1 = lane.run("upload", 1, task("u1")), u2 = lane.run("upload", 1, task("u2"));
    firstGate.resolve(); await Promise.all([first, d1, d2, u1, u2]);
    expect(order).toEqual(["u1", "d1", "u2", "d2"]); expect(maximum).toBe(1);
  });
  it("bounds waiting bytes independently of the existing active operation's size", async () => {
    const lane = new SyncRequestLane({ maxPending: 10, maxQueuedBytes: 10 }), body = gate<void>();
    const first = lane.run("upload", 20, () => body.promise);
    const second = lane.run("download", 8, async () => "page");
    await expect(lane.run("upload", 4, vi.fn())).rejects.toMatchObject({ code: "ESYNC_LANE_BUSY" });
    body.resolve(); await first; expect(await second).toBe("page");
  });
});
