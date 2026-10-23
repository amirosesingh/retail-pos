import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  config: { url: "https://tenant-a.example.co", key: "publishable-a" },
  memberConfig: { url: "https://members-a.example.co", key: "member-publishable-a" },
  clients: [] as Array<{
    auth: {
      stopAutoRefresh: ReturnType<typeof vi.fn>;
      getSession: ReturnType<typeof vi.fn>;
    };
    removeAllChannels: ReturnType<typeof vi.fn>;
  }>,
  session: null as { access_token: string } | null,
  fetchers: [] as Array<typeof fetch>,
  transport: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn((_url, _key, options) => {
    harness.fetchers.push(options.global.fetch);
    const client = {
      auth: {
        stopAutoRefresh: vi.fn(),
        getSession: vi.fn(async () => ({ data: { session: harness.session }, error: null })),
      },
      removeAllChannels: vi.fn(() => Promise.resolve()),
    };
    harness.clients.push(client);
    return client;
  }),
}));

vi.mock("@/lib/desktop-supabase-fetch", () => ({ desktopSupabaseFetch: harness.transport }));
vi.mock("@/lib/fetch-deadline", () => ({ fetchWithDeadline: harness.transport }));

vi.mock("@/lib/external-supabase-config", () => ({
  supabaseConfig: (scope = "pos") => ({
    ...(scope === "membership" ? harness.memberConfig : harness.config),
  }),
}));

vi.mock("@/lib/session-expiry", () => ({
  inspectResponse: vi.fn(),
  noteConnectivityIssue: vi.fn(),
  clearConnectivityIssue: vi.fn(),
}));

vi.mock("@/integrations/supabase/auth-storage", () => ({ externalAuthStorage: {} }));

