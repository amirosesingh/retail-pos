import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { CloudClient } = require("../../../electron/sync/cloud-client.cjs");
const { refreshTable, runBootstrap } = require("../../../electron/jobs/bootstrap.cjs");
const { LocalDataLifecycle } = require("../../../electron/jobs/lifecycle.cjs");
const { tagBootstrapDiagnostic, bootstrapDiagnostic } = require("../../../electron/diagnostics.cjs");
const table = (name: string, order = 0) => ({ cloudTable: name, sqlServerTable: name, dependencyOrder: order, columns: [{ cloudColumn: "id", sqlServerColumn: "id", primaryKey: true }] });
const registry = { tables: [table("pos_settings"), table("settings_scoped", 1), table("change_history", 2)] };
const names = registry.tables.map(row => row.cloudTable);
const httpError = () => Object.assign(new Error("HTTP 503"), { code: "HTTP_503", status: 503 });
const proof = "a".repeat(64);
const client = () => new CloudClient({ configStore: { get: () => "https://pos.fixture" }, terminalStore: { read: () => ({ tokenId: "terminal-fixture", deviceBindingProof: proof }) } });
const fetchPage = (cloud: InstanceType<typeof CloudClient>) => cloud.bootstrapPage({ table: "change_history", branchId: "branch-fixture", historyDays: 90, cursor: null, limit: 100 });

function sqlHarness() {
  const events: string[] = [];
  const begin = vi.fn(async () => { events.push("begin"); });
  const commit = vi.fn(async () => { events.push("commit"); });
  const rollback = vi.fn(async () => { events.push("rollback"); });
  class Transaction { begin = begin; commit = commit; rollback = rollback; }
  const connectionManager = { sql: vi.fn(() => ({ Transaction, ISOLATION_LEVEL: { SERIALIZABLE: 4 } })), pool: { request: () => ({ query: vi.fn(async () => ({ recordset: [{ current_version: 42 }] })) }) } };
  const cloud = { bootstrapPage: vi.fn(async (_input: { table: string; limit: number }) => ({ rows: [{ id: "one" }], cursor: null })), applyLocalBatch: vi.fn(async () => { events.push("apply"); }) };
  const checkpoints = { save: vi.fn(async () => { events.push("baseline"); }) };
  const context = { job: { dependency_index: 0, last_committed_cursor: null, batch_number: 0 }, waitWhilePaused: vi.fn(), checkpoint: vi.fn(async (_patch: unknown, _transaction?: unknown) => { events.push("checkpoint"); }) };
  return { events, begin, commit, rollback, connectionManager, cloud, checkpoints, context };
}
const refresh = (h: ReturnType<typeof sqlHarness>, extra: Record<string, unknown> = {}) => refreshTable({ ...h, registry, branchId: "branch-fixture", tableName: "change_history", ...extra });
const job = (h: ReturnType<typeof sqlHarness>) => runBootstrap({ ...h, registry: { tables: [table("change_history")] }, branchId: "branch-fixture", historyDays: 90 });

