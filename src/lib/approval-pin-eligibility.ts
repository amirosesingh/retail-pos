import { canAuthorize, resolveRules, type AuthorizationRule } from "./authorization";

export function approvalPinEligible(
  rules: AuthorizationRule[],
  person: { userId: string; role: string; storeId: string; active: boolean },
) {
  if (!person.active) return false;
  return Object.values(resolveRules(rules, person.storeId)).some(
    (rule) =>
      rule.isEnabled &&
      (rule.mode === "pin" || rule.mode === "either") &&
      canAuthorize(rule, { userId: person.userId, role: person.role }),
  );
}
