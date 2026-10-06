import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  config: { url: "https://tenant-a.example.co", key: "publishable-a" },
  memberConfig: { url: "https://members-a.example.co", key: "member-publishable-a" },
  clients: [] as Array<{
    auth: { stopAutoRefresh: ReturnType<typeof vi.fn> };
    removeAllChannels: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => {
    const client = {
      auth: { stopAutoRefresh: vi.fn() },
      removeAllChannels: vi.fn(),
    };
    harness.clients.push(client);
    return client;
  }),
}));

vi.mock("@/lib/external-supabase-config", () => ({
  supabaseConfig: (scope = "pos") => ({
    ...(scope === "membership" ? harness.memberConfig : harness.config),
  }),
}));

vi.mock("@/lib/session-expiry", () => ({
  inspectResponse: vi.fn(),
  noteConnectivityIssue: vi.fn(),
}));

vi.mock("@/integrations/supabase/auth-storage", () => ({ externalAuthStorage: {} }));

describe("external Supabase client ownership", () => {
  beforeEach(() => {
    vi.resetModules();
    harness.config = { url: "https://tenant-a.example.co", key: "publishable-a" };
    harness.memberConfig = {
      url: "https://members-a.example.co",
      key: "member-publishable-a",
    };
    harness.clients.length = 0;
  });

  it("keeps one GoTrue client for the same profile and replaces it only when the tenant changes", async () => {
    const { externalClientSnapshot, resetExternalClient } = await import(
      "@/integrations/supabase/external-client"
    );

    const first = externalClientSnapshot();
    resetExternalClient();
    expect(externalClientSnapshot()).toBe(first);
    expect(harness.clients).toHaveLength(1);
    expect(harness.clients[0]!.auth.stopAutoRefresh).not.toHaveBeenCalled();

    harness.config = { url: "https://tenant-b.example.co", key: "publishable-b" };
    resetExternalClient();
    const second = externalClientSnapshot();
    expect(second).not.toBe(first);
    expect(harness.clients).toHaveLength(2);
    expect(harness.clients[0]!.auth.stopAutoRefresh).toHaveBeenCalledOnce();
    expect(harness.clients[0]!.removeAllChannels).toHaveBeenCalledOnce();
  });

  it("keeps membership Auth isolated and replaces only the changed membership tenant", async () => {
    const { memberPortalClientSnapshot, resetExternalClient } = await import(
      "@/integrations/supabase/external-client"
    );

    const first = memberPortalClientSnapshot();
    resetExternalClient();
    expect(memberPortalClientSnapshot()).toBe(first);
    expect(harness.clients).toHaveLength(1);

    harness.memberConfig = {
      url: "https://members-b.example.co",
      key: "member-publishable-b",
    };
    resetExternalClient();
    expect(memberPortalClientSnapshot()).not.toBe(first);
    expect(harness.clients).toHaveLength(2);
    expect(harness.clients[0]!.auth.stopAutoRefresh).toHaveBeenCalledOnce();
    expect(harness.clients[0]!.removeAllChannels).toHaveBeenCalledOnce();
  });
});
