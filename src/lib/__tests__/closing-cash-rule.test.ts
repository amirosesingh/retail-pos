import { describe, expect, it } from "vitest";
import { DEFAULT_POS_RULES, RULE_GROUPS, requiresClosingCashCount, withClosingCashCount } from "../pos-rules";

describe("closing cash count rule", () => {
  it("exposes one control while keeping both historical database flags synchronized", () => {
    const controls = RULE_GROUPS.flatMap(group => group.fields).filter(field =>
      field.key === "require_daily_sales_for_shift_close" || field.key === "require_counted_cash_on_close",
    );
    expect(controls.map(field => field.key)).toEqual(["require_counted_cash_on_close"]);
    const legacy = { ...DEFAULT_POS_RULES, require_daily_sales_for_shift_close: true, require_counted_cash_on_close: false };
    expect(requiresClosingCashCount(legacy)).toBe(true);
    expect(withClosingCashCount(legacy, false)).toMatchObject({
      require_daily_sales_for_shift_close: false,
      require_counted_cash_on_close: false,
    });
    expect(withClosingCashCount(legacy, true)).toMatchObject({
      require_daily_sales_for_shift_close: true,
      require_counted_cash_on_close: true,
    });
  });
});
