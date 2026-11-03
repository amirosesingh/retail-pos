import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  ip: vi.fn(),
  status: vi.fn(),
  fail: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: mocks.request,
  getRequestIP: mocks.ip,
}));
vi.mock("../pin-throttle.server", () => ({
  throttleStatus: mocks.status,
  throttleFail: mocks.fail,
  throttleReset: mocks.reset,
}));

import { beginPinRequest, finishPinRequest } from "../pin-request-throttle.server";

describe("PIN request address throttle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.status.mockResolvedValue({ locked: false });
  });

  it("shares one address bucket across PIN callers and counts only failed proofs", async () => {
    mocks.ip.mockReturnValue("203.0.113.7");
    const attempt = await beginPinRequest();
    expect(attempt).toEqual({ key: "cashier-ip:203.0.113.7", locked: false });
    await finishPinRequest(attempt.key, false);
    expect(mocks.fail).toHaveBeenCalledWith(attempt.key, 20);
    await finishPinRequest(attempt.key, true);
    expect(mocks.reset).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledTimes(1);
  });

  it("blocks a locked address before checking a PIN", async () => {
    mocks.ip.mockReturnValue("203.0.113.7");
    mocks.status.mockResolvedValue({ locked: true });
    expect(await beginPinRequest()).toEqual({ key: "cashier-ip:203.0.113.7", locked: true });
  });

  it("ignores caller-controlled forwarding headers and retains the SQL account lockout", async () => {
    mocks.ip.mockReturnValue(undefined);
    mocks.request.mockReturnValue(new Request("https://pos.test", {
      headers: { "x-forwarded-for": "198.51.100.2" },
    }));
    expect(await beginPinRequest()).toEqual({ key: null, locked: false });
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it("fails closed when central address protection cannot be read", async () => {
    mocks.ip.mockReturnValue("203.0.113.7");
    mocks.status.mockRejectedValue(new Error("database unavailable"));
    await expect(beginPinRequest()).rejects.toThrow("database unavailable");
  });

  it("uses trusted Worker context without reading the framework or forwarding headers", async () => {
    mocks.ip.mockReturnValue("192.0.2.99");
    const request = new Request("https://pos.test", { headers: {
      "cf-connecting-ip": "198.51.100.4", "x-forwarded-for": "198.51.100.5", forwarded: "for=198.51.100.6",
    } });
    const signal = new AbortController().signal;
    expect(await beginPinRequest(request, signal, { trustedWorkerIp: " 2001:DB8::1 " }))
      .toEqual({ key: "cashier-ip:2001:db8::1", locked: false });
    expect(mocks.status).toHaveBeenCalledWith("cashier-ip:2001:db8::1", signal);
    expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.ip).not.toHaveBeenCalled();
  });

  it.each([null, "", "unknown", "203.0.113.1, 198.51.100.1", "for=203.0.113.1"])(
    "never falls back from an absent or malformed trusted Worker address %j", async trustedWorkerIp => {
      mocks.ip.mockReturnValue("192.0.2.99");
      const request = new Request("https://pos.test", { headers: { "cf-connecting-ip": "198.51.100.4" } });
      expect(await beginPinRequest(request, undefined, { trustedWorkerIp })).toEqual({ key: null, locked: false });
      expect(mocks.status).not.toHaveBeenCalled(); expect(mocks.ip).not.toHaveBeenCalled();
    },
  );

  it("keeps the framework transport address ahead of request headers for existing callers", async () => {
    mocks.ip.mockReturnValue("192.0.2.99");
    const request = new Request("https://pos.test", { headers: {
      "cf-connecting-ip": "198.51.100.4", "x-forwarded-for": "198.51.100.5",
    } });
    expect(await beginPinRequest(request)).toEqual({ key: "cashier-ip:192.0.2.99", locked: false });
    expect(mocks.ip).toHaveBeenCalledOnce(); expect(mocks.request).not.toHaveBeenCalled();
  });

  it("retains the existing Cloudflare-header fallback for framework callers without an address", async () => {
    mocks.ip.mockReturnValue(undefined);
    const request = new Request("https://pos.test", { headers: { "cf-connecting-ip": "203.0.113.8" } });
    expect(await beginPinRequest(request)).toEqual({ key: "cashier-ip:203.0.113.8", locked: false });
    expect(mocks.ip).toHaveBeenCalledOnce();
  });

  it("fails closed on the trusted Worker path when the central address bucket cannot be checked", async () => {
    mocks.status.mockRejectedValue(new Error("address protection unavailable"));
    await expect(beginPinRequest(undefined, undefined, { trustedWorkerIp: "203.0.113.8" }))
      .rejects.toThrow("address protection unavailable");
    expect(mocks.ip).not.toHaveBeenCalled();
  });
});
