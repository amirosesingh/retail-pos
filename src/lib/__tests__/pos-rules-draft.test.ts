import { describe, expect, it } from "vitest";

import { DEFAULT_POS_RULES } from "../pos-rules";
import { reconcileRulesDraft } from "../pos-rules-draft";

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
});