describe("external Supabase client ownership", () => {
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as Record<PropertyKey, unknown>)[
      Symbol.for("retail-pos.supabase.external-clients.v1")
    ];
    harness.config = { url: "https://tenant-a.example.co", key: "publishable-a" };
    harness.memberConfig = {
      url: "https://members-a.example.co",
      key: "member-publishable-a",
    };
    harness.clients.length = 0;
    harness.session = null;
    harness.fetchers.length = 0;
    harness.transport.mockReset();
    harness.transport.mockResolvedValue(new Response("[]"));
  });

  it("reuses the same GoTrue owner when the module is evaluated again", async () => {
    const firstModule = await import("@/integrations/supabase/external-client");
    const first = firstModule.externalClientSnapshot();

    vi.resetModules();
    const reloadedModule = await import("@/integrations/supabase/external-client");
    const second = reloadedModule.externalClientSnapshot();

    expect(second).toBe(first);
    expect(harness.clients).toHaveLength(1);
  });

  it("keeps one GoTrue client for the same profile and replaces it only when the tenant changes", async () => {
    const { externalClientSnapshot, resetExternalClient } =
      await import("@/integrations/supabase/external-client");

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
    const { memberPortalClientSnapshot, resetExternalClient } =
      await import("@/integrations/supabase/external-client");

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

  it("returns an authenticated snapshot only after the concrete client restores a bearer", async () => {
    const { authenticatedExternalClientSnapshot, externalClientSnapshot } =
      await import("@/integrations/supabase/external-client");

    expect(await authenticatedExternalClientSnapshot()).toBeNull();
    harness.session = { access_token: "verified-user-token" };
    expect(await authenticatedExternalClientSnapshot()).toBe(externalClientSnapshot());
  });

  it("notifies Auth owners only when the POS tenant client is replaced", async () => {
    const { externalClientSnapshot, resetExternalClient, subscribeExternalClientReset } =
      await import("@/integrations/supabase/external-client");
    const listener = vi.fn();
    const unsubscribe = subscribeExternalClientReset(listener);

    externalClientSnapshot();
    resetExternalClient();
    expect(listener).not.toHaveBeenCalled();

    harness.config = { url: "https://tenant-b.example.co", key: "publishable-b" };
    resetExternalClient();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });
  it("stops anonymous protected requests before transport but preserves public reads", async () => {
    const { externalClientSnapshot } = await import("@/integrations/supabase/external-client");
    externalClientSnapshot();
    const fetcher = harness.fetchers[0];
    for (const path of [
      "products",
      "stores",
      "sales",
      "audit_logs",
      "user_roles",
      "settings_overrides",
      "settings_locks",
      "stock_transfers",
      "staff_roles",
      "rpc/current_app_user",
    ]) {
      const result = await fetcher(`https://tenant-a.example.co/rest/v1/${path}`);
      expect(result.status).toBe(401);
    }
    expect(harness.transport).not.toHaveBeenCalled();
    await fetcher("https://tenant-a.example.co/rest/v1/public_flags");
    expect(harness.transport).toHaveBeenCalledOnce();
  });
  it("preserves a signed-in bearer and denies publishable keys used as bearer tokens", async () => {
    const { externalClientSnapshot } = await import("@/integrations/supabase/external-client");
    externalClientSnapshot();
    const fetcher = harness.fetchers[0];
    expect(
      (
        await fetcher("https://tenant-a.example.co/rest/v1/products", {
          headers: { Authorization: "Bearer publishable-a" },
        })
      ).status,
    ).toBe(401);
    await fetcher("https://tenant-a.example.co/rest/v1/products", {
      headers: { Authorization: "Bearer user-session" },
    });
    expect(harness.transport).toHaveBeenCalledOnce();
    expect(new Headers(harness.transport.mock.calls[0][1].headers).get("Authorization")).toBe(
      "Bearer user-session",
    );
  });
  it("does not let membership requests alter POS connectivity or session diagnostics", async () => {
    const { memberPortalClientSnapshot } = await import("@/integrations/supabase/external-client");
    const diagnostics = await import("@/lib/session-expiry");
    vi.mocked(diagnostics.clearConnectivityIssue).mockClear();
    vi.mocked(diagnostics.noteConnectivityIssue).mockClear();
    vi.mocked(diagnostics.inspectResponse).mockClear();
    memberPortalClientSnapshot();
    const fetcher = harness.fetchers[0];
    await fetcher("https://members-a.example.co/rest/v1/public_flags");
    harness.transport.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(fetcher("https://members-a.example.co/rest/v1/public_flags")).rejects.toThrow();
    harness.transport.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    expect((await fetcher("https://members-a.example.co/rest/v1/public_flags")).status).toBe(503);
    expect(diagnostics.clearConnectivityIssue).not.toHaveBeenCalled();
    expect(diagnostics.noteConnectivityIssue).not.toHaveBeenCalled();
    expect(diagnostics.inspectResponse).not.toHaveBeenCalled();
  });
  it("ignores caller timeouts but reports actual transport timeouts", async () => {
    const { externalClientSnapshot } = await import("@/integrations/supabase/external-client");
    const { noteConnectivityIssue } = await import("@/lib/session-expiry");
    vi.mocked(noteConnectivityIssue).mockClear();
    externalClientSnapshot();
    const fetcher = harness.fetchers[0];
    const controller = new AbortController();
    controller.abort(new DOMException("Probe ended", "TimeoutError"));
    harness.transport.mockRejectedValueOnce(controller.signal.reason);
    await expect(fetcher("https://tenant-a.example.co/rest/v1/public_flags", { signal: controller.signal })).rejects.toThrow("Probe ended");
    expect(noteConnectivityIssue).not.toHaveBeenCalled();
    harness.transport.mockRejectedValueOnce(new DOMException("Server timed out", "TimeoutError"));
    await expect(fetcher("https://tenant-a.example.co/rest/v1/public_flags")).rejects.toThrow("Server timed out");
    expect(noteConnectivityIssue).toHaveBeenCalledOnce();
  });
  it("clears connectivity warnings after recovery and ignores deliberate cancellation", async () => {
    const { externalClientSnapshot } = await import("@/integrations/supabase/external-client");
    const { clearConnectivityIssue, noteConnectivityIssue } = await import("@/lib/session-expiry");
    vi.mocked(clearConnectivityIssue).mockClear();
    vi.mocked(noteConnectivityIssue).mockClear();
    externalClientSnapshot();
    const fetcher = harness.fetchers[0];
    harness.transport.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(fetcher("https://tenant-a.example.co/rest/v1/public_flags")).rejects.toThrow("Failed to fetch");
    expect(noteConnectivityIssue).toHaveBeenCalledOnce();
    await fetcher("https://tenant-a.example.co/rest/v1/public_flags");
    expect(clearConnectivityIssue).toHaveBeenCalledOnce();
    harness.transport.mockRejectedValueOnce(new DOMException("Cancelled", "AbortError"));
    await expect(fetcher("https://tenant-a.example.co/rest/v1/public_flags")).rejects.toThrow("Cancelled");
    expect(noteConnectivityIssue).toHaveBeenCalledOnce();
  });

});
