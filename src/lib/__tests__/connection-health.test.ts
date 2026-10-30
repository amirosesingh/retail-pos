import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cloud: { error: null | { message: string; status?: number; code?: string } } = { error: null };
const configured = vi.hoisted(() => ({ url: "https://operator-project.test", key: "sb_publishable_test", ready: true }));
const staffClient = vi.hoisted(() => ({
  from: vi.fn(() => { throw new Error("A public health probe must not consult the staff client"); }),
  auth: { getSession: vi.fn() },
}));

// The probe refuses to call an unconfigured device's central database, and
// tests carry no real credentials, so the configuration check is stubbed.
vi.mock("@/lib/external-supabase-config", () => ({
  hasSupabaseConfig: () => configured.ready,
  supabaseConfig: () => configured,
}));
vi.mock("@/lib/connection-profile", () => ({ awaitProfileHydrated: async () => {} }));

vi.mock("@/integrations/supabase/external-client", () => ({
  supabaseExternal: staffClient,
}));

const bridge: { connected: boolean; present: boolean } = { connected: false, present: false };

vi.mock("@/core/local-db/local-db", () => ({
  localConfigurationBridge: () => (bridge.present ? { status: async () => ({ connected: bridge.connected }) } : null),
}));

import {
  checkHealth,
  cloudVerdict,
  cloudDiagnosis,
  resetHealthCache,
} from "@/core/activation/connection-health";
import { connectivityWarningAllowed, isConnectivityMessage } from "@/lib/notification-guard";

beforeEach(() => {
  configured.url = "https://operator-project.test"; configured.key = "sb_publishable_test"; configured.ready = true;
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (cloud.error && !cloud.error.status) throw new TypeError(cloud.error.message);
    return Response.json(cloud.error ?? [], { status: cloud.error?.status ?? 200 });
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("connection health", () => {
  afterEach(() => vi.unstubAllGlobals());
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
  it("probes a reachable backend even when the WebView offline hint is stale", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect((await checkHealth(true)).cloud).toBe(true);
    expect(cloudVerdict()).toBe("verified");
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
  it.each([[503, "service-error"], [429, "rate-limited"]] as const)("uses actual HTTP %s even though the PostgREST error body has no status", async (status, issue) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "PGRST000", message: "Service unavailable" }, { status })));
    expect((await checkHealth(true)).cloud).toBe(false);
    expect(cloudDiagnosis()).toEqual({ issue, status });
  });
  it.each(["JWT expired", "Invalid API key", "relation does not exist"])("does not misclassify HTTP 503 body %s as a credential or schema verdict", async message => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message }, { status: 503 })));
    expect((await checkHealth(true)).cloud).toBe(false);
    expect(cloudVerdict()).toBe("unreachable");
    expect(cloudDiagnosis()).toEqual({ issue: "service-error", status: 503 });
  });
  it("uses the current operator project/key without consulting the staff Auth client", async () => {
    const response = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", response);
    configured.url = "https://changed-operator-project.test/";
    configured.key = "sb_publishable_changed";
    expect((await checkHealth(true)).cloud).toBe(true);
    expect(response).toHaveBeenCalledExactlyOnceWith("https://changed-operator-project.test/rest/v1/public_flags?select=key&limit=1",
      expect.objectContaining({ headers: { apikey: "sb_publishable_changed" }, signal: expect.any(AbortSignal) }));
    expect(staffClient.from).not.toHaveBeenCalled();
    expect(staffClient.auth.getSession).not.toHaveBeenCalled();
  });
  it("supports a configured legacy anonymous key without a staff bearer", async () => {
    const response = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", response);
    configured.key = "legacy-anon-test-key";
    expect((await checkHealth(true)).cloud).toBe(true);
    expect(response).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      headers: { apikey: "legacy-anon-test-key", Authorization: "Bearer legacy-anon-test-key" },
    }));
  });
  it("does not call a public-probe rejection an expired staff session", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({message: "JWT expired"}, { status: 401 })));
    expect((await checkHealth(true)).cloud).toBe(false);
    expect(cloudDiagnosis()).toEqual({ issue: "configuration", status: 401 });
  });
  it("does not request the database until the operator configuration is present", async () => {
    configured.ready = false;
    expect((await checkHealth(true)).cloud).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(cloudVerdict()).toBe("unconfigured");
  });
  it("allows a twelve-second warm web probe without falsely marking a responding database offline", async () => {
    await checkHealth(true);
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Promise<Response>(resolve => setTimeout(() => resolve(Response.json([])), 12_000))));
    const checking = checkHealth(true);
    await vi.advanceTimersByTimeAsync(12_000);
    expect((await checking).cloud).toBe(true);
    expect(cloudDiagnosis().issue).toBe("none");
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
