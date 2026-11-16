import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { sqlErrorDiagnostic } = require("../../../electron/db/sql-error-diagnostic.cjs");
const { SyncCoordinator } = require("../../../electron/sync/coordinator.cjs");
const { bootstrapDiagnostic, tagBootstrapDiagnostic } = require("../../../electron/diagnostics.cjs");
const RequestError = require("mssql/lib/error/request-error");
const main = readFileSync("electron/main.cjs", "utf8");
function native(number: number, message = "Private SQL values must stay private") {
  const original = Object.assign(new Error(message), { code: number, sqlstate: "23000", severity: 16,
    query: "PRIVATE SQL", parameters: { password: "PRIVATE password", row: "PRIVATE customer" } });
  const wrapped = new RequestError(original, "EREQUEST"); wrapped.code = "EREQUEST"; return wrapped;
}
function terminated(number = 547) {
  return Object.assign(native(3621, "[Microsoft][ODBC Driver 18 for SQL Server][SQL Server]The statement has been terminated."),
    { precedingErrors: [native(number)] });
}
type Diagnostics = { logConnection: (event: string, detail: object) => void; databaseErrors: () => Record<string, unknown>[] };
function logFixture() {
  const files = new Map<string, string>(), location = path.resolve("fixture-sql-diagnostics");
  const key = (file: string) => path.basename(file);
  const fs = { statSync: () => ({ size: 0 }), appendFileSync: (file: string, value: string) => files.set(key(file), (files.get(key(file)) ?? "") + value),
    readFileSync: (file: string) => { const value = files.get(key(file)); if (value === undefined) throw Error("fixture missing"); return value; } };
  const module = { exports: {} as Diagnostics };
  const nativeRequire = createRequire(path.resolve("electron/diagnostics.cjs"));
  new Function("require", "module", readFileSync("electron/diagnostics.cjs", "utf8"))((name: string) =>
    name === "node:fs" ? fs : name === "electron" ? { app: { getPath: () => location } } : nativeRequire(name), module);
  return { ...module.exports, files };
}

