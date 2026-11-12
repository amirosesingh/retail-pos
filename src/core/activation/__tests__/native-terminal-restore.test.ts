import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const privilege = require("../../../../electron/ipc-privilege.cjs");
const session = require("../../../../electron/admin-session.cjs");
const { WriteBarrier } = require("../../../../electron/sync/write-barrier.cjs");
const { RecoveryMetadataGate } = require("../../../../electron/db/shift-recovery-metadata.cjs");
const restore = require("../../../../electron/terminal-restore.cjs");
const main = readFileSync(new URL("../../../../electron/main.cjs", import.meta.url), "utf8");
const from = main.indexOf('  ipcMain.handle("terminal:restore",');
const to = main.indexOf('  ipcMain.handle("terminal:clear",', from);
const config = {
  tokenId: "10000000-0000-4000-8000-000000000001", deviceType: "pc", deviceUse: "operations",
  locationId: "store-a", locationName: "Store A", supabaseUrl: "https://saved-project.example",
  supabaseKey: "older-publishable-key", backendUrl: "https://older-pos.example", deviceBindingProof: "a".repeat(64),
};
const descriptor = { id: config.tokenId, platform: "pc", mode: "operations", branchId: config.locationId };
const approval = { approved: true, status: "used", terminal: descriptor, supabaseUrl: config.supabaseUrl };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

/** Real installed privilege/control/close wrappers and Main handler; stores and HTTP are isolated fixtures. */
function fixture() {
  type Registration = typeof config;
  type BindingMarker = Pick<Registration, "tokenId"> & Partial<Pick<Registration, "deviceType" | "deviceUse" | "locationId">>;
  let active: Registration | null = null;
  let previous: BindingMarker | null = { ...config };
  let cloud = { url: config.supabaseUrl, key: "current-publishable-key" };
  let backend = "https://saved-pos.example";
  let provisioned = true;
  const terminalStore = {
    read: vi.fn((_options: { strict: boolean }) => active),
    lastBinding: vi.fn((_options?: { strict?: boolean }) => previous), wasProvisioned: () => provisioned,
    write: vi.fn((value: Registration) => { active = value; return { ok: true }; }),
  };
  const cloudCredentials = { read: vi.fn((_options: { strict: boolean }) => cloud), write: vi.fn(), remove: vi.fn() };
  const configStore = { getStrict: vi.fn((_key: string) => backend), set: vi.fn() };
  const fetch = vi.fn(async (_url: string, _request: RequestInit) => Response.json(approval));
  const logConnection = vi.fn();
  const barrier = new WriteBarrier();
  const metadata = new RecoveryMetadataGate();
  const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<{ ok: boolean; config?: Registration; code?: string; reason?: string }>>();
  const ipcMain = { handle: (name: string, handler: typeof handlers extends Map<string, infer T> ? T : never) => handlers.set(name, handler) };
  privilege.install(ipcMain, { isFirstRun: () => !provisioned, isManagementDevice: () => false,
    writeBarrier: { run: (work: () => unknown) => metadata.run(() => barrier.run(work)) } });
  metadata.install(ipcMain);
  const sender = { mainFrame: {} };
  const event = { sender, senderFrame: sender.mainFrame };
  new Function("ipcMain", "mainWindow", "terminalStore", "cloudCredentials", "configStore", "diagnostics", "fetch", "require", main.slice(from, to))(
    ipcMain, { webContents: sender }, terminalStore, cloudCredentials, configStore, { logConnection }, fetch,
    (name: string) => { if (name !== "./terminal-restore.cjs") throw new Error("Unexpected dependency"); return restore; },
  );
  const writeHandler = vi.fn(async () => ({ ok: true }));
  ipcMain.handle("terminal:write", writeHandler);
  return {
    terminalStore, cloudCredentials, configStore, fetch, logConnection, barrier, metadata, event,
    run: (value: unknown = config, source: unknown = event) => handlers.get("terminal:restore")!(source, value),
    normalWrite: () => handlers.get("terminal:write")!(event, config), writeHandler,
    active: () => active,
    setActive(value: Registration | null) { active = value; },
    setPrevious(value: BindingMarker | null) { previous = value; },
    setCloud(value: typeof cloud) { cloud = value; }, setBackend(value: string) { backend = value; },
    setProvisioned(value: boolean) { provisioned = value; },
  };
}

beforeEach(() => { session.clear(); session.clearRecovery(); });
afterEach(() => { session.clear(); session.clearRecovery(); });

