/**
 * A terminal is ready only when its own secure store holds a complete
 * connection profile: central database URL, API key and POS backend address.
 * Nothing may come from the web deployment's environment.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const platform = vi.hoisted(() => ({ terminal: true }));
const store = vi.hoisted(() => ({
  status: { configured: false, url: "", keyHint: "", encrypted: true, source: "android" as const },
  backend: "",
}));

vi.mock("@/platform-config/platform", () => ({
  isTerminalApp: () => platform.terminal,
}));

vi.mock("@/lib/secure-cloud-config", () => ({
  cloudKeyStatus: async () => store.status,
  subscribeCloudKeys: () => () => {},
}));

vi.mock("@/lib/external-supabase-config", () => ({
  hasTerminalSupabaseOverride: () => store.status.configured,
}));

vi.mock("@/lib/backend-config", () => ({
  backendUrl: async () => store.backend,
}));

// These tests exercise readiness after restoration; vault failures are covered
// by connection-profile.test.ts with the real restoration path.
vi.mock("@/lib/connection-profile", () => ({
  hydrateConnectionProfile: async () => {},
  isConnectionProfileHydrated: () => true,
  subscribeProfileHydrated: () => () => {},
}));

import { hasRequiredPlatformConfig } from "../platform-config-ready";

const configured = {
  configured: true,
  url: "https://tenant.example.co",
  keyHint: "abc…wxyz",
  encrypted: true,
  source: "android" as const,
};

describe("hasRequiredPlatformConfig", () => {
  beforeEach(() => {
    platform.terminal = true;
    store.status = { configured: false, url: "", keyHint: "", encrypted: true, source: "android" };
    store.backend = "";
  });

  it("reports a fresh terminal as missing, not as an error", async () => {
    const res = await hasRequiredPlatformConfig();
    expect(res.ready).toBe(false);
    expect(res.state).toBe("missing");
  });

  it("reports a half-configured terminal as incomplete", async () => {
    store.backend = "https://pos.example.com";
    const res = await hasRequiredPlatformConfig();
    expect(res.state).toBe("incomplete");
    expect(res.have).toEqual({ supabaseUrl: false, supabaseKey: false, backendUrl: true });
  });

  it("is not ready when the backend address was never entered", async () => {
    store.status = configured;
    const res = await hasRequiredPlatformConfig();
    expect(res.ready).toBe(false);
    expect(res.state).toBe("incomplete");
    expect(res.reason).toMatch(/backend address/i);
  });

  it("rejects a stored address that is not a real https URL", async () => {
    store.status = { ...configured, url: "not-a-url" };
    store.backend = "https://pos.example.com";
    const res = await hasRequiredPlatformConfig();
    expect(res.ready).toBe(false);
    expect(res.state).toBe("failed");
  });

  it("accepts a fully configured terminal", async () => {
    store.status = configured;
    store.backend = "https://pos.example.com";
    const res = await hasRequiredPlatformConfig();
    expect(res.ready).toBe(true);
    expect(res.state).toBe("ready");
  });

  it("never blocks the web build", async () => {
    platform.terminal = false;
    const res = await hasRequiredPlatformConfig();
    expect(res.ready).toBe(true);
    expect(res.state).toBe("not-applicable");
  });
});
