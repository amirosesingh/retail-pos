import { describe, expect, it } from "vitest";
import { AUTH_ACTIONS, canAuthorize, defaultRule } from "../authorization";
import { APPROVAL_ACTION_PERMISSIONS, approverActionAllowed } from "../approval-action-permissions";
describe("approval requires action authority as well as rule eligibility", () => {
  it("maps every supported approval action and rejects unknown ones", () => {
    for (const action of AUTH_ACTIONS) expect(APPROVAL_ACTION_PERMISSIONS[action.key], action.key).toBeTruthy();
    expect(approverActionAllowed("unknown", { role: "admin" })).toBe(false);
  });
  it("does not grant a manager's explicitly denied or missing permission", () => {
    expect(approverActionAllowed("refund", { role: "manager", permissions: { can_process_refund: false } })).toBe(false);
    expect(approverActionAllowed("refund", { role: "manager", permissions: {} })).toBe(false);
  });
  it("requires release approval permission rather than transfer creation for cross-cluster approval",()=>{
    expect(approverActionAllowed("cross_group_transfer_approval",{role:"staff",permissions:{can_create_transfer:true}})).toBe(false);
    expect(approverActionAllowed("cross_group_transfer_approval",{role:"staff",permissions:{can_approve_transfer:true}})).toBe(true);
  });
  it("lets an assigned user qualify without a manager title, while preserving exclusions", () => {
    const who = { userId: "cashier-2", role: "staff", permissions: { can_process_refund: true } };
    const rule = { ...defaultRule("refund"), allowedRoles: [], allowedUserIds: [who.userId] };
    expect(approverActionAllowed("refund", who) && canAuthorize(rule, who)).toBe(true);
    expect(approverActionAllowed("refund", who) && canAuthorize({ ...rule, allowedUserIds: ["!cashier-2"] }, who)).toBe(false);
  });
});
