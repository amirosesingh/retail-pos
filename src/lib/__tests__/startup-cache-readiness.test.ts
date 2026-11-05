import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const { LocalDataLifecycle } = require("../../../electron/jobs/lifecycle.cjs");
const { ManagementReplica } = require("../../../electron/sync/management-replica.cjs");

function fixture() {
  const job = { job_id: "history", job_type: "history_gap_recovery_v1", branch_id: "branch", terminal_id: "terminal", organization_id: "default", organization_name: "https://fixture.test", dependency_index: 90, current_table: "change_history", phase: "hr:page:50", last_committed_cursor: null, completed_rows: 0 };
  const state = { enabled: true, configured: true, connected: true, tradingReady: true, profile: { database: "fixture" } };
  const bounds: { table_name: string; minimum_version: number; current_version: number; checkpoint_version: number | null }[] = [{ table_name: "shifts", minimum_version: 20, current_version: 60, checkpoint_version: 30 }];
  const query = vi.fn(async (sql: string) => ({ recordset: sql.includes("OPENJSON") ? bounds : sql.includes("min_valid_version") ? [{ current_version: 60, min_valid_version: 20 }] : [{ id: "branch" }] }));
  const manager = { pool: { request: () => ({ input() { return this; }, query }) } };
  const repository = { startupSnapshot: vi.fn(async (): Promise<{ job_id: string } | null> => ({ job_id: "completed" })), hasOtherActiveJobs: vi.fn(async () => false), get: vi.fn(async () => ({ ...job })) };
  const registration = { tokenId: "terminal", locationId: "branch", deviceUse: "operations", branchId: "" };
  const cloud = { terminalId: () => "terminal", backendUrl: () => "https://fixture.test", terminalStore: { read: () => registration } };
  const service = { snapshot: () => state, markReady: vi.fn(), transition: vi.fn() };
  const lifecycle = new LocalDataLifecycle({ connectionManager: manager, databaseService: service, jobRepository: repository, cloud, registry: { tables: [{ sqlServerTable: "shifts", columns: [{ primaryKey: true }] }, { sqlServerTable: "change_history", columns: [{ primaryKey: true }] }] } });
  return { lifecycle, state, bounds, query, manager, repository, cloud, service, job, registration };
}

