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

export function changedDrawerLimit(text: string | null, baseline: number): text is string {
  return text !== null && text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") !== String(baseline);
}

/** The native offline pilot accepts only these two fields and preserves exact money text. */
export function offlineRulesPatch(draft: PosRules, base: PosRules, drawerLimit: string | null) {
  const patch: { block_shift_close_on_hold?: boolean; max_drawer_cash_limit?: string } = {};
  const supported = ["block_shift_close_on_hold", "max_drawer_cash_limit"];
  if ((Object.keys(base) as (keyof PosRules)[]).some(key => !supported.includes(key) && draft[key] !== base[key])) return null;
  if (draft.block_shift_close_on_hold !== base.block_shift_close_on_hold) patch.block_shift_close_on_hold = draft.block_shift_close_on_hold;
  if (changedDrawerLimit(drawerLimit, base.max_drawer_cash_limit)) {
    if (!/^(?:0|[1-9][0-9]{0,25})(?:\.[0-9]{1,12})?$/.test(drawerLimit)) return null;
    patch.max_drawer_cash_limit = drawerLimit;
  }
  return Object.keys(patch).length ? patch : null;
}
