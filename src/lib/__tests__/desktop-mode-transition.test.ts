import { afterEach, expect, it, vi } from "vitest";
vi.mock("../live-mode", () => ({ isOnlineOnly: () => false }));
vi.mock("@/platform-config/features", () => ({ hasFeature: () => true }));
import { effectiveDatabaseMode, setStartupOnlineMode, subscribeDatabaseMode } from "@/core/local-db/db-mode";
afterEach(() => vi.unstubAllGlobals());
it("switches local to online and back once per state transition only when the canonical source changes", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  vi.stubGlobal("window", { sessionStorage: storage });
  const changed = vi.fn(); const off = subscribeDatabaseMode(changed);
  try {
    expect(effectiveDatabaseMode()).toBe("local");
    setStartupOnlineMode(true); expect(effectiveDatabaseMode()).toBe("online");
    setStartupOnlineMode(true); expect(changed).toHaveBeenCalledTimes(1);
    setStartupOnlineMode(false); expect(effectiveDatabaseMode()).toBe("local");
    expect(changed).toHaveBeenCalledTimes(2);
  } finally { off(); }
});

it("waits for a real saved-SQL connection attempt, falls back on failure, and returns only after recovery is ready", async () => {
  const { DatabaseService } = await import("../../../electron/db/service.cjs");
  const { desktopStorageRoute } = await import("../desktop-storage-route");
  const profile = { host: "saved-sql", database: "POS" };
  let resolve!: (result: { ok: boolean; ready: boolean }) => void;
  const validator = vi.fn(() => new Promise<{ ok: boolean; ready: boolean }>(done => { resolve = done; }));
  const manager = { pool: null as object | null, isConnected() { return Boolean(this.pool); },
    open: vi.fn(async () => { manager.pool = {}; }), close: vi.fn(async () => { manager.pool = null; }) };
  const service = new DatabaseService({ secureConfig: { enabled: () => true, profile: () => profile, credentials: () => profile }, manager, validator });
  expect(desktopStorageRoute(service.snapshot())).toBe("pending");
  const attempt = service.restore();
  expect(validator).toHaveBeenCalledOnce();
  expect(desktopStorageRoute(service.snapshot())).toBe("pending");
  resolve({ ok: false, ready: false }); await attempt;
  expect(desktopStorageRoute(service.snapshot())).toBe("online");
  const recovery = service.restore();
  expect(desktopStorageRoute(service.snapshot())).toBe("pending");
  resolve({ ok: true, ready: true }); await recovery;
  expect(manager.open).toHaveBeenCalledOnce();
  expect(desktopStorageRoute(service.snapshot())).toBe("pending");
  service.markReady(); expect(desktopStorageRoute(service.snapshot())).toBe("local");
});
