import { describe, expect, it } from "vitest";
import { defaultRule } from "../authorization";
import { approvalPinEligible } from "../approval-pin-eligibility";

const person = { userId: "front-1", role: "cashier", storeId: "branch-1", active: true };
const rule = { ...defaultRule("manual_discount"), mode: "pin" as const };
describe("approval PIN eligibility", () => {
  it("requires assignment to an enabled PIN rule, not just a staff account", () => {
    expect(approvalPinEligible([], person)).toBe(false);
    expect(approvalPinEligible([rule], person)).toBe(false);
    expect(approvalPinEligible([{ ...rule, allowedUserIds: [person.userId] }], person)).toBe(true);
    expect(approvalPinEligible([{ ...rule, allowedUserIds: [person.userId], isEnabled: false }], person)).toBe(false);
    expect(approvalPinEligible([{ ...rule, mode: "request", allowedUserIds: [person.userId] }], person)).toBe(false);
  });
  it("honors branch overrides, exclusions and inactive accounts", () => {
    const manager = { ...person, role: "manager" };
    expect(approvalPinEligible([rule], manager)).toBe(true);
    expect(approvalPinEligible([rule], { ...manager, active: false })).toBe(false);
    expect(approvalPinEligible([{ ...rule, allowedUserIds: ["!front-1"] }], manager)).toBe(false);
    expect(approvalPinEligible([rule, { ...rule, scopeType: "branch", scopeId: "branch-1", mode: "none" }], manager)).toBe(false);
  });
});