function logHarness() {
  const output: Array<{ file: string; line: string }> = [];
  const module = { exports: {} as Record<string, (...args: unknown[]) => unknown> };
  const fs = { statSync: () => { throw new Error("fixture missing log"); }, appendFileSync: (file: string, line: string) => output.push({ file, line }) };
  runInNewContext(readFileSync("electron/diagnostics.cjs", "utf8"), { module, exports: module.exports, Buffer, process, Date, console,
    require: (name: string) => name === "node:fs" ? fs : name === "electron" ? { app: { getPath: () => "/fixture-logs" } } : require(name),
  });
  return { diagnostics: module.exports, output, parsed: () => JSON.parse(output.at(-1)!.line.slice(output.at(-1)!.line.indexOf("{"))) };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("bootstrap diagnostic-only transport context", () => {
  it.each([
    ["HTML", () => new Response("<html>PRIVATE BODY token=private</html>", { status: 503 }), true, "HTTP_503", "HTTP 503"],
    ["JSON", () => Response.json({ code: "SERVICE_UNAVAILABLE", error: "Service unavailable" }, { status: 503 }), false, "SERVICE_UNAVAILABLE", "Service unavailable"],
    ["opaque JSON", () => Response.json({}, { status: 503 }), false, "HTTP_503", "HTTP 503"],
    ["Postgres", () => Response.json({ code: "57014", message: "statement timeout" }, { status: 500 }), false, "57014", "statement timeout"],
  ] as const)("distinguishes %s without changing request bytes or public error fields", async (_name, response, nonJsonResponse, code, message) => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => response());vi.stubGlobal("fetch", fetch);
    const signal = vi.spyOn(AbortSignal, "timeout");
    const cloud = client();let failure: unknown;
    try { await fetchPage(cloud); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code, message, status: code === "57014" ? 500 : 503, detail: null });
    expect(Object.keys(failure!)).not.toContain("bootstrapDiagnostic");
    expect(bootstrapDiagnostic(failure, names)).toEqual({ httpStatus: code === "57014" ? 500 : 503, nonJsonResponse });
    expect(fetch).toHaveBeenCalledTimes(1);expect(signal).toHaveBeenCalledWith(30_000);
    expect(fetch.mock.calls[0][0]).toBe("https://pos.fixture/api/v1/pos/sync");
    expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify({ sqlServerBootstrap: { organizationId: "default", table: "change_history", branchId: "branch-fixture", historyDays: 90, cursor: null, limit: 100 }, terminalToken: "terminal-fixture", deviceBindingProof: proof }));
  });
  it("preserves successful result shape and one request", async () => {
    const fetch = vi.fn(async () => Response.json({ rows: [{ id: "one" }], cursor: "next" }));vi.stubGlobal("fetch", fetch);
    expect(await fetchPage(client())).toEqual({ rows: [{ id: "one" }], cursor: "next" });expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("preserves transport error identity with no invented HTTP/JSON fields", async () => {
    const failure = new TypeError("fixture network unavailable");vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));
    const h = sqlHarness();h.cloud.bootstrapPage.mockImplementation(() => fetchPage(client()));
    await expect(refresh(h)).rejects.toBe(failure);
    expect(bootstrapDiagnostic(failure, names)).toEqual({ table: "change_history", bootstrapPhase: "download", bootstrapOrigin: "refresh" });
    expect(h.begin).not.toHaveBeenCalled();expect(h.checkpoints.save).not.toHaveBeenCalled();
  });
  it("preserves timeout error/cause and the existing smaller-page backoff", async () => {
    vi.useFakeTimers();const failure = Object.assign(new Error("statement timeout"), { code: "57014" });
    const h = sqlHarness();h.cloud.bootstrapPage.mockImplementation(async input => { if (input.limit > 50) throw failure;return { rows: [{ id: "one" }], cursor: null }; });
    const pending = refresh(h);await vi.advanceTimersByTimeAsync(249);
    expect(h.cloud.bootstrapPage).toHaveBeenCalledTimes(1);expect(h.begin).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);expect(await pending).toEqual({ completed: 1 });
    expect(h.cloud.bootstrapPage.mock.calls.map(call => call[0].limit)).toEqual([100, 50]);
    expect(h.begin).toHaveBeenCalledTimes(1);expect(h.commit).toHaveBeenCalledTimes(1);expect(h.rollback).not.toHaveBeenCalled();
  });
  it("preserves Abort/Timeout transport conversion without introducing a retry", async () => {
    const cause = Object.assign(new Error("fixture timeout"), { name: "TimeoutError" });const fetch = vi.fn().mockRejectedValue(cause);vi.stubGlobal("fetch", fetch);
    await expect(fetchPage(client())).rejects.toMatchObject({ code: "ETIMEDOUT", cause });expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("actual bootstrap, prefetch and expired-history boundaries", () => {
  it("tags a job download failure after its existing initial checkpoint, without writes or baseline progress", async () => {
    const h = sqlHarness(), failure = httpError();h.cloud.bootstrapPage.mockRejectedValue(failure);
    await expect(job(h)).rejects.toBe(failure);
    expect(bootstrapDiagnostic(failure, names)).toEqual({ table: "change_history", bootstrapPhase: "download", bootstrapOrigin: "job" });
    expect(h.context.checkpoint).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ current_table: "change_history", dependency_index: 0, last_committed_cursor: null }));
    expect(h.begin).not.toHaveBeenCalled();expect(h.checkpoints.save).not.toHaveBeenCalled();
  });
  it.each(["begin", "apply", "commit"])("preserves %s failure identity and original rollback boundary", async stage => {
    const h = sqlHarness(), failure = Object.assign(new Error("fixture SQL failure"), { code: "EREQUEST", status: 500 });
    (stage === "begin" ? h.begin : stage === "apply" ? h.cloud.applyLocalBatch : h.commit).mockRejectedValue(failure);
    await expect(refresh(h)).rejects.toBe(failure);
    expect(bootstrapDiagnostic(failure, names)).toEqual({ table: "change_history", bootstrapPhase: "local_apply", bootstrapOrigin: "refresh" });
    expect(h.rollback).toHaveBeenCalledTimes(stage === "begin" ? 0 : 1);expect(h.checkpoints.save).not.toHaveBeenCalled();
  });
  it("preserves successful apply/checkpoint/commit ordering and baseline value", async () => {
    const h = sqlHarness();expect(await job(h)).toEqual({ completed: 1 });
    expect(h.events).toEqual(["checkpoint", "begin", "apply", "checkpoint", "commit", "baseline", "checkpoint"]);
    expect(h.checkpoints.save).toHaveBeenCalledExactlyOnceWith("branch-fixture", "change_history", "push", { change_tracking_version: 42 });
    expect(h.cloud.bootstrapPage).toHaveBeenCalledExactlyOnceWith({ table: "change_history", branchId: "branch-fixture", historyDays: 90, cursor: null, limit: 100 });
  });
  it("keeps unknown-table skip behavior unchanged", async () => {
    const h = sqlHarness();expect(await refresh(h, { tableName: "not_registered" })).toEqual({ completed: 0, skipped: true });expect(h.cloud.bootstrapPage).not.toHaveBeenCalled();expect(h.connectionManager.sql).not.toHaveBeenCalled();
  });
  it("labels settings prefetch and stops before any push or reset", async () => {
    const h = sqlHarness(), failure = httpError();h.cloud.bootstrapPage.mockImplementation(async input => { if (input.table === "settings_scoped") throw failure;return { rows: [], cursor: null }; });
    const push = vi.fn();const lifecycle = new LocalDataLifecycle({ ...h, registry, databaseService: { transition: vi.fn() }, syncCoordinator: { runPush: push } });
    lifecycle.cachedSnapshotReady = vi.fn().mockResolvedValue(false);
    await expect(lifecycle.ensure({ branchId: "branch-fixture", historyDays: 90 })).rejects.toBe(failure);
    expect(bootstrapDiagnostic(failure, names)).toEqual({ table: "settings_scoped", bootstrapPhase: "download", bootstrapOrigin: "prefetch" });
    expect(h.cloud.bootstrapPage.mock.calls.map(call => call[0].table)).toEqual(["pos_settings", "settings_scoped"]);
    expect(h.commit).toHaveBeenCalledTimes(1);expect(push).not.toHaveBeenCalled();expect(h.checkpoints.save).not.toHaveBeenCalled();
  });
  it("labels targeted gap recovery without advancing the expired cursor on a failed download", async () => {
    const h = sqlHarness(), failure = httpError();h.cloud.bootstrapPage.mockRejectedValue(failure);
    const lifecycle = new LocalDataLifecycle({ ...h, registry, syncCoordinator: {} });
    await expect(lifecycle.recoverChangeTrackingGap("branch-fixture", 90, "change_history")).rejects.toBe(failure);
    expect(bootstrapDiagnostic(failure, names)).toEqual({ table: "change_history", bootstrapPhase: "download", bootstrapOrigin: "gap_recovery" });
    expect(h.checkpoints.save).not.toHaveBeenCalled();expect(h.begin).not.toHaveBeenCalled();
  });
  it.each(["primitive", "frozen", "hostile getter", "hostile proxy"])("never replaces a %s error to obtain breadcrumbs", async kind => {
    const h = sqlHarness();const failure = kind === "primitive" ? "original failure" : kind === "frozen" ? Object.freeze(httpError()) : kind === "hostile getter" ? Object.defineProperty(httpError(), "bootstrapDiagnostic", { get: () => { throw Error("PRIVATE getter"); } }) : new Proxy(httpError(), { getOwnPropertyDescriptor: () => { throw Error("PRIVATE proxy"); }, defineProperty: () => { throw Error("PRIVATE proxy"); } });
    h.cloud.bootstrapPage.mockRejectedValue(failure);await expect(refresh(h)).rejects.toBe(failure);expect(bootstrapDiagnostic(failure, names)).toEqual({});expect(h.begin).not.toHaveBeenCalled();
  });
});

