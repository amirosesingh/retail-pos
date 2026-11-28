import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const policy = require("../../../../electron/verified-activation.cjs");
const { createTerminalOnlineRecovery } = require("../../../../electron/terminal-online-recovery.cjs");
const { createTerminalRepair } = require("../../../../electron/terminal-repair.cjs");
const { DatabaseService } = require("../../../../electron/db/service.cjs");
const privilege = require("../../../../electron/ipc-privilege.cjs");
const session = require("../../../../electron/admin-session.cjs");
const ipcGuard = require("../../../../electron/ipc-guard.cjs");
const { WriteBarrier } = require("../../../../electron/sync/write-barrier.cjs");
const { RecoveryMetadataGate } = require("../../../../electron/db/shift-recovery-metadata.cjs");
const source = readFileSync(new URL("../../../../electron/main.cjs", import.meta.url), "utf8");
const old = { tokenId: "10000000-0000-4000-8000-000000000001", deviceType: "pc", deviceUse: "operations", locationId: "branch-a" };
const target = { ...old, tokenId: "10000000-0000-4000-8000-000000000002", deviceBindingProof: "a".repeat(64),
  supabaseUrl: "https://fixture-project.invalid", supabaseKey: "fixture-public", backendUrl: "https://fixture-backend.invalid" };
const evidence = { sealed: "retained-cipher", plain: "retained-plain", key: "retained-key" };
const folders: string[] = [];