describe("qualified startup snapshot", () => {
  it.each([["a","b"],["a"]])("preserves Main's NULL-branch Management route and only its verified scope %j", async (...allowed) => {
    const runNow=vi.fn(async (options:{branchId:string}) => ({ok:Boolean(options.branchId)})), ensure=vi.fn(), markReady=vi.fn();
    const replica=new ManagementReplica({cloud:{managementBranches:async()=>({ok:true,branches:allowed.map(id=>({id}))})},databaseService:{snapshot:()=>({enabled:true,configured:true})},connectionManager:{isConnected:()=>true},lifecycle:{bootstrapType:()=>"bootstrap_7300",bootstrap:vi.fn()},jobs:{active:async()=>null,completed:async()=>({})},coordinator:{withExclusive:(handler:()=>unknown)=>handler(),runNow}});
    const source=readFileSync("electron/main.cjs","utf8"),start=source.indexOf("function prepareLocalData("),end=source.indexOf("\nlet localDatabaseRecoveryPromise",start);
    const context={isManagementDevice:()=>true,managementReplica:replica,localDataLifecycle:{ensure},databaseService:{markReady},localBranchId:()=>null,prepare:undefined as undefined|(()=>Promise<unknown>)};
    runInNewContext(`let localDataPreparePromise=null;${source.slice(start,end)};globalThis.prepare=prepareLocalData;`,context);
    expect(await context.prepare!()).toMatchObject({ok:true,branches:allowed.length});
    expect(runNow.mock.calls.map(call=>call[0].branchId)).toEqual(allowed);
    expect(runNow.mock.calls.some(call=>call[0].branchId==="unauthorized")).toBe(false);
    expect(ensure).not.toHaveBeenCalled(); expect(markReady).not.toHaveBeenCalled();
  });
  it("releases an existing snapshot during only validated audit recovery, without cursor writes", async () => {
    const h = fixture(); await h.lifecycle.releaseHistoryCache("branch", 90, h.job);
    expect(h.service.markReady).toHaveBeenCalledExactlyOnceWith({ phase: "history_recovery", syncReady: false, branchId: "branch", historyDays: 90 });
    expect(h.repository.hasOtherActiveJobs).toHaveBeenCalledWith("history");
    expect(h.query.mock.calls.every(([sql]) => !/UPDATE|INSERT|MERGE|DELETE/.test(sql))).toBe(true);
    expect(h.lifecycle.preserveCachedReady()).toBe(true);
  });
  it("preserves ordinary completed-cache offline readiness without the new CT preflight", async () => {
    const h = fixture(); h.bounds[0].checkpoint_version = 1;
    expect(await h.lifecycle.cachedSnapshotReady("branch", 90)).toBe(true);
    expect(h.query.mock.calls.some(([sql]) => sql.includes("OPENJSON"))).toBe(false);
    expect(h.repository.hasOtherActiveJobs).toHaveBeenCalledWith(null);
  });
  it.each(["backend", "terminal"])("fails closed for invalid ordinary-cache %s identity", async kind => {
    const h = fixture();
    if(kind === "backend") h.cloud.backendUrl = () => "invalid";
    else h.cloud.terminalId = () => "";
    await expect(h.lifecycle.cachedSnapshotReady("branch", 90)).rejects.toMatchObject({ code: "EHISTORY_RECOVERY" });
    expect(h.lifecycle.preserveCachedReady()).toBe(false); expect(h.service.markReady).not.toHaveBeenCalled();
  });
  it("preserves the existing missing-checkpoint zero-baseline semantics", async () => {
    const h = fixture(); h.bounds[0].checkpoint_version = null;
    await h.lifecycle.releaseHistoryCache("branch", 90, h.job); expect(h.service.markReady).toHaveBeenCalledOnce();
  });
  it("rejects Operations access outside its registered branch and inconsistent saved branch fields", async () => {
    const h = fixture(); expect(await h.lifecycle.cachedSnapshotReady("other",90)).toBe(false);
    h.registration.branchId = "other";
    await expect(h.lifecycle.cachedSnapshotReady("branch",90)).rejects.toMatchObject({ code: "EACTIVATION_BINDING" });
    expect(h.service.markReady).not.toHaveBeenCalled();
  });
  it("does not invent Management cache authority from a NULL registered branch", async () => {
    const h=fixture(); h.registration.deviceUse="management"; h.registration.locationId="";
    expect(await h.lifecycle.cachedSnapshotReady("branch",90)).toBe(false);
    expect(h.repository.startupSnapshot).not.toHaveBeenCalled();
  });
  it.each(["first bootstrap", "newer incomplete bootstrap", "restore barrier"])("does not release %s without its completed snapshot proof", async () => {
    const h = fixture(); h.repository.startupSnapshot.mockResolvedValue(null);
    await h.lifecycle.releaseHistoryCache("branch", 90, h.job); expect(h.service.markReady).not.toHaveBeenCalled();
  });
  it("does not ignore a second active job hidden behind the history job", async () => {
    const h = fixture(); h.repository.hasOtherActiveJobs.mockResolvedValue(true);
    await h.lifecycle.releaseHistoryCache("branch", 90, h.job); expect(h.service.markReady).not.toHaveBeenCalled();
  });
  it.each(["branch_id", "terminal_id", "organization_name", "dependency_index", "phase"])("rejects mismatched or malformed %s", async key => {
    const h = fixture(); (h.job as Record<string, unknown>)[key] = "foreign";
    await expect(h.lifecycle.releaseHistoryCache("branch", 90, h.job)).rejects.toMatchObject({ code: "EHISTORY_RECOVERY" });
    expect(h.service.markReady).not.toHaveBeenCalled();
  });
  it.each(["expired", "missing bounds", "duplicate checkpoint", "future checkpoint"])("denies history exemption for operational CT %s", async kind => {
    const h = fixture();
    if(kind === "expired") h.bounds[0].checkpoint_version = 1;
    if(kind === "missing bounds") h.bounds.length = 0;
    if(kind === "duplicate checkpoint") h.bounds.push({ ...h.bounds[0] });
    if(kind === "future checkpoint") h.bounds[0].checkpoint_version = 100;
    await h.lifecycle.releaseHistoryCache("branch", 90, h.job); expect(h.service.markReady).not.toHaveBeenCalled();
  });
  it.each(["disconnect", "pool", "profile", "terminal", "backend", "branch"])("denies readiness if %s changes during proof reads", async kind => {
    const h = fixture(); const original = h.repository.startupSnapshot;
    original.mockImplementation(async () => {
      if(kind === "disconnect") h.state.connected = false;
      if(kind === "pool") h.manager.pool = { request: h.manager.pool.request };
      if(kind === "profile") h.state.profile.database = "other";
      if(kind === "terminal") h.cloud.terminalId = () => "other";
      if(kind === "backend") h.cloud.backendUrl = () => "https://other.test";
      if(kind === "branch") h.registration.locationId = "other";
      return { job_id: "completed" };
    });
    await h.lifecycle.releaseHistoryCache("branch", 90, h.job).catch(() => undefined);
    expect(h.service.markReady).not.toHaveBeenCalled(); expect(h.lifecycle.preserveCachedReady()).toBe(false);
  });
  it.each(["ECHANGEGAP", "EHISTORY_RECOVERY", "EHISTORY_BASELINE_EXPIRED", "HTTP_503"])("Main does not mint readiness from a failed incomplete preparation (%s)", async code => {
    const failure = Object.assign(new Error("original"), { code }), markReady = vi.fn(), transition = vi.fn();
    const source = readFileSync("electron/main.cjs", "utf8"), start = source.indexOf("function prepareLocalData("), end = source.indexOf("\nlet localDatabaseRecoveryPromise", start);
    const context = { diagnostics: { logConnection: vi.fn(), bootstrapDiagnostic: () => ({}) }, syncRegistry: { tables: [] }, databaseService: { markReady, transition }, databaseConfig: { profile: () => ({}) }, localBranchId: () => "branch", isManagementDevice: () => false, localDataLifecycle: { ensure: async () => { throw failure; }, preserveCachedReady: () => false }, prepare:undefined as undefined|(()=>Promise<unknown>) };
    runInNewContext(`let localDataPreparePromise=null;${source.slice(start,end)};globalThis.prepare=prepareLocalData;`, context);
    await expect(context.prepare!()).rejects.toBe(failure);
    expect(markReady).not.toHaveBeenCalled(); expect(transition).toHaveBeenCalledWith("enabled_bootstrapping", expect.objectContaining({ code, syncReady: false }));
  });
});
