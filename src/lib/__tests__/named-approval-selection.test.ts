import { describe, expect, it } from "vitest";
import {
  canAuthorize,
  canRequestApproval,
  defaultRule,
  normalizeRule,
  resolveRules,
} from "../authorization";

describe("saved named-only approval audiences", () => {
  it.each(["sponsorship", "delete_product", "stock_adjustment", "stock_transfer"] as const)(
    "keeps %s restricted to the selected people after saving and reloading",
    (action) => {
      const saved = {
        action_key: action,
        scope_type: "global",
        mode: "request",
        allowed_roles: [],
        allowed_user_ids: ["chosen-cashier"],
        requester_roles: [],
        requester_user_ids: ["requester"],
        require_reason: true,
      };
      for (const rule of [
        normalizeRule(saved),
        resolveRules([normalizeRule(saved)], "branch-a")[action],
      ]) {
        expect(rule.allowedRoles).toEqual([]);
        expect(canAuthorize(rule, { userId: "chosen-cashier", role: "cashier" })).toBe(true);
        expect(canAuthorize(rule, { userId: "other-admin", role: "admin" })).toBe(false);
        expect(canAuthorize(rule, { userId: "other-manager", role: "manager" })).toBe(false);
        expect(canRequestApproval(rule, { userId: "requester", role: "cashier" })).toBe(true);
        expect(canRequestApproval(rule, { userId: "other-cashier", role: "cashier" })).toBe(false);
      }
    },
  );
  it("preserves empty arrays stored by the desktop database as JSON strings", () => {
    const rule = normalizeRule({
      action_key: "sponsorship",
      allowed_roles: "[]",
      requester_roles: "[]",
      allowed_user_ids: '["chosen"]',
    });
    expect(rule.allowedRoles).toEqual([]);
    expect(rule.requesterRoles).toEqual([]);
    expect(canAuthorize(rule, { userId: "other", role: "admin" })).toBe(false);
  });
  it("retains defaults for legacy rows where role fields are absent", () => {
    const rule = normalizeRule({ action_key: "sponsorship" });
    expect(rule.allowedRoles).toEqual(defaultRule("sponsorship").allowedRoles);
    expect(rule.requesterRoles).toEqual(defaultRule("sponsorship").requesterRoles);
  });
  it("retains deliberately selected roles and explicit exclusions", () => {
    const rule = normalizeRule({
      ...defaultRule("stock_adjustment"),
      allowedRoles: ["manager"],
      allowedUserIds: ["!excluded", "named"],
    });
    expect(canAuthorize(rule, { userId: "manager", role: "manager" })).toBe(true);
    expect(canAuthorize(rule, { userId: "excluded", role: "manager" })).toBe(false);
    expect(canAuthorize(rule, { userId: "named", role: "cashier" })).toBe(true);
  });
});
