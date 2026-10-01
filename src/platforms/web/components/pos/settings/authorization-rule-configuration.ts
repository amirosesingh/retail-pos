import {
  includedAuthorizationUserIds,
  type AuthActionDef,
  type AuthorizationRule,
} from "@/lib/authorization";

const approverCount = (rule: AuthorizationRule) =>
  new Set([
    ...rule.allowedRoles.map((role) => `role:${role.toLowerCase()}`),
    ...includedAuthorizationUserIds(rule.allowedUserIds).map((id) => `user:${id.toLowerCase()}`),
  ]).size;

export function authorizationRuleSummary(rule: AuthorizationRule): string {
  if (rule.mode === "none") return "No additional configuration";
  const count = approverCount(rule);
  const approvers = `${count} approver${count === 1 ? "" : "s"}`;
  const reason = rule.requireReason ? "Reason required" : "Reason optional";
  if (rule.mode === "pin") return `${approvers} • ${reason}`;
  const escalation = rule.escalationAfterMinutes ? "Escalation enabled" : "Escalation off";
  return `${approvers} • ${escalation} • ${reason}`;
}

export type AuthorizationRuleValidationIssue = { field: string; message: string };

export function validateAuthorizationRuleConfiguration(
  rule: AuthorizationRule,
  action: Pick<AuthActionDef, "thresholdLabel">,
): AuthorizationRuleValidationIssue[] {
  if (rule.mode === "none") return [];
  const issues: AuthorizationRuleValidationIssue[] = [];
  if (!rule.allowedRoles.length && !includedAuthorizationUserIds(rule.allowedUserIds).length) {
    issues.push({
      field: "authorizers",
      message: "Choose at least one person or role to authorise.",
    });
  }
  if (
    action.thresholdLabel &&
    (rule.threshold === null || !Number.isFinite(rule.threshold) || rule.threshold < 0)
  ) {
    issues.push({ field: "threshold", message: `Enter ${action.thresholdLabel.toLowerCase()}.` });
  }
  if (rule.mode === "request" || rule.mode === "either") {
    if (
      !rule.requesterRoles.length &&
      !includedAuthorizationUserIds(rule.requesterUserIds).length
    ) {
      issues.push({ field: "requesters", message: "Choose who may send an approval request." });
    }
    if (
      !Number.isFinite(rule.approvalTimeoutMinutes) ||
      rule.approvalTimeoutMinutes < 1 ||
      rule.approvalTimeoutMinutes > 1440
    ) {
      issues.push({
        field: "timeout",
        message: "Enter an approval expiry between 1 and 1,440 minutes.",
      });
    }
    if (rule.escalationAfterMinutes !== null) {
      if (
        !Number.isFinite(rule.escalationAfterMinutes) ||
        rule.escalationAfterMinutes < 1 ||
        rule.escalationAfterMinutes > 1440
      ) {
        issues.push({
          field: "escalation-delay",
          message: "Enter an escalation delay between 1 and 1,440 minutes.",
        });
      }
      if (!rule.escalationRoles.length) {
        issues.push({
          field: "escalation-roles",
          message: "Choose at least one backup role for escalation.",
        });
      }
    }
  }
  return issues;
}
