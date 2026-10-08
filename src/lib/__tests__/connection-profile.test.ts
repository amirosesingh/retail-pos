/**
 * The connection profile is what makes one APK/EXE usable by every customer:
 * central database URL, publishable key and POS backend address, entered once
 * on the device and expected to still be there after a restart.
 *
 * These tests drive the real Android path with an in-memory secure store, and
 * simulate a restart by clearing `localStorage` (which Android's start-up purge
 * does) and re-reading the profile.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const secure = vi.hoisted(() => new Map<string, string>());
const shell = vi.hoisted(() => ({ mobile: true, windows: false }));
const net = vi.hoisted(() => ({
  backendOk: true,
  cloudOk: true,
}));
const electronStore = vi.hoisted(() => ({
  backendUrl: "",
  cloudUrl: "",
  cloudKey: "",
}));

vi.mock("@/platform-config/platform", () => ({
  isTerminalApp: () => true,
  isNative: () => shell.mobile,
}));

vi.mock("@/platform-config/features", () => ({
  isMobileShell: () => shell.mobile,
  isWindowsShell: () => shell.windows,
  hasFeature: () => false,
}));

vi.mock("capacitor-secure-storage-plugin", () => ({
  SecureStoragePlugin: {
    get: async ({ key }: { key: string }) => {
      const value = secure.get(key);
      if (value === undefined) throw new Error("not found");
      return { value };
    },
    set: async ({ key, value }: { key: string; value: string }) => {
      secure.set(key, value);
      return { value: true };
    },
    remove: async ({ key }: { key: string }) => {
      secure.delete(key);
      return { value: true };
    },
  },
}));

vi.mock("@/integrations/supabase/external-client", () => ({
  resetExternalClient: () => {},
  createTenantClient: () => ({
    from: () => ({
      select: () => ({
        limit: async () =>
          net.cloudOk ? { data: [], error: null } : { data: null, error: { message: "invalid api key" } },
      }),
    }),
  }),
}));

vi.mock("@/lib/external-supabase-config", () => ({
  setTerminalSupabaseOverride: () => {},
  clearTerminalSupabaseOverride: () => {},
  hasTerminalSupabaseOverride: () => secure.has("pos.cloud.url"),
  hasSupabaseConfig: () => false,
  supabaseConfig: () => ({ url: "", key: "" }),
}));

vi.mock("@/lib/sync-status", () => ({ setSyncState: () => {} }));

// The sync kick must be observable and must never fire mid-commit.
const syncRuns: string[] = [];
vi.mock("@/lib/sync-engine", () => ({
  runExclusive: async (reason: string) => {
    syncRuns.push(reason);
  },
}));

import { backendUrl, saveBackendUrl } from "../backend-config";
import { saveConnectionProfile, connectionProfile, cloudKeyStatus } from "../secure-cloud-config";
import { hasRequiredPlatformConfig, platformConfigReadySync } from "../platform-config-ready";
import { __resetProfileHydrationForTests } from "../connection-profile";

const KEY_A = "test-publishable-key-a";

/** Minimal browser surface: the suite runs in node, the code expects a device. */
function installWindow() {
  const map = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
  (globalThis as { window?: unknown }).window = globalThis;
  (globalThis as { localStorage?: unknown }).localStorage = localStorage;
  (globalThis as { pos?: unknown }).pos = {
    backendUrl: async () => ({ ok: true, url: electronStore.backendUrl }),
    setBackendUrl: async (value: string) => {
      electronStore.backendUrl = value;
      return { ok: true, url: value };
    },
    cloudKeyStatus: async () => ({
      ok: true,
      configured: Boolean(electronStore.cloudUrl && electronStore.cloudKey),
      url: electronStore.cloudUrl,
      keyHint: electronStore.cloudKey ? "test-p…key-a" : "",
      encrypted: true,
    }),
    bootstrapCloudCredentials: async () =>
      electronStore.cloudUrl && electronStore.cloudKey
        ? { ok: true, url: electronStore.cloudUrl, key: electronStore.cloudKey }
        : { ok: false },
    setCloudCredentials: async ({ url, key }: { url: string; key: string }) => {
      electronStore.cloudUrl = url;
      electronStore.cloudKey = key;
      return { ok: true, configured: true, url, keyHint: "test-p…key-a", encrypted: true };
    },
    removeCloudCredentials: async () => {
      electronStore.cloudUrl = "";
      electronStore.cloudKey = "";
      return { ok: true };
    },
  };
}

