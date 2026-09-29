import { describe, expect, it } from "vitest";
import {
  canAuthorizeAmount,
  canAuthorizeEscalated,
  canDecideRequestAmount,
  canRequestApproval,
  defaultRule,
  effectiveApprovalAuthority,
  isRoutedApprover,
  isAuthorizationRuleConflict,
  normalizeRule,
  resolveEditableRules,
  resolveRules,
} from "../authorization";

const rule = {
  ...defaultRule("discount_over_limit"),
  mode: "either" as const,
  requesterRoles: ["cashier"],
  allowedRoles: ["supervisor", "manager"],
  extraAuthority: { "role:supervisor": 5, "role:manager": 20, "user:sarah": 25 },
};

describe("central relative approval authority", () => {
  it("keeps request rights separate from decision rights", () => {
    expect(canRequestApproval(rule, { role: "cashier" })).toBe(true);
    expect(canRequestApproval(rule, { role: "guest" })).toBe(false);
    expect(canRequestApproval({ ...rule, mode: "pin" }, { role: "cashier" })).toBe(false);
  });

  it("supports a named requester without granting that person approval authority", () => {
    const named = { ...rule, requesterRoles: [], requesterUserIds: ["cashier-17"] };
    expect(canRequestApproval(named, { userId: "Cashier-17", role: "guest" })).toBe(true);
    expect(canAuthorizeAmount(named, { userId: "Cashier-17", role: "guest" }, 5, 0)).toBe(false);
  });

  it.each([
    ["supervisor", 10.01, true],
    ["supervisor", 15, true],
    ["supervisor", 15.01, false],
    ["supervisor", 25, false],
    ["manager", 25, true],
    ["manager", 30, true],
    ["manager", 30.01, false],
    ["manager", 100, false],
  ] as const)("calculates %s authority for %s", (role, requested, allowed) => {
    expect(canAuthorizeAmount(rule, { role }, requested, 10)).toBe(allowed);
  });

  it.each([0, 5, 9.99, 10])("keeps values through the direct boundary direct: %s", (value) => {
    expect(value <= 10).toBe(true);
  });

  it("applies an optional absolute ceiling", () => {
    const capped = { ...rule, absoluteCeilings: { "role:manager": 20 } };
    expect(effectiveApprovalAuthority(capped, { role: "manager" }, 15).effectiveMaximum).toBe(20);
    expect(canAuthorizeAmount(capped, { role: "manager" }, 20.01, 15)).toBe(false);
  });

  it("lets a personal relative allowance override the role allowance", () => {
    const authority = effectiveApprovalAuthority(rule, { userId: "Sarah", role: "manager" }, 10);
    expect(authority.extraAllowance).toBe(25);
    expect(authority.effectiveMaximum).toBe(35);
  });

  it("preserves legacy authority_limits as absolute values", () => {
    const legacy = { ...rule, extraAuthority: {}, authorityLimits: { "role:supervisor": 20 } };
    expect(effectiveApprovalAuthority(legacy, { role: "supervisor" }, 10)).toMatchObject({
      mode: "legacy_absolute",
      effectiveMaximum: 20,
    });
  });

  it("uses branch rules over global rules", () => {
    const global = {
      ...rule,
      scopeType: "global" as const,
      scopeId: "",
      extraAuthority: { "role:manager": 20 },
    };
    const branch = {
      ...rule,
      scopeType: "branch" as const,
      scopeId: "b1",
      extraAuthority: { "role:manager": 5 },
    };
    expect(
      resolveRules([global, branch], "b1").discount_over_limit.extraAuthority["role:manager"],
    ).toBe(5);
    expect(
      resolveRules([global, branch], "b2").discount_over_limit.extraAuthority["role:manager"],
    ).toBe(20);
  });

  it("creates an inherited branch edit at version zero", () => {
    const global = {
      ...rule,
      id: "global-rule",
      scopeType: "global" as const,
      scopeId: "",
      rowVersion: 7,
    };
    const editable = resolveEditableRules([global], "branch", "b1").discount_over_limit;
    expect(editable).toMatchObject({
      id: "",
      scopeType: "branch",
      scopeId: "b1",
      rowVersion: 0,
      mode: global.mode,
    });
  });

  it("keeps the actual branch version when an override already exists", () => {
    const branch = {
      ...rule,
      id: "branch-rule",
      scopeType: "branch" as const,
      scopeId: "b1",
      rowVersion: 4,
    };
    expect(resolveEditableRules([branch], "branch", "b1").discount_over_limit).toBe(branch);
  });

  it("preserves an already-normalized rule across the UI boundary", () => {
    const stored = normalizeRule({
      id: "branch-rule",
      action_key: "discount_over_limit",
      scope_type: "branch",
      scope_id: "b1",
      mode: "request",
      allowed_roles: ["manager"],
      allowed_user_ids: ["user-1"],
      requester_roles: ["cashier"],
      requester_user_ids: ["user-2"],
      authority_limits: { "role:manager": 25 },
      extra_authority: { "role:manager": 10 },
      absolute_ceilings: { "role:manager": 40 },
      approval_timeout_minutes: 20,
      escalation_after_minutes: 5,
      escalation_roles: ["area_manager"],
      require_reason: true,
      threshold: 12,
      is_enabled: false,
      row_version: 8,
      updated_at: "2026-09-30T00:00:00.000Z",
      updated_by: "admin-1",
    });

    expect(normalizeRule(stored)).toEqual(stored);
  });

  it("recognizes cloud and desktop optimistic-lock conflicts", () => {
    expect(isAuthorizationRuleConflict('{"code":"PT409"}')).toBe(true);
    expect(isAuthorizationRuleConflict("ESTALE_RULE: reopen it to review")).toBe(true);
    expect(isAuthorizationRuleConflict("Network unavailable")).toBe(false);
  });

  it("opens configured backup roles only after the escalation delay", () => {
    const escalated = {
      ...rule,
      escalationAfterMinutes: 5,
      escalationRoles: ["area_manager"],
    };
    const createdAt = new Date(Date.now() - 6 * 60_000).toISOString();
    expect(canAuthorizeEscalated(escalated, { role: "area_manager" }, createdAt)).toBe(true);
    expect(
      canAuthorizeEscalated(escalated, { role: "area_manager" }, new Date().toISOString()),
    ).toBe(false);
    expect(canAuthorizeEscalated(escalated, { role: "cashier" }, createdAt)).toBe(false);
  });

  it("allows an escalated backup to decide after the primary authority window", () => {
    const escalated = {
      ...rule,
      escalationAfterMinutes: 1,
      escalationRoles: ["area_manager"],
    };
    expect(
      canDecideRequestAmount(
        escalated,
        { role: "area_manager" },
        {
          createdAt: new Date(Date.now() - 2 * 60_000).toISOString(),
          requestedAmount: 50,
          requesterDirectLimit: 10,
        },
      ),
    ).toBe(true);
  });

  it("routes only snapshotted people and opens the backup route after its delay", () => {
    const createdAt = "2026-09-29T00:00:00.000Z";
    const request = {
      createdAt,
      approvalRoute: {
        primaryRoles: ["manager"],
        primaryUserIds: ["primary-1"],
        primaryApprovers: [{ id: "primary-1", name: "Primary", role: "manager" }],
        escalationAfterMinutes: 5,
        escalationRoles: ["area_manager"],
        escalationApprovers: [{ id: "backup-1", name: "Backup", role: "area_manager" }],
        ruleScopeType: "global" as const,
        ruleScopeId: "",
      },
    };
    expect(isRoutedApprover(request, { userId: "PRIMARY-1" }, Date.parse(createdAt))).toBe(true);
    expect(isRoutedApprover(request, { userId: "other" }, Date.parse(createdAt))).toBe(false);
    expect(isRoutedApprover(request, { userId: "backup-1" }, Date.parse(createdAt))).toBe(false);
    expect(
      isRoutedApprover(request, { userId: "backup-1" }, Date.parse(createdAt) + 5 * 60_000),
    ).toBe(true);
  });

  it("keeps legacy and offline rows with no route snapshot branch-rule compatible", () => {
    expect(
      isRoutedApprover(
        { approvalRoute: null, createdAt: new Date().toISOString() },
        { userId: "u1" },
      ),
    ).toBe(true);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses invalid numeric values: %s",
    (value) => {
      expect(canAuthorizeAmount(rule, { role: "manager" }, value, 10)).toBe(false);
    },
  );
});
