import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const secrets = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(async () => {}) }));
vi.mock("@/lib/device-secrets", () => ({ getDeviceSecret: secrets.read, setDeviceSecret: secrets.write, clearDeviceSecret: vi.fn() }));
vi.mock("@/integrations/supabase/external-client", () => ({ resetExternalClient: vi.fn(), createTenantClient: vi.fn(), supabaseExternal: {} }));
vi.mock("@/core/activation/connection-health", () => ({ resetHealthCache: vi.fn() }));

describe("native activation restore", () => {
  const config = { tokenId: "1484f3ee-92fc-450a-9d36-0a1362e5e797", locationId: "branch-1", deviceType: "pc" };
  let readDisk: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.resetModules();
    secrets.read.mockReset();
    secrets.write.mockClear();
    secrets.read.mockResolvedValue(null);
    readDisk = vi.fn(async () => ({ ok: true, config }));
    vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
      dispatchEvent: vi.fn(), pos: { readTerminalConfig: readDisk, writeTerminalConfig: vi.fn(async () => ({ ok: true })) } });
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
    secrets.read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const terminal = await import("@/core/activation/terminal-tokens");
    const first = terminal.hydrateTerminalConfig();
    const second = terminal.hydrateTerminalConfig();
    expect(terminal.isTerminalConfigHydrated()).toBe(false);
    finish(config);
    await Promise.all([first, second]);
    expect(secrets.read).toHaveBeenCalledOnce();
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
});
