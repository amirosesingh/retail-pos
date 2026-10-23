import { describe, expect, it } from "vitest";
import { emptyUnitCostSettings, totalUnitCost, updateUnitCostRules } from "@/lib/total-unit-cost";

describe("Total Unit Cost planning estimate", () => {
  it("uses the bulk default without changing the purchase cost", () => {
    const settings = updateUnitCostRules(emptyUnitCostSettings, "default", [], { percent: 20, amount: 3 });
    const purchaseCost = 10;
    expect(totalUnitCost(purchaseCost, "item-a", settings)).toBe(15);
    expect(purchaseCost).toBe(10);
  });

  it("preserves a custom item when the bulk default changes and resets only selected items", () => {
    const initial = updateUnitCostRules(emptyUnitCostSettings, "selected", ["item-a"], { percent: 35, amount: 2 });
    const changed = updateUnitCostRules(initial, "default", [], { percent: 20, amount: 1 });
    expect(totalUnitCost(100, "item-a", changed)).toBe(137);
    expect(totalUnitCost(100, "item-b", changed)).toBe(121);
    const reset = updateUnitCostRules(changed, "reset", ["item-a"], { percent: 0, amount: 0 });
    expect(totalUnitCost(100, "item-a", reset)).toBe(121);
  });

  it("rejects invalid rules and missing purchase costs", () => {
    expect(() => updateUnitCostRules(emptyUnitCostSettings, "default", [], { percent: -1, amount: 0 })).toThrow();
    expect(totalUnitCost(Number.NaN, "item-a")).toBeNull();
    expect(totalUnitCost(-1, "item-a")).toBeNull();
  });
});