describe("bounded SQL error-number diagnostics", () => {
  it("reads the installed native RequestError shape and prefers meaningful preceding SQL over3621", () => {
    const error = terminated(547), before = Object.getOwnPropertyNames(error);
    expect(error.originalError.code).toBe(3621);
    expect(sqlErrorDiagnostic(error)).toEqual({ sqlNumber: 547 });
    expect(Object.getOwnPropertyNames(error)).toEqual(before); expect(error.code).toBe("EREQUEST");
    expect(error.message).toContain("terminated"); expect(sqlErrorDiagnostic(error)).not.toHaveProperty("message");
  });

  it("keeps termination-only3621 without inventing a cause", () => {
    expect(sqlErrorDiagnostic(native(3621, "The statement has been terminated."))).toEqual({ sqlNumber: 3621 });
    expect(sqlErrorDiagnostic(Object.assign(new Error("The statement has been terminated."), { code: "EREQUEST" }))).toEqual({});
  });

  it.each([
    { code: "EREQUEST", originalError: { info: { number: 2627 } } },
    { code: "ESQLSERVER_WRITE", cause: { name: "RequestError", number: "1205" } },
    { cause: { originalError: { code: 515, sqlstate: "23000" } } },
    { sqlNumber: "207" },
  ])("supports bounded driver and application wrapping without dumping values: %j", error => {
    const result = sqlErrorDiagnostic(error); expect(result.sqlNumber).toBeGreaterThan(0); expect(Object.keys(result)).toEqual(["sqlNumber"]);
  });

  it.each([null, undefined, "termination", { code: "ECONNRESET" }, { code: "ETIMEDOUT", number: 10060 },
    { code: "HTTP_403", status: 403, originalError: { code: 403 } }, { code: "23505" },
    { sqlNumber: -1 }, { sqlNumber: 0 }, { sqlNumber: 1.5 }, { sqlNumber: Infinity },
    { sqlNumber: "3621 PRIVATE" }, { sqlNumber: { valueOf: (): number => 547 } }, { sqlNumber: 2147483648 }])(
    "does not manufacture SQL diagnostics from transport, HTTP or malformed metadata %j", error => {
      expect(sqlErrorDiagnostic(error)).toEqual({});
    });

  it("does not invoke getters, proxies or coercion while retaining an accessible native cause", () => {
    const getter = vi.fn(() => { throw Error("must not execute"); });
    const value = Object.defineProperties({ originalError: { code: 2601, sqlstate: "23000" } }, {
      number: { get: getter }, precedingErrors: { get: getter }, message: { get: getter }, code: { get: getter },
    });
    expect(sqlErrorDiagnostic(value)).toEqual({ sqlNumber: 2601 }); expect(getter).not.toHaveBeenCalled();
    const get = vi.fn(() => { throw Error("must not execute"); });
    expect(sqlErrorDiagnostic(new Proxy({}, { get, getOwnPropertyDescriptor: () => { throw Error("blocked descriptor"); } }))).toEqual({});
    expect(get).not.toHaveBeenCalled();
  });

  it("bounds cyclic/oversized chains and survives malformed preceding branches", () => {
    const error = terminated(547); error.cause = error; error.precedingErrors.unshift(error);
    expect(sqlErrorDiagnostic(error)).toEqual({ sqlNumber: 547 });
    const { proxy, revoke } = Proxy.revocable([], {}); revoke();
    expect(sqlErrorDiagnostic({ code: "EREQUEST", number: 2627, precedingErrors: proxy })).toEqual({ sqlNumber: 2627 });
    const oversized = new Array(1_000_000_000); oversized[0] = native(207);
    expect(sqlErrorDiagnostic({ precedingErrors: oversized })).toEqual({ sqlNumber: 207 });
  });

  it("preserves the code, failure state and last verified pending counts through the real coordinator", async () => {
    const error = terminated(547), pull = vi.fn(async () => ({ merged: 0 }));
    const coordinator = new SyncCoordinator({ pushWorker: { run: vi.fn(async () => { throw error; }),
      reader: { connectionManager: { pool: {} }, pendingSummary: async () => { throw Error("unknown pending counts"); } } }, pullWorker: { run: pull } });
    coordinator.status.pending = 7; coordinator.status.failed = 2;
    const result = await coordinator.runNow({ branchId: "fixture-branch" });
    expect(result).toMatchObject({ ok: false, code: "EREQUEST", sqlNumber: 547, pending: 7, failed: 2 });
    expect(result.error).toContain("terminated"); expect(pull).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|originalError|precedingErrors|parameters|query/);
    expect(error.precedingErrors[0].number).toBe(547);
  });

  it.each(["ECONNRESET", "ETIMEDOUT", "HTTP_403", "ESYNC_SHIFT_AUTHOR_DENIED"])("leaves %s authorization/retry behavior intact", async code => {
    const error = Object.assign(new Error("unchanged failure"), { code, ...(code === "HTTP_403" || code === "ESYNC_SHIFT_AUTHOR_DENIED" ? { status: 403 } : {}) });
    const coordinator = new SyncCoordinator({ pushWorker: { run: async () => { throw error; } }, pullWorker: { run: async () => ({}) } });
    const result = await coordinator.runNow({ branchId: "fixture-branch" });
    expect(result.code).toBe(code); expect(result.ok).toBe(false); expect(result).not.toHaveProperty("sqlNumber");
    expect(result.credentialsInvalid).toBe(code === "HTTP_403");
  });

  it("logs manual coordinator results and thrown native failures through the actual Main wrapper", async () => {
    const diagnostics = { logConnection: vi.fn(), sqlErrorDiagnostic };
    const from = main.indexOf("async function observedDatabaseOperation("), to = main.indexOf("let localDataPreparePromise", from);
    const observed = new Function("diagnostics", main.slice(from, to) + ";return observedDatabaseOperation;")(diagnostics);
    const result = { ok: false, code: "EREQUEST", error: "statement terminated", sqlNumber: 547 };
    expect(await observed("synchronization", "manual", async () => result)).toBe(result);
    expect(diagnostics.logConnection).toHaveBeenLastCalledWith("synchronization.manual.failed", expect.objectContaining({ code: "EREQUEST", sqlNumber: 547 }));
    const error = terminated(207);
    await expect(observed("synchronization", "manual", async () => { throw error; })).rejects.toBe(error);
    expect(diagnostics.logConnection).toHaveBeenLastCalledWith("synchronization.manual.failed", expect.objectContaining({ code: "EREQUEST", sqlNumber: 207 }));
    expect(JSON.stringify(diagnostics.logConnection.mock.calls)).not.toContain("PRIVATE");
  });

  it("logs automatic coordinator SQL metadata through the actual Main scheduler without changing retry", async () => {
    const diagnostics = { logConnection: vi.fn(), sqlErrorDiagnostic, bootstrapDiagnostic }, schedule = vi.fn();
    const result: { ok: boolean; code: string; error: string; sqlNumber?: number } = { ok: false, code: "EREQUEST", error: "statement terminated", sqlNumber: 547 };
    const context = { diagnostics, syncRegistry: { tables: [{ cloudTable: "shifts" }] }, scheduleAutomaticSync: schedule, databaseService: { snapshot: () => ({ enabled: true, configured: true }) },
      isManagementDevice: () => false, databaseManager: { isConnected: () => true }, terminalStore: { read: () => ({ tokenId: "fixture" }) },
      localBranchId: () => "fixture-branch", jobManager: { running: false }, localDataPreparePromise: null,
      syncCoordinator: { paused: false, running: false, runNow: vi.fn(async () => result) }, shouldRetryRecoveryMetadata: () => false,
      prepareLocalData: vi.fn(async () => result),
      recoveryMetadataInstaller: { approvedArtifactHash: null }, historyCadence: { decision: () => "core", beginCore: () => 1, finishCore: vi.fn(), nextDelay: () => 60000 },
      automaticSyncQueued: false, lastActivityFlush: Date.now(), ACTIVITY_INTERVAL_MS: 120000, approvalTokenVerifier: { refresh: vi.fn() },
      AUTO_SYNC_RETRY_MS: 60000, AUTO_SYNC_OK_MS: 120000, AUTO_VERIFY_MS: 900000, lastAutomaticVerification: Date.now() };
    const from = main.indexOf("async function runAutomaticSync() {"), to = main.indexOf("function stopAutomaticSync()", from);
    const run = new Function(...Object.keys(context), main.slice(from, to) + ";return runAutomaticSync;")(...Object.values(context));
    await run();
    expect(diagnostics.logConnection).toHaveBeenCalledWith("synchronization.automatic.failed", expect.objectContaining({ code: "EREQUEST", sqlNumber: 547 }));
    expect(context.historyCadence.finishCore).toHaveBeenCalledWith(1, { ok: false, nextMs: 60000 });
    expect(schedule).toHaveBeenLastCalledWith(60000, { historyContinuation: true });
    // A returned recovery failure supersedes its earlier tracking-gap cause.
    context.syncCoordinator.runNow.mockResolvedValueOnce({ ...result, code: "ECHANGEGAP", sqlNumber: 22117 });
    await run();
    expect(diagnostics.logConnection).toHaveBeenLastCalledWith("synchronization.automatic.failed", expect.objectContaining({ code: "EREQUEST", sqlNumber: 547 }));
    const gap = () => tagBootstrapDiagnostic({ ...result, code: "ECHANGEGAP", sqlNumber: 22117 },
      { table: "shifts", phase: "download", origin: "gap_recovery", httpStatus: 503, nonJsonResponse: true });
    for (const returned of [
      { ...result, sqlNumber: 3621 },
      { ok: false, code: "ELOCAL_PENDING_UNVERIFIED", error: "Retained work still needs review." },
    ]) {
      context.syncCoordinator.runNow.mockResolvedValueOnce(gap());
      context.prepareLocalData.mockResolvedValueOnce(returned);
      await run();
      const final = diagnostics.logConnection.mock.calls.at(-1)![1];
      expect(final).toMatchObject({ code: returned.code, message: returned.error });
      if ("sqlNumber" in returned) expect(final.sqlNumber).toBe(3621);
      else expect(final).not.toHaveProperty("sqlNumber");
      expect(final).not.toHaveProperty("bootstrapPhase"); expect(final).not.toHaveProperty("httpStatus");
      expect(final).not.toHaveProperty("table"); expect(final).not.toHaveProperty("nonJsonResponse");
      expect(schedule).toHaveBeenLastCalledWith(60000, { historyContinuation: true });
    }
    context.syncCoordinator.runNow.mockResolvedValueOnce(gap());
    context.prepareLocalData.mockRejectedValueOnce(terminated(2601));
    await run();
    expect(diagnostics.logConnection).toHaveBeenLastCalledWith("synchronization.automatic.failed", expect.objectContaining({ code: "EREQUEST", sqlNumber: 2601 }));
    expect(diagnostics.logConnection.mock.calls.at(-1)![1]).not.toHaveProperty("httpStatus");
  });

  it("projects only validated numeric SQL diagnostics into durable logs and the failure summary", () => {
    const logs = logFixture(); logs.logConnection("application.started", {});
    logs.logConnection("synchronization.manual.failed", { code: "EREQUEST", message: "statement terminated", ...sqlErrorDiagnostic(terminated(547)),
      originalError: { password: "PRIVATE" }, parameters: "PRIVATE", query: "PRIVATE" });
    expect(logs.files.get("failure.log")).toContain('"sqlNumber":547');
    expect(logs.files.get("failure.log")).not.toContain("PRIVATE");
    expect(logs.databaseErrors()).toMatchObject([{ code: "EREQUEST", sqlNumber: 547 }]);
    for (const value of ["PRIVATE", { password: "PRIVATE" }, -1, 1.5, Infinity])
      logs.logConnection("synchronization.manual.failed", { code: "EREQUEST", message: "unchanged failure", sqlNumber: value });
    expect(logs.files.get("failure.log")).not.toContain("PRIVATE");
  });
});
