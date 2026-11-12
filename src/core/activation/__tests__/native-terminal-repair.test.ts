import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createTerminalRepair } = require("../../../../electron/terminal-repair.cjs");
const activationBoundary = require("../../../../electron/verified-activation.cjs");
const privilege = require("../../../../electron/ipc-privilege.cjs");
const session = require("../../../../electron/admin-session.cjs");
const { WriteBarrier } = require("../../../../electron/sync/write-barrier.cjs");
const { RecoveryMetadataGate } = require("../../../../electron/db/shift-recovery-metadata.cjs");
const main = readFileSync(new URL("../../../../electron/main.cjs", import.meta.url), "utf8");
const old = { tokenId: "old-fixture-terminal", deviceType: "pc", deviceUse: "operations", locationId: "branch-a" };
const next = { ...old, tokenId: "new-fixture-terminal" };
const savedProfile = { host: "fixture-local", instanceName: "SQLEXPRESS", port: 0, database: "retained-pos", authMode: "windows" };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

function fixture() {
  let active: object | null = null, previous: object | null = old, provisioned = true, closing = false;
  let profile: object | null = { ...savedProfile }, backend = "https://fixture.invalid";
  let databaseMatch = 1, journal = 0, conflicts = 0, shifts = 0, visible = 1;
  const schema: Record<string, number | null> = {};
  for (let i = 0; i < 7; i++) schema[`object_${i}`] = schema[`table_${i}`] = null;
  const pending = { intents: false, legacy: false, sales: false };
  let pause: Promise<void> | null = null;
  const query = vi.fn(async (text: string) => {
    if (pause) await pause;
    if (text.includes("matches_profile")) return { recordsets: [[{ matches_profile: databaseMatch, journal_pending: journal, conflict_pending: conflicts, shift_pending: shifts }], [{ metadata_visible: visible, ...schema }]] };
    const present = text.includes("FROM dbo.pos_sync_shift_intents") ? pending.intents : text.includes("FROM dbo.pos_sync_shift_legacy_recoveries") ? pending.legacy : pending.sales;
    return { recordset: present ? [{ pending: 1 }] : [] };
  });
  const input = vi.fn();
  const pool = { request: () => { const request = { query, input: (...args: unknown[]) => { input(...args); return request; } }; return request; } };
  const manager = {
    pool: pool as typeof pool | null, profile: { ...savedProfile } as object | null,
    isConnected: () => Boolean(manager.pool),
    open: vi.fn(async (credentials: typeof savedProfile) => { manager.pool = pool; manager.profile = { ...credentials }; return pool; }),
  };
  const terminalStore = {
    read: vi.fn((_options?: { strict: boolean }) => active), lastBinding: vi.fn((_options?: { strict: boolean }) => previous),
    wasProvisioned: () => provisioned, write: vi.fn((value: object) => { active=value;previous=value;provisioned=true;return { ok: true }; }),
  };
  const configStore = { getStrict: vi.fn((key: string) => key === "localDatabaseProfile" ? profile : backend), set: vi.fn(), get: vi.fn(() => backend) };
  const credentials = vi.fn(() => profile ? { ...profile, password: "fixture-secret" } : null);
  const runtime = createTerminalRepair({ terminalStore, activationBoundary, adminSession: session, databaseManager: manager,
    databaseConfig: { credentials }, cloudCredentials: { read: vi.fn(() => ({ url: "https://fixture-db.invalid", key: "fixture-publishable" })) },
    configStore, withExclusive: async (work: () => Promise<unknown>) => work(), canCheck: () => !closing,
  });
  const handlers = new Map<string, (event: unknown, raw?: unknown) => unknown>();
  const ipcMain = { handle: (name: string, handler: (event: unknown, raw?: unknown) => unknown) => handlers.set(name, handler) };
  const barrier = new WriteBarrier(), metadata = new RecoveryMetadataGate();
  privilege.install(ipcMain, { isFirstRun: () => !provisioned, isManagementDevice: () => false,
    writeBarrier: { run: (work: () => unknown) => metadata.run(() => barrier.run(work)) } });
  metadata.install(ipcMain);
  const sender = { mainFrame: {} }, event = { sender, senderFrame: sender.mainFrame };
  const start = main.indexOf('  ipcMain.handle("terminal:repair-status",'), end = main.indexOf('  ipcMain.handle("terminal:restore",', start);
  new Function("ipcMain", "mainWindow", "terminalRepair", main.slice(start, end))(ipcMain, { webContents: sender }, runtime);
  const safeStart = main.indexOf("async function assertSafeRegistrationChange("), safeEnd = main.indexOf("function recordRegistrationChange(", safeStart);
  const assertSafe = new Function("terminalStore", "activationBoundary", "adminSession", "databaseManager", "legacyRecoveryRuntime", "conflictRepository", "syncCoordinator", "require",
    main.slice(safeStart, safeEnd) + ";return assertSafeRegistrationChange;")(terminalStore, activationBoundary, session, manager,
      { reader: { pendingSummary: async () => ({ pending: journal, failed: 0 }) } }, { unresolved: async () => conflicts ? [{}] : [] },
      { withExclusive: async (work: () => Promise<unknown>) => work() }, (name: string) => require(`../../../../electron/${name.slice(2)}`));
  const writeStart = main.indexOf('  ipcMain.handle("terminal:write",'), writeEnd = main.indexOf('  ipcMain.handle("terminal:repair-status",', writeStart);
  new Function("ipcMain", "terminalStore", "verifiedTerminalMirror", "guard", "activationBoundary", "assertSafeRegistrationChange", "terminalRepair", "configStore", "recordRegistrationChange", "isManagementDevice", "syncCoordinator", "scheduleAutomaticSync", "terminalOnlineRecovery",
    `let terminalIdentityPausedSync=false;${main.slice(writeStart, writeEnd)}`)(ipcMain, terminalStore, async (value: unknown) => value,
      { terminalConfig: (value: unknown) => value, refuse: (error: string) => ({ ok: false, error }) }, activationBoundary, assertSafe, runtime, configStore,
      vi.fn(), () => false, { resume: vi.fn() }, vi.fn(), {pending:()=>false});
  return {
    runtime, terminalStore, configStore, credentials, manager, query, input, pool, schema, pending, barrier, metadata, event,
    status: (source: unknown = event) => handlers.get("terminal:repair-status")!(source),
    connect: (source: unknown = event) => handlers.get("terminal:repair-connect-database")!(source),
    write: (value: unknown = next) => handlers.get("terminal:write")!(event, value),
    active: (value: object | null) => { active = value; }, previous: (value: object | null) => { previous = value; },
    provisioned: (value: boolean) => { provisioned = value; }, profile: (value: object | null) => { profile = value; },
    cloudBackend: (value: string) => { backend = value; }, closing: (value: boolean) => { closing = value; },
    databaseMatch: (value: number) => { databaseMatch = value; }, journal: (value: number) => { journal = value; },
    conflicts: (value: number) => { conflicts = value; }, shifts: (value: number) => { shifts = value; }, visible: (value: number) => { visible = value; },
    pause: (value: Promise<void> | null) => { pause = value; },
    tables: (...indices: number[]) => { for (const index of indices) schema[`object_${index}`] = schema[`table_${index}`] = index + 1; },
  };
}

