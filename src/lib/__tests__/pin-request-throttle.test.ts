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
    expect(mocks.fail).toHaveBeenCalledWith(attempt.key);
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
});
