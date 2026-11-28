import { describe, expect, it } from "vitest";

import { DEFAULT_POS_RULES } from "../pos-rules";
import { offlineRulesPatch, reconcileRulesDraft } from "../pos-rules-draft";

describe("POS rules editor refreshes", () => {
  const first = { ...DEFAULT_POS_RULES };
  const refreshed = { ...first, max_refund_days_limit: 21 };

  it("accepts a background refresh while the editor is clean", () => {
    expect(reconcileRulesDraft(first, first, refreshed)).toBe(refreshed);
  });

  it("keeps unfinished edits during focus and timer refreshes", () => {
    const draft = { ...first, max_refund_days_limit: 14 };
    expect(reconcileRulesDraft(draft, first, refreshed)).toBe(draft);
  });

  it("can replace a draft after a confirmed stale-version conflict", () => {
    const draft = { ...first, max_refund_days_limit: 14 };
    expect(reconcileRulesDraft(draft, first, refreshed, true)).toBe(refreshed);
  });

  it("queues only changed supported fields and preserves exact money input", () => {
    const draft = { ...first, block_shift_close_on_hold: !first.block_shift_close_on_hold };
    expect(offlineRulesPatch(draft, first, "9007199254740993.125000000002")).toEqual({
      block_shift_close_on_hold: draft.block_shift_close_on_hold,
      max_drawer_cash_limit: "9007199254740993.125000000002",
    });
    expect(offlineRulesPatch(draft, first, "1e10")).toBeNull();
    expect(offlineRulesPatch(refreshed, first, null)).toBeNull();
    expect(offlineRulesPatch(first, first, `${first.max_drawer_cash_limit}.00`)).toBeNull();
  });
});
