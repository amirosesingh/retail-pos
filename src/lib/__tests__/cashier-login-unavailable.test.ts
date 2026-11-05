import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rest: vi.fn(), audit: vi.fn(), fail: vi.fn() }));
vi.mock("@/core/api/pos-relay.server", () => ({
  serviceRest: mocks.rest,
  hasServiceKey: () => true,
}));
vi.mock("@/lib/public-api-guard.server", () => ({ callerVerifiedDownstream: () => null }));
vi.mock("@/lib/system-audit.server", () => ({ writeSystemAudit: mocks.audit }));
vi.mock("@/lib/pin-throttle.server", () => ({
  throttleStatus: async () => ({ locked: false }),
  throttleFail: mocks.fail,
  throttleReset: vi.fn(),
  minutesLeft: () => 1,
}));
import { handleCashierLogin } from "@/routes/api/public/cashier-login";

const request = (username = "staff1") =>
  new Request("https://pos.test/api/public/cashier-login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
    body: JSON.stringify({ username, pin: "1234" }),
  });

describe("cashier login infrastructure failures", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  it("returns unavailable without consuming a wrong-PIN attempt when verification fails", async () => {
    mocks.rest.mockResolvedValue(new Response("database timeout", { status: 503 }));
    const response = await handleCashierLogin(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "central_unavailable" });
    expect(mocks.fail).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("distinguishes a failed profile read from an inactive account", async () => {
    mocks.rest
      .mockResolvedValueOnce(Response.json({ status: "verified", account: { user_id: "staff1" } }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 500 }));
    const response = await handleCashierLogin(request());
    expect(response.status).toBe(503);
    expect(mocks.fail).not.toHaveBeenCalled();
  });
  it("checks email directly once and preserves unavailable responses", async () => {
    mocks.rest.mockResolvedValue(new Response("unavailable", { status: 503 }));
    expect((await handleCashierLogin(request("staff@example.test"))).status).toBe(503);
    expect(mocks.rest).toHaveBeenCalledTimes(1);
    expect(mocks.fail).not.toHaveBeenCalled();
  });
  it.each([[], null, {}])("does not call an incomplete profile %j deactivated or a wrong PIN", async payload => {
    mocks.rest.mockResolvedValueOnce(Response.json({ status: "verified", account: { user_id: "staff1" } }))
      .mockResolvedValueOnce(Response.json(payload));
    const response = await handleCashierLogin(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "central_unavailable" });
    expect(mocks.fail).not.toHaveBeenCalled();
  });
  it("still refuses and counts a genuinely wrong PIN", async () => {
    mocks.rest.mockResolvedValue(Response.json({ status: "invalid" }));
    const response = await handleCashierLogin(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "sign_in_failed" });
    expect(mocks.fail).toHaveBeenCalledTimes(2);
  });
  it.each(["locked", "credential_unavailable", "account_inactive", "invalid_input"])("does not consume outer wrong-PIN attempts for %s", async status => {
    mocks.rest.mockResolvedValue(Response.json({ status }));
    const response = await handleCashierLogin(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, code: "sign_in_failed" });
    expect(mocks.fail).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each([null, { error: "incomplete response" }])("does not count malformed successful verification data %j as a wrong PIN", async payload => {
    mocks.rest.mockResolvedValue(Response.json(payload));
    const response = await handleCashierLogin(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "central_unavailable" });
    expect(mocks.fail).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
