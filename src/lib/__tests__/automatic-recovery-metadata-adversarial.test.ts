import { createRequire } from "node:module";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopStorageRoute } from "../desktop-storage-route";

const require = createRequire(import.meta.url);
const { RecoveryMetadataGate, ShiftRecoveryMetadataInstaller, packageFiles, PACKAGE_HASHES, shouldRetryRecoveryMetadata } = require("../../../electron/db/shift-recovery-metadata.cjs");
const { HistoryCadence } = require("../../../electron/sync/history-cadence.cjs");
const { WriteBarrier } = require("../../../electron/sync/write-barrier.cjs");
const { SyncCoordinator } = require("../../../electron/sync/coordinator.cjs");
const { DatabaseService } = require("../../../electron/db/service.cjs");
const { LocalDataLifecycle } = require("../../../electron/jobs/lifecycle.cjs");
const session = require("../../../electron/admin-session.cjs");
const ipcPrivilege = require("../../../electron/ipc-privilege.cjs");
const main = readFileSync("electron/main.cjs", "utf8");
const branch = "00000000-0000-4000-8000-000000000001";
const terminalId = "00000000-0000-4000-8000-000000000002";
const databaseGuid = "00000000-0000-4000-8000-000000000003";
type DelegateInput = { expectedDatabaseGuid: string; expectedDatabaseName: string; assertCurrent: () => void; onProgress: (value: object) => void };
type DelegateResult = { available: boolean; state?: string; installed?: boolean };

function section(start: string, end: string) {
  const from = main.indexOf(start), to = main.indexOf(end, from);
  if (from < 0 || to <= from) throw Error("Main metadata boundary missing");
  return main.slice(from, to);
}
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

// Actual Main admission/wrapper functions, real coordinator and both write
// barriers. The installer delegate is synthetic and executes NO SQL; artifact,
// backup and provider acceptance have separate owned fixtures.
function mainFixture() {
  const gate = new RecoveryMetadataGate(), shutdown = new WriteBarrier();
  const coordinator = new SyncCoordinator({ pushWorker: { run: vi.fn(async () => ({ pushed: 1 })) }, pullWorker: {} });
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  let registration = { tokenId: terminalId, locationId: branch, deviceUse: "operations", deviceType: "pc" };
  let backend = "https://owned-fixture.invalid", singleInstance = true;
  const profile = { host: "owned-fixture", database: "OwnedRecoveryFixture", retentionDays: 90 };
  const primaryRow = { database_guid: databaseGuid, database_name: profile.database, configured_database_id: 5, current_database_id: 5,
    transaction_count: 0, transaction_state: 1, implicit_transactions: 0 };
  const primaryQuery = vi.fn(async (_sql: string) => ({ recordset: [{ ...primaryRow }] }));
  class PrimaryRequest {
    query = primaryQuery;
    constructor(parent: object, options: { requestTimeout: number }) { expect(parent).toBe(manager.pool); expect(options.requestTimeout).toBe(5000); }
    input(name: string, _type: unknown, value: unknown) { expect(name).toBe("configuredDatabase"); expect(value).toBe(profile.database); return this; }
  }
  const manager = { pool: {} as object, profile: { ...profile }, sql: () => ({ Request: PrimaryRequest, NVarChar: (n: number) => n }) };
  const service = new DatabaseService({ manager, secureConfig: { enabled: () => true, profile: () => profile, credentials: () => profile } });
  service.validated = true;
  const installer = { prepare: vi.fn(async (input: DelegateInput): Promise<DelegateResult> => {
    input.assertCurrent(); return { available: true, state: "matching", installed: true };
  }) };
  const context = {
    process: { platform: "win32" }, Boolean, JSON,
    require: (name: string) => {
      if (name !== "./verified-activation.cjs") throw Error("Unexpected Main dependency");
      return require("../../../electron/verified-activation.cjs");
    },
    app: { hasSingleInstanceLock: () => singleInstance },
    databaseManager: manager, databaseConfig: { profile: () => profile }, databaseService: service,
    currentLocalAdmission: { pending: () => false },
    terminalStore: { read: () => registration, wasProvisioned: () => true },
    authorizationServerUrl: () => backend, cloudCredentials: { read: () => ({ url: "https://project.owned-fixture.invalid" }) },
    recoveryMetadataGate: gate, syncCoordinator: coordinator, closeWriteBarrier: shutdown,
    recoveryMetadataInstaller: installer, ipcPrivilege, packageFiles,
    ipcMain: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler) },
    quitting: false, safeMode: false, closePreparation: null as unknown,
    jobManager: { running: null as unknown }, localDataPreparePromise: null as unknown,
    prepare: undefined as undefined | ((input: object) => Promise<unknown>),
    registerIpc: undefined as undefined | (() => void),
  };
  runInNewContext(section("function isManagementDevice()", "const activationBoundary"), context);
  runInNewContext(section("async function prepareShiftRecoveryMetadata(", "function publishBusinessChange(") + "\nglobalThis.prepare=prepareShiftRecoveryMetadata;", context);
  runInNewContext(section("function registerIpc() {", '  ipcMain.handle("admin:status"') + "\n}", context);
  context.registerIpc!();
  const invoke = (name: string, ...args: unknown[]) => handlers.get(name)!(null, ...args);
  const prepare = () => context.prepare!({ profile, pool: manager.pool, assertCurrent() {} });
  return { context, gate, shutdown, coordinator, manager, service, installer, handlers, invoke, prepare, primaryRow, primaryQuery,
    register: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => context.ipcMain.handle(name, handler),
    setBackend: (value: string) => { backend = value; },
    setRegistration: (value: typeof registration) => { registration = value; },
    setSingleInstance: (value: boolean) => { singleInstance = value; } };
}
function signInAdmin() {
  session.grant("admin", "fixture.admin", { can_manage_sync_backup: true, can_manage_terminals: true, can_process_sale: true,
    can_open_shift: true, can_close_shift: true, can_access_pos_settings: true }, "pos", branch);
}

