import type { PosRules } from "./pos-rules";
import { rulesEqual } from "./pos-rules-pending";

/**
 * Accept a newly verified rule set only while the editor is still clean.
 * Background focus/timer refreshes must not erase an administrator's draft.
 */
export function reconcileRulesDraft(
  draft: PosRules,
  previouslyConfirmed: PosRules,
  newlyConfirmed: PosRules,
  force = false,
): PosRules {
  return force || rulesEqual(draft, previouslyConfirmed) ? newlyConfirmed : draft;
}
