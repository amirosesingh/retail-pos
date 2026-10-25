import { afterEach, beforeEach, expect, it, vi } from "vitest";
const values = vi.hoisted(() => new Map<string, string>());
vi.mock("../business-storage", () => ({
  readBusinessValue: (key: string) => values.get(key),
  writeBusinessValue: (key: string, value: string) => values.set(key, value),
}));
import { cacheCredential, verifyCachedPin, verifyCachedPinResult } from "../offline-credentials";
beforeEach(() => { values.clear(); vi.stubGlobal("window", {}); });
afterEach(() => { vi.unstubAllGlobals(); });
const profile = { username: "cashier", cashierId: "id", fullName: "Cashier", storeId: "branch", permissions: {} };
it("distinguishes an unavailable cached account from a genuine offline PIN mismatch", async () => {
  expect(await verifyCachedPinResult("cashier", "1234")).toEqual({ ok: false, reason: "missing" });
  await cacheCredential("1234", profile);
  expect(await verifyCachedPinResult("cashier", "9999")).toEqual({ ok: false, reason: "invalid" });
  expect(await verifyCachedPinResult(" CASHIER ", "1234")).toMatchObject({ ok: true, credential: profile });
});
it("preserves the legacy cache API for existing consumers", async () => {
  await cacheCredential("1234", profile);
  expect(await verifyCachedPin("cashier", "1234")).toMatchObject(profile);
  expect(await verifyCachedPin("cashier", "9999")).toBeNull();
});
it("treats an expired verifier as unavailable without falsely rejecting the PIN", async () => {
  await cacheCredential("1234", profile);
  vi.useFakeTimers();
  try {
    vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(await verifyCachedPinResult("cashier", "1234")).toEqual({ ok: false, reason: "missing" });
  } finally { vi.useRealTimers(); }
});
