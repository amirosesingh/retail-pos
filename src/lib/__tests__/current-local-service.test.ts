import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { DatabaseService } = require("../../../electron/db/service.cjs");
const privilege = require("../../../electron/ipc-privilege.cjs");
const session = require("../../../electron/admin-session.cjs");
const profile = { host: "fixture-local", port: 1433, database: "POS_Local_Beta", authMode: "windows",
  username: "", password: "", encrypt: true, trustServerCertificate: false,
  connectionTimeoutMs: 5000, requestTimeoutMs: 5000 };
const failure = (code: string) => Object.assign(new Error("Fixture admission refusal"), { code });

function fixture() {
  const state = { context: true, admitted: false, enabled: false, populated: false, guid: "first-physical-guid",
    admittedGuid: null as string | null, profile: null as typeof profile | null, crashAfterAdmission: false };
  const old = Object.freeze({ profile: { host: "retained-server", database: "old-pos" }, pending: "unsent-old-sale", passwordBlob: "old-sealed-secret" });
  const manager = { pool: null as { guid: string } | null, profile: null as (Omit<typeof profile, "password"> & { password?: string }) | null,
    isConnected: () => Boolean(manager.pool),
    open: vi.fn(async (value: typeof profile) => { manager.pool = { guid: state.guid }; manager.profile = { ...value, password: undefined }; return manager.pool; }),
    close: vi.fn(async () => { manager.pool = null; manager.profile = null; }),
    temporary: vi.fn(async (_value: typeof profile, _database: string, work: (pool: { guid: string }) => Promise<unknown>) => work({ guid: state.guid })),
  };
  const check = (pool: { guid: string }) => {
    if (!state.context) throw failure("ECURRENT_LOCAL_CONTEXT");
    if (state.admitted && state.admittedGuid !== pool.guid) throw failure("ECURRENT_LOCAL_TARGET");
    if (!state.admitted && state.populated) throw failure("ECURRENT_LOCAL_FRESH");
  };
  const database = (pool: { guid: string }) => ({ guid: pool.guid, name: profile.database, server: "fixture-local" });
  const recoveryLocal = { pending: () => true, canConfigure: () => state.context, hasAdmission: () => state.admitted,
    inspect: vi.fn(async (pool: { guid: string }) => { check(pool); return { ok: true, database: database(pool) }; }),
    admit: vi.fn(async (pool: { guid: string }, value: typeof profile, options: { assertCurrent: () => void; expectedDatabase?: { guid: string } }) => {
      options.assertCurrent(); check(pool);
      if (options.expectedDatabase?.guid !== pool.guid) throw failure("ECURRENT_LOCAL_TARGET");
      state.admitted = true; state.admittedGuid = pool.guid;
      state.profile = { ...value }; state.enabled = true; return { ok: true };
    }),
    assertPool: vi.fn(async (pool: { guid: string }, _value: typeof profile, options: { assertCurrent: () => void }) => {
      options.assertCurrent(); if (!state.admitted) throw failure("ECURRENT_LOCAL_TARGET"); check(pool); return { ok: true };
    }),
  };
  const secureConfig = { enabled: () => state.enabled, profile: () => state.profile, credentials: () => state.profile,
    setEnabled: vi.fn((value: boolean) => { state.enabled = value; }),
    save: vi.fn(() => { if (state.crashAfterAdmission) throw failure("ECURRENT_LOCAL_STORE"); return state.profile; }),
    remove: vi.fn(),
  };
  const validator = vi.fn(async () => ({ ok: true, ready: true }));
  const migrate = vi.fn(async () => ({ ok: true }));
  const prepare = vi.fn(async () => ({ available: true }));
  const makeService = () => new DatabaseService({ secureConfig, manager, validator, migrate,
    prepareRecoveryMetadata: prepare, localRecoveryPending: () => recoveryLocal.pending(), recoveryLocal });
  const service = makeService();
  const effects = vi.fn(async () => ({ ok: true }));
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc = { handle: (channel: string, listener: (...args: unknown[]) => unknown) => handlers.set(channel, listener) };
  privilege.install(ipc, { isFirstRun: () => false,
    isLocalRecoveryPending: () => service.snapshot().localRecoveryPending === true,
    canConfigureLocalRecovery: () => service.canConfigureRecovery(),
    isRetainedLocalRecoveryPending: () => recoveryLocal.pending(),
  });
  ipc.handle("database:validate", (_event, value) => service.validate(value));
  ipc.handle("database:save-connect", (_event, value) => service.saveAndConnect(value));
  for (const channel of ["business:query", "config:set", "config:write", "config:reset", "database:migrate", "database:provision-connect"])
    ipc.handle(channel, effects);
  return { state, old, manager, recoveryLocal, secureConfig, validator, migrate, prepare, service, makeService, effects,
    call: (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args) };
}

