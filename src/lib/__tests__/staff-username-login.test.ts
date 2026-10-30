import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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
    expect(await staffUsernameLogin("alice", "password")).toEqual({ ok: false, code: "central_unavailable" });
  });

  it.each([null, {}, [{ ...account, auth_user_id: null }], [{ ...account, email: "" }]])(
    "does not consume a wrong-password result for incomplete account metadata %j", async payload => {
      mocks.rest.mockResolvedValue(Response.json(payload));
      expect(await staffUsernameLogin("alice", "password")).toEqual({ ok: false, code: "central_unavailable" });
      expect(mocks.signIn).not.toHaveBeenCalled();
    },
  );

  it.each([null, {}, { access_token: "access" }])("does not call incomplete successful Auth session %j a wrong password", async session => {
    mocks.signIn.mockResolvedValue({ data: { user: { id: "auth-1" }, session }, error: null });
    expect(await staffUsernameLogin("alice", "password")).toEqual({ ok: false, code: "central_unavailable" });
  });

  it("bounds the account lookup with the shared password deadline", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    mocks.rest.mockImplementationOnce((_path, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const checking = staffUsernameLogin("alice", "password");
    controller.abort();
    expect(await checking).toEqual({ ok: false, code: "central_unavailable" });
    expect(timeout).toHaveBeenCalledExactlyOnceWith(20_000);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("shares the same deadline with Auth fetch without automatic credential resubmission", async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetch = vi.fn((_input, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetch);
    mocks.signIn.mockImplementationOnce(async () => {
      const configured = mocks.createClient.mock.calls[0][2];
      await configured.global.fetch("https://project.supabase.co/auth/v1/token", {});
    });
    const checking = staffUsernameLogin("alice", "password");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(fetch.mock.calls[0][1].signal).toBe(mocks.rest.mock.calls[0][1].signal);
    controller.abort();
    expect(await checking).toEqual({ ok: false, code: "central_unavailable" });
    expect(mocks.signIn).toHaveBeenCalledOnce();
  });

  it("does not treat database failure as a wrong password", async () => {
    mocks.rest.mockResolvedValue(new Response("unavailable", { status: 503 }));
    expect(await staffUsernameLogin("alice", "password")).toEqual({ ok: false, code: "central_unavailable" });
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it.each([
    { message: "Failed to fetch" }, { message: "Request timed out", status: 503 },
    { message: "Service unavailable", status: 503 },
  ])("does not treat an Auth service failure as a wrong password: %j", async error => {
    mocks.signIn.mockResolvedValue({ data: { session: null, user: null }, error });
    expect(await staffUsernameLogin("alice", "password")).toEqual({ ok: false, code: "central_unavailable" });
  });
  it("preserves a confirmed incorrect password refusal", async () => {
    mocks.signIn.mockResolvedValue({ data: { session: null, user: null }, error: { code: "invalid_credentials" } });
    expect(await staffUsernameLogin("alice", "password")).toEqual({ ok: false, code: "invalid_credentials" });
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
