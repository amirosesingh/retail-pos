import { describe, expect, it } from "vitest";
import { defaultRule, canAuthorize, canRequestApproval, approvalAuthority, canAuthorizeEscalated } from "../authorization";
import { approvalPinEligible } from "../approval-pin-eligibility";
import { NO_PERMISSIONS, hasPermission, normalizePermissions } from "../permissions";
import { grantPageEntry, permissionPageEntryKeys, permissionReferenceKeys } from "../permission-editor";
import { normalisePermissions } from "@/core/api/relay-claims.server";

describe("saved permission connections", () => {
  it("keeps page grants and revocations through client and server resolution", () => {
    const saved = JSON.parse(JSON.stringify(grantPageEntry(NO_PERMISSIONS, "inventory")));
    expect(hasPermission(normalizePermissions(saved), "can_view_inventory")).toBe(true);
    expect(normalisePermissions(saved).can_view_inventory).toBe(true);
    const revoked = { ...saved, "page:inventory": false };
    expect(hasPermission(normalizePermissions(revoked), "can_view_inventory")).toBe(false);
    expect(normalisePermissions(revoked).can_view_inventory).toBe(false);
    expect(saved.can_edit_product_price).toBe(false);
  });
  it("opening approvals never grants transfer or decision authority", () => {
    expect(permissionPageEntryKeys("approvals")).toEqual([]);
    expect(permissionReferenceKeys("approvals")).toEqual([]);
    const saved = grantPageEntry(NO_PERMISSIONS, "approvals");
    expect(saved["page:approvals"]).toBe(true);
    expect(saved.can_approve_transfer).toBe(false);
    expect(canAuthorize(defaultRule("manual_discount"), { role: "cashier" })).toBe(false);
  });
  it("does not let malformed server grants differ from the browser", () => {
    for (const value of ["true", "false", 1, null, {}]) {
      expect(normalisePermissions({ can_manage_staff: value }).can_manage_staff).toBe(false);
      expect(normalizePermissions({ can_manage_staff: value }).can_manage_staff).toBe(false);
    }
  });
});

describe("manager and Supervisor approval identity", () => {
  const rule = { ...defaultRule("manual_discount"), mode: "either" as const };
  const who = { userId: "floor-manager", role: "supervisor" };
  it("connects manager rules to Supervisor accounts without granting cashier authority", () => {
    expect(canAuthorize(rule, who)).toBe(true);
    expect(approvalPinEligible([rule], { ...who, storeId: "branch", active: true })).toBe(true);
    expect(canAuthorize(rule, { ...who, role: "cashier" })).toBe(false);
    expect(canAuthorize(rule, { ...who, role: "custom-manager" })).toBe(false);
    expect(canAuthorize({ ...rule, allowedUserIds: ["!floor-manager"] }, who)).toBe(false);
  });
  it("preserves exact role and personal limits while resolving a missing alias", () => {
    const limited = { ...rule, authorityLimits: { "role:manager": 10, "role:supervisor": 5 } };
    expect(approvalAuthority(limited, who)).toBe(5);
    expect(approvalAuthority(limited, { ...who, role: "manager" })).toBe(10);
    expect(approvalAuthority({ ...rule, authorityLimits: { "role:manager": 10 } }, who)).toBe(10);
    expect(approvalAuthority({ ...limited, authorityLimits: { ...limited.authorityLimits, "user:floor-manager": 2 } }, who)).toBe(2);
  });
  it("uses the same identity for requesting and timed escalation", () => {
    expect(canRequestApproval({ ...rule, requesterRoles: ["manager"] }, who)).toBe(true);
    const escalated = { ...rule, escalationAfterMinutes: 1, escalationRoles: ["manager"] };
    expect(canAuthorizeEscalated(escalated, who, new Date(0).toISOString(), 59_000)).toBe(false);
    expect(canAuthorizeEscalated(escalated, who, new Date(0).toISOString(), 60_000)).toBe(true);
  });
});
