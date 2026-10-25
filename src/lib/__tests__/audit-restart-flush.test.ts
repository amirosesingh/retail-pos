import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stored: "", push: vi.fn(), request: vi.fn(), nativeLog: undefined as undefined | ReturnType<typeof vi.fn>,
}));
vi.mock("../business-storage", () => ({
  readBusinessValue: () => mocks.stored,
  writeBusinessValue: (_key: string, value: string) => { mocks.stored = value; },
}));
vi.mock("@/core/api/pos-db", () => ({ db: { pushAuditLogs: mocks.push } }));
vi.mock("../session-presence", () => ({ hasSignedInIdentity: () => false }));
vi.mock("@/core/local-db/local-db", () => ({ localDb: () => ({ database: {getState: async () => ({configured:true})}, logConnection: mocks.nativeLog }) }));
vi.mock("@/platform-config/platform", () => ({isTerminalApp: () => true}));
vi.mock("../activity-journal", () => ({ replayOrder: (rows: unknown[]) => rows, stamp: () => ({deviceTime:new Date().toISOString(),seq:2}) }));

beforeEach(() => {
  vi.resetModules();vi.useFakeTimers();mocks.push.mockReset();mocks.request.mockReset();
  mocks.nativeLog = undefined;
  mocks.stored = JSON.stringify([{id:"pending",at:new Date().toISOString(),category:"other",action:"Opened app",module:"app",details:{},synced_to_cloud:false}]);
  vi.stubGlobal("window",{location:{pathname:"/"}});
  vi.stubGlobal("navigator",{onLine:false,locks:{request:mocks.request}});
  mocks.push.mockImplementation(async (rows: {id:string}[]) => rows.map(row=>row.id));
  mocks.request.mockImplementation(async (_name, options, callback) => callback(options.ifAvailable ? null : {}));
});
afterEach(() => {vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});

it("restart waits for the audit lock and saves locally even offline and signed out", async () => {
  const {flushPendingAuditLogs} = await import("../audit-log");
  await expect(flushPendingAuditLogs()).resolves.toBeUndefined();
  expect(mocks.request.mock.calls[0][1].ifAvailable).toBeUndefined();
  expect(mocks.request.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  expect(mocks.push).toHaveBeenCalledTimes(1);
  expect(JSON.parse(mocks.stored)[0].synced_to_cloud).toBe(true);
});

it("new activity during a save does not make successful progress look like a login failure", async () => {
  const audit = await import("../audit-log");
  mocks.push.mockImplementationOnce(async (rows: {id:string}[]) => {
    audit.logger.log("other","New event","app");
    return rows.map(row=>row.id);
  });
  await expect(audit.flushPendingAuditLogs()).resolves.toBeUndefined();
  expect(mocks.push).toHaveBeenCalledTimes(2);
  expect(JSON.parse(mocks.stored).every((row:{synced_to_cloud:boolean})=>row.synced_to_cloud)).toBe(true);
});

it("a missing acknowledgement preserves the queue and reports a local saving failure", async () => {
  mocks.push.mockResolvedValue([]);
  const {flushPendingAuditLogs} = await import("../audit-log");
  await expect(flushPendingAuditLogs()).rejects.toThrow("local database");
  expect(JSON.parse(mocks.stored)[0].synced_to_cloud).toBe(false);
});

it("a held lock timeout reports the actual contention and retains pending logs", async () => {
  mocks.request.mockRejectedValue(Object.assign(new Error("Timeout"),{name:"TimeoutError"}));
  const {flushPendingAuditLogs} = await import("../audit-log");
  await expect(flushPendingAuditLogs()).rejects.toThrow("Another window is still saving");
  expect(mocks.push).not.toHaveBeenCalled();
  expect(JSON.parse(mocks.stored)[0].synced_to_cloud).toBe(false);
});

it("saves anonymous login activity to native diagnostics without requiring a person's SQL permission", async () => {
  mocks.nativeLog = vi.fn().mockResolvedValue({ ok: true });
  mocks.stored = JSON.stringify([{id:"login-event",staffId:"anonymous",at:new Date().toISOString(),category:"browse",action:"Opened login",module:"app",details:{},synced_to_cloud:false}]);
  const audit = await import("../audit-log");
  await expect(audit.flushPendingAuditLogs()).resolves.toBeUndefined();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.nativeLog).toHaveBeenCalledWith("application.signed-out-activity", expect.objectContaining({scope:"login-event"}));
  expect(JSON.parse(mocks.stored)).toEqual([]);
});
it("does not discard a signed-out person's unsaved business audit or a failed diagnostic write", async () => {
  mocks.nativeLog = vi.fn().mockResolvedValue({ ok: false });
  mocks.stored = JSON.stringify([{id:"login-event",staffId:"anonymous",at:new Date().toISOString(),category:"browse",details:{},synced_to_cloud:false}]);
  let audit = await import("../audit-log");
  await expect(audit.flushPendingAuditLogs()).rejects.toThrow("diagnostic log");
  expect(JSON.parse(mocks.stored)).toHaveLength(1);
  vi.resetModules();
  mocks.stored = JSON.stringify([{id:"sale-event",staffId:"person-a",at:new Date().toISOString(),category:"sale",details:{},synced_to_cloud:false}]);
  audit = await import("../audit-log");
  await expect(audit.flushPendingAuditLogs()).rejects.toThrow();
  expect(JSON.parse(mocks.stored)[0].synced_to_cloud).toBe(false);
  expect(mocks.push).not.toHaveBeenCalled();
});
