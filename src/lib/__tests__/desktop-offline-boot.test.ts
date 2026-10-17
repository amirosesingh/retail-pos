import { afterEach, describe, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/connection-profile", () => ({ awaitProfileHydrated: async () => {} }));
vi.mock("@/core/local-db/local-db", () => ({ localDb: () => ({ database: { getState: async () => ({ connected: true }) } }) }));
vi.mock("@/platform-config/features", () => ({ isWindowsShell: () => true }));
vi.mock("@/lib/external-supabase-config", () => ({ hasSupabaseConfig: () => true }));
vi.mock("@/integrations/supabase/external-client", () => ({ supabaseExternal: { from: () => ({ select: () => ({ limit: query }) }) } }));

describe("offline Windows startup with a connected LAN", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("keeps local SQL Server available without waiting for two long cloud probes", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { onLine: true });
    query.mockImplementation(() => new Promise(() => {}));
    const health = await import("@/core/activation/connection-health");
    const checking = health.checkHealth(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await checking).toMatchObject({ local: true, cloud: false, anyOnline: true });
    expect(health.cloudVerdict()).toBe("unreachable");
    expect(query).toHaveBeenCalledOnce();
  });
});
