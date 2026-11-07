import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { HistoryCadence } = require("../../../electron/sync/history-cadence.cjs");
const { shouldRetryRecoveryMetadata } = require("../../../electron/db/shift-recovery-metadata.cjs");
const main = readFileSync("electron/main.cjs", "utf8");
const source = (start: string, end: string) => {
  const from = main.indexOf(start), to = main.indexOf(end, from);
  if (from < 0 || to <= from) throw new Error("Main reporting boundary missing");
  return main.slice(from, to);
};
type Result = { ok: boolean; code?: string; error?: string; stage?: string; historyPending?: boolean; syncReady?: boolean };
type LogEntry = { event: string; detail: Record<string, unknown> };
type DiagnosticApi = {
  logConnection: (event: string, detail?: object) => void;
  databaseErrors: () => Array<{ code: string; stage: string }>;
  tagBootstrapDiagnostic: <T>(error: T, fields: object) => T;
  bootstrapDiagnostic: (error: unknown, tables: string[]) => object;
};

// Real diagnostics classification and in-memory files: no user profile or SQL.
function diagnostics() {
  const files = new Map<string, string>(), folder = path.resolve("test-diagnostics");
  const key = (file: string) => path.basename(file);
  const fs = {
    statSync(file: string) { if (!files.has(key(file))) throw Error("missing"); return { size: files.get(key(file))!.length }; },
    appendFileSync(file: string, value: string) { files.set(key(file), (files.get(key(file)) ?? "") + value); },
    readFileSync(file: string) { if (!files.has(key(file))) throw Error("missing"); return files.get(key(file)); },
    renameSync(from: string, to: string) { files.set(key(to), files.get(key(from))!); files.delete(key(from)); },
    readdirSync() { return []; },
  };
  const module = { exports: {} as DiagnosticApi };
  new Function("require", "module", readFileSync("electron/diagnostics.cjs", "utf8"))((name: string) =>
    name === "node:fs" ? fs : name === "electron" ? { app: { getPath: () => folder } } : require(name), module);
  const entries = (name: string): LogEntry[] => (files.get(name) ?? "").split("\n").filter(Boolean).map(line => {
    const match = line.match(/^\S+\s+(\S+)\s+(\{.*\})$/)!;
    return { event: match[1], detail: JSON.parse(match[2]) };
  });
  return { ...module.exports, files, entries };
}

function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-06T00:00:00Z"));
  const log = diagnostics(), scheduled: number[] = [], calls: LogEntry[] = [];
  log.logConnection("application.started");
  const runNow = vi.fn(async (_input: object): Promise<Result> => ({ ok: true }));
  const recovered = { ok: true, source: "existing lifecycle" };
  const ensure = vi.fn(async (_input: object): Promise<Result> => recovered);
  const report = vi.fn(), finish = vi.fn();
  const manual = new Map<string, (_event: unknown, options?: object) => Promise<unknown>>();
  const context = {
    Date, historyCadence: new HistoryCadence({ now: Date.now, jitter: () => 0 }), quitting: false,
    automaticSyncQueued: false, automaticSyncScheduler: { schedule: (delay: number) => scheduled.push(delay) },
    isManagementDevice: () => false, managementReplica: { run: vi.fn() },
    terminalStore: { read: () => ({ tokenId: "registered" }) }, terminalIdentityPausedSync: false,
    databaseService: { snapshot: () => ({ enabled: true, configured: true, connected: true }),
      beginStartupActivity: () => ({ report, finish }), markReady: vi.fn(), transition: vi.fn() },
    databaseManager: { isConnected: () => true }, recoverLocalDatabase: vi.fn(), shouldRetryRecoveryMetadata,recoveryMetadataInstaller:{approvedArtifactHash:null},recordFault: vi.fn(),
    localBranchId: () => "A", jobManager: { running: false }, localDataPreparePromise: null,
    syncCoordinator: { paused: false, running: false, runNow }, approvalTokenVerifier: { refresh: vi.fn() },
    lastActivityFlush: Date.now(), ACTIVITY_INTERVAL_MS: 120000, AUTO_SYNC_OK_MS: 120000,
    AUTO_SYNC_RETRY_MS: 60000, AUTO_VERIFY_MS: 900000, lastAutomaticVerification: Date.now(),
    localDataLifecycle: { ensure, preserveCachedReady: () => false,
      historyStep: vi.fn(async () => ({ completed: true, status: "completed" })),
      reconcileAndRecover: vi.fn(async () => []), historyPending: () => false },
    databaseConfig: { profile: () => ({ retentionDays: 90 }) },
    diagnostics: { ...log, logConnection: (event: string, detail: Record<string, unknown>) => {
      calls.push({ event, detail }); log.logConnection(event, detail);
    } }, syncRegistry: { tables: [{ cloudTable: "shifts" }] },
    MEMBERSHIP_TABLES: new Set(["members"]), reconciliationError: () => Error("count review"),
    guard: { options: (input: object) => input, guarded: (work: () => Promise<unknown>) => work() },
    ipcMain: { handle: (name: string, handler: (_event: unknown, options?: object) => Promise<unknown>) => manual.set(name, handler) },
  };
  runInNewContext(source("async function observedDatabaseOperation(", "let localDataPreparePromise"), context);
  runInNewContext(source("function prepareLocalData(", "let localDatabaseRecoveryPromise"), context);
  runInNewContext(source("function scheduleAutomaticSync(", "function stopAutomaticSync("), context);
  runInNewContext(source('  ipcMain.handle("sync:run-now"', '  ipcMain.handle("sync:finalize-shift-close"'), context);
  const api = context as typeof context & { runAutomaticSync: () => Promise<void>; scheduleAutomaticSync: (delay?: number) => void };
  const gap = () => runNow.mockResolvedValueOnce({ ok: false, code: "ECHANGEGAP", error: "Change Tracking expired." });
  return { context: api, log, calls, runNow, ensure, recovered, report, finish, scheduled, gap,
    manual: (options = {}) => manual.get("sync:run-now")!(null, options) };
}
afterEach(() => vi.useRealTimers());

