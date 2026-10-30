import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ login: vi.fn(), fail: vi.fn(), reset: vi.fn(), status: vi.fn() }));
vi.mock("@/lib/public-api-guard.server", () => ({ callerVerifiedDownstream: () => null }));
vi.mock("@/core/api/pos-relay.server", () => ({ hasServiceKey: () => true }));
vi.mock("@/lib/pin-throttle.server", () => ({
  throttleStatus: mocks.status,
  throttleFail: mocks.fail,
  throttleReset: mocks.reset,
}));
vi.mock("@/lib/staff-username-login.server", () => ({ staffUsernameLogin: mocks.login }));

import { handleUsernameLogin } from "@/routes/api/public/username-login";

const request = (username = "manager", password = "password") => new Request(
  "https://pos.test/api/public/username-login",
  { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) },
);

describe("public username login", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.status.mockResolvedValue({ locked: false });
  });

  it("returns tokens only after a verified password and never exposes the email", async () => {
    mocks.login.mockResolvedValue({ ok: true, accessToken: "access", refreshToken: "refresh", projectUrl: "https://project.supabase.co" });
    const response = await handleUsernameLogin(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ ok: true, accessToken: "access" });
    const signal = mocks.login.mock.calls[0][2];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(mocks.status).toHaveBeenCalledWith("staff-password:manager", signal);
    expect(mocks.reset).toHaveBeenCalledExactlyOnceWith("staff-password:manager", signal);
  });

  it("throttles wrong passwords without identifying the account", async () => {
    mocks.login.mockResolvedValue({ ok: false, code: "invalid_credentials" });
    const response = await handleUsernameLogin(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, code: "invalid_credentials", error: "Invalid username or password" });
    expect(mocks.fail).toHaveBeenCalledTimes(2);
  });

  it("does not consume a wrong-password attempt on database failure", async () => {
    mocks.login.mockResolvedValue({ ok: false, code: "central_unavailable" });
    expect((await handleUsernameLogin(request())).status).toBe(503);
    expect(mocks.fail).not.toHaveBeenCalled();
  });

  it("rejects an oversized unauthenticated body before login work", async () => {
    const oversized = request("manager", "x".repeat(10_000));
    expect((await handleUsernameLogin(oversized)).status).toBe(401);
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it("does not use caller-supplied X-Forwarded-For for the rate-limit key", async () => {
    mocks.login.mockResolvedValue({ ok: false, code: "invalid_credentials" });
    const spoofed = request();
    spoofed.headers.set("x-forwarded-for", "1.2.3.4");
    await handleUsernameLogin(spoofed);
    expect(mocks.status).toHaveBeenCalledWith("staff-password-ip:unknown", expect.any(AbortSignal));
    expect(mocks.status.mock.calls.map(call => call[0])).not.toContain("staff-password-ip:1.2.3.4");
  });
});
