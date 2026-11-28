import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const secrets = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(async () => {}) }));
vi.mock("@/lib/device-secrets", () => ({ getDeviceSecret: secrets.read, setDeviceSecret: secrets.write, clearDeviceSecret: vi.fn() }));
vi.mock("@/integrations/supabase/external-client", () => ({ resetExternalClient: vi.fn(), createTenantClient: vi.fn(), supabaseExternal: {} }));
vi.mock("@/core/activation/connection-health", () => ({ resetHealthCache: vi.fn() }));

describe("native activation restore", () => {
  const config = { tokenId: "1484f3ee-92fc-450a-9d36-0a1362e5e797", locationId: "branch-1", deviceType: "pc" };
  let readDisk: ReturnType<typeof vi.fn>;
  let writeDisk: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.resetModules();
    secrets.read.mockReset();
    secrets.write.mockClear();
    secrets.read.mockResolvedValue(null);
    readDisk = vi.fn(async () => ({ ok: true, config }));
    writeDisk = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
      dispatchEvent: vi.fn(), pos: { readTerminalConfig: readDisk, writeTerminalConfig: writeDisk } });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("does not consume or delete a native registration saved in a browser", async () => {
    Reflect.deleteProperty(window, "pos");
    const removeItem = vi.fn();
    Object.assign(window, { localStorage: { getItem: vi.fn(() => JSON.stringify(config)), removeItem } });
    secrets.read.mockResolvedValue(config);
    const terminal = await import("@/core/activation/terminal-tokens");
    expect(terminal.readTerminalConfig()).toBeNull();
    await expect(terminal.hydrateTerminalConfig()).resolves.toBeNull();
    expect(secrets.read).not.toHaveBeenCalled();
    expect(secrets.write).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(readDisk).not.toHaveBeenCalled();
  });
  it("restores the desktop registration before hydration completes, without internet", async () => {
    const terminal = await import("@/core/activation/terminal-tokens");
    await expect(terminal.hydrateTerminalConfig()).resolves.toMatchObject(config);
    expect(terminal.isTerminalConfigHydrated()).toBe(true);
    expect(readDisk).toHaveBeenCalledOnce();
  });
  it("keeps a failed native registration read retryable instead of publishing an unregistered terminal", async () => {
    readDisk.mockResolvedValueOnce({ ok: false, code: "EACTIVATION_STORE" });
    const terminal = await import("@/core/activation/terminal-tokens");

    await expect(terminal.hydrateTerminalConfig()).rejects.toThrow("Could not restore the saved terminal registration");
    expect(terminal.isTerminalConfigHydrated()).toBe(false);
    expect(terminal.readTerminalConfig()).toBeNull();
    expect(secrets.write).not.toHaveBeenCalled();
    expect(window.localStorage.removeItem).not.toHaveBeenCalled();

    await expect(terminal.hydrateTerminalConfig()).resolves.toMatchObject(config);
    expect(terminal.isTerminalConfigHydrated()).toBe(true);
    expect(readDisk).toHaveBeenCalledTimes(2);
  });
  it("shares concurrent restores instead of publishing a temporary missing registration", async () => {
    let finish!: (value: unknown) => void;
    readDisk.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const terminal = await import("@/core/activation/terminal-tokens");
    const first = terminal.hydrateTerminalConfig();
    const second = terminal.hydrateTerminalConfig();
    expect(terminal.isTerminalConfigHydrated()).toBe(false);
    expect(terminal.readTerminalConfig()).toBeNull();
    finish({ ok: true, config });
    await expect(Promise.all([first, second])).resolves.toEqual([config, config]);
    expect(readDisk).toHaveBeenCalledOnce();
    expect(secrets.read).not.toHaveBeenCalled();
  });
  it("keeps unreadable Android activation retryable instead of declaring it absent", async () => {
    Reflect.deleteProperty(window, "pos");
    Object.assign(window, { Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" } });
    secrets.read.mockRejectedValueOnce(new Error("storage not ready"));
    const terminal = await import("@/core/activation/terminal-tokens");
    await expect(terminal.hydrateTerminalConfig()).rejects.toThrow("registration has not been removed");
    expect(terminal.isTerminalConfigHydrated()).toBe(false);
    secrets.read.mockResolvedValue(config);
    await expect(terminal.hydrateTerminalConfig()).resolves.toMatchObject({ tokenId: config.tokenId });
  });
  it("keeps a historically provisioned device in recovery when all full registration copies are missing", async () => {
    readDisk.mockResolvedValue({ ok: true, config: null, recoveryRequired: true });
    const terminal = await import("@/core/activation/terminal-tokens");
    await expect(terminal.hydrateTerminalConfig()).rejects.toMatchObject({ code: "EACTIVATION_RECOVERY_BINDING" });
    expect(terminal.isTerminalConfigHydrated()).toBe(false);
    expect(writeDisk).not.toHaveBeenCalled();
    expect(secrets.write).not.toHaveBeenCalled();
  });
  it("still recognizes verified fresh native storage with no retained registration", async () => {
    readDisk.mockResolvedValue({ ok: true, config: null, recoveryRequired: false });
    const terminal = await import("@/core/activation/terminal-tokens");
    await expect(terminal.hydrateTerminalConfig()).resolves.toBeNull();
    expect(terminal.isTerminalConfigHydrated()).toBe(true);
  });
  it("copies only the bounded raw retained evidence without opening or generating secrets", async () => {
    const values: Record<string, string> = { "pos.secure.terminal.config": "fixture-sealed", "pos.terminal.config": "fixture-plain", "pos.device.key": "fixture-key" };
    const storage = window.localStorage as unknown as { getItem: (name: string) => string | null };
    storage.getItem = vi.fn(name => values[name] ?? null);
    const terminal = await import("@/core/activation/terminal-tokens");
    expect(terminal.retainedTerminalRecoveryEvidence()).toEqual({ sealed: "fixture-sealed", plain: "fixture-plain", key: "fixture-key" });
    expect(secrets.read).not.toHaveBeenCalled(); expect(secrets.write).not.toHaveBeenCalled();
    expect(window.localStorage.setItem).not.toHaveBeenCalled(); expect(window.localStorage.removeItem).not.toHaveBeenCalled();
  });
  it.each(["unreadable", "oversized"])("refuses %s retained evidence without replacing it", async kind => {
    const storage = window.localStorage as unknown as { getItem: (name: string) => string | null };
    storage.getItem = vi.fn(() => { if (kind === "unreadable") throw new Error("private vault detail"); return "x".repeat(32_769); });
    const terminal = await import("@/core/activation/terminal-tokens");
    expect(() => terminal.retainedTerminalRecoveryEvidence()).toThrow("could not be preserved");
    expect(window.localStorage.setItem).not.toHaveBeenCalled(); expect(secrets.write).not.toHaveBeenCalled();
  });
});
