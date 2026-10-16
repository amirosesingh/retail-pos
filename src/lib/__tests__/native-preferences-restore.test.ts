import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const vault = vi.hoisted(() => ({ get: vi.fn(), values: new Map<string, string>() }));
vi.mock("@/platform-config/platform", () => ({ isNative: () => true, isElectron: () => false, isTerminalApp: () => true }));
vi.mock("@capacitor/preferences", () => ({ Preferences: {
  keys: async () => ({ keys: [...vault.values.keys()] }), get: vault.get,
  set: async ({ key, value }: { key: string; value: string }) => { vault.values.set(key, value); },
  remove: async ({ key }: { key: string }) => { vault.values.delete(key); },
} }));

describe("phone preference restore", () => {
  let store: Record<string, string>;
  beforeEach(() => {
    vi.resetModules();
    vault.values.clear();
    vault.values.set("pos.device.key", "saved-device-key");
    vault.values.set("pos.secure.terminal.config", "saved-activation");
    vault.get.mockImplementation(async ({ key }: { key: string }) => ({ value: vault.values.get(key) ?? null }));
    store = {};
    const ls = Object.defineProperties(store, {
      getItem: { configurable: true, writable: true, value: (key: string) => store[key] ?? null },
      setItem: { configurable: true, writable: true, value: (key: string, value: string) => { store[key] = value; } },
      removeItem: { configurable: true, writable: true, value: (key: string) => { delete store[key]; } },
      clear: { configurable: true, writable: true, value: () => {} },
    });
    vi.stubGlobal("window", { localStorage: ls });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("keeps identity untouched when one persisted value cannot be read, then retries", async () => {
    store["pos.device.key"] = "current-device-key";
    vault.get.mockRejectedValueOnce(new Error("Preferences unavailable"));
    const { hydrateNativeStorage } = await import("@/platforms/mobile/mobile-storage");
    await expect(hydrateNativeStorage()).rejects.toThrow("Preferences unavailable");
    expect(store["pos.device.key"]).toBe("current-device-key");
    expect(store["pos.secure.terminal.config"]).toBeUndefined();
    await hydrateNativeStorage();
    expect(store["pos.device.key"]).toBe("saved-device-key");
    expect(store["pos.secure.terminal.config"]).toBe("saved-activation");
  });
  it("awaits a slow activation read before exposing either part of identity", async () => {
    let finish!: (value: { value: string }) => void;
    vault.get.mockImplementation(({ key }: { key: string }) => key === "pos.secure.terminal.config"
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ value: vault.values.get(key) }));
    const { hydrateNativeStorage } = await import("@/platforms/mobile/mobile-storage");
    const restoring = hydrateNativeStorage();
    await vi.waitFor(() => expect(vault.get).toHaveBeenCalledTimes(2));
    expect(store["pos.device.key"]).toBeUndefined();
    finish({ value: "saved-activation" });
    await restoring;
    expect(store["pos.device.key"]).toBe("saved-device-key");
    expect(store["pos.secure.terminal.config"]).toBe("saved-activation");
  });
});
