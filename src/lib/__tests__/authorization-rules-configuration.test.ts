import { describe, expect, it } from "vitest";

import {
  authorizationRuleSummary,
  validateAuthorizationRuleConfiguration,
} from "@/platforms/web/components/pos/settings/authorization-rule-configuration";
import { defaultRule } from "@/lib/authorization";

describe("authorization rule configuration", () => {
  it("builds a compact overview summary without exposing the detailed form", () => {
    expect(
      authorizationRuleSummary({
        ...defaultRule("discount_over_limit"),
        mode: "request",
        allowedRoles: ["manager"],
        allowedUserIds: ["lead-1", "lead-2"],
        escalationAfterMinutes: 5,
        requireReason: true,
      }),
    ).toBe("3 approvers • Escalation enabled • Reason required");
  });

  it("does not require inactive approval settings for no authorization", () => {
    const rule = {
      ...defaultRule("discount_over_limit"),
      mode: "none" as const,
      allowedRoles: [],
      requesterRoles: [],
      threshold: null,
    };

    expect(
      validateAuthorizationRuleConfiguration(rule, {
        thresholdLabel: "Discount (%) allowed without authorisation",
      }),
    ).toEqual([]);
  });

  it("identifies the exact mandatory fields missing from an approval request", () => {
    const rule = {
      ...defaultRule("discount_over_limit"),
      mode: "request" as const,
      allowedRoles: [],
      allowedUserIds: [],
      requesterRoles: [],
      requesterUserIds: [],
      threshold: null,
      escalationAfterMinutes: 5,
      escalationRoles: [],
    };

    expect(
      validateAuthorizationRuleConfiguration(rule, {
        thresholdLabel: "Discount (%) allowed without authorisation",
      }).map((issue) => issue.field),
    ).toEqual(["authorizers", "threshold", "requesters", "escalation-roles"]);
  });
});
