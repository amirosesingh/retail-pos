import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  session: null as unknown,
  branch: "branch-a",
  saved: null as unknown,
  getUser: vi.fn(),
  refresh: vi.fn(),
  login: vi.fn(),
  discard: vi.fn(),
  provision: vi.fn(),
}));
vi.mock("@/integrations/supabase/external-client", () => ({
  externalClientSnapshot: () => ({
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
      getUser: state.getUser,
      refreshSession: state.refresh,
      signInWithPassword: state.login,
    },
  }),
  discardRejectedExternalAuthSession: state.discard,
}));
vi.mock("../terminal-account.functions", () => ({ getTerminalAccount: state.provision }));
vi.mock("../device-secrets", () => ({
  getDeviceSecret: async () => state.saved,
  setDeviceSecret: vi.fn(),
}));
vi.mock("@/core/activation/terminal-tokens", () => ({
  readTerminalConfig: () => ({ tokenId: "terminal-id", locationId: state.branch, deviceType: "mobile" }),
}));
vi.mock("@/core/activation/device-proof", () => ({ deviceProofHash: async () => "proof" }));
vi.mock("../audit-log", () => ({ logger: { log: vi.fn() } }));
vi.mock("../connection-profile", () => ({ awaitProfileHydrated: async () => {} }));
vi.mock("../external-supabase-config", () => ({
  supabaseConfig: () => ({ url: "https://tenant.example" }),
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("window", {});
  state.session = null;
  state.branch = "branch-a";
  state.saved = {
    email: "terminal@example",
    password: "secret",
    projectUrl: "https://tenant.example",
  };
  state.getUser.mockResolvedValue({ data: { user: { id: "terminal" } }, error: null });
  state.login.mockResolvedValue({ error: null });
  state.discard.mockImplementation(async () => {
    state.session = null;
  });
  state.provision.mockResolvedValue({ ok: true, email: "terminal@example", password: "fresh" });
});
const restored = () => ({
  access_token: "cached",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "terminal" },
});
it("proves a restored machine session before using it", async () => {
  state.session = restored();
  const { ensureTerminalSession } = await import("../terminal-session");
  expect(await ensureTerminalSession()).toBe(true);
  expect(state.getUser).toHaveBeenCalledOnce();
  expect(state.login).not.toHaveBeenCalled();
});
it("clears a revoked machine session and recovers without clearing PIN credentials", async () => {
  state.session = restored();
  state.getUser.mockResolvedValue({
    data: { user: null },
    error: { status: 403, message: "Session not found" },
  });
  const { ensureTerminalSession } = await import("../terminal-session");
  expect(await ensureTerminalSession()).toBe(true);
  expect(state.discard).toHaveBeenCalledOnce();
  expect(state.login).toHaveBeenCalledWith({ email: "terminal@example", password: "secret" });
});
it("preserves credentials during a cloud outage and bounds retries", async () => {
  state.session = restored();
  state.getUser.mockRejectedValue(new TypeError("Failed to fetch"));
  const { ensureTerminalSession } = await import("../terminal-session");
  expect(await ensureTerminalSession()).toBe(false);
  expect(await ensureTerminalSession()).toBe(false);
  expect(state.getUser).toHaveBeenCalledOnce();
  expect(state.discard).not.toHaveBeenCalled();
  expect(state.provision).not.toHaveBeenCalled();
  expect(state.login).not.toHaveBeenCalled();
});
it("repairs malformed stored credentials before attempting password login", async () => {
  state.saved = { projectUrl: "https://tenant.example" };
  const { ensureTerminalSession } = await import("../terminal-session");
  expect(await ensureTerminalSession()).toBe(true);
  expect(state.provision).toHaveBeenCalledOnce();
  expect(state.login).toHaveBeenCalledWith({ email: "terminal@example", password: "fresh" });
});
it("never sends missing email/password from an invalid provisioning response", async () => {
  state.saved = null;
  state.provision.mockResolvedValue({ ok: true });
  const { ensureTerminalSession } = await import("../terminal-session");
  expect(await ensureTerminalSession()).toBe(false);
  expect(state.login).not.toHaveBeenCalled();
});

it("does not use saved machine credentials for a management phone", async () => {
  state.branch = "";
  const { ensureTerminalSession } = await import("../terminal-session");
  expect(await ensureTerminalSession()).toBe(false);
  expect(state.login).not.toHaveBeenCalled();
  expect(state.provision).not.toHaveBeenCalled();
});
