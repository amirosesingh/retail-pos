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
    secrets.read.mockResolvedValue(null);
    readDisk = vi.fn(async () => ({ ok: true, config }));
    vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
      dispatchEvent: vi.fn(), pos: { readTerminalConfig: readDisk, writeTerminalConfig: vi.fn(async () => ({ ok: true })) } });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("restores the desktop registration before hydration completes, without internet", async () => {
    const terminal = await import("@/core/activation/terminal-tokens");
    await expect(terminal.hydrateTerminalConfig()).resolves.toMatchObject(config);
    expect(terminal.isTerminalConfigHydrated()).toBe(true);
    expect(readDisk).toHaveBeenCalledOnce();
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
    secrets.read.mockRejectedValueOnce(new Error("storage not ready"));
    const terminal = await import("@/core/activation/terminal-tokens");
    await expect(terminal.hydrateTerminalConfig()).rejects.toThrow("registration has not been removed");
    expect(terminal.isTerminalConfigHydrated()).toBe(false);
    secrets.read.mockResolvedValue(config);
    await expect(terminal.hydrateTerminalConfig()).resolves.toMatchObject({ tokenId: config.tokenId });
  });
});
