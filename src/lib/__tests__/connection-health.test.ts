import { beforeEach, describe, expect, it, vi } from "vitest";

const cloud: { error: null | { message: string; status?: number; code?: string } } = { error: null };

// The probe refuses to call an unconfigured device's central database, and
// tests carry no real credentials, so the configuration check is stubbed.
vi.mock("@/lib/external-supabase-config", () => ({
  hasSupabaseConfig: () => true,
}));

vi.mock("@/integrations/supabase/external-client", () => ({
  supabaseExternal: {
    from: () => ({
      select: () => ({
        limit: async () => ({ error: cloud.error }),
      }),
    }),
  },
}));

const bridge: { connected: boolean; present: boolean } = { connected: false, present: false };

vi.mock("@/core/local-db/local-db", () => ({
  localDb: () => (bridge.present ? { status: async () => ({ connected: bridge.connected }) } : null),
}));

import {
  checkHealth,
  cloudVerdict,
  resetHealthCache,
} from "@/core/activation/connection-health";
import { connectivityWarningAllowed, isConnectivityMessage } from "@/lib/notification-guard";

describe("connection health", () => {
  beforeEach(() => {
    resetHealthCache();
    cloud.error = null;
    bridge.present = false;
    bridge.connected = false;
  });

  it("reports the cloud as reachable on its own", async () => {
    const report = await checkHealth();
    expect(report.cloud).toBe(true);
    expect(report.anyOnline).toBe(true);
  });

  it("reports the local database as reachable when the cloud is down", async () => {
    cloud.error = { message: "Failed to fetch" };
    bridge.present = true;
    bridge.connected = true;
    const report = await checkHealth();
    expect(report.cloud).toBe(false);
    expect(report.local).toBe(true);
    expect(report.anyOnline).toBe(true);
  });

  it("reuses the cached answer inside the cache window", async () => {
    const first = await checkHealth();
    cloud.error = { message: "Failed to fetch" };
    const second = await checkHealth();
    expect(second.at).toBe(first.at);
    expect(second.cloud).toBe(true);
  });

  it("sees nothing reachable when both are down", async () => {
    cloud.error = { message: "Failed to fetch" };
    const report = await checkHealth();
    expect(report.anyOnline).toBe(false);
  });

  it("accepts a permission-restricted probe as a valid configured project", async () => {
    cloud.error = { code: "42501", status: 403, message: "permission denied for table public_flags" };
    const report = await checkHealth(true);
    expect(report.cloud).toBe(true);
    expect(cloudVerdict()).toBe("verified");
  });

  it("still rejects a genuinely invalid publishable key", async () => {
    cloud.error = { status: 401, message: "Invalid API key" };
    const report = await checkHealth(true);
    expect(report.cloud).toBe(false);
    expect(cloudVerdict()).toBe("rejected");
  });

  it("does not treat unrelated policy errors as proof that the key is valid", async () => {
    cloud.error = { status: 403, message: "The project access policy is unavailable" };
    const report = await checkHealth(true);
    expect(report.cloud).toBe(false);
    expect(cloudVerdict()).toBe("rejected");
  });
});

describe("notification guard", () => {
  beforeEach(() => {
    resetHealthCache();
    cloud.error = null;
    bridge.present = false;
    bridge.connected = false;
  });

  it("recognises connectivity wording", () => {
    expect(isConnectivityMessage("Database Connection Required: ...")).toBe(true);
    expect(isConnectivityMessage("Saving sale is missing a required field.")).toBe(false);
  });

  it("suppresses an offline warning while a database is reachable", async () => {
    expect(await connectivityWarningAllowed()).toBe(false);
  });

  it("allows the warning only when nothing answers", async () => {
    cloud.error = { message: "Failed to fetch" };
    expect(await connectivityWarningAllowed()).toBe(true);
  });
});
