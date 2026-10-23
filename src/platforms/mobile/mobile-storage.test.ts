import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ values: new Map<string, string>(), drop: false, failRemove: false }));
vi.mock("@/platform-config/platform", () => ({ isNative: () => true }));
vi.mock("@capacitor/preferences", () => ({ Preferences: {
  keys: async () => ({ keys: [...native.values.keys()] }),
  get: async ({ key }: { key: string }) => ({ value: native.values.get(key) ?? null }),
  set: async ({ key, value }: { key: string; value: string }) => { if (!native.drop) native.values.set(key, value); },
  remove: async ({ key }: { key: string }) => { if (!native.failRemove) native.values.delete(key); },
} }));
describe("native settings across interface updates", () => {
  beforeEach(() => {
    vi.resetModules();
    native.values.clear();
    native.drop = false;
    native.failRemove = false;
    const storage: Record<string, unknown> = {};
    Object.defineProperties(storage, {
      getItem: { value: (key: string) => storage[key] ?? null, writable: true },
      setItem: { value: (key: string, value: string) => { storage[key] = value; }, writable: true },
      removeItem: { value: (key: string) => { delete storage[key]; }, writable: true },
      clear: { value: () => { Object.keys(storage).forEach(key => delete storage[key]); }, writable: true },
    });
    vi.stubGlobal("window", { localStorage: storage, dispatchEvent: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("restores identity and retains OTA rollback metadata while clearing old business caches", async () => {
    native.values.set("pos.terminal.config", "sealed-identity");
    native.values.set("pos.device.key", "device-key");
    native.values.set("retail.ios.ota.v1", "rollback-metadata");
    native.values.set("pos.report.cache", "stale");
    const { hydrateNativeStorage, flushNativeStorage } = await import("./mobile-storage");
    await hydrateNativeStorage();
    expect(window.localStorage.getItem("pos.terminal.config")).toBe("sealed-identity");
    expect(native.values.get("retail.ios.ota.v1")).toBe("rollback-metadata");
    expect(native.values.has("pos.report.cache")).toBe(false);
    window.localStorage.setItem("pos.terminal.config", "updated-identity");
    await flushNativeStorage();
    expect(native.values.get("pos.terminal.config")).toBe("updated-identity");
  });
  it("waits for removed registration and refuses a reload if it is still persisted", async () => {
    native.values.set("pos.terminal.config", "old-registration");
    const { hydrateNativeStorage, flushNativeStorage } = await import("./mobile-storage");
    await hydrateNativeStorage();
    native.failRemove = true;
    window.localStorage.removeItem("pos.terminal.config");
    await expect(flushNativeStorage()).rejects.toThrow("Could not remove saved device settings");
    native.failRemove = false;
    await flushNativeStorage();
    expect(native.values.has("pos.terminal.config")).toBe(false);
    expect(window.localStorage.getItem("pos.terminal.config")).toBeNull();
  });
  it("blocks reload if the native store does not retain the current settings", async () => {
    const { hydrateNativeStorage, flushNativeStorage } = await import("./mobile-storage");
    await hydrateNativeStorage();
    native.drop = true;
    window.localStorage.setItem("pos.device.key", "new-key");
    await expect(flushNativeStorage()).rejects.toThrow("Could not verify");
  });
});
