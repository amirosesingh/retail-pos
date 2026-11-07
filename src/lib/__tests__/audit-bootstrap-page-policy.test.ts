import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { CloudClient } = require("../../../electron/sync/cloud-client.cjs");
const { readPage } = require("../../../electron/sync/page-policy.cjs");
const { refreshTable, runBootstrap } = require("../../../electron/jobs/bootstrap.cjs");
const { JobManager } = require("../../../electron/jobs/manager.cjs");
const { LocalDataLifecycle } = require("../../../electron/jobs/lifecycle.cjs");
const legacyHistorySnapshot = require("../../../electron/sync/history-recovery.cjs");
const { releasedHistoryModule } = require("../../../scripts/lib/released-history-fixture.cjs");
const { refreshTable: legacyRefresh } = releasedHistoryModule("electron/jobs/bootstrap.cjs");
const { tagBootstrapDiagnostic } = require("../../../electron/diagnostics.cjs");
const { PROJECTION } = require("../../../electron/sync/history-index-protocol.cjs");
type PageInput = { table: string; branchId: string; historyDays: number; cursor: string | null; limit: number };
const proof = "a".repeat(64);
const branch = "branch-fixture";
const terminal = "aaaaaaaa-aaaa-4aaa-8aaa-000000009999";
const record = (index: number) => ({ id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`, old_value: { fixture: index }, new_value: { fixture: index + 1 },
  organization_id: "default", scope_type: "BRANCH", scope_id: branch });
const rows = Array.from({ length: 253 }, (_, index) => record(index + 1));
const table = (name = "change_history") => ({ cloudTable: name, sqlServerTable: name, dependencyOrder: 0, columns: [{ cloudColumn: "id", sqlServerColumn: "id", primaryKey: true }] });
const pressureError = () => tagBootstrapDiagnostic(Object.assign(new Error("HTTP 503"), { status: 503, code: "HTTP_503" }), { httpStatus: 503, nonJsonResponse: true });
const rejected = (promise: Promise<unknown>) => promise.then(() => { throw new Error("Expected failure"); }, error => error);

function harness(name = "change_history", response?: (input: PageInput, attempt: number) => Response, legacy = false) {
  const requests: Array<Record<string, unknown>> = [], inputs: PageInput[] = [], failures: unknown[] = [], applied: string[] = [], events: string[] = [];
  const policyRequests: Array<Record<string, unknown>> = [];
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const scoped = body.sqlServerScopedHistory;
    if (scoped?.action === "begin") {
      expect(scoped).toEqual({ organizationId: "default", branchId: branch, action: "begin" });
      expect(body).not.toHaveProperty("sqlServerHistoryReconcile");
      policyRequests.push(body);
      const text = JSON.stringify({ protocol: "history-index-v2", projection: PROJECTION, policy: "branch-history-v1", history_scope: "branch",
        organization_id: "default", branch_id: branch, terminal_id: terminal, keep_commerce: false,
        action: "begin", upper_id: null, after_id: null, ids: [], next_id: null, complete: true, range_count: null });
      return new Response(text, { headers: { "Content-Type": "application/json", "X-POS-History-Reconcile-Version": "2", "X-POS-History-Reconcile-Kind": "index", "X-POS-Scoped-History-Transport": "1" } });
    }
    requests.push(body);
    if (scoped) {
      expect(legacy).toBe(false);
      expect(name).toBe("change_history");
      expect(Object.keys(body).sort()).toEqual(["deviceBindingProof", "sqlServerScopedHistory", "terminalToken"]);
      expect(Object.keys(scoped).sort()).toEqual(["action", "branchId", "cursor", "historyDays", "limit", "organizationId"]);
      expect(scoped).toMatchObject({ action: "bootstrap", organizationId: "default", branchId: branch, historyDays: 90 });
    } else {
      expect(body).toHaveProperty("sqlServerBootstrap.table", name);
    }
    const input = scoped ? { ...scoped, table: "change_history" } as PageInput : body.sqlServerBootstrap as PageInput;
    inputs.push(input);
    if (response) return response(input, inputs.length);
    const last = input.cursor ? JSON.parse(input.cursor).id : null;
    const offset = last ? rows.findIndex(row => row.id === last) + 1 : 0;
    const page = rows.slice(offset, offset + input.limit);
    return Response.json({ rows: page, cursor: offset + page.length < rows.length ? JSON.stringify({ id: page.at(-1)!.id }) : null },
      scoped ? { headers: { "X-POS-Scoped-History-Transport": "1" } } : undefined);
  });
  vi.stubGlobal("fetch", fetch);
  const begin = vi.fn(async () => { events.push("begin"); }), commit = vi.fn(async () => { events.push("commit"); }), rollback = vi.fn(async () => { events.push("rollback"); });
  class Transaction { begin = begin; commit = commit; rollback = rollback; }
  class Request { async query() { return { recordset: [{ current_version: 99, min_valid_version: 0 }] }; } }
  const connectionManager = { sql: () => ({ Transaction, Request, ISOLATION_LEVEL: { SERIALIZABLE: 4 } }), pool: { request: () => new Request() } };
  const cloud = new CloudClient({ connectionManager, configStore: { get: () => "https://pos.fixture" },
    terminalStore: { read: () => ({ tokenId: terminal, deviceUse: "operations", locationId: branch, deviceBindingProof: proof }) } });
  // The pinned 1.4.82 recovery loop sent this bootstrap request without a policy handshake.
  const originalPage = legacy ? (input: PageInput) => cloud.request({ sqlServerBootstrap: { organizationId: "default", ...input } }) : cloud.bootstrapPage.bind(cloud);
  cloud.bootstrapPage = async (input: PageInput) => { try { return await originalPage(input); } catch (error) { failures.push(error);throw error; } };
  cloud.applyLocalBatch = vi.fn(async (_transaction: unknown, _table: unknown, batch: { rows: Array<{ row_data: { id: string } }> }) => { events.push("apply");applied.push(...batch.rows.map(change => change.row_data.id)); });
  const checkpoints = { save: vi.fn(async () => { events.push("baseline"); }), advanceRecovery: vi.fn(async () => { events.push("baseline"); }) };
  const jobs = new Map<string, { job_id: string; [key: string]: unknown }>();
  const jobRepository = { recovery: async () => [...jobs.values()].at(-1) ?? null, create: async (value: { job_id: string; [key: string]: unknown }) => { jobs.set(value.job_id, structuredClone(value)); }, get: async (id: string) => structuredClone(jobs.get(id)), checkpoint: async (id: string, patch: object) => { const saved = jobs.get(id); if (!saved) throw new Error("Missing fixture job"); Object.assign(saved, structuredClone(patch)); } };
  const jobManager = new JobManager(jobRepository);
  const reader = { unacknowledged: async () => [] };
  const registry = { tables: [table(name)] };
  const lifecycle = new LocalDataLifecycle({ registry, cloud, connectionManager, checkpoints, jobRepository, jobManager, reader, syncCoordinator: {} });
  const context = { job: { dependency_index: 0, last_committed_cursor: null as string | null, completed_rows: 0, batch_number: 0 }, waitWhilePaused: vi.fn(), checkpoint: vi.fn(async (patch: object, _transaction?: unknown) => { events.push("checkpoint");Object.assign(context.job, patch); }) };
  return { cloud, connectionManager, checkpoints, registry, lifecycle, context, requests, policyRequests, inputs, failures, fetch, begin, commit, rollback, applied, events };
}
const refresh = (h: ReturnType<typeof harness>) => refreshTable({ ...h, branchId: "branch-fixture", historyDays: 90, tableName: h.registry.tables[0].cloudTable });
const job = (h: ReturnType<typeof harness>) => runBootstrap({ ...h, branchId: "branch-fixture", historyDays: 90 });

afterEach(() => { vi.unstubAllGlobals();vi.useRealTimers();vi.restoreAllMocks(); });

describe("audit-only bounded bootstrap downloads", () => {
  it("downloads all253 audit rows in pages≤100 with lossless opaque cursors and one final CT baseline", async () => {
    // Preserve the legacy opaque-snapshot contract separately. New application
    // recovery uses the missing-only index job and never obtains a CT ACK here.
    const h = harness("change_history", undefined, true);expect(await legacyHistorySnapshot.recover(h.lifecycle,branch,90,legacyRefresh)).toMatchObject({ completed: 253, currentVersion: 99 });
    expect(h.policyRequests).toHaveLength(0);
    expect(h.inputs.map(input => input.limit)).toEqual([100, 100, 100]);
    expect(h.inputs.map(input => input.cursor)).toEqual([null, JSON.stringify({ id: rows[99].id }), JSON.stringify({ id: rows[199].id })]);
    expect(h.applied).toEqual(rows.map(row => row.id));expect(new Set(h.applied).size).toBe(253);
    expect(h.begin).toHaveBeenCalledTimes(4);expect(h.commit).toHaveBeenCalledTimes(4);expect(h.rollback).not.toHaveBeenCalled();
    expect(h.checkpoints.advanceRecovery).toHaveBeenCalledExactlyOnceWith("branch-fixture", "change_history", "99", expect.anything());expect(h.events.at(-1)).toBe("commit");
    for (const body of h.requests) {
      expect(Object.keys(body).sort()).toEqual(["deviceBindingProof", "sqlServerBootstrap", "terminalToken"]);
      expect(body).toMatchObject({ terminalToken: terminal, deviceBindingProof: proof, sqlServerBootstrap: { organizationId: "default", table: "change_history", branchId: branch, historyDays: 90 } });
      expect(Object.keys(body.sqlServerBootstrap as object).sort()).toEqual(["branchId", "cursor", "historyDays", "limit", "organizationId", "table"]);
    }
  });
  it("caps a legacy preferred500 audit page and never grows a successful small page", async () => {
    const fetch = vi.fn(async (_limit: number) => ({ rows: [record(1)], cursor: null }));
    expect(await readPage(fetch, 500, { table: "change_history" })).toMatchObject({ limit: 100, nextLimit: 100 });
    expect(await readPage(fetch, 25, { table: "change_history" })).toMatchObject({ limit: 25, nextLimit: 25 });expect(fetch.mock.calls.map(call => call[0])).toEqual([100, 25]);
  });
  it("retries trusted non-JSON503 twice at the same cursor before any apply, then finishes losslessly", async () => {
    vi.useFakeTimers();const h = harness("change_history", undefined, true);const normal = h.fetch.getMockImplementation()!;
    h.fetch.mockImplementation(async (url, init) => h.inputs.length < 2 ? (() => { const body = JSON.parse(String(init.body));h.requests.push(body);h.inputs.push(body.sqlServerBootstrap);return new Response("<html>unavailable</html>", { status: 503 }); })() : normal(url, init));
    const pending = legacyHistorySnapshot.recover(h.lifecycle,branch,90,legacyRefresh);
    await vi.advanceTimersByTimeAsync(249);expect(h.inputs.map(input => input.limit)).toEqual([100]);expect(h.begin).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);expect(h.inputs.map(input => input.limit)).toEqual([100, 50]);expect(h.begin).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(499);expect(h.fetch).toHaveBeenCalledTimes(2);await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ completed: 253 });expect(h.inputs.slice(0, 3).map(input => [input.limit, input.cursor])).toEqual([[100, null], [50, null], [25, null]]);
    expect(h.inputs.every(input => input.limit <= 100)).toBe(true);expect(h.inputs.slice(2).every(input => input.limit === 25)).toBe(true);
    expect(h.applied).toEqual(rows.map(row => row.id));expect(new Set(h.applied).size).toBe(253);expect(h.cloud.applyLocalBatch).toHaveBeenCalledTimes(11);expect(h.checkpoints.advanceRecovery).toHaveBeenCalledTimes(1);
  });
  it("exhausts exactly two smaller-page503 retries and preserves the last error with no transaction/baseline", async () => {
    vi.useFakeTimers();const h = harness("change_history", () => new Response("<html>unavailable</html>", { status: 503 }), true);
    const pending = rejected(legacyHistorySnapshot.recover(h.lifecycle,branch,90,legacyRefresh));await vi.advanceTimersByTimeAsync(750);const failure = await pending;
    expect(failure).toBe(h.failures[2]);expect(failure).toMatchObject({ code: "HTTP_503", status: 503, message: "HTTP 503" });
    expect(h.inputs.map(input => [input.limit, input.cursor])).toEqual([[100, null], [50, null], [25, null]]);
    expect(h.begin).not.toHaveBeenCalled();expect(h.cloud.applyLocalBatch).not.toHaveBeenCalled();expect(h.checkpoints.save).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });
  it.each([401, 403])("never retries denial HTTP%s even with non-JSON response", async status => {
    const h = harness("change_history", () => new Response("<html>denied</html>", { status }));const failure = await rejected(refresh(h));
    expect(failure).toBe(h.failures[0]);expect(failure.status).toBe(status);expect(h.policyRequests).toHaveLength(1);expect(h.inputs).toHaveLength(1);expect(h.begin).not.toHaveBeenCalled();
  });
  it("never retries JSON503 or provider-supplied forged private metadata", async () => {
    const h = harness("change_history", () => Response.json({ code: "HTTP_503", error: "Unavailable", bootstrapDiagnostic: { httpStatus: 503, nonJsonResponse: true } }, { status: 503 }));
    const failure = await rejected(refresh(h));expect(failure).toBe(h.failures[0]);expect(failure.bootstrapDiagnostic.nonJsonResponse).toBe(false);expect(h.policyRequests).toHaveLength(1);expect(h.inputs).toHaveLength(1);expect(h.begin).not.toHaveBeenCalled();
  });
  it.each([401, 403, 503])("does not let a JSON timeout code override HTTP%s refusal", async status => {
    const h = harness("change_history", () => Response.json({ code: "57014", error: "provider refusal" }, { status }));
    const failure = await rejected(refresh(h));expect(failure).toBe(h.failures[0]);expect(h.policyRequests).toHaveLength(1);expect(h.inputs).toHaveLength(1);expect(h.begin).not.toHaveBeenCalled();
  });
  it.each(["public flag", "enumerable tag", "unfrozen tag", "getter tag"])("does not trust %s as a503 pressure signal", async kind => {
    const failure = Object.assign(new Error("original"), { code: "HTTP_503", status: 503, nonJsonResponse: true });
    if (kind === "enumerable tag") Object.assign(failure, { bootstrapDiagnostic: Object.freeze({ httpStatus: 503, nonJsonResponse: true }) });
    if (kind === "unfrozen tag") Object.defineProperty(failure, "bootstrapDiagnostic", { value: { httpStatus: 503, nonJsonResponse: true } });
    if (kind === "getter tag") Object.defineProperty(failure, "bootstrapDiagnostic", { get: () => { throw Error("must not invoke"); } });
    const fetch = vi.fn().mockRejectedValue(failure);expect(await rejected(readPage(fetch, 100, { table: "change_history" }))).toBe(failure);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not retry below the existing minimum page size", async () => {
    const failure = pressureError(), fetch = vi.fn().mockRejectedValue(failure);
    expect(await rejected(readPage(fetch, 10, { table: "change_history" }))).toBe(failure);expect(fetch).toHaveBeenCalledExactlyOnceWith(10);
  });
  it("preserves timeout and oversized shrinking while audit pages never regrow", async () => {
    vi.useFakeTimers();const timeout = vi.fn(async (limit: number) => { if (limit > 50) throw Object.assign(new Error("timeout"), { code: "57014" });return { rows: [record(1)] }; });
    const pending = readPage(timeout, 100, { table: "change_history" });await vi.advanceTimersByTimeAsync(250);expect(await pending).toMatchObject({ limit: 50, nextLimit: 50 });
    const oversized = vi.fn(async (limit: number) => { if (limit > 50) throw Object.assign(new Error("oversized"), { code: "EOVERSIZED" });return { rows: [record(1)] }; });
    expect(await readPage(oversized, 100, { table: "change_history" })).toMatchObject({ limit: 50, nextLimit: 50 });expect(oversized.mock.calls.map(call => call[0])).toEqual([100, 50]);
  });
  it("keeps a committed products page through transient retry without establishing a complete-table baseline", async () => {
    vi.useFakeTimers();const cursor = JSON.stringify({ id: rows[99].id });
    const h = harness("products", (input, attempt) => {
      if (!input.cursor) return Response.json({ rows: rows.slice(0, 100), cursor });
      if (attempt === 2) return Response.json({ code: "57014", message: "fixture statement timeout" }, { status: 500 });
      return Response.json({ code: "SERVICE_UNAVAILABLE", message: "fixture retry refused" }, { status: 503 });
    });
    const failure = rejected(job(h));await vi.advanceTimersByTimeAsync(250);expect(await failure).toBe(h.failures[1]);
    expect(h.applied).toEqual(rows.slice(0, 100).map(row => row.id));expect(h.cloud.applyLocalBatch).toHaveBeenCalledTimes(1);expect(h.begin).toHaveBeenCalledTimes(1);expect(h.commit).toHaveBeenCalledTimes(1);
    expect(h.context.job.last_committed_cursor).toBe(JSON.stringify({ id: rows[99].id }));expect(h.context.job.completed_rows).toBe(100);expect(h.checkpoints.save).not.toHaveBeenCalled();
    expect(h.inputs.slice(1).map(input => [input.limit, input.cursor])).toEqual([[200, cursor], [100, cursor]]);
  });
  it("does not retry or double-apply a local transaction failure", async () => {
    const h = harness("products"), failure = Object.assign(new Error("local SQL failure"), { code: "EREQUEST" });h.cloud.applyLocalBatch.mockRejectedValue(failure);
    expect(await rejected(job(h))).toBe(failure);expect(h.fetch).toHaveBeenCalledTimes(1);expect(h.cloud.applyLocalBatch).toHaveBeenCalledTimes(1);expect(h.commit).not.toHaveBeenCalled();expect(h.rollback).toHaveBeenCalledTimes(1);expect(h.checkpoints.save).not.toHaveBeenCalled();
  });
  it("leaves other tables' successful growth and503 refusal unchanged", async () => {
    const h = harness("pos_settings");expect(await refresh(h)).toEqual({ completed: 253 });expect(h.inputs.map(input => input.limit)).toEqual([100, 200]);expect(h.applied).toEqual(rows.map(row => row.id));
    const failure = pressureError(), fetch = vi.fn().mockRejectedValue(failure);expect(await rejected(readPage(fetch, 100, { table: "pos_settings" }))).toBe(failure);expect(fetch).toHaveBeenCalledTimes(1);
    const unchanged = vi.fn(async (_limit: number) => ({ rows: [record(1)] }));expect(await readPage(unchanged, 500)).toMatchObject({ limit: 500, nextLimit: 500 });
  });
});

it("startup progress counts only committed page rows and cannot interrupt commits",async()=>{
 const h=harness("products");const reports:Array<{phase:string;processedRows:number;commits:number}>=[];
 await refreshTable({...h,branchId:branch,historyDays:90,tableName:"products",onActivity:(value:{phase:string;processedRows:number})=>{
  reports.push({...value,commits:h.commit.mock.calls.length});if(value.processedRows>0)throw Error("subscriber failed");
 }});
 expect(reports[0]).toMatchObject({phase:"downloading",processedRows:0,commits:0});
 expect(reports.find(value=>value.processedRows===100)).toMatchObject({phase:"applying",commits:1});
 expect(reports.at(-1)).toMatchObject({phase:"applying",processedRows:253,commits:2});
 expect(h.applied).toHaveLength(253);expect(h.rollback).not.toHaveBeenCalled();
});