beforeEach(() => { session.clear(); session.clearRecovery(); });
afterEach(() => { session.clear(); session.clearRecovery(); vi.useRealTimers(); });

describe("Emergency Access native repair prerequisites through installed IPC wrappers", () => {
  it("denies signed-out, first-run, foreign-window and subframe callers", async () => {
    const f = fixture();
    expect(await f.status()).toMatchObject({ ok: false, code: "EPRIVILEGE" });
    f.provisioned(false);
    expect(await f.status()).toMatchObject({ ok: false, code: "EPRIVILEGE" });
    session.grantRecovery();
    expect(await f.status({ sender: {}, senderFrame: {} })).toMatchObject({ ok: false, code: "EPRIVILEGE" });
    expect(await f.connect({ sender: f.event.sender, senderFrame: {} })).toMatchObject({ ok: false, code: "EPRIVILEGE" });
    expect(f.query).not.toHaveBeenCalled(); expect(f.manager.open).not.toHaveBeenCalled();
  });
  it("permits a verified recovery or administrator to check readable clear saved work without writes", async () => {
    const f = fixture(); session.grantRecovery();
    expect(await f.status()).toEqual({ ok: true, ready: true });
    expect(f.terminalStore.read).toHaveBeenCalledWith({ strict: true });
    expect(f.terminalStore.lastBinding).toHaveBeenCalledWith({ strict: true });
    expect(f.terminalStore.write).not.toHaveBeenCalled(); expect(f.configStore.set).not.toHaveBeenCalled();
    expect(f.query.mock.calls.every(([query]) => !/\b(?:UPDATE|DELETE|INSERT|CREATE|ALTER|EXEC)\b/i.test(query))).toBe(true);
    expect(session.hasPosAuthority()).toBe(false);
    session.clearRecovery(); session.grant("admin", "fixture", {}, "pos");
    expect(await f.status()).toEqual({ ok: true, ready: true });
  });
  it.each(["native", "marker", "profile"])("holds unreadable %s storage with no mutation", async store => {
    const f = fixture(); session.grantRecovery();
    const bad = () => { throw Error("private credential detail"); };
    if (store === "native") f.terminalStore.read.mockImplementation(bad);
    if (store === "marker") f.terminalStore.lastBinding.mockImplementation(bad);
    if (store === "profile") f.configStore.getStrict.mockImplementation(bad);
    const result = await f.status();
    expect(result).toMatchObject({ ok: false, code: "EACTIVATION_REPAIR_STORE" });
    expect(JSON.stringify(result)).not.toContain("private"); expect(f.query).not.toHaveBeenCalled();
  });
  it("keeps missing provisioned binding and missing saved SQL unknown, rather than fresh", async () => {
    const f = fixture(); session.grantRecovery(); f.previous(null);
    expect(await f.status()).toMatchObject({ ok: false, code: "EACTIVATION_REPAIR_STORE" });
    const g = fixture(); g.profile(null);
    expect(await g.connect()).toMatchObject({ ok: false, code: "EACTIVATION_REPAIR_DATABASE_UNKNOWN" });
    expect(g.manager.open).not.toHaveBeenCalled();
  });
  it("keeps existing native registration on the retry-original path", async () => {
    const f = fixture(); session.grantRecovery(); f.active(old);
    expect(await f.status()).toMatchObject({ code: "EACTIVATION_REPAIR_EXISTING" });
    expect(f.query).not.toHaveBeenCalled();
  });
  it("connects only the saved profile using existing credentials without save/migration/readiness grants", async () => {
    const f = fixture(); session.grantRecovery(); f.manager.pool = null; f.manager.profile = null;
    expect(await f.status()).toMatchObject({ code: "EACTIVATION_REPAIR_DATABASE", requiresLocalDatabase: true });
    expect(await f.connect()).toEqual({ ok: true, ready: true });
    expect(f.manager.open).toHaveBeenCalledExactlyOnceWith({ ...savedProfile, password: "fixture-secret" });
    expect(f.configStore.set).not.toHaveBeenCalled(); expect(f.terminalStore.write).not.toHaveBeenCalled();
    expect(session.hasPosAuthority()).toBe(false);
  });
  it.each(["expiry", "cloud", "closing"])("denies readiness after %s changes during saved SQL connection", async kind => {
    const f = fixture(); session.grantRecovery(); const wait = deferred(); f.manager.pool=null;f.manager.profile=null;
    f.manager.open.mockImplementationOnce(async credentials=>{
      await wait.promise;f.manager.pool=f.pool;f.manager.profile={...credentials};return f.pool;
    });
    const work=f.connect();await vi.waitFor(()=>expect(f.manager.open).toHaveBeenCalledOnce());
    if(kind==="expiry")session.clearRecovery();
    if(kind==="cloud")f.cloudBackend("https://changed.invalid");
    if(kind==="closing")f.closing(true);
    wait.resolve();
    expect(await work).toMatchObject({ok:false,code:kind==="expiry"?"EPRIVILEGE":"EACTIVATION_REPAIR_CONTEXT"});
    expect(f.terminalStore.write).not.toHaveBeenCalled();expect(f.configStore.set).not.toHaveBeenCalled();
  });
  it("denies saved target substitution or a differently connected pool", async () => {
    const f = fixture(); session.grantRecovery(); f.manager.pool = null;
    await f.status(); f.profile({ ...savedProfile, database: "empty-replacement" });
    expect(await f.connect()).toMatchObject({ code: "EACTIVATION_REPAIR_CONTEXT" });
    expect(f.manager.open).not.toHaveBeenCalled();
    const g = fixture(); g.manager.profile = { ...savedProfile, database: "wrong" };
    expect(await g.status()).toMatchObject({ code: "EACTIVATION_REPAIR_CONTEXT" });
    expect(g.query).not.toHaveBeenCalled();
  });
  it("allows fixing cloud settings between attempts while preserving the local target pin", async () => {
    const f = fixture(); session.grantRecovery(); await f.status(); f.cloudBackend("https://new-fixture.invalid");
    expect(await f.status()).toEqual({ ok: true, ready: true });
  });
  it.each(["journal", "conflicts", "shifts"] as const)("holds %s work without acknowledgement", async kind => {
    const f = fixture(); session.grantRecovery(); f[kind](1);
    expect(await f.status()).toMatchObject({ code: "EACTIVATION_REPAIR_PENDING" });
    expect(f.terminalStore.write).not.toHaveBeenCalled();
  });
  it.each(["intents", "legacy", "sales"] as const)("includes the separate durable %s queue with missing native registration", async kind => {
    const f = fixture(); session.grantRecovery(); f.tables(0, 1, 2, 3, 4, 5, 6); f.pending[kind] = true;
    expect(await f.status()).toMatchObject({ code: "EACTIVATION_REPAIR_PENDING" });
  });
  it("treats accepted legacy events without local adoption as pending", async () => {
    const f = fixture(); session.grantRecovery(); f.tables(1, 2, 3); f.pending.legacy = true;
    expect(await f.status()).toMatchObject({ code: "EACTIVATION_REPAIR_PENDING" });
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining("OR 1=1"));
  });
  it.each(["metadata", "partial", "collision", "wrong-db", "unknown-count", "query"])("fails closed on %s uncertainty", async kind => {
    const f = fixture(); session.grantRecovery();
    if (kind === "metadata") f.visible(0);
    if (kind === "partial") f.tables(2);
    if (kind === "collision") f.schema.object_0 = 42;
    if (kind === "wrong-db") f.databaseMatch(0);
    if (kind === "unknown-count") f.journal(Number.NaN);
    if (kind === "query") f.query.mockRejectedValueOnce(Error("private SQL password"));
    const result = await f.status();
    expect(result).toMatchObject({ ok: false, code: "EACTIVATION_REPAIR_CHECK" });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it.each(["expiry", "session", "pool", "cloud", "closing"])("rechecks %s after an awaited count", async kind => {
    const f = fixture(); session.grantRecovery(); const wait = deferred(); f.pause(wait.promise);
    const work = f.status(); await vi.waitFor(() => expect(f.query).toHaveBeenCalled());
    if (kind === "expiry") session.clearRecovery();
    if (kind === "session") session.grant("admin", "replacement", {}, "pos");
    if (kind === "pool") f.manager.pool = null;
    if (kind === "cloud") f.cloudBackend("https://changed.invalid");
    if (kind === "closing") f.closing(true);
    wait.resolve();
    expect(await work).toMatchObject({ ok: false, code: kind === "expiry" ? "EPRIVILEGE" : "EACTIVATION_REPAIR_CONTEXT" });
  });
  it("respects shutdown and recovery-metadata barriers on status and connection", async () => {
    const f = fixture(); session.grantRecovery(); await f.barrier.sealAndDrain();
    expect(await f.status()).toMatchObject({ code: "EAPP_CLOSING" });
    expect(await f.connect()).toMatchObject({ code: "EAPP_CLOSING" });
    f.barrier.reopen(); f.metadata.preparing = true;
    expect(await f.status()).toMatchObject({ code: "ERECOVERY_METADATA_BUSY" });
    expect(f.manager.open).not.toHaveBeenCalled();
  });
  it("uses dbo-only absence proof and includes unattributed retained journal rows", async () => {
    const f = fixture(); session.grantRecovery(); expect(await f.status()).toMatchObject({ ready: true });
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining("NULLIF(LTRIM(RTRIM(branch_id)),N'') IS NULL"));
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining("USER_NAME()=N'dbo'"));
    const g = fixture(); g.visible(0);
    expect(await g.status()).toMatchObject({ code: "EACTIVATION_REPAIR_CHECK" });
  });
});