/** Android's start-up purge: plain storage goes, the sealed store stays. */
function restart() {
  window.localStorage.clear();
  __resetProfileHydrationForTests();
}


function mockFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/auth/v1/health")) return new Response("{}", { status: 200 });
    if (url.includes("/api/public/sync-health"))
      return net.backendOk
        ? new Response(JSON.stringify({ serviceKey: true }), { status: 200 })
        : Promise.reject(new Error("connection refused"));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
}

describe("connection profile", () => {
  beforeEach(() => {
    installWindow();
    secure.clear();
    electronStore.backendUrl = "";
    electronStore.cloudUrl = "";
    electronStore.cloudKey = "";
    window.localStorage.clear();
    syncRuns.length = 0;
    net.backendOk = true;
    net.cloudOk = true;
    shell.mobile = true;
    shell.windows = false;
    __resetProfileHydrationForTests();
    mockFetch();
  });

  it("first launch has no profile, so setup is required", async () => {
    const res = await hasRequiredPlatformConfig();
    expect(res.ready).toBe(false);
    expect(res.state).toBe("missing");
  });

  it("saves a complete profile once both halves pass", async () => {
    const res = await saveConnectionProfile({
      supabaseUrl: "https://tenant.example.co",
      supabaseKey: KEY_A,
      backendUrl: "https://pos.example.com",
    });
    expect(res.ok).toBe(true);
    expect(res.stage).toBe("saved");
    const ready = await hasRequiredPlatformConfig();
    expect(ready.state).toBe("ready");
  });

  it("restores the whole profile after a restart, with no setup screen", async () => {
    await saveConnectionProfile({
      supabaseUrl: "https://tenant.example.co",
      supabaseKey: KEY_A,
      backendUrl: "https://pos.example.com",
    });
    restart();
    expect(await backendUrl()).toBe("https://pos.example.com");
    expect((await cloudKeyStatus()).configured).toBe(true);
    const ready = await hasRequiredPlatformConfig();
    expect(ready.ready).toBe(true);
  });

  it("keeps the backend address across a restart even on its own", async () => {
    await saveBackendUrl("https://pos.example.com");
    restart();
    expect(await backendUrl()).toBe("https://pos.example.com");
  });

  it("writes and reads the exact backend address through the Windows Electron bridge", async () => {
    shell.mobile = false;
    shell.windows = true;
    const res = await saveConnectionProfile({
      supabaseUrl: "https://tenant.example.co",
      supabaseKey: KEY_A,
      backendUrl: "pws.mycompanywebsite.com/",
    });
    expect(res.ok).toBe(true);
    expect(electronStore.backendUrl).toBe("https://pws.mycompanywebsite.com");
    expect(await backendUrl()).toBe("https://pws.mycompanywebsite.com");
    expect((await connectionProfile()).backendUrl).toBe("https://pws.mycompanywebsite.com");
  });

  it("rejects an explicitly insecure HTTP backend address", async () => {
    shell.mobile = false;
    shell.windows = true;
    const res = await saveConnectionProfile({
      supabaseUrl: "https://tenant.example.co",
      supabaseKey: KEY_A,
      backendUrl: "http://pos.example.com",
    });
    expect(res.ok).toBe(false);
    expect(res.stage).toBe("validate");
    expect(electronStore.backendUrl).toBe("");
  });

  it("survives a backend change: A → B → restart still reads B", async () => {
    await saveConnectionProfile({
      supabaseUrl: "https://tenant.example.co",
      supabaseKey: KEY_A,
      backendUrl: "https://a.example.com",
    });
    // Only the backend changes; the key box is left blank on purpose.
    const res = await saveConnectionProfile({
      supabaseUrl: "https://tenant.example.co",
      supabaseKey: null,
      backendUrl: "https://b.example.com",
    });
    expect(res.ok).toBe(true);
    restart();
    expect(await backendUrl()).toBe("https://b.example.com");
    expect((await cloudKeyStatus()).configured).toBe(true);
  });

  it("keeps the working profile when the new backend fails its test", async () => {
    await saveConnectionProfile({
      supabaseUrl: "https://tenant.example.co",
      supabaseKey: KEY_A,
      backendUrl: "https://a.example.com",
    });
    net.backendOk = false;
    const res = await saveConnectionProfile({
      supabaseUrl: "https://tenant.example.co",
      supabaseKey: null,
      backendUrl: "https://dead.example.com",
    });
    expect(res.ok).toBe(false);
    expect(res.stage).toBe("backend");
    net.backendOk = true;
    restart();
    expect(await backendUrl()).toBe("https://a.example.com");
  });

  it("preserves the backend address when only the database changes", async () => {
    await saveConnectionProfile({
      supabaseUrl: "https://tenant-a.example.co",
      supabaseKey: KEY_A,
      backendUrl: "https://pos.example.com",
    });
    const res = await saveConnectionProfile({
      supabaseUrl: "https://tenant-b.example.co",
      supabaseKey: "test-publishable-key-b",
      backendUrl: "https://pos.example.com",
    });
    expect(res.ok).toBe(true);
    restart();
    expect(await backendUrl()).toBe("https://pos.example.com");
    expect((await cloudKeyStatus()).url).toBe("https://tenant-b.example.co");
  });

  it("treats a half-stored profile as incomplete, not as ready", async () => {
    await saveBackendUrl("https://pos.example.com");
    const res = await hasRequiredPlatformConfig();
    expect(res.state).toBe("incomplete");
    expect(res.have).toEqual({ supabaseUrl: false, supabaseKey: false, backendUrl: true });
  });

  it("starts sync only after the complete profile is committed", async () => {
    expect(syncRuns).toHaveLength(0);
    await saveConnectionProfile({
      supabaseUrl: "https://tenant.example.co",
      supabaseKey: KEY_A,
      backendUrl: "https://pos.example.com",
    });
    // Give the dynamic import inside afterCredentialsSaved a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(syncRuns).toEqual(["credentials-saved"]);
  });

  it("never fails a save because the backend test only warns", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/v1/health")) return new Response("{}", { status: 200 });
      return new Response(JSON.stringify({ serviceKey: false }), { status: 200 });
    }) as typeof fetch;
    const res = await saveConnectionProfile({
      supabaseUrl: "https://tenant.example.co",
      supabaseKey: KEY_A,
      backendUrl: "https://pos.example.com",
    });
    expect(res.ok).toBe(true);
  });

  it("does not report a configured device as unconfigured mid-restore", async () => {
    await saveConnectionProfile({
      supabaseUrl: "https://tenant.example.co",
      supabaseKey: KEY_A,
      backendUrl: "https://pos.example.com",
    });
    expect(await hasRequiredPlatformConfig()).toMatchObject({ ready: true });
    // A restart puts the restore back in flight; the synchronous answer must
    // fall back to the last settled verdict rather than guessing "missing".
    restart();
    expect(platformConfigReadySync()).toBe(true);
  });

  it("shows the saved values back to the settings screen, key masked", async () => {
    await saveConnectionProfile({
      supabaseUrl: "https://tenant.example.co",
      supabaseKey: KEY_A,
      backendUrl: "https://pos.example.com",
    });
    const shown = await connectionProfile();
    expect(shown.supabaseUrl).toBe("https://tenant.example.co");
    expect(shown.backendUrl).toBe("https://pos.example.com");
    expect(shown.hasKey).toBe(true);
    expect(shown.keyHint).not.toContain(KEY_A);
  });

  it("hydrates the secure profile before mounting cloud-dependent root providers", () => {
    const root = readFileSync("src/routes/__root.tsx", "utf8");
    expect(root).toContain("<ConnectionProfileBoot>");
    expect(root.indexOf("<ConnectionProfileBoot>")).toBeLessThan(root.indexOf("<AuthProvider>"));
    expect(root).toContain("void hydrateConnectionProfile().catch");
    expect(root).toContain("Restoring database connection");
  });
});
