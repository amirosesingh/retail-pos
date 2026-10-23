import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rest: vi.fn(),
  signIn: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: mocks.rest }));
vi.mock("@/lib/external-supabase-config", () => ({
  supabaseConfig: () => ({ url: "https://project.supabase.co", key: "publishable-key" }),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { staffUsernameLogin } from "@/lib/staff-username-login.server";

const account = {
  user_id: "alice",
  login_username: "alice",
  email: "alice@example.com",
  auth_user_id: "auth-1",
  is_active: true,
};

describe("staff username/password login", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.createClient.mockReturnValue({ auth: { signInWithPassword: mocks.signIn } });
    mocks.rest.mockResolvedValue(Response.json([account]));
    mocks.signIn.mockResolvedValue({
      data: { user: { id: "auth-1" }, session: { access_token: "access", refresh_token: "refresh" } },
      error: null,
    });
  });

  it("looks up the unique username and authenticates with Supabase Auth", async () => {
    expect(await staffUsernameLogin(" ALICE ", "correct-password")).toEqual({
      ok: true, accessToken: "access", refreshToken: "refresh", projectUrl: "https://project.supabase.co",
    });
    expect(mocks.rest.mock.calls[0][0]).toContain("login_username.eq.alice");
    expect(mocks.signIn).toHaveBeenCalledWith({ email: account.email, password: "correct-password" });
  });

  it("rejects inactive, ambiguous and mismatched accounts without issuing tokens", async () => {
    mocks.rest.mockResolvedValueOnce(Response.json([{ ...account, is_active: false }]));
    expect(await staffUsernameLogin("alice", "password")).toEqual({ ok: false, code: "invalid_credentials" });
    mocks.rest.mockResolvedValueOnce(Response.json([account, { ...account, user_id: "other" }]));
    expect(await staffUsernameLogin("alice", "password")).toEqual({ ok: false, code: "invalid_credentials" });
    expect(mocks.signIn).not.toHaveBeenCalled();
    mocks.signIn.mockResolvedValueOnce({
      data: { user: { id: "wrong" }, session: { access_token: "access", refresh_token: "refresh" } },
      error: null,
    });
    expect(await staffUsernameLogin("alice", "password")).toEqual({ ok: false, code: "invalid_credentials" });
  });

  it("does not treat database failure as a wrong password", async () => {
    mocks.rest.mockResolvedValue(new Response("unavailable", { status: 503 }));
    expect(await staffUsernameLogin("alice", "password")).toEqual({ ok: false, code: "central_unavailable" });
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("rejects database-filter syntax before sending a query", async () => {
    expect(await staffUsernameLogin("alice),is_active.eq.true", "password")).toEqual({
      ok: false, code: "invalid_credentials",
    });
    expect(mocks.rest).not.toHaveBeenCalled();
  });

  it("preserves existing internal-username staff login", async () => {
    mocks.rest.mockResolvedValue(Response.json([{ ...account, email: "alice@pos-internal.local" }]));
    expect((await staffUsernameLogin("alice", "password")).ok).toBe(true);
    expect(mocks.signIn).toHaveBeenCalledWith({ email: "alice@pos-internal.local", password: "password" });
  });
});