describe("ordinary terminal writer keeps fresh activation and original registration compatible", () => {
  it("allows genuine first activation through its existing FIRST_RUN gate without admin recovery", async () => {
    const f = fixture(); f.provisioned(false); f.previous(null); f.profile(null);
    expect(await f.write()).toMatchObject({ ok: true });
    expect(f.terminalStore.write).toHaveBeenCalledOnce(); expect(f.query).not.toHaveBeenCalled();
  });
  it("preserves exact original mirroring without requiring a local SQL database", async () => {
    const f = fixture(); session.grantRecovery(); f.profile(null); f.manager.pool = null;
    expect(await f.write(old)).toMatchObject({ ok: true });
    expect(f.terminalStore.write).toHaveBeenCalledOnce(); expect(f.query).not.toHaveBeenCalled();
  });
  it("uses a readable full native registration for harmless mirroring when its optional old marker is unreadable", async () => {
    const f = fixture(); session.grantRecovery(); f.active(old);
    f.terminalStore.lastBinding.mockImplementation(() => { throw new Error("unreadable optional marker"); });
    expect(await f.write(old)).toMatchObject({ ok: true });
    expect(f.terminalStore.lastBinding).not.toHaveBeenCalled();
    expect(f.terminalStore.write).toHaveBeenCalledOnce();
    expect(f.query).not.toHaveBeenCalled();
  });
  it("requires a repair check again at final changed registration write", async () => {
    const f = fixture(); session.grantRecovery(); expect(await f.status()).toMatchObject({ ready: true });
    f.tables(0); f.pending.intents = true;
    expect(await f.write()).toMatchObject({ ok: false, error: expect.stringContaining("pending local") });
    expect(f.terminalStore.write).not.toHaveBeenCalled();
  });
  it("persists an explicitly authorized replacement after final saved-database checks pass",async()=>{
    const f=fixture();session.grantRecovery();
    expect(await f.status()).toEqual({ok:true,ready:true});
    f.query.mockClear();
    expect(await f.write()).toEqual({ok:true});
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining("matches_profile"));
    expect(f.terminalStore.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(next));
    expect(session.hasPosAuthority()).toBe(false);
    expect(await f.status()).toMatchObject({ok:false,code:"EACTIVATION_REPAIR_EXISTING"});
  });
  it("does not overwrite unreadable or provisioned-unknown binding", async () => {
    const f = fixture(); session.grantRecovery(); f.previous(null);
    expect(await f.write()).toMatchObject({ ok: false });
    expect(f.terminalStore.write).not.toHaveBeenCalled();
  });
  it("refuses the final write when application closing already sealed the barrier", async () => {
    const f = fixture(); session.grantRecovery(); await f.barrier.sealAndDrain();
    expect(await f.write()).toMatchObject({ ok: false, code: "EAPP_CLOSING" });
    expect(f.terminalStore.write).not.toHaveBeenCalled();
  });
});

it("preload exposes only argument-free native repair methods", () => {
  const preload = readFileSync(new URL("../../../../electron/preload.cjs", import.meta.url), "utf8");
  const lines = preload.split("\n").filter(line => /terminalRepair(?:Status|ConnectDatabase):/.test(line));
  const invoke = vi.fn(), bridge = new Function("invoke", `return {${lines.join("\n")}};`)(invoke);
  bridge.terminalRepairStatus(); bridge.terminalRepairConnectDatabase();
  expect(invoke.mock.calls).toEqual([["terminal:repair-status"], ["terminal:repair-connect-database"]]);
});