afterEach(() => { session.clear(); session.clearRecovery(); vi.useRealTimers(); });

describe("composed Main metadata quiescence without a business database", () => {
  it("captures primary database identity only inside the lease and passes it to the temporary installer", async () => {
    const f = mainFixture();
    f.primaryQuery.mockImplementation(async statement => {
      expect(f.coordinator.ownsExclusive()).toBe(true); expect(f.gate.preparing).toBe(true);
      expect(statement.indexOf("SELECT @transactions=@@TRANCOUNT")).toBeLessThan(statement.indexOf("FROM sys.database_recovery_status"));
      expect(statement).not.toMatch(/\b(?:UPDATE|INSERT|DELETE|MERGE|ALTER)\b/);
      return { recordset: [{ ...f.primaryRow }] };
    });
    expect(await f.prepare()).toMatchObject({ available: true });
    expect(f.installer.prepare).toHaveBeenCalledWith(expect.objectContaining({ expectedDatabaseGuid: databaseGuid, expectedDatabaseName: "OwnedRecoveryFixture" }));
  });

  it.each(["database", "ambient", "implicit", "guid"])("refuses an unverified primary %s before the temporary installer", async kind => {
    const f = mainFixture();
    if (kind === "database") f.primaryRow.configured_database_id = 9;
    if (kind === "ambient") f.primaryRow.transaction_count = 1;
    if (kind === "implicit") f.primaryRow.implicit_transactions = 2;
    if (kind === "guid") f.primaryRow.database_guid = "not-a-guid";
    await expect(f.prepare()).rejects.toMatchObject({ code: "ERECOVERY_METADATA_CONTEXT" });
    expect(f.installer.prepare).not.toHaveBeenCalled(); expect(f.gate.preparing).toBe(false);
  });

  it("pins the package before even primary SQL and rechecks a changed source after its identity read", async () => {
    const untrusted = mainFixture();
    untrusted.context.packageFiles = () => { throw Object.assign(Error("Synthetic untrusted package"), { code: "ERECOVERY_METADATA_PACKAGE" }); };
    await expect(untrusted.prepare()).rejects.toMatchObject({ code: "ERECOVERY_METADATA_PACKAGE" });
    expect(untrusted.primaryQuery).not.toHaveBeenCalled(); expect(untrusted.installer.prepare).not.toHaveBeenCalled();
    const changed = mainFixture();
    changed.primaryQuery.mockImplementationOnce(async () => { changed.setBackend("https://changed.owned-fixture.invalid"); return { recordset: [{ ...changed.primaryRow }] }; });
    await expect(changed.prepare()).rejects.toMatchObject({ code: "ERECOVERY_METADATA_CONTEXT" });
    expect(changed.installer.prepare).not.toHaveBeenCalled();
  });

  it("lets an accepted closing obtain its existing upload lease before metadata takes that lease", async () => {
    const f = mainFixture(), localSaved = deferred(), uploadAllowed = deferred(), trace: string[] = [];
    const closing = f.gate.run(async () => {
      trace.push("local-closing-committed"); localSaved.resolve(); await uploadAllowed.promise;
      await f.coordinator.runPush({ branchId: branch }); trace.push("closing-acknowledged"); return { closingSaved: true };
    });
    await localSaved.promise;
    f.installer.prepare.mockImplementation(async ({ assertCurrent }: { assertCurrent: () => void }) => {
      assertCurrent(); expect(f.coordinator.ownsExclusive()).toBe(true); trace.push("metadata"); return { available: true };
    });
    const metadata = f.prepare(); expect(f.gate.preparing).toBe(true);
    const newSale = vi.fn(); expect(await f.gate.run(newSale)).toMatchObject({ ok: false, code: "ERECOVERY_METADATA_BUSY" });
    uploadAllowed.resolve(); expect(await closing).toEqual({ closingSaved: true });
    expect(await metadata).toMatchObject({ available: true });
    expect(trace).toEqual(["local-closing-committed", "closing-acknowledged", "metadata"]);
    expect(newSale).not.toHaveBeenCalled(); expect(f.gate.preparing).toBe(false);
  });

  it("does not let metadata cleanup reopen a shutdown-owned write seal", async () => {
    const f = mainFixture(), entered = deferred(), release = deferred();
    f.installer.prepare.mockImplementation(async ({ assertCurrent }: { assertCurrent: () => void }) => {
      entered.resolve(); await release.promise; assertCurrent(); return { available: true };
    });
    const running = f.prepare(); await entered.promise; await f.shutdown.sealAndDrain();
    release.resolve(); await running;
    expect(f.shutdown.sealed).toBe(true); expect(f.gate.preparing).toBe(false);
    const sale = vi.fn(); expect(await f.shutdown.run(sale)).toMatchObject({ code: "EAPP_CLOSING" }); expect(sale).not.toHaveBeenCalled();
  });

  it("does not let a cancelled shutdown reopen the separate metadata gate", async () => {
    const f = mainFixture(), entered = deferred(), release = deferred();
    f.installer.prepare.mockImplementation(async () => { entered.resolve(); await release.promise; return { available: true }; });
    const running = f.prepare(); await entered.promise;
    await f.shutdown.sealAndDrain(); f.shutdown.reopen();
    const sale = vi.fn(); expect(await f.gate.run(sale)).toMatchObject({ code: "ERECOVERY_METADATA_BUSY" }); expect(sale).not.toHaveBeenCalled();
    release.resolve(); await running; expect(f.gate.preparing).toBe(false); expect(f.shutdown.sealed).toBe(false);
  });

  it("does not let successful schema progress clear a prior full shift-recovery failure", async () => {
    const f = mainFixture();
    f.service.beginStartupActivity().finish(Object.assign(Error("Saved closing graph needs review"), { code: "SYNC_SHIFT_GRAPH_CONFLICT" }));
    f.installer.prepare.mockImplementation(async (input: { assertCurrent: () => void; onProgress: (value: object) => void }) => {
      input.assertCurrent(); input.onProgress({ phase: "metadata_backing_up", backupFile: "private-fixture-path" });
      expect(f.service.snapshot().startupActivity).toMatchObject({ active: true, phase: "metadata_backing_up", failure: "blocked", reason: "shift-data" });
      return { available: true, state: "matching", installed: true };
    });
    expect(await f.prepare()).toMatchObject({ available: true });
    const activity = f.service.snapshot().startupActivity;
    expect(activity).toMatchObject({ active: false, failure: "blocked", reason: "shift-data" });
    expect(JSON.stringify(activity)).not.toContain("private-fixture-path");
    expect(desktopStorageRoute(f.service.snapshot())).toBe("pending");
  });

  it("retires a timed-out queued lease without installing later or cancelling an accepted writer", async () => {
    vi.useFakeTimers();
    const gate = new RecoveryMetadataGate(), coordinator = new SyncCoordinator({ pushWorker: {}, pullWorker: {} });
    const occupied = deferred(), release = deferred(), work = vi.fn(async () => ({ available: true }));
    const earlier = coordinator.withExclusive(async () => { occupied.resolve(); await release.promise; });
    await occupied.promise;
    const metadata = gate.prepare({ coordinator, assertCurrent() {}, isBusy: () => false, work, timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(11);
    expect(await metadata).toMatchObject({ code: "ERECOVERY_METADATA_BUSY" }); expect(gate.preparing).toBe(false);
    release.resolve(); await earlier; await coordinator.withExclusive(async () => {});
    expect(work).not.toHaveBeenCalled();
  });

  it("keeps accepted local work alive when draining it reaches the bounded timeout", async () => {
    vi.useFakeTimers();
    const gate = new RecoveryMetadataGate(), finish = deferred(), started = deferred();
    const saved = gate.run(async () => { started.resolve(); await finish.promise; return { saved: true }; }); await started.promise;
    const work = vi.fn(); const metadata = gate.prepare({ coordinator: new SyncCoordinator({ pushWorker: {}, pullWorker: {} }), assertCurrent() {}, isBusy: () => false, work, timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(11); expect(await metadata).toMatchObject({ code: "ERECOVERY_METADATA_BUSY" });
    expect(gate.active.size).toBe(1); expect(work).not.toHaveBeenCalled();
    finish.resolve(); expect(await saved).toEqual({ saved: true }); expect(gate.active.size).toBe(0);
  });

  it.each(["pool", "backend", "terminal", "quitting"])("rejects a changed %s before a delegated fixture can continue", async kind => {
    const f = mainFixture(), entered = deferred(), release = deferred();
    f.installer.prepare.mockImplementation(async ({ assertCurrent }: { assertCurrent: () => void }) => {
      entered.resolve(); await release.promise; assertCurrent(); return { available: true };
    });
    const running = f.prepare(); await entered.promise;
    if (kind === "pool") f.manager.pool = {};
    if (kind === "backend") f.setBackend("https://different.owned-fixture.invalid");
    if (kind === "terminal") f.setRegistration({ tokenId: "00000000-0000-4000-8000-000000000009", locationId: branch, deviceUse: "operations", deviceType: "pc" });
    if (kind === "quitting") f.context.quitting = true;
    release.resolve(); await expect(running).rejects.toMatchObject({ code: "ERECOVERY_METADATA_CONTEXT" });
    expect(f.gate.preparing).toBe(false);
  });

  it.each(["quitting", "close", "shutdown-sealed", "job", "preparation"])("does not delegate while %s already owns work", async kind => {
    const f = mainFixture();
    if (kind === "quitting") f.context.quitting = true;
    if (kind === "close") f.context.closePreparation = {};
    if (kind === "shutdown-sealed") await f.shutdown.sealAndDrain();
    if (kind === "job") f.context.jobManager.running = {};
    if (kind === "preparation") f.context.localDataPreparePromise = Promise.resolve();
    expect(await f.prepare()).toMatchObject({ code: "ERECOVERY_METADATA_BUSY" }); expect(f.installer.prepare).not.toHaveBeenCalled();
  });

  it("does not claim applicability for Management/mobile or a process without the instance lock", async () => {
    for (const kind of ["management", "mobile", "lock"]) {
      const f = mainFixture();
      if (kind === "management") f.setRegistration({ tokenId: terminalId, locationId: "", deviceUse: "management", deviceType: "pc" });
      if (kind === "mobile") f.setRegistration({ tokenId: terminalId, locationId: branch, deviceUse: "operations", deviceType: "mobile" });
      if (kind === "lock") f.setSingleInstance(false);
      expect(await f.prepare()).toMatchObject({ state: "not_applicable" }); expect(f.installer.prepare).not.toHaveBeenCalled();
    }
  });
});

describe("actual Main IPC barrier composition", () => {
  it("holds preparation behind an accepted secure session adoption before allowing its identity read", async () => {
    const f = mainFixture(), entered = deferred(), release = deferred(); signInAdmin();
    f.register("admin:adopt-session", async () => { entered.resolve(); await release.promise; return { ok: true }; });
    const adopting = f.invoke("admin:adopt-session"); await entered.promise;
    expect(await f.prepare()).toMatchObject({ code: "ERECOVERY_METADATA_BUSY" });
    expect(f.primaryQuery).not.toHaveBeenCalled(); expect(f.installer.prepare).not.toHaveBeenCalled();
    release.resolve(); expect(await adopting).toEqual({ ok: true });
    expect(await f.prepare()).toMatchObject({ available: true });
  });

  it("excludes its initiating startup control from draining itself and blocks a concurrent retry", async () => {
    const f = mainFixture(), entered = deferred(), release = deferred(); signInAdmin();
    f.installer.prepare.mockImplementation(async () => { entered.resolve(); await release.promise; return { available: true }; });
    f.register("database:retry-startup", async () => f.prepare());
    const startup = f.invoke("database:retry-startup"); await entered.promise;
    expect(await f.invoke("database:retry-startup")).toMatchObject({ code: "ERECOVERY_METADATA_BUSY" });
    release.resolve(); expect(await startup).toMatchObject({ available: true });
    expect(f.installer.prepare).toHaveBeenCalledTimes(1); expect(f.gate.control.size).toBe(0);
  });

  it("holds actual control mutations and additional SQL writers while leaving verified reads available", async () => {
    const f = mainFixture(), entered = deferred(), release = deferred(), mutate = vi.fn(async () => ({ ok: true })); signInAdmin();
    const names = ["terminal:write", "terminal:clear", "admin:adopt-session", "config:write", "config:set", "config:reset", "backend:set", "cloud:set", "cloud:remove",
      "database:set-enabled", "database:migrate-saved", "database:provision-connect", "database:save-connect", "database:disconnect", "database:restore",
      "pos:remove-connection", "pos:forget-connection", "pos:apply-schema-tables", "pos:restore-drill", "sqladmin:query", "sqladmin:repair",
      "business:reserve-stock", "approval:authorize-offline-discount", "business:commit-aggregate"];
    for (const name of names) f.register(name, mutate);
    const read = vi.fn(async () => ({ ok: true, fixture: true }));
    for (const name of ["terminal:read", "database:get-state", "cloud:bootstrap"]) f.register(name, read);
    f.installer.prepare.mockImplementation(async () => { entered.resolve(); await release.promise; return { available: true }; });
    const running = f.prepare(); await entered.promise;
    try {
      for (const name of names) expect(await f.invoke(name, { kind: "sale" })).toMatchObject({ ok: false, code: "ERECOVERY_METADATA_BUSY" });
      expect(mutate).not.toHaveBeenCalled();
      for (const name of ["terminal:read", "database:get-state", "cloud:bootstrap"]) expect(await f.invoke(name)).toEqual({ ok: true, fixture: true });
      expect(read).toHaveBeenCalledTimes(3);
    } finally { release.resolve(); await running; }
  });

  it("retains the existing permission denial before metadata state is considered", async () => {
    const f = mainFixture(), denied = vi.fn(async () => ({ ok: true }));
    f.register("backend:set", denied); session.clear();
    expect(await f.invoke("backend:set", "https://different.owned-fixture.invalid")).toMatchObject({ ok: false }); expect(denied).not.toHaveBeenCalled();
  });
});

describe("optional metadata is not a startup snapshot or closing acknowledgement", () => {
  it.each([true, false])("uses the existing completed-snapshot proof, not a refused upgrade, for checkout (%s)", async completed => {
    const profile = { host: "owned-fixture", database: "OwnedRecoveryFixture", retentionDays: 90 };
    const query = vi.fn(async (_sql: string) => ({ recordset: [{ id: branch }] }));
    const manager = { pool: { request: () => ({ input() { return this; }, query }) }, isConnected: () => true };
    const service = new DatabaseService({ manager, secureConfig: { enabled: () => true, profile: () => profile, credentials: () => profile },
      prepareRecoveryMetadata: async () => ({ available: false, state: "held", code: "ERECOVERY_METADATA_BACKUP_VERIFY" }) });
    service.validated = true; service.transition("enabled_bootstrapping");
    await service.prepareOptionalRecovery(profile);
    const lifecycle = new LocalDataLifecycle({ connectionManager: manager, databaseService: service, registry: { tables: [] },
      cloud: { terminalId: () => terminalId, backendUrl: () => "https://owned-fixture.invalid", terminalStore: { read: () => ({ tokenId: terminalId, locationId: branch, deviceUse: "operations" }) } },
      jobRepository: { startupSnapshot: async () => completed ? { job_id: "completed-fixture" } : null, hasOtherActiveJobs: async () => false } });
    expect(await lifecycle.cachedSnapshotReady(branch, 90)).toBe(completed);
    const failure = Object.assign(Error("Owned scoped recovery is still pending"), { code: "ELOCAL_PENDING_UNVERIFIED" });
    lifecycle.ensure = async () => { throw failure; };
    const context = { isManagementDevice: () => false, localDataLifecycle: lifecycle, databaseService: service, databaseConfig: { profile: () => profile },
      localBranchId: () => branch, diagnostics: { logConnection() {}, bootstrapDiagnostic: () => ({}) }, syncRegistry: { tables: [] },
      prepare: undefined as undefined | (() => Promise<unknown>) };
    runInNewContext("let localDataPreparePromise=null;" + section("function prepareLocalData(", "let localDatabaseRecoveryPromise") + ";globalThis.prepare=prepareLocalData;", context);
    await expect(context.prepare!()).rejects.toBe(failure);
    expect(service.snapshot().recoveryMetadata.code).toBe("ERECOVERY_METADATA_BACKUP_VERIFY");
    expect(desktopStorageRoute(service.snapshot())).toBe(completed ? "local" : "pending");
    expect(query.mock.calls.every(([sql]) => !/\b(?:UPDATE|INSERT|MERGE|DELETE|ALTER)\b/i.test(sql))).toBe(true);
  });
});

describe("independently pinned package before a SQL connection", () => {
  it.each([null, PACKAGE_HASHES.installer])("rejects a matching malicious manifest/probe pair before even rollout-%s can connect", async approvedArtifactHash => {
    const root = resolve(".tmp/reviewer-package-fixtures"); mkdirSync(root, { recursive: true });
    const directory = mkdtempSync(join(root, "owned-package-"));
    const files = ["shift-recovery-metadata.manifest.json", "shift-recovery-metadata-probe.sql", "shift-recovery-metadata.sql"];
    try {
      for (const name of files) writeFileSync(join(directory, name), readFileSync(join("database/sqlserver/recovery", name)));
      const malicious = "THROW 51000,'Synthetic untrusted probe must never execute.',1;";
      const manifest = JSON.parse(readFileSync(join(directory, files[0]), "utf8"));
      manifest.probe.sha256 = createHash("sha256").update(malicious).digest("hex").toUpperCase();
      writeFileSync(join(directory, files[1]), malicious);
      writeFileSync(join(directory, files[0]), JSON.stringify(manifest));
      const temporary = vi.fn(async () => { throw Error("Untrusted package reached a SQL connection"); });
      const installer = new ShiftRecoveryMetadataInstaller({ manager: { temporary }, approvedArtifactHash, loadPackage: () => packageFiles(directory) });
      expect(await installer.prepare({ profile: { database: "OwnedRecoveryFixture" }, expectedDatabaseGuid: databaseGuid, expectedDatabaseName: "OwnedRecoveryFixture", assertCurrent() {} })).toMatchObject({ available: false, code: "ERECOVERY_METADATA_PACKAGE" });
      expect(temporary).not.toHaveBeenCalled();
    } finally {
      // Only our unique package fixture; no recursive cleanup or profile path.
      expect(dirname(directory)).toBe(root); expect(basename(directory)).toMatch(/^owned-package-/);
      expect(lstatSync(directory).isSymbolicLink()).toBe(false); expect(realpathSync(directory)).toBe(directory);
      for (const name of files) unlinkSync(join(directory, name));
      rmdirSync(directory);
    }
  });
});

function automaticRetryFixture() {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-07T00:00:00Z"));
  const profile = { host: "owned-fixture", database: "OwnedRecoveryFixture" };
  const manager = { pool: {}, isConnected: () => true, open: vi.fn(async () => ({})), close: vi.fn() };
  const optional = vi.fn(async () => ({ available: true, state: "matching", installed: true }));
  const service = new DatabaseService({ manager, validator: async () => ({ ok: true, ready: true }),
    secureConfig: { enabled: () => true, profile: () => profile, credentials: () => profile }, prepareRecoveryMetadata: optional });
  service.validated = true; service.transition("enabled_bootstrapping");
  service.recoveryMetadata = { available: false, state: "held", code: "ERECOVERY_METADATA_BUSY" };
  const scheduled: number[] = [], runNow = vi.fn(async () => ({ ok: true }));
  const prepareLocalData = vi.fn(async () => service.markReady({ phase: "fixture-normal-lifecycle", syncReady: true }));
  const context = {
    Date, historyCadence: new HistoryCadence({ now: Date.now, jitter: () => 0 }), automaticSyncQueued: false,
    automaticSyncScheduler: { schedule: (delay: number) => scheduled.push(delay) }, quitting: false,
    isManagementDevice: () => false, managementReplica: { resetRetry: vi.fn(), run: vi.fn() }, terminalStore: { read: () => ({ tokenId: terminalId }) },
    terminalIdentityPausedSync: false, databaseService: service, databaseManager: manager, localBranchId: () => branch,
    jobManager: { running: false }, localDataPreparePromise: null as unknown, syncCoordinator: { paused: false, running: false, runNow },
    shouldRetryRecoveryMetadata, recoveryMetadataInstaller: { approvedArtifactHash: PACKAGE_HASHES.installer as string | null },
    prepareLocalData, approvalTokenVerifier: { refresh: vi.fn(async () => {}) }, recordFault: vi.fn(),
    lastActivityFlush: Date.now(), ACTIVITY_INTERVAL_MS: 120000, AUTO_SYNC_OK_MS: 120000, AUTO_SYNC_RETRY_MS: 60000,
    AUTO_VERIFY_MS: 900000, lastAutomaticVerification: Date.now(), databaseConfig: { profile: () => profile },
    localDataLifecycle: { historyStep: vi.fn(async () => ({ completed: true, status: "completed" })), reconcileAndRecover: vi.fn(async () => []), historyPending: () => false },
    diagnostics: { logConnection: vi.fn(), bootstrapDiagnostic: () => ({}) }, syncRegistry: { tables: [] }, MEMBERSHIP_TABLES: new Set(), reconciliationError: () => Error("fixture-review"),
  };
  runInNewContext(section("let localDatabaseRecoveryPromise=null;", "// Local commits and private cloud notifications") +
    section("function scheduleAutomaticSync(", "function stopAutomaticSync("), context);
  const api = context as typeof context & { runAutomaticSync: () => Promise<void> };
  return { context: api, service, optional, scheduled, runNow, prepareLocalData };
}

describe("actual Main retries only transient metadata startup busy through the existing cycle", () => {
  it("waits for the existing job then performs the real DatabaseService restore and normal lifecycle once", async () => {
    const f = automaticRetryFixture(); f.context.jobManager.running = true;
    await f.context.runAutomaticSync(); expect(f.optional).not.toHaveBeenCalled(); expect(f.runNow).not.toHaveBeenCalled();
    f.context.jobManager.running = false;
    await f.context.runAutomaticSync();
    expect(f.optional).toHaveBeenCalledTimes(1); expect(f.prepareLocalData).toHaveBeenCalledTimes(1);
    expect(f.service.snapshot()).toMatchObject({ state: "enabled_ready", recoveryMetadata: { available: true } });
    expect(f.scheduled.at(-1)).toBe(60000); expect(f.runNow).not.toHaveBeenCalled();
    await f.context.runAutomaticSync();
    expect(f.runNow).toHaveBeenCalledTimes(1); expect(f.optional).toHaveBeenCalledTimes(1);
  });

  it.each(["ready", "paused", "unapproved", "preparing", "backup", "schema", "approval"])("does not turn %s into a metadata restore loop", async kind => {
    const f = automaticRetryFixture();
    if (kind === "ready") f.service.markReady();
    if (kind === "paused") f.context.syncCoordinator.paused = true;
    if (kind === "unapproved") f.context.recoveryMetadataInstaller.approvedArtifactHash = null;
    if (kind === "preparing") f.context.localDataPreparePromise = Promise.resolve();
    if (kind === "backup") f.service.recoveryMetadata.code = "ERECOVERY_METADATA_BACKUP_VERIFY";
    if (kind === "schema") f.service.recoveryMetadata.code = "ERECOVERY_METADATA_SCHEMA";
    if (kind === "approval") f.service.recoveryMetadata.code = "ERECOVERY_METADATA_APPROVAL_REQUIRED";
    await f.context.runAutomaticSync();
    expect(f.optional).not.toHaveBeenCalled(); expect(f.prepareLocalData).not.toHaveBeenCalled();
  });
});
