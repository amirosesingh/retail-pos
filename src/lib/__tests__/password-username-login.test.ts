import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rest: vi.fn(), config: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({ validator: (parse: (data: unknown) => unknown) => ({
    handler: (handle: (input: { data: unknown }) => unknown) => (input: { data: unknown }) => handle({ data: parse(input.data) }),
  }) }),
}));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: mocks.rest }));
vi.mock("../external-supabase-config", () => ({ supabaseConfig: mocks.config }));
import { signInWithPasswordUsername } from "../password-username.functions";

const projectUrl = "https://example.supabase.co";
const accountId = "00000000-0000-4000-8000-000000000001";
const request = { username: "manager", password: "correct-password", projectUrl };

beforeEach(() => {
  mocks.config.mockReset().mockReturnValue({ url: projectUrl, key: "public-test-key" });
  mocks.rest.mockReset().mockResolvedValue(new Response(JSON.stringify([{
    email: "manager@example.com", auth_user_id: accountId, is_active: true,
  }]), { status: 200 }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    access_token: "access", refresh_token: "refresh", user: { id: accountId },
  }), { status: 200 })));
});

describe("password alias sign-in", () => {
  it("authenticates the resolved account and returns only session tokens", async () => {
    const result = await signInWithPasswordUsername({ data: request });
    expect(result).toEqual({ ok: true, accessToken: "access", refreshToken: "refresh" });
    expect(JSON.stringify(result)).not.toContain("manager@example.com");
    expect(mocks.rest.mock.calls[0][0]).toContain("login_username.eq.manager");
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`${projectUrl}/auth/v1/token?grant_type=password`);
  });
  it("does not disclose or authenticate disabled accounts", async () => {
    mocks.rest.mockResolvedValue(new Response(JSON.stringify([{
      email: "manager@example.com", auth_user_id: accountId, is_active: false,
    }]), { status: 200 }));
    expect(await signInWithPasswordUsername({ data: request })).toEqual({ ok: false, code: "invalid-credentials" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects another project's directory before any lookup", async () => {
    expect(await signInWithPasswordUsername({ data: { ...request, projectUrl: "https://other.supabase.co" } })).toEqual({ ok: false, code: "configuration-invalid" });
    expect(mocks.rest).not.toHaveBeenCalled();
  });
  it("refuses mismatched Auth identities", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: "access", refresh_token: "refresh", user: { id: "00000000-0000-4000-8000-000000000002" },
    }), { status: 200 })));
    expect(await signInWithPasswordUsername({ data: request })).toEqual({ ok: false, code: "invalid-credentials" });
  });
});