describe("actual Main scoped recovery reports the final operation outcome", () => {
  it("reports automatic recovery, not a failed attempt, when the existing lifecycle succeeds", async () => {
    const f = fixture(); f.gap(); await f.context.runAutomaticSync();
    expect(f.calls.map(row => row.event)).toEqual([
      "synchronization.automatic.recovering", "synchronization.bootstrap.succeeded", "synchronization.automatic.succeeded",
    ]);
    expect(f.log.entries("failure.log")).toEqual([]);
    expect(f.log.databaseErrors()).toEqual([]);
    expect(f.runNow).toHaveBeenCalledExactlyOnceWith({ branchId: "A", batchSize: 500, includeActivity: false });
    expect(f.ensure).toHaveBeenCalledExactlyOnceWith({ branchId: "A", historyDays: 90, force: true, onActivity: f.report });
    expect(f.finish).toHaveBeenCalledWith(undefined);
    expect(f.scheduled.at(-1)).toBe(120000);
  });

  it("keeps proven reader unavailability pending, preserves warnings and schedules one bounded retry", async () => {
    const f = fixture(); f.gap();
    f.log.logConnection("synchronization.bootstrap.failed", { category: "synchronization", stage: "bootstrap", code: "EARLIER" });
    f.ensure.mockResolvedValueOnce({ ok: true, historyPending: true, syncReady: false, code: "EHISTORY_POLICY_UNAVAILABLE" });
    await f.context.runAutomaticSync();
    expect(f.calls.map(row => row.event)).toEqual([
      "synchronization.automatic.recovering", "synchronization.bootstrap.pending", "synchronization.automatic.pending",
    ]);
    expect(f.log.databaseErrors()).toMatchObject([{ code: "EARLIER" }]);
    expect(f.context.localDataLifecycle.historyStep).not.toHaveBeenCalled();
    expect(f.scheduled.at(-1)).toBe(60000);
  });

  it("returns pending from manual recovery without logging full synchronization success", async () => {
    const f = fixture(); f.gap();
    const result = { ok: true, historyPending: true, syncReady: false, code: "EHISTORY_POLICY_UNAVAILABLE" };
    f.ensure.mockResolvedValueOnce(result);
    expect(await f.manual()).toBe(result);
    expect(f.calls.map(row => row.event)).toEqual([
      "synchronization.manual.recovering", "synchronization.bootstrap.pending", "synchronization.manual.pending",
    ]);
    expect(f.log.entries("failure.log")).toEqual([]);
  });

  it("keeps genuine prior warnings while recovery is downloading, without a false success or failure", async () => {
    const f = fixture(); f.gap();
    f.log.logConnection("synchronization.automatic.failed", { category: "synchronization", stage: "automatic", code: "EARLIER" });
    f.log.logConnection("checkout.commit.failed", { category: "database", stage: "sale", code: "PERMISSION_DENIED" });
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.ensure.mockImplementationOnce(async input => {
      (input as { onActivity: (value: object) => void }).onActivity({ phase: "download", table: "shifts", completed: 2, total: 8 });
      entered(); await new Promise<void>(resolve => { release = resolve; }); return f.recovered;
    });
    const running = f.context.runAutomaticSync(); await started;
    expect(f.report).toHaveBeenCalledWith({ phase: "download", table: "shifts", completed: 2, total: 8 });
    expect(f.calls.map(row => row.event)).toEqual(["synchronization.automatic.recovering"]);
    const progress = f.log.entries("success.log").find(row => row.event.endsWith(".recovering"))!;
    expect(progress.detail).toMatchObject({ state: "recovering", outcome: "success" });
    expect(progress.detail).not.toHaveProperty("code"); expect(progress.detail).not.toHaveProperty("message");
    expect(f.log.databaseErrors().map(row => row.code).sort()).toEqual(["EARLIER", "PERMISSION_DENIED"]);
    release(); await running;
    expect(f.log.databaseErrors().map(row => row.code)).toEqual(["PERMISSION_DENIED"]);
    expect(f.log.files.get("failure.log")).toContain("EARLIER"); // Historical evidence is retained.
  });

  it("records the actual final recovery failure and its private diagnostic, then clears only after success", async () => {
    const f = fixture(); f.gap();
    const failure = f.log.tagBootstrapDiagnostic(Object.assign(Error("Retained closings need review."), { code: "ELOCAL_PENDING_UNVERIFIED" }),
      { table: "shifts", phase: "local_apply", origin: "gap_recovery" });
    f.ensure.mockRejectedValueOnce(failure); await f.context.runAutomaticSync();
    const automatic = f.log.entries("failure.log").filter(row => row.event === "synchronization.automatic.failed");
    expect(automatic).toHaveLength(1);
    expect(automatic[0].detail).toMatchObject({ code: "ELOCAL_PENDING_UNVERIFIED", table: "shifts", bootstrapPhase: "local_apply", bootstrapOrigin: "gap_recovery" });
    expect(f.log.files.get("failure.log")).not.toContain("ECHANGEGAP");
    expect(f.calls.some(row => row.event === "synchronization.automatic.succeeded")).toBe(false);
    expect(f.finish).toHaveBeenCalledWith(failure);
    expect(f.context.databaseService.transition).toHaveBeenCalledWith("enabled_bootstrapping", expect.objectContaining({ code: "ELOCAL_PENDING_UNVERIFIED" }));
    expect(f.scheduled.at(-1)).toBe(60000);
    f.context.scheduleAutomaticSync(250); await f.context.runAutomaticSync();
    expect(f.log.databaseErrors().map(row => row.code)).toEqual(["ELOCAL_PENDING_UNVERIFIED"]); // bootstrap remains unresolved.
    f.gap(); f.context.scheduleAutomaticSync(250); await f.context.runAutomaticSync();
    expect(f.log.databaseErrors()).toEqual([]);
    expect(f.log.files.get("failure.log")).toContain("ELOCAL_PENDING_UNVERIFIED");
  });

  it.each(["HTTP_503", "PERMISSION_DENIED"])("retains ordinary %s failure and retry behavior without recovery", async code => {
    const f = fixture(); f.runNow.mockResolvedValueOnce({ ok: false, code, error: "Request rejected." });
    await f.context.runAutomaticSync();
    expect(f.ensure).not.toHaveBeenCalled();
    expect(f.calls.map(row => row.event)).toEqual(["synchronization.automatic.failed"]);
    expect(f.log.databaseErrors()).toMatchObject([{ code }]); expect(f.scheduled.at(-1)).toBe(60000);
  });

  it("observes the whole manual recovery so a recovered gap leaves no stale manual failure", async () => {
    const f = fixture(); f.gap();
    expect(await f.manual({ batchSize: 7 })).toBe(f.recovered);
    expect(f.calls.map(row => row.event)).toEqual([
      "synchronization.manual.recovering", "synchronization.bootstrap.succeeded", "synchronization.manual.succeeded",
    ]);
    expect(f.runNow).toHaveBeenCalledExactlyOnceWith({ batchSize: 7, branchId: "A" });
    expect(f.ensure).toHaveBeenCalledTimes(1); expect(f.log.databaseErrors()).toEqual([]);
    expect(f.log.entries("failure.log")).toEqual([]);
  });

  it("does not treat an ordinary completed pass as full manual sync while scoped history is pending", async () => {
    const f = fixture(); f.context.localDataLifecycle.historyPending = () => true;
    expect(await f.manual()).toEqual({ ok: true, historyPending: true, syncReady: false });
    expect(f.calls.map(row => row.event)).toEqual(["synchronization.manual.pending"]);
    expect(f.ensure).not.toHaveBeenCalled();
  });

  it("rethrows the same final manual recovery error without claiming success", async () => {
    const f = fixture(); f.gap(); const failure = Object.assign(Error("Administrator review required."), { code: "ELOCAL_PENDING_UNVERIFIED" });
    f.ensure.mockRejectedValueOnce(failure);
    await expect(f.manual()).rejects.toBe(failure);
    expect(f.log.entries("failure.log").filter(row => row.event === "synchronization.manual.failed")).toMatchObject([
      { detail: { code: "ELOCAL_PENDING_UNVERIFIED" } },
    ]);
    expect(f.log.files.get("failure.log")).not.toContain("ECHANGEGAP");
    expect(f.calls.some(row => row.event === "synchronization.manual.succeeded")).toBe(false);
  });

  it("preserves ordinary manual result identity and errors", async () => {
    const f = fixture(), result = { ok: false, code: "PERMISSION_DENIED", error: "Denied." };
    f.runNow.mockResolvedValueOnce(result); expect(await f.manual()).toBe(result);
    expect(f.ensure).not.toHaveBeenCalled(); expect(f.log.databaseErrors()).toMatchObject([{ code: "PERMISSION_DENIED" }]);
    await f.manual(); expect(f.log.databaseErrors()).toEqual([]);
  });
});