function fixture(savedProfile: object | null = null) {
  const folder = mkdtempSync(join(tmpdir(), "pos-online-registration-")); folders.push(folder);
  let active: typeof target | null = null, previous: typeof old | null = old, connected = false, closing = false, busy = false;
  const values = new Map<string, unknown>([["backendUrl", target.backendUrl], ["localDatabaseProfile", savedProfile], ["localDatabaseEnabled", savedProfile ? true : null]]);
  const config = { getStrict: vi.fn((key: string) => values.get(key) ?? null), get: (key: string) => values.get(key) ?? null,
    set: vi.fn((key: string, value: unknown) => { values.set(key, value); return { ok: true }; }) };
  const cloud = { read: vi.fn(() => ({ url: target.supabaseUrl, key: target.supabaseKey })) };
  const terminal = { read: vi.fn(() => active), lastBinding: vi.fn(() => previous), wasProvisioned: () => true,
    write: vi.fn((config: typeof target) => { active = config; previous = config; return { ok: true }; }) };
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from("sealed:" + value),
    decryptString: (bytes: Buffer) => { if (!bytes.toString().startsWith("sealed:")) throw Error("unreadable fixture"); return bytes.toString().slice(7); } };
  const recovery = createTerminalOnlineRecovery({ app: { getPath: () => folder }, safeStorage, configStore: config,
    terminalStore: terminal, activationBoundary: policy, cloudCredentials: cloud });
  const manager = { pool: null as object | null, profile: savedProfile, isConnected: () => connected,
    open: vi.fn(async () => { throw Error("unexpected local connection"); }),
    close: vi.fn(async () => { manager.pool = null; connected = false; }) };
  const secureConfig = { enabled: () => values.get("localDatabaseEnabled") === true, profile: () => savedProfile,
    credentials: vi.fn(() => savedProfile), setEnabled: vi.fn(), save: vi.fn() };
  const validate = vi.fn(), migrate = vi.fn();
  const service = new DatabaseService({ secureConfig, manager, validator: validate, migrate,
    localRecoveryPending: () => recovery.pending() });
  const barrier = new WriteBarrier(), metadata = new RecoveryMetadataGate();
  const currentLocalAdmission = { present: false };
  let afterHold: (() => Promise<void>) | null = null;
  const runtime = createTerminalRepair({ terminalStore: terminal, activationBoundary: policy, adminSession: session,
    databaseManager: manager, databaseConfig: secureConfig, cloudCredentials: cloud, configStore: config,
    onlineRecovery: recovery, withExclusive: async (work: () => Promise<unknown>) => work(),
    assertNoCurrentLocalAdmission: () => { if (currentLocalAdmission.present) throw Object.assign(new Error("Keep the admitted current local setup."), { code: "ECURRENT_LOCAL_RETAINED" }); },
    canCheck: () => !closing && !barrier.sealed, onlineBusy: () => busy || metadata.control.size > 1,
    onOnlineHold: async () => { service.holdLocalRecovery(); await afterHold?.(); } });
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  const ipc = { handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, listener) };
  privilege.install(ipc, { isFirstRun: () => false, isLocalRecoveryPending: () => recovery.pending(),
    writeBarrier: { run: (work: () => Promise<unknown>) => metadata.run(() => barrier.run(work)) } });
  metadata.install(ipc);
  const sender = { mainFrame: {} }, event = { sender, senderFrame: sender.mainFrame };
  const apiStart = source.indexOf('  ipcMain.handle("terminal:repair-status",'), apiEnd = source.indexOf('  ipcMain.handle("terminal:restore",', apiStart);
  new Function("ipcMain", "mainWindow", "terminalRepair", source.slice(apiStart, apiEnd))(ipc, { webContents: sender }, runtime);
  const readStart=source.indexOf('  ipcMain.handle("terminal:read",');
  const readEnd=source.indexOf('  ipcMain.handle("terminal:write",',readStart);
  new Function("ipcMain","terminalStore",source.slice(readStart,readEnd))(ipc,terminal);
  const descriptor = { id: target.tokenId, platform: "pc", mode: "operations", branchId: target.locationId };
  const response = { approved: true, status: "used", supabaseUrl: target.supabaseUrl, terminal: descriptor };
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => response }));
  const verifyStart = source.indexOf("async function verifiedTerminalMirror("), verifyEnd = source.indexOf("function stampVerifiedBranchOperations(", verifyStart);
  const verify = new Function("terminalStore", "activationBoundary", "authorizationServerUrl", "cloudCredentials", "fetch", "AbortSignal",
    source.slice(verifyStart, verifyEnd) + ";return verifiedTerminalMirror;")(terminal, policy, () => values.get("backendUrl"), cloud, fetcher, AbortSignal);
  const legacyCheck = vi.fn(async () => { throw Error("unverified local database must not be queried"); });
  const writeStart = source.indexOf('  ipcMain.handle("terminal:write",'), writeEnd = source.indexOf('  ipcMain.handle("terminal:repair-status",', writeStart);
  new Function("ipcMain", "terminalStore", "verifiedTerminalMirror", "guard", "activationBoundary", "assertSafeRegistrationChange", "terminalRepair", "configStore", "recordRegistrationChange", "isManagementDevice", "syncCoordinator", "scheduleAutomaticSync", "terminalOnlineRecovery",
    `let terminalIdentityPausedSync=false;${source.slice(writeStart, writeEnd)}`)(ipc, terminal, verify,
      { terminalConfig: (value: unknown) => value, refuse: (error: string) => ({ ok: false, error }) }, policy, legacyCheck, runtime, config,
      vi.fn(), () => false, { resume: vi.fn() }, vi.fn(), recovery);
  const localEffect = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: true }));
  for (const channel of ["database:save-connect", "database:set-enabled", "database:restore", "sqladmin:execute", "local:mirror", "business:commit-aggregate", "db:write", "staff:login", "sync:resume", "pos:push", "receipts:refund", "config:reset", "config:write", "config:set"])
    ipc.handle(channel, localEffect);
  ipc.handle("database:get-state", async () => service.snapshot());
  const probeQuery = vi.fn(async () => ({ recordset: [
    { name: "master", state_desc: "ONLINE", compatibility_level: 170 },
    { name: "POS_Local_Beta", state_desc: "ONLINE", compatibility_level: 170 },
  ] }));
  const probeManager = Object.assign(manager, {
    testServer: vi.fn(async () => ({ ok: true, version: "17.fixture" })),
    temporary: vi.fn(async (_profile: unknown, _database: string, work: (pool: unknown) => Promise<unknown>) =>
      work({ request: () => ({ query: probeQuery }) })),
  });
  const discoverServers = vi.fn(async () => ({ ok: true, servers: [{ host: "localhost" }] }));
  const discoveryStart = source.indexOf('  ipcMain.handle("database:list-servers",');
  const discoveryEnd = source.indexOf('  ipcMain.handle("database:validate",', discoveryStart);
  new Function("ipcMain", "discoverLocalSqlServers", "guard", "observedDatabaseOperation", "databaseService",
    source.slice(discoveryStart, discoveryEnd))(ipc, discoverServers, ipcGuard,
      (_kind: string, _action: string, work: () => Promise<unknown>) => work(), service);
  return { folder, values, config, cloud, terminal, manager, recovery, runtime, service, validate, migrate, secureConfig, barrier,
    discoverServers, probeManager, probeQuery, currentLocalAdmission,
    event, response, fetcher, legacyCheck, localEffect, call: (channel: string, ...args: unknown[]) => handlers.get(channel)!(event, ...args),
    continue: (otherEvent: unknown = event) => handlers.get("terminal:repair-continue-online")!(otherEvent, evidence),
    connected: (value: boolean) => { connected = value; }, busy: (value: boolean) => { busy = value; },
    closing: (value: boolean) => { closing = value; }, afterHold: (value: () => Promise<void>) => { afterHold = value; },
    loseNative: () => { active = null; } };
}

