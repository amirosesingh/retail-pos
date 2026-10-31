import { expect, it } from "vitest";
import { localCashierLoginFailure, countsAsWrongCashierPin } from "../login-failure";
it.each(["unavailable", "error", "unknown", "missing"])(
  "does not count a local SQL %s result as a wrong PIN",
  (reason) => {
    const result = localCashierLoginFailure(reason);
    expect(result).toMatchObject({ ok: false, code: "local-backend-unavailable" });
    expect(countsAsWrongCashierPin(result.code)).toBe(false);
    expect(result.error).not.toContain("Invalid username or PIN");
  },
);
it("counts genuine credential refusals but not uncoded validation or setup refusals", () => {
  expect(countsAsWrongCashierPin(localCashierLoginFailure("invalid").code)).toBe(true);
  expect(countsAsWrongCashierPin(localCashierLoginFailure("bad-pin").code)).toBe(true);
  expect(countsAsWrongCashierPin(undefined)).toBe(false);
});
it.each(["locked", "inactive", "scope"])(
  "preserves the %s refusal without adding an incorrect local PIN failure",
  (reason) => {
    const result = localCashierLoginFailure(reason);
    expect(result.ok).toBe(false);
    expect(countsAsWrongCashierPin(result.code)).toBe(false);
  },
);
it("does not count a verified-PIN session failure as a wrong PIN", () => {
  expect(countsAsWrongCashierPin("session-open-failed")).toBe(false);
});