describe("safe actual Main → diagnostic log boundary", () => {
  it("roundtrips one sanitized event without changing ready-state failure or error identity", async () => {
    const h = sqlHarness();vi.stubGlobal("fetch", vi.fn(async () => new Response("PRIVATE body credentials", { status: 503 })));
    h.cloud.bootstrapPage.mockImplementation(() => fetchPage(client()));
    const failure = await refresh(h).then(() => { throw Error("Expected failure"); }, (error: unknown) => error);
    const logs = logHarness(), markReady = vi.fn();
    const source = readFileSync("electron/main.cjs", "utf8"), start = source.indexOf("function prepareLocalData("), end = source.indexOf("\nlet localDatabaseRecoveryPromise", start);
    const context = { diagnostics: logs.diagnostics, syncRegistry: registry, databaseService: { markReady }, databaseConfig: { profile: () => ({ retentionDays: 90 }) }, localBranchId: () => "branch-fixture", isManagementDevice: () => false, localDataLifecycle: { ensure: vi.fn().mockRejectedValue(failure) }, prepare: undefined as undefined | (() => Promise<unknown>) };
    runInNewContext(`let localDataPreparePromise=null;${source.slice(start,end)};globalThis.prepare=prepareLocalData;`, context);
    await expect(context.prepare!()).rejects.toBe(failure);
    expect(markReady).toHaveBeenCalledExactlyOnceWith({ phase: "sync_pending", syncReady: false, code: "HTTP_503", error: "HTTP 503", differences: undefined });
    expect(logs.output).toHaveLength(1);expect(logs.output[0].file).toMatch(/failure\.log$/);
    expect(logs.parsed()).toMatchObject({ category: "synchronization", stage: "bootstrap", code: "HTTP_503", message: "HTTP 503", table: "change_history", bootstrapPhase: "download", bootstrapOrigin: "refresh", httpStatus: 503, nonJsonResponse: true, outcome: "failure" });
    expect(logs.output[0].line).not.toMatch(/PRIVATE|https:|branch-fixture|terminal-fixture|credentials|sqlServerBootstrap/);
  });
  it("normalizes only enums/registered names/primitives, never getters or forged payload fields", () => {
    const failure = Object.assign(new Error("failed"), { bootstrapDiagnostic: { table: "secret_customer", phase: "PRIVATE phase", origin: "https://PRIVATE", httpStatus: "503", nonJsonResponse: { token: "PRIVATE" }, body: "PRIVATE", url: "PRIVATE", query: "PRIVATE" } });
    expect(bootstrapDiagnostic(failure, names)).toEqual({});
    tagBootstrapDiagnostic(failure, { table: "change_history", phase: "download", origin: "job", httpStatus: 503, nonJsonResponse: false });
    expect(Object.getOwnPropertyDescriptor(failure, "bootstrapDiagnostic")?.enumerable).toBe(false);
    expect(bootstrapDiagnostic(failure, names)).toEqual({ table: "change_history", bootstrapPhase: "download", bootstrapOrigin: "job", httpStatus: 503, nonJsonResponse: false });
    expect(JSON.stringify(failure)).not.toContain("PRIVATE");
    const logs = logHarness();logs.diagnostics.logConnection("synchronization.bootstrap.failed", { stage: "bootstrap", ...bootstrapDiagnostic(failure, names), headers: "PRIVATE", body: "PRIVATE", url: "PRIVATE" });
    expect(logs.output[0].line).not.toContain("PRIVATE");
  });
  it("rejects URLs, queries, identifiers and malformed direct new log fields", () => {
    const logs = logHarness();
    for (const tableName of ["change_history?key=PRIVATE", "https://PRIVATE", "person@PRIVATE.test", "PRIVATE-id", "not_registered"]) {
      const error = { bootstrapDiagnostic: { table: tableName, phase: "download", origin: "prefetch" } };
      expect(bootstrapDiagnostic(error, names)).not.toHaveProperty("table");
    }
    logs.diagnostics.logConnection("synchronization.bootstrap.failed", { stage: "bootstrap", bootstrapPhase: { body: "PRIVATE" }, bootstrapOrigin: "PRIVATE", httpStatus: "503", nonJsonResponse: "PRIVATE" });
    expect(logs.parsed()).not.toHaveProperty("bootstrapPhase");expect(logs.parsed()).not.toHaveProperty("bootstrapOrigin");expect(logs.parsed()).not.toHaveProperty("httpStatus");expect(logs.parsed()).not.toHaveProperty("nonJsonResponse");expect(logs.output[0].line).not.toContain("PRIVATE");
  });
});
