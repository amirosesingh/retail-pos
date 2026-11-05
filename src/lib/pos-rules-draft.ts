import type { PosRules } from "./pos-rules";
import { rulesEqual } from "./pos-rules-pending";

/** Safety defaults are not a saved configuration that an operator may overwrite. */
export function hasVerifiedRulesBaseline(snapshot: {
  source: string;
  loading: boolean;
  usingDefaults: boolean;
  notVerified: boolean;
}): boolean {
  return !snapshot.loading && !snapshot.usingDefaults && !snapshot.notVerified &&
    ["DATABASE", "LAST_KNOWN_GOOD", "LOCAL_PENDING"].includes(snapshot.source);
}

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
