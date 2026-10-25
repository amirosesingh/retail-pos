import { afterEach, expect, it, vi } from "vitest";
import { cashierServiceFailure, cashierFallbackFailure } from "../cashier-login-failure";
import { requestCashierLogin } from "../cashier-login-request";
import { countsAsWrongCashierPin } from "../login-failure";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it.each([200, 408, 500, 502, 503, 504])("does not label an incomplete HTTP %s response as a wrong PIN", status => {
  const result = cashierServiceFailure(status, null);
  expect(result.useLocal).toBe(true);
  expect(countsAsWrongCashierPin(result.code)).toBe(false);
  expect(result.error).not.toMatch(/invalid|incorrect/i);
});
it("counts a confirmed modern or legacy wrong-PIN refusal without offline fallback", () => {
  for (const payload of [{ code: "invalid_credentials" }, { error: "Invalid username or PIN" }]) {
    const result = cashierServiceFailure(401, payload);
    expect(countsAsWrongCashierPin(result.code)).toBe(true);
    expect(result.useLocal).toBe(false);
  }
  expect(countsAsWrongCashierPin(cashierServiceFailure(401, null).code)).toBe(false);
});
it.each(["identity_mismatch", "locked"])("does not fall back or count PIN failures for %s", code => {
  const result = cashierServiceFailure(409, { code });
  expect(result.useLocal).toBe(false);
  expect(countsAsWrongCashierPin(result.code)).toBe(false);
});
it("does not turn a stale offline verifier into a central wrong-PIN response after a delay", () => {
  expect(cashierFallbackFailure("invalid", false).code).toBe("cloud-unreachable");
  expect(cashierFallbackFailure("missing", false).code).toBe("cloud-unreachable");
  expect(cashierFallbackFailure("invalid", true).code).toBe("invalid-credentials");
  expect(cashierFallbackFailure("missing", true).code).toBe("local-backend-unavailable");
});
it.each(["scope", "inactive", "locked"])("retains local %s refusals rather than bypassing them with a cached login", reason => {
  expect(countsAsWrongCashierPin(cashierFallbackFailure(reason, false).code)).toBe(false);
});
it("waits for a delayed successful PIN response without prematurely rejecting or retrying", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(() => new Promise<Response>(resolve => setTimeout(() => resolve(Response.json({ ok: true })), 5_000)));
  vi.stubGlobal("fetch", fetch);
  const promise = requestCashierLogin<{ code?: string; error?: string }>("https://app.example", { username: "staff", pin: "test-pin" });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(await promise).toEqual({ status: 200, payload: { ok: true } });
  expect(fetch).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("keeps the deadline active while reading a stalled response body", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal;
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    signal = init.signal!;
    return { status: 200, json: () => new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })) };
  });
  vi.stubGlobal("fetch", fetch);
  const promise = requestCashierLogin<{ code?: string; error?: string }>("https://app.example", { username: "staff", pin: "test-pin" });
  await vi.advanceTimersByTimeAsync(6_000);
  const result = await promise;
  expect(result.payload).toBeNull();
  expect(cashierServiceFailure(result.status, result.payload).code).toBe("cloud-unreachable");
  expect(fetch).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
