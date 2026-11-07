import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { CloudClient } = require("../../../electron/sync/cloud-client.cjs");
const { PushWorker } = require("../../../electron/sync/push-worker.cjs");
const { readPage } = require("../../../electron/sync/page-policy.cjs");
const { bootstrapDiagnostic } = require("../../../electron/diagnostics.cjs");
const branch = "branch-fixture";
const terminal="00000000-0000-4000-8000-000000000001";
const proof = "a".repeat(64);
const client = () => new CloudClient({
  connectionManager:{pool:{}},
  configStore: { get: () => "https://pos.fixture" },
  terminalStore: { read: () => ({ tokenId: terminal, deviceUse:"operations", locationId:branch, deviceBindingProof: proof }) },
});
const bootstrap = (cloud = client(), limit = 100) => cloud.bootstrapPage({
  table: "change_history", branchId: branch, historyDays: 90, cursor: "saved-cursor", limit,
});
const rejection = (name: string) => new DOMException("Fixture response did not finish", name);
const failedBody = (status: number, error: Error) => ({
  ok: status >= 200 && status < 300, status, json: vi.fn().mockRejectedValue(error),
});
function controlledDeadlines() {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
    const controller = new AbortController();
    signals.push(controller.signal);
    setTimeout(() => controller.abort(rejection("TimeoutError")), milliseconds);
    return controller.signal;
  });
  return signals;
}
function stalledBody(signal: AbortSignal, status = 200) {
  return new Response(new ReadableStream({
    start(controller) {
      signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
    },
  }), { status });
}
const outcome = <T>(pending: Promise<T>) => pending.then(
  value => ({ value, error: undefined }),
  (error: unknown) => ({ value: undefined, error }),
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("native cloud response completion", () => {
  it.each(["TimeoutError", "AbortError"])("normalizes a %s before headers without an internal retry", async name => {
    const cause = rejection(name);
    const fetch = vi.fn().mockRejectedValue(cause);
    vi.stubGlobal("fetch", fetch);
    const result = await outcome(bootstrap());
    expect(result.value).toBeUndefined();
    expect(result.error).toMatchObject({ code: "ETIMEDOUT", cause });
    expect(result.error).not.toHaveProperty("status");
    expect(bootstrapDiagnostic(result.error, [])).toEqual({transportOperation:"bootstrap",transportStage:"fetch",transportErrorName:name});
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["TimeoutError", "AbortError"])("normalizes a %s during a successful response body", async name => {
    const cause = rejection(name);
    const fetch = vi.fn(async () => failedBody(200, cause));
    vi.stubGlobal("fetch", fetch);
    const result = await outcome(bootstrap());
    expect(result.value).toBeUndefined();
    expect(result.error).toMatchObject({ code: "ETIMEDOUT", cause });
    expect(result.error).not.toHaveProperty("status");
    expect(bootstrapDiagnostic(result.error, [])).toEqual({transportOperation:"bootstrap",transportStage:"body",transportErrorName:name});
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps the existing 30-second deadline active through a streamed body", async () => {
    const signals = controlledDeadlines();
    const fetch = vi.fn(async (_url: string, init: RequestInit) => stalledBody(init.signal!));
    vi.stubGlobal("fetch", fetch);
    let settled = false;
    const pending = outcome(bootstrap()).then(result => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).error).toMatchObject({ code: "ETIMEDOUT", cause: signals[0].reason });
    expect(signals[0].aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not return a valid upload acknowledgement until its complete body arrives", async () => {
    controlledDeadlines();
    let finish!: (value: unknown) => void;
    const acknowledgement = { ok: true, shift_closure_ack_version: 2, shift_closures: [] };
    const json = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json }));
    vi.stubGlobal("fetch", fetch);
    let settled = false;
    const pending = client().pushAggregate({ batchId: "stable-upload", branchId: branch, operations: [] })
      .then((value: unknown) => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(settled).toBe(false);
    finish(acknowledgement);
    expect(await pending).toEqual(acknowledgement);
    expect(json).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("accepts a complete valid response even when the deadline signal fires before its resolution microtask", async () => {
    const signals = controlledDeadlines();
    const acknowledgement = { ok: true, accepted: 1 };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200,
      json: () => new Promise(resolve => setTimeout(() => resolve(acknowledgement), 30_000)),
    })));
    const pending = outcome(client().pushBatch({ batchId: "stable-upload", branchId: branch,
      table: "products", rows: [], changes: [] }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(signals[0].aborted).toBe(true);
    expect(await pending).toEqual({ value: acknowledgement, error: undefined });
  });

  it("propagates an unrelated successful-status body stream failure without inventing HTTP 200", async () => {
    const failure = Object.assign(new TypeError("Fixture stream terminated"), { cause: { code: "UND_ERR_SOCKET" } });
    vi.stubGlobal("fetch", vi.fn(async () => failedBody(200, failure)));
    const result = await outcome(bootstrap());
    expect(result.error).toBe(failure);
    expect(bootstrapDiagnostic(result.error, [])).toEqual({transportOperation:"bootstrap",transportStage:"body",transportErrorName:"TypeError",transportCode:"UND_ERR_SOCKET"});
  });

  it("rejects malformed JSON on HTTP 200 instead of fabricating an acknowledgement", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{invalid json")));
    const result = await outcome(bootstrap());
    expect(result.value).toBeUndefined();
    expect(result.error).toMatchObject({ code: "HTTP_200", status: 200, message: "HTTP 200" });
    expect(bootstrapDiagnostic(result.error, [])).toEqual({ httpStatus: 200, nonJsonResponse: true });
  });

  it.each([
    [401, "SESSION_INVALID"], [403, "STORE_FORBIDDEN"], [400, "INVALID_REQUEST"], [503, "SERVICE_UNAVAILABLE"],
  ])("preserves HTTP %i and its authoritative JSON error code", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, code, error: "Fixture refused",
      details: "fixture detail" }, { status })));
    const result = await outcome(bootstrap());
    expect(result.error).toMatchObject({ code, status, message: "Fixture refused", detail: "fixture detail" });
    expect(bootstrapDiagnostic(result.error, [])).toEqual({ httpStatus: status, nonJsonResponse: false });
  });

  it.each([400, 401, 403, 422, 500, 503])("keeps known HTTP %i when its body aborts", async status => {
    const cause = rejection("AbortError");
    const fetch = vi.fn(async () => failedBody(status, cause));
    vi.stubGlobal("fetch", fetch);
    const result = await outcome(readPage((limit: number) => bootstrap(client(), limit), 100, { table: "change_history" }));
    expect(result.error).toMatchObject({ code: `HTTP_${status}`, status, cause });
    expect(bootstrapDiagnostic(result.error, [])).toEqual({ httpStatus: status, nonJsonResponse: false });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([401, 403])("does not shrink or retry a malformed HTTP %i denial for ordinary catalogue pages", async status => {
    const fetch = vi.fn(async () => new Response("<html>Fixture refusal</html>", { status }));
    vi.stubGlobal("fetch", fetch);
    const result = await outcome(readPage((limit: number) => bootstrap(client(), limit), 100, { table: "products" }));
    expect(result.error).toMatchObject({ code: `HTTP_${status}`, status });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not call a failed HTTP 503 body stream a verified non-JSON service-pressure response", async () => {
    const cause = new TypeError("Fixture stream terminated");
    const fetch = vi.fn(async () => failedBody(503, cause));
    vi.stubGlobal("fetch", fetch);
    const result = await outcome(readPage((limit: number) => bootstrap(client(), limit), 100, { table: "change_history" }));
    expect(result.error).toMatchObject({ code: "HTTP_503", status: 503, cause });
    expect(bootstrapDiagnostic(result.error, [])).toEqual({ httpStatus: 503, nonJsonResponse: false });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("native retry and acknowledgement integration", () => {
  it("uses the existing smaller-page backoff after a successful-status body deadline without changing the cursor", async () => {
    controlledDeadlines();
    const page = { rows: [{ id: "fixture-row", organization_id:"default", scope_type:"BRANCH", scope_id:branch }], cursor: "next-cursor" };
    const fetch = vi.fn(async (_url: string, init: RequestInit) => fetch.mock.calls.length === 1
      ? stalledBody(init.signal!) : Response.json(page));
    vi.stubGlobal("fetch", fetch);
    const pending = readPage((limit: number) => bootstrap(client(), limit), 100, { table: "change_history" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(249);
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ batch: page, limit: 50, nextLimit: 50 });
    const payloads = fetch.mock.calls.map(call => JSON.parse(String(call[1].body)));
    expect(payloads.map(payload => payload.sqlServerBootstrap.limit)).toEqual([100, 50]);
    for (const payload of payloads) expect(payload).toMatchObject({ terminalToken: terminal,
      deviceBindingProof: proof, sqlServerBootstrap: { branchId: branch, cursor: "saved-cursor" } });
  });

  it("preserves genuine non-JSON HTTP 503 provenance and the existing bounded history backoff", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response("<html>Fixture service unavailable</html>", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const pending = outcome(readPage((limit: number) => bootstrap(client(), limit), 100, { table: "change_history" }));
    await vi.advanceTimersByTimeAsync(249);
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    const result = await pending;
    expect(result.error).toMatchObject({ code: "HTTP_503", status: 503 });
    expect(bootstrapDiagnostic(result.error, [])).toEqual({ httpStatus: 503, nonJsonResponse: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("retains an upload after a body timeout and acknowledges only a later confirmed replay", async () => {
    let pendingAggregate = true;
    const aggregate = { aggregateId: "saved-aggregate", changes: [{ entity_type: "products",
      entity_id: JSON.stringify({ id: "fixture-product" }), key: { id: "fixture-product" }, operation: "insert" }] };
    const reader = {
      pendingAggregates: vi.fn(async (_branch: string, _size: number, excluded: string[]) =>
        pendingAggregate && !excluded.includes(aggregate.aggregateId) ? [aggregate] : []),
      rows: vi.fn(async () => [{ id: "fixture-product" }]),
      acknowledgeAggregate: vi.fn(async () => { pendingAggregate = false; }),
      failAggregate: vi.fn(async () => undefined),
    };
    const registry = { tables: [{ sqlServerTable: "products", cloudTable: "products", dependencyOrder: 0,
      columns: [{ cloudColumn: "id", sqlServerColumn: "id", primaryKey: true }] }] };
    const cloud = client();
    const worker = new PushWorker({ reader, cloud, registry });
    const cause = rejection("TimeoutError");
    const fetch = vi.fn().mockResolvedValueOnce(failedBody(200, cause))
      .mockImplementation(async (_url, init) => Response.json({ ok: true, replayed: true,
        batch_id: JSON.parse(init.body).sqlServerAggregate.batchId }));
    vi.stubGlobal("fetch", fetch);
    expect(await worker.pushAggregates(branch, 100, true)).toBe(0);
    expect(pendingAggregate).toBe(true);
    expect(reader.acknowledgeAggregate).not.toHaveBeenCalled();
    expect(reader.failAggregate).toHaveBeenCalledExactlyOnceWith("saved-aggregate", expect.objectContaining({ code: "ETIMEDOUT", cause }));
    expect(fetch).toHaveBeenCalledOnce();
    expect(await worker.pushAggregates(branch, 100, true)).toBe(1);
    expect(reader.acknowledgeAggregate).toHaveBeenCalledExactlyOnceWith("saved-aggregate");
    expect(pendingAggregate).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
  });
});