beforeEach(() => { session.clear(); session.clearRecovery(); });
afterEach(() => {
  session.clear(); session.clearRecovery();
  for (const folder of folders.splice(0)) {
    if (!resolve(folder).startsWith(resolve(tmpdir()) + "\\pos-online-registration-") && !resolve(folder).startsWith(resolve(tmpdir()) + "/pos-online-registration-")) throw Error("unexpected fixture cleanup path");
    rmSync(folder, { recursive: true, force: true });
  }
});

describe("online re-registration through actual native handlers", () => {
  it("classifies historical provisioning before a missing configuration can become a fresh hosted claim",async()=>{
    const f=fixture();
    expect(await f.call("terminal:read")).toMatchObject({ok:true,config:null,recoveryRequired:true});
    f.terminal.wasProvisioned=()=>false;f.terminal.lastBinding.mockReturnValue(null);
    expect(await f.call("terminal:read")).toMatchObject({ok:true,config:null,recoveryRequired:false});
  });
  it("keeps an unreadable historical marker unknown rather than granting fresh activation",async()=>{
    const f=fixture();f.terminal.lastBinding.mockImplementation(()=>{throw Error("fixture private marker detail");});
    expect(await f.call("terminal:read")).toMatchObject({ok:false,code:"EACTIVATION_STORE"});
    expect(JSON.stringify(await f.call("terminal:read"))).not.toContain("private marker");
  });
  it("unblocks a missing SQL profile only after explicit protected online recovery and confirms native persistence", async () => {
    const f = fixture(); session.grantRecovery();
    expect(await f.call("terminal:repair-status")).toMatchObject({ code: "EACTIVATION_REPAIR_DATABASE_UNKNOWN" });
    expect(await f.continue()).toEqual({ ok: true, ready: true, mode: "online", localRecoveryPending: true });
    expect(await f.call("terminal:repair-status")).toEqual({ ok: true, ready: true, mode: "online", localRecoveryPending: true });
    expect(f.recovery.read()).toMatchObject({ previous: { raw: old }, source: { profile: null, enabled: null }, evidence });
    expect(await f.call("terminal:write", target)).toEqual({ ok: true });
    expect(f.terminal.read()).toMatchObject(target);
    expect(f.recovery.read()).toMatchObject({ previous: { raw: old }, replacement: { binding: policy.binding(target) } });
    expect(f.legacyCheck).not.toHaveBeenCalled(); expect(f.manager.open).not.toHaveBeenCalled();
    expect(session.hasPosAuthority()).toBe(false);
  });
  it("preserves an unavailable saved SQL target and its previous enablement instead of treating its queues as empty", async () => {
    const profile = { host: "prior-fixture", database: "prior-pos", authMode: "windows" };
    const f = fixture(profile); session.grantRecovery();
    expect(await f.continue()).toMatchObject({ ready: true });
    expect(f.recovery.read().source).toMatchObject({ profile, enabled: true });
    expect(f.values.get("localDatabaseProfile")).toEqual(profile);
    expect(f.values.get("localDatabaseEnabled")).toBe(false);
    expect(f.manager.open).not.toHaveBeenCalled(); expect(f.legacyCheck).not.toHaveBeenCalled();
  });
  it("refuses an unverified direct replacement that did not choose online recovery", async () => {
    const f = fixture(); session.grantRecovery();
    expect(await f.call("terminal:write", target)).toMatchObject({ ok: false });
    expect(f.terminal.write).not.toHaveBeenCalled(); expect(f.recovery.pending()).toBe(false);
  });
  it.each(["signed-out", "foreign-window", "subframe", "closing", "busy", "connected"])("refuses %s online recovery without changing saved state", async kind => {
    const f = fixture(); if (kind !== "signed-out") session.grantRecovery();
    if (kind === "closing") await f.barrier.sealAndDrain();
    if (kind === "busy") f.busy(true);
    if (kind === "connected") f.connected(true);
    const event = kind === "foreign-window" ? { sender: { mainFrame: {} }, senderFrame: {} }
      : kind === "subframe" ? { ...f.event, senderFrame: {} } : f.event;
    expect(await f.continue(event)).toMatchObject({ ok: false });
    expect(f.recovery.pending()).toBe(false); expect(f.terminal.write).not.toHaveBeenCalled();
  });
  it("keeps the durable hold but denies readiness if authorization expires after saving it", async () => {
    const f = fixture(); session.grantRecovery(); f.afterHold(async () => { session.clearRecovery(); });
    expect(await f.continue()).toMatchObject({ ok: false, code: "EPRIVILEGE" });
    expect(f.recovery.pending()).toBe(true); expect(f.terminal.write).not.toHaveBeenCalled();
    f.afterHold(async () => {}); session.grantRecovery(); expect(await f.continue()).toMatchObject({ ready: true });
  });
  it("waits for an already accepted SQL control operation before preserving setup or changing registration", async () => {
    const f=fixture();session.grantRecovery();
    let finish!:()=>void;
    f.localEffect.mockImplementationOnce(()=>new Promise<void>(done=>{finish=done;}));
    const accepted=f.call("database:save-connect");
    await Promise.resolve();
    expect(await f.continue()).toMatchObject({ok:false,code:"EACTIVATION_REPAIR_ONLINE_BUSY"});
    expect(f.recovery.pending()).toBe(false);
    finish();await accepted;
    expect(await f.continue()).toMatchObject({ok:true,ready:true});
  });
  it.each(["project", "descriptor", "revoked"])("refuses hosted %s mismatch before binding or saving a replacement", async kind => {
    const f = fixture(); session.grantRecovery(); await f.continue();
    if (kind === "project") f.response.supabaseUrl = "https://wrong-project.invalid";
    if (kind === "descriptor") f.response.terminal.branchId = "other-branch";
    if (kind === "revoked") f.response.status = "revoked";
    expect(await f.call("terminal:write", target)).toMatchObject({ ok: false });
    expect(f.terminal.write).not.toHaveBeenCalled(); expect(f.recovery.read().replacement).toBeNull();
  });
  it("keeps SQL held across restart and ignores attempts to reopen it or publish local readiness", async () => {
    const f = fixture({ host: "prior-fixture", database: "prior-pos", authMode: "windows" }); session.grantRecovery();
    await f.continue(); await f.call("terminal:write", target);
    const restarted = new DatabaseService({ secureConfig: f.secureConfig, manager: f.manager, validator: f.validate, migrate: f.migrate,
      localRecoveryPending: () => f.recovery.pending() });
    expect(await restarted.restore()).toMatchObject({ enabled: false, connected: false, tradingReady: false, localRecoveryPending: true });
    expect(await restarted.saveAndConnect({})).toMatchObject({ code: "ELOCAL_RECOVERY_PENDING" });
    expect(restarted.markReady()).toMatchObject({ tradingReady: false, localRecoveryPending: true });
    expect(f.manager.open).not.toHaveBeenCalled(); expect(f.validate).not.toHaveBeenCalled(); expect(f.migrate).not.toHaveBeenCalled();
  });
  it("denies local SQL/business/configuration entrypoints even for an adopted administrator", async () => {
    const f = fixture(); session.grantRecovery(); await f.continue();
    session.grant("admin", "fixture-admin", {}, "pos", "branch-a");
    for (const channel of ["database:save-connect", "database:set-enabled", "database:restore", "sqladmin:execute", "local:mirror", "business:commit-aggregate", "db:write", "staff:login", "sync:resume", "pos:push", "receipts:refund", "config:reset", "config:write"])
      expect(await f.call(channel)).toMatchObject({ ok: false, code: "ELOCAL_RECOVERY_PENDING" });
    expect(await f.call("config:set", "localDatabaseEnabled", true)).toMatchObject({ code: "ELOCAL_RECOVERY_PENDING" });
    expect(await f.call("config:set", " localDatabaseEnabled ", true)).toMatchObject({ code: "ELOCAL_RECOVERY_PENDING" });
    expect(f.localEffect).not.toHaveBeenCalled();
    expect(await f.call("database:get-state")).toMatchObject({ localRecoveryPending: true });
  });
  it("allows read-only discovery through actual Main handlers while preserving the sealed recovery hold", async () => {
    const f = fixture({ host: "prior-fixture", database: "prior-pos", authMode: "windows" });
    session.grantRecovery(); await f.continue(); session.clearRecovery();
    const record = readFileSync(join(f.folder, "terminal-online-recovery.bin"));
    const settings = new Map(f.values);
    const profile = { host: "localhost", port: 1433, database: "POS_Local_Beta", authMode: "windows",
      username: "", password: "", encrypt: true, trustServerCertificate: false,
      connectionTimeoutMs: 5000, requestTimeoutMs: 5000 };
    expect(await f.call("database:list-servers")).toMatchObject({ ok: true, servers: [{ host: "localhost" }] });
    expect(await f.call("database:test-server", profile)).toMatchObject({ ok: true, version: "17.fixture" });
    expect(await f.call("database:list-databases", profile)).toMatchObject({ ok: true, databases: [{ name: "POS_Local_Beta" }] });
    expect(f.probeManager.temporary).toHaveBeenCalledOnce();
    expect(f.probeManager.temporary.mock.calls[0][1]).toBe("master");
    expect(f.probeQuery).toHaveBeenCalledOnce();
    expect(f.values).toEqual(settings);
    expect(readFileSync(join(f.folder, "terminal-online-recovery.bin"))).toEqual(record);
    expect(f.recovery.pending()).toBe(true);
    expect(f.service.snapshot()).toMatchObject({ connected: false, tradingReady: false, localRecoveryPending: true });
    expect(f.manager.open).not.toHaveBeenCalled(); expect(f.secureConfig.save).not.toHaveBeenCalled();
    expect(f.validate).not.toHaveBeenCalled(); expect(f.migrate).not.toHaveBeenCalled();
    expect(await f.call("database:save-connect", profile)).toMatchObject({ code: "ELOCAL_RECOVERY_PENDING" });
    expect(f.localEffect).not.toHaveBeenCalled();
    expect(session.status()).toMatchObject({ unlocked: false });
  });
  it.each(["database:test-server", "database:list-databases"])("keeps %s profile validation while recovery is held", async channel => {
    const f = fixture(); session.grantRecovery(); await f.continue(); session.clearRecovery();
    expect(await f.call(channel, { authMode: "invalid" })).toMatchObject({ ok: false, code: "EBADARG" });
    expect(f.probeManager.testServer).not.toHaveBeenCalled(); expect(f.probeManager.temporary).not.toHaveBeenCalled();
    expect(f.recovery.pending()).toBe(true); expect(f.manager.open).not.toHaveBeenCalled();
  });
  it("requires explicit append-preserving continuation for later re-registration instead of consuming another token first", async () => {
    const f=fixture();session.grantRecovery();
    await f.continue();await f.call("terminal:write",target);f.loseNative();
    expect(await f.call("terminal:repair-status")).toMatchObject({ok:false,code:"EACTIVATION_REPAIR_ONLINE_TARGET"});
    expect(f.recovery.read().attempts).toHaveLength(0);
    expect(await f.continue()).toMatchObject({ok:true,ready:true});
    const later={...target,tokenId:"10000000-0000-4000-8000-000000000003"};
    f.response.terminal.id=later.tokenId;
    expect(await f.call("terminal:write",later)).toEqual({ok:true});
    const retained=f.recovery.read();
    expect(retained.previous.raw).toEqual(old);
    expect(retained.attempts).toHaveLength(1);
    expect(retained.attempts[0].replacement.binding.id).toBe(target.tokenId);
    expect(retained.replacement.binding.id).toBe(later.tokenId);
    expect(f.legacyCheck).not.toHaveBeenCalled();
  });
  it("does not allow later re-registration to ignore an admitted current local database", async () => {
    const f = fixture(); session.grantRecovery();
    await f.continue(); await f.call("terminal:write", target);
    f.currentLocalAdmission.present = true; f.loseNative();
    const retained = readFileSync(join(f.folder, "terminal-online-recovery.bin"));
    expect(await f.call("terminal:repair-status")).toMatchObject({ ok: false, code: "EACTIVATION_REPAIR_CURRENT_LOCAL" });
    expect(await f.continue()).toMatchObject({ ok: false, code: "EACTIVATION_REPAIR_CURRENT_LOCAL" });
    expect(readFileSync(join(f.folder, "terminal-online-recovery.bin"))).toEqual(retained);
    expect(f.recovery.read().attempts).toHaveLength(0); expect(f.terminal.write).toHaveBeenCalledOnce();
  });
});