afterEach(() => { session.clear(); session.clearRecovery(); });

describe("active replacement local SQL service admission", () => {
  it("admits validated fresh SQL for the active replacement without clearing old retained work", async () => {
    const f = fixture(); session.grant("admin", "fixture-admin", {}, "pos", "fixture-branch");
    const retained = JSON.stringify(f.old);
    expect(f.service.snapshot()).toMatchObject({ localRecoveryPending: true, tradingReady: false });
    expect(await f.call("business:query")).toMatchObject({ code: "ELOCAL_RECOVERY_PENDING" });
    expect(await f.call("database:validate", profile)).toMatchObject({ ok: true, ready: true });
    expect(f.recoveryLocal.inspect).toHaveBeenCalledOnce();
    expect(await f.call("database:save-connect", profile)).toMatchObject({ ok: true });
    expect(f.service.snapshot()).toMatchObject({ connected: true, tradingReady: true, retainedLocalRecoveryPending: true });
    expect(f.service.snapshot().localRecoveryPending).not.toBe(true);
    expect(f.recoveryLocal.admit).toHaveBeenCalledOnce(); expect(f.recoveryLocal.assertPool).toHaveBeenCalledOnce();
    expect(await f.call("business:query")).toEqual({ ok: true });
    expect(f.recoveryLocal.pending()).toBe(true); expect(JSON.stringify(f.old)).toBe(retained);
    expect(await f.service.remove()).toMatchObject({ code: "ECURRENT_LOCAL_RETAINED" });
    expect(f.secureConfig.remove).not.toHaveBeenCalled();
  });

  it("still requires the existing POS database permission before admitting a target", async () => {
    const f = fixture(); session.clear();
    expect(await f.call("database:validate", profile)).toMatchObject({ ok: true });
    expect(await f.call("database:save-connect", profile)).toMatchObject({ code: "EPRIVILEGE" });
    expect(f.manager.open).not.toHaveBeenCalled(); expect(f.recoveryLocal.admit).not.toHaveBeenCalled();
  });
  it("pins the inspected physical target from Validate through Save and refuses a first-admission swap", async () => {
    const f = fixture(); expect(await f.service.validate(profile)).toMatchObject({ ok: true });
    f.state.guid = "recreated-after-validation";
    expect(await f.service.saveAndConnect(profile)).toMatchObject({ code: "ECURRENT_LOCAL_TARGET" });
    expect(f.state.admitted).toBe(false); expect(f.secureConfig.save).not.toHaveBeenCalled();
    expect(f.manager.pool).toBeNull(); expect(f.old.pending).toBe("unsent-old-sale");
  });
  it("validates schema and inspects identity on the same temporary pool and rechecks the actual opened pool", async () => {
    const f = fixture(); const schemaPools: unknown[] = [];
    f.validator.mockImplementation(async (...args: unknown[]) => {
      const [manager, value] = args as [{ temporary: (profile: unknown, database: string, work: (pool: unknown) => Promise<unknown>) => Promise<unknown> }, typeof profile];
      await manager.temporary(value, value.database, async pool => { schemaPools.push(pool); });
      return { ok: true, ready: true };
    });
    await f.service.validate(profile);
    expect(schemaPools[0]).toBe(f.recoveryLocal.inspect.mock.calls[0][0]);
    expect(await f.service.saveAndConnect(profile)).toMatchObject({ ok: true });
    expect(schemaPools[1]).toBe(f.recoveryLocal.admit.mock.calls[0][0]);
    expect(f.recoveryLocal.admit.mock.calls[0][2].expectedDatabase).toEqual({ guid: "first-physical-guid", name: "POS_Local_Beta", server: "fixture-local" });
  });
  it.each(["schema", "timeout"])("refuses an opened target's %s failure without reclassifying it", async kind => {
    const f = fixture(); await f.service.validate(profile);
    f.validator.mockImplementationOnce(async () => kind === "schema" ? { ok: true, ready: false }
      : { ok: false, ready: false, code: "ETIMEOUT", error: "The schema check timed out." });
    expect(await f.service.saveAndConnect(profile)).toMatchObject({ code: kind === "schema" ? "ECURRENT_LOCAL_SCHEMA" : "ETIMEOUT" });
    expect(f.recoveryLocal.admit).not.toHaveBeenCalled(); expect(f.secureConfig.save).not.toHaveBeenCalled();
  });
  it("invalidates a pending physical validation proof when the local connection is changed", async () => {
    const f = fixture(); await f.service.validate(profile); await f.service.disconnect();
    expect(await f.service.saveAndConnect(profile)).toMatchObject({ code: "EVALIDATION_REQUIRED" });
    expect(f.recoveryLocal.admit).not.toHaveBeenCalled(); expect(f.secureConfig.save).not.toHaveBeenCalled();
  });
  it("verifies SQL authentication while the active connection manager keeps its password redacted", async () => {
    const f = fixture(), sqlProfile = { ...profile, authMode: "sql", username: "fixture-user", password: "fixture-only-password" };
    expect(await f.service.validate(sqlProfile)).toMatchObject({ ok: true });
    expect(await f.service.saveAndConnect(sqlProfile)).toMatchObject({ ok: true });
    expect(f.manager.profile?.password).toBeUndefined();
    expect(f.service.snapshot()).toMatchObject({ connected: true, tradingReady: true });
    expect(f.recoveryLocal.assertPool.mock.calls[0][1]).toMatchObject({ password: "fixture-only-password" });
  });

  it.each(["unverified replacement", "populated target"])("keeps %s held", async kind => {
    const f = fixture(); session.grant("admin", "fixture-admin", {}, "pos", "fixture-branch");
    if (kind === "unverified replacement") f.state.context = false; else f.state.populated = true;
    expect(await f.call("database:validate", profile)).toMatchObject({ ok: false });
    expect(await f.service.saveAndConnect(profile)).toMatchObject({ ok: false });
    expect(f.recoveryLocal.admit).not.toHaveBeenCalled(); expect(f.secureConfig.save).not.toHaveBeenCalled();
    expect(f.service.snapshot()).toMatchObject({ localRecoveryPending: true, tradingReady: false });
  });

  it("restores the same admitted physical database after it contains new pending work", async () => {
    const f = fixture(); await f.service.validate(profile); await f.service.saveAndConnect(profile);
    f.state.populated = true; await f.manager.close(); const restarted = f.makeService();
    expect(restarted.snapshot()).toMatchObject({ localRecoveryPending: true });
    expect(await restarted.restore()).toMatchObject({ connected: true, tradingReady: true });
    expect(f.recoveryLocal.admit).toHaveBeenCalledOnce(); expect(f.recoveryLocal.inspect).toHaveBeenCalledOnce();
    expect(f.recoveryLocal.assertPool).toHaveBeenCalled(); expect(f.old.pending).toBe("unsent-old-sale");
  });
  it("shows admitted startup progress while deferred physical verification still blocks local readiness", async () => {
    const f = fixture(); await f.service.validate(profile); await f.service.saveAndConnect(profile); await f.manager.close();
    let finish!: () => void;
    const physicalCheck = new Promise<{ ok: boolean }>(resolve => { finish = () => resolve({ ok: true }); });
    f.recoveryLocal.assertPool.mockImplementationOnce(async () => physicalCheck);
    const restarted = f.makeService();
    expect(restarted.snapshot()).toMatchObject({ state: "enabled_connecting", enabled: true,
      connected: false, tradingReady: false, localRecoveryPending: true });
    const restoring = restarted.restore();
    await vi.waitFor(() => expect(f.recoveryLocal.assertPool).toHaveBeenCalledTimes(2));
    expect(restarted.snapshot()).toMatchObject({ state: "enabled_connecting", enabled: true,
      connected: false, tradingReady: false, localRecoveryPending: true, detail: { phase: "verifying_current_target" } });
    finish(); expect(await restoring).toMatchObject({ connected: true, tradingReady: true });
  });
  it("keeps a valid operator-disabled admitted target in normal online mode without clearing retained guards", async () => {
    const f = fixture(); session.grant("admin", "fixture-admin", {}, "pos", "fixture-branch");
    await f.service.validate(profile); await f.service.saveAndConnect(profile);
    expect(await f.service.setEnabled(false)).toMatchObject({ state: "disabled", enabled: false,
      configured: true, connected: false, tradingReady: false, retainedLocalRecoveryPending: true });
    expect(f.service.snapshot().localRecoveryPending).not.toBe(true);
    expect(f.recoveryLocal.pending()).toBe(true);
    expect(await f.call("config:set", "localDatabaseEnabled", true)).toMatchObject({ code: "ELOCAL_RECOVERY_PENDING" });
    expect(await f.service.setEnabled(true)).toMatchObject({ connected: true, tradingReady: true });
    expect(f.old.pending).toBe("unsent-old-sale");
    await f.service.setEnabled(false); f.state.context = false;
    expect(f.service.snapshot()).toMatchObject({ state: "disabled", enabled: false, localRecoveryPending: true });
  });
  it("migrates an admitted target on its immediately reverified live pool rather than a new profile pool", async () => {
    const f = fixture(); await f.service.validate(profile); await f.service.saveAndConnect(profile); await f.manager.close();
    f.validator.mockImplementationOnce(async () => ({ ok: true, ready: false, status: "migration_required", migrationHistoryPresent: true }));
    const mutationPools: unknown[] = [];
    f.migrate.mockImplementationOnce(async (...args: unknown[]) => {
      expect(args).toEqual([null]); mutationPools.push(f.manager.pool);
      const checked = f.recoveryLocal.assertPool.mock.calls.at(-1)?.[0];
      expect(f.manager.pool).toBe(checked); return { ok: true };
    });
    expect(await f.makeService().restore()).toMatchObject({ connected: true, tradingReady: true });
    expect(f.migrate).toHaveBeenCalledWith(null); expect(mutationPools).toHaveLength(1);
    expect(mutationPools[0]).not.toBeNull();
  });
  it("revalidates a verified saved migration pool while trading readiness is temporarily suspended", async () => {
    const f = fixture(); await f.service.validate(profile); await f.service.saveAndConnect(profile);
    f.service.beginMigration();
    expect(f.service.snapshot()).toMatchObject({ state: "enabled_validating", tradingReady: false, localRecoveryPending: true });
    expect(await f.service.revalidateConnected()).toMatchObject({ state: "enabled_bootstrapping", connected: true, tradingReady: true });
    expect(f.service.snapshot().localRecoveryPending).not.toBe(true);
    expect(f.recoveryLocal.admit).toHaveBeenCalledOnce();
  });
  it("automatically reconnects an admitted target after its connection drops", async () => {
    const f = fixture(); await f.service.validate(profile); await f.service.saveAndConnect(profile);
    f.state.populated = true; await f.manager.close();
    expect(f.service.snapshot()).toMatchObject({ localRecoveryPending: true, tradingReady: false });
    expect(f.service.canRestoreAdmitted()).toBe(true);
    expect(await f.service.restore({ reuseValidation: true })).toMatchObject({ connected: true, tradingReady: true });
    expect(f.recoveryLocal.admit).toHaveBeenCalledOnce();
  });
  it.each([true, false])("keeps automatic sync held and bounds a reconnect attempt when eligible=%s", async eligible => {
    const main = readFileSync("electron/main.cjs", "utf8"), start = main.indexOf("async function runAutomaticSync() {"), end = main.indexOf("function stopAutomaticSync()", start);
    const restore = vi.fn(async () => ({})), schedule = vi.fn();
    const run = new Function("databaseService", "recoverLocalDatabase", "scheduleAutomaticSync", "AUTO_SYNC_RETRY_MS", "recordFault",
      main.slice(start, end) + ";return runAutomaticSync;")({ snapshot: () => ({ localRecoveryPending: true }), canRestoreAdmitted: () => eligible }, restore, schedule, 60000, vi.fn());
    await run();
    expect(restore).toHaveBeenCalledTimes(eligible ? 1 : 0); expect(schedule).toHaveBeenCalledWith(60000);
  });

  it("refuses a same-name recreated database before schema validation, migration or bootstrap", async () => {
    const f = fixture(); await f.service.validate(profile); await f.service.saveAndConnect(profile); await f.manager.close();
    f.validator.mockClear(); f.prepare.mockClear(); f.state.guid = "replacement-physical-guid";
    const restarted = f.makeService();
    expect(await restarted.restore()).toMatchObject({ state: "enabled_error", enabled: true, connected: false,
      localRecoveryPending: true, tradingReady: false, detail: { code: "ECURRENT_LOCAL_TARGET" } });
    expect(f.validator).not.toHaveBeenCalled(); expect(f.migrate).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
    expect(f.state.admittedGuid).toBe("first-physical-guid"); expect(f.manager.pool).toBeNull();
    expect(restarted.canRestoreAdmitted()).toBe(false);
  });

  it("recovers a durable admission after the connection acknowledgement failed", async () => {
    const f = fixture(); await f.service.validate(profile); f.state.crashAfterAdmission = true;
    expect(await f.service.saveAndConnect(profile)).toMatchObject({ code: "ECURRENT_LOCAL_STORE" });
    expect(f.state.admitted).toBe(true); expect(f.manager.pool).toBeNull();
    f.state.crashAfterAdmission = false;
    expect(await f.makeService().restore()).toMatchObject({ connected: true, tradingReady: true });
    expect(f.recoveryLocal.admit).toHaveBeenCalledOnce();
  });

  it("preserves old configuration even after the new admitted target is ready", async () => {
    const f = fixture(); session.grant("admin", "fixture-admin", {}, "pos", "fixture-branch");
    await f.service.validate(profile); await f.service.saveAndConnect(profile);
    for (const [channel, args] of [
      ["config:set", ["localDatabaseProfile", profile]], ["config:set", [" localDatabaseEnabled ", true]],
      ["config:write", []], ["config:reset", []],
    ] as const) expect(await f.call(channel, ...args)).toMatchObject({ code: "ELOCAL_RECOVERY_PENDING" });
    expect(f.effects).not.toHaveBeenCalled(); expect(f.old.passwordBlob).toBe("old-sealed-secret");
  });

  it("does not let first admission invoke provisioning or migrations on an unverified target", async () => {
    const f = fixture(); session.grant("admin", "fixture-admin", {}, "pos", "fixture-branch");
    for (const channel of ["database:migrate", "database:provision-connect"])
      expect(await f.call(channel, profile)).toMatchObject({ code: "ELOCAL_RECOVERY_PENDING" });
    expect(f.effects).not.toHaveBeenCalled();
    await f.service.validate(profile); await f.service.saveAndConnect(profile);
    for (const channel of ["database:migrate", "database:provision-connect"])
      expect(await f.call(channel, profile)).toMatchObject({ code: "ELOCAL_RECOVERY_PENDING" });
    expect(f.effects).not.toHaveBeenCalled();
  });

  it("reinstates the hold if the active proof or pool context changes", async () => {
    const f = fixture(); await f.service.validate(profile); await f.service.saveAndConnect(profile);
    f.state.context = false;
    expect(f.service.markReady()).toMatchObject({ localRecoveryPending: true, tradingReady: false });
    expect(await f.call("business:query")).toMatchObject({ code: "ELOCAL_RECOVERY_PENDING" });
    expect(f.old.pending).toBe("unsent-old-sale");
  });
});