describe("pre-login native restoration of the original retained registration", () => {
  it("restores a provisioned signed-out device without opening ordinary terminal writes", async () => {
    const f = fixture();
    expect(f.normalWrite()).toMatchObject({ ok: false, code: "EPRIVILEGE" });
    expect(f.writeHandler).not.toHaveBeenCalled();
    await expect(f.run()).resolves.toMatchObject({ ok: true, config: { ...config, supabaseKey: "current-publishable-key", backendUrl: "https://saved-pos.example" } });
    expect(f.fetch).toHaveBeenCalledExactlyOnceWith("https://saved-pos.example/api/public/terminal-pairing", expect.objectContaining({
      method: "POST", body: JSON.stringify({ tokenId: config.tokenId, proofHash: config.deviceBindingProof }),
    }));
    expect(f.terminalStore.read).toHaveBeenCalledWith({ strict: true });
    expect(f.terminalStore.lastBinding).toHaveBeenCalledWith({ strict: true });
    expect(f.cloudCredentials.read).toHaveBeenCalledWith({ strict: true });
    expect(f.configStore.getStrict).toHaveBeenCalledWith("backendUrl");
    expect(f.configStore.set).not.toHaveBeenCalled();
    expect(f.cloudCredentials.write).not.toHaveBeenCalled();
    expect(f.cloudCredentials.remove).not.toHaveBeenCalled();
    expect(session.hasPosAuthority()).toBe(false);
  });

  it("preserves the canonical Management binding without inventing a branch", async () => {
    const f = fixture(), management = { ...config, deviceUse: "management", locationId: "" };
    f.setPrevious(management);
    f.fetch.mockResolvedValue(Response.json({ ...approval, terminal: { ...descriptor, mode: "management", branchId: null } }));
    await expect(f.run(management)).resolves.toMatchObject({ ok: true, config: { deviceUse: "management", locationId: "" } });
  });

  it("accepts the canonical descriptor of a legacy claimed active registration", async () => {
    const f = fixture(); f.fetch.mockResolvedValue(Response.json({ ...approval, status: "active" }));
    await expect(f.run()).resolves.toMatchObject({ ok: true });
  });

  it("restores from the actual minimal previous-binding fields without requiring a full activation copy", async () => {
    const f = fixture();
    f.setPrevious({ tokenId: config.tokenId, locationId: config.locationId });
    await expect(f.run()).resolves.toMatchObject({ ok: true });
    expect(f.terminalStore.lastBinding).toHaveBeenCalledTimes(2);
    expect(f.terminalStore.lastBinding.mock.calls.every(([options]) => options?.strict)).toBe(true);
  });

  it.each([
    [null, "missing_binding"], [{ ...config, tokenId: "another-terminal" }, "token"],
    [{ ...config, deviceType: "mobile" }, "platform"], [{ ...config, locationId: "other-store" }, "branch"],
    [{ ...config, deviceUse: "management", locationId: "" }, "mode"],
  ] as const)("refuses absent or foreign prior binding %# with a fixed reason", async (previous, reason) => {
    const f = fixture(); f.setPrevious(previous);
    await expect(f.run()).resolves.toMatchObject({ ok: false, code: "EACTIVATION_RECOVERY_BINDING", reason });
    expect(f.logConnection).toHaveBeenCalledWith("activation.restore.refused", expect.objectContaining({ reason }));
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.terminalStore.write).not.toHaveBeenCalled();
  });

  it("does not turn the restore channel into first-time activation", async () => {
    const f = fixture(); f.setProvisioned(false);
    await expect(f.run()).resolves.toMatchObject({ ok: false, code: "EACTIVATION_RECOVERY_BINDING", reason: "not_provisioned" });
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.terminalStore.write).not.toHaveBeenCalled();
  });

  it("keeps the verifier's rejection independent of diagnostic field classification", async () => {
    const activation = require("../../../../electron/verified-activation.cjs");
    const rejected = vi.spyOn(activation, "sameBinding").mockReturnValue(false);
    try {
      const f = fixture();
      await expect(f.run()).resolves.toMatchObject({ ok: false, code: "EACTIVATION_RECOVERY_BINDING", reason: "binding" });
      expect(f.fetch).not.toHaveBeenCalled(); expect(f.terminalStore.write).not.toHaveBeenCalled();
    } finally { rejected.mockRestore(); }
  });

  it.each(["", "newly-generated-proof"])("requires the original complete device proof %#", async proof => {
    const f = fixture();
    await expect(f.run({ ...config, deviceBindingProof: proof })).resolves.toMatchObject({ ok: false, code: "EACTIVATION_RECOVERY_PROOF" });
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.terminalStore.write).not.toHaveBeenCalled();
  });

  it("refuses a retained registration for a different saved database", async () => {
    const f = fixture(); f.setCloud({ url: "https://other-project.example", key: "another-publishable-key" });
    await expect(f.run()).resolves.toMatchObject({ ok: false, code: "EACTIVATION_RECOVERY_PROJECT" });
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.terminalStore.write).not.toHaveBeenCalled();
  });

  it("treats a missing saved project as global connection context failure", async () => {
    const f = fixture(); f.setCloud({ url: "", key: "" });
    await expect(f.run()).resolves.toMatchObject({ ok: false, code: "EACTIVATION_CONTEXT_CHANGED" });
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.terminalStore.write).not.toHaveBeenCalled();
  });

  it.each(["", "http://unsafe.example", "https://user:password@unsafe.example"])("requires a saved HTTPS backend %#", async backend => {
    const f = fixture(); f.setBackend(backend);
    await expect(f.run()).resolves.toMatchObject({ ok: false, code: "EACTIVATION_CONTEXT_CHANGED" });
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.terminalStore.write).not.toHaveBeenCalled();
  });

  it.each([
    { approved: false }, { ...approval, status: "revoked" }, { ...approval, status: "pending" },
    { ...approval, status: "active", terminal: undefined }, { ...approval, terminal: { ...descriptor, branchId: "foreign" } },
    { ...approval, terminal: { ...descriptor, platform: "mobile" } }, { ...approval, supabaseUrl: "https://other-project.example" },
  ])("preserves saved settings when the backend cannot verify this original registration %#", async response => {
    const f = fixture(); f.fetch.mockResolvedValue(Response.json(response));
    await expect(f.run()).resolves.toMatchObject({ ok: false, code: "EACTIVATION_RECOVERY_VERIFY" });
    expect(f.terminalStore.write).not.toHaveBeenCalled();
  });

  it.each(["terminal", "binding", "cloud", "backend"])("refuses changed native %s context after verification starts", async changed => {
    const f = fixture(), response = deferred<Response>();
    f.fetch.mockImplementation(() => response.promise);
    const restoring = f.run();
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledOnce());
    if (changed === "terminal") f.setActive({ ...config, tokenId: "replacement" });
    if (changed === "binding") f.setPrevious({ ...config, locationId: "other-store" });
    if (changed === "cloud") f.setCloud({ url: config.supabaseUrl, key: "rotated-publishable-key" });
    if (changed === "backend") f.setBackend("https://new-pos.example");
    response.resolve(Response.json(approval));
    await expect(restoring).resolves.toMatchObject({ ok: false, code: "EACTIVATION_CONTEXT_CHANGED" });
    expect(f.terminalStore.write).not.toHaveBeenCalled();
  });

  it.each(["terminal", "binding", "cloud", "backend"])("preserves saved files when the %s vault is unreadable", async store => {
    const f = fixture(); const unavailable = () => { throw new Error("Private decryption details " + config.deviceBindingProof); };
    if (store === "terminal") f.terminalStore.read.mockImplementation(unavailable);
    if (store === "binding") f.terminalStore.lastBinding.mockImplementation(unavailable);
    if (store === "cloud") f.cloudCredentials.read.mockImplementation(unavailable);
    if (store === "backend") f.configStore.getStrict.mockImplementation(unavailable);
    const result = await f.run();
    expect(result).toMatchObject({ ok: false, code: "EACTIVATION_STORE" });
    expect(JSON.stringify(result)).not.toContain(config.deviceBindingProof);
    expect(f.terminalStore.write).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
  });

  it("keeps a prior-binding read failure during verification global and leaves the native mirror absent", async () => {
    const f = fixture(), response = deferred<Response>();
    f.fetch.mockImplementation(() => response.promise);
    const restoring = f.run();
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledOnce());
    f.terminalStore.lastBinding.mockImplementation(() => { throw new Error("Private marker decryption diagnostic"); });
    response.resolve(Response.json(approval));
    const result = await restoring;
    expect(result).toMatchObject({ ok: false, code: "EACTIVATION_STORE" });
    expect(JSON.stringify(result)).not.toContain("Private marker");
    expect(f.terminalStore.write).not.toHaveBeenCalled();
  });

  it("returns the authoritative existing mirror without replacing its proof or settings", async () => {
    const f = fixture(), existing = { ...config, supabaseKey: "native-key", deviceBindingProof: "b".repeat(64) };
    f.setActive(existing);
    await expect(f.run()).resolves.toEqual({ ok: true, config: existing });
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.terminalStore.write).not.toHaveBeenCalled();
  });

  it.each(["write", "read-back"])("does not claim restoration when native %s fails", async failure => {
    const f = fixture();
    if (failure === "write") f.terminalStore.write.mockReturnValue({ ok: false });
    else f.terminalStore.read.mockImplementation(() => f.terminalStore.write.mock.calls.length ? null : f.active());
    await expect(f.run()).resolves.toMatchObject({ ok: false, code: "EACTIVATION_STORE" });
    expect(f.terminalStore.write).toHaveBeenCalledOnce();
    expect(f.configStore.set).not.toHaveBeenCalled(); expect(f.cloudCredentials.write).not.toHaveBeenCalled();
  });

  it("never replaces a different readable native registration", async () => {
    const f = fixture(); f.setActive({ ...config, tokenId: "replacement" });
    await expect(f.run()).resolves.toMatchObject({ ok: false, code: "EACTIVATION_CONTEXT_CHANGED" });
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.terminalStore.write).not.toHaveBeenCalled();
  });

  it("shares identical in-flight restores and rejects a competing candidate", async () => {
    const f = fixture(), response = deferred<Response>();
    f.fetch.mockImplementation(() => response.promise);
    const first = f.run(), second = f.run();
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledOnce());
    await expect(f.run({ ...config, deviceName: "competing candidate" })).resolves.toMatchObject({ code: "EACTIVATION_CONTEXT_CHANGED" });
    response.resolve(Response.json(approval));
    expect((await Promise.all([first, second])).every(result => result.ok)).toBe(true);
    expect(f.terminalStore.write).toHaveBeenCalledOnce();
  });

  it("refuses child frames and other windows before reading or writing storage", async () => {
    const f = fixture();
    for (const event of [{ ...f.event, senderFrame: {} }, { sender: { mainFrame: {} }, senderFrame: {} }]) {
      await expect(f.run(config, event)).resolves.toMatchObject({ ok: false, code: "EPRIVILEGE" });
    }
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.terminalStore.read).not.toHaveBeenCalled(); expect(f.terminalStore.write).not.toHaveBeenCalled();
  });

  it("does not start restoration after the updater closes the write gate", async () => {
    const f = fixture(); await f.barrier.sealAndDrain();
    await expect(f.run()).resolves.toMatchObject({ ok: false, code: "EAPP_CLOSING" });
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.terminalStore.write).not.toHaveBeenCalled();
  });

  it("drains an accepted restore before close and prevents concurrent metadata preparation", async () => {
    const f = fixture(), response = deferred<Response>();
    f.fetch.mockImplementation(() => response.promise);
    const restoring = f.run();
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledOnce());
    let drained = false;
    const closing = f.barrier.sealAndDrain().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    const work = vi.fn();
    await expect(f.metadata.prepare({ coordinator: {}, assertCurrent: () => {}, isBusy: () => false, work }))
      .resolves.toMatchObject({ available: false, code: "ERECOVERY_METADATA_BUSY" });
    expect(work).not.toHaveBeenCalled();
    response.resolve(Response.json(approval));
    await expect(restoring).resolves.toMatchObject({ ok: true });
    await closing; expect(drained).toBe(true);
  });

  it("logs fixed stages and codes without registration credentials or backend response details", async () => {
    const f = fixture();
    f.fetch.mockRejectedValue(new Error("Private response " + config.deviceBindingProof));
    await expect(f.run()).resolves.toMatchObject({ ok: false, code: "EACTIVATION_RECOVERY_VERIFY" });
    const logged = JSON.stringify(f.logConnection.mock.calls);
    expect(logged).toContain("activation.restore.failed"); expect(logged).toContain("verify");
    for (const secret of [config.tokenId, config.supabaseUrl, config.supabaseKey, config.deviceBindingProof, "saved-pos.example", "Private response"]) expect(logged).not.toContain(secret);
  });

  it("reports only the fixed mismatch field rather than the previous or requested identity values", async () => {
    const f = fixture(); f.setPrevious({ ...config, tokenId: "private-previous-terminal" });
    const result = await f.run();
    expect(result).toMatchObject({ code: "EACTIVATION_RECOVERY_BINDING", reason: "token" });
    const report = JSON.stringify([result, f.logConnection.mock.calls]);
    for (const value of ["private-previous-terminal", config.tokenId, config.supabaseKey, config.deviceBindingProof])
      expect(report).not.toContain(value);
  });

  it("forwards only the retained registration through the preload bridge", () => {
    const preload = readFileSync(new URL("../../../../electron/preload.cjs", import.meta.url), "utf8");
    const property = preload.split("\n").find(line => line.includes("restoreTerminalConfig:"));
    const invoke = vi.fn();
    const bridge = new Function("invoke", `return ({ ${property} });`)(invoke);
    bridge.restoreTerminalConfig(config);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("terminal:restore", config);
  });
});
