import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { approvalTotp, matchingTotpStep } from "../approval-totp";
import { approvalMethods, preserveApprovalMethods } from "../approval-credentials";
const require = createRequire(import.meta.url);
const { tokenAt, matchingStep } = require("../../../electron/approval-token-verifier.cjs");
const secret = Buffer.from("12345678901234567890").toString("base64");
describe("approval token interoperability", () => {
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])("matches RFC 6238 at %s", async (seconds, expected) => {
    expect(await approvalTotp(secret, Number(seconds) * 1000)).toBe(expected);
    expect(tokenAt(secret, Math.floor(Number(seconds) / 30))).toBe(expected);
  });
  it("accepts only the current or adjacent step and rejects malformed credentials", async () => {
    const now = 1234567890000;
    const code = await approvalTotp(secret, now);
    expect(await matchingTotpStep(secret, code, now)).toBe(Math.floor(now / 30000));
    expect(matchingStep(secret, code, now)).toBe(Math.floor(now / 30000));
    expect(await matchingTotpStep(secret, code, now + 90000)).toBe(null);
    expect(await matchingTotpStep(secret, "1234", now)).toBe(null);
    expect(matchingStep(secret, "1234", now)).toBe(null);
  });
  it("preserves existing PIN access while TOTP is opt-in", () => {
    expect(approvalMethods(null)).toEqual({ pin: true, totp: false });
    expect(approvalMethods({ approval_pin_enabled: false, approval_totp_enabled: true })).toEqual({
      pin: false,
      totp: true,
    });
  });
  it("never copies or overwrites credential switches with page permissions", () => {
    expect(
      preserveApprovalMethods(
        { can_sell: true, approval_pin_enabled: true, approval_totp_enabled: true },
        { approval_pin_enabled: false, approval_totp_enabled: false },
      ),
    ).toEqual({ can_sell: true, approval_pin_enabled: false, approval_totp_enabled: false });
    expect(preserveApprovalMethods({ approval_totp_enabled: true }, null)).toEqual({});
  });
});
