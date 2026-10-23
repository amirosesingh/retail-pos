/** Configured unit cost for catalog margin; stock valuation and recorded sales keep their own cost snapshots. */
export type UnitCostRule = { percent: number; amount: number };
export type TotalUnitCostSettings = {
  defaultRule: UnitCostRule;
  overrides: Record<string, UnitCostRule | null>;
};
export const emptyUnitCostSettings: TotalUnitCostSettings = { defaultRule: { percent: 0, amount: 0 }, overrides: {} };
export function validUnitCostRule(rule: UnitCostRule): boolean {
  return Number.isFinite(rule.percent) && rule.percent >= 0 && rule.percent <= 10000 &&
    Number.isFinite(rule.amount) && rule.amount >= 0 && rule.amount <= 100000000;
}
export function totalUnitCost(cost: number, id: string, settings: TotalUnitCostSettings = emptyUnitCostSettings): number | null {
  const rule = settings.overrides?.[id] ?? settings.defaultRule;
  if (!Number.isFinite(cost) || cost < 0 || !rule || !validUnitCostRule(rule)) return null;
  return Math.round((cost * (1 + rule.percent / 100) + rule.amount + Number.EPSILON) * 100) / 100;
}
export function updateUnitCostRules(settings: TotalUnitCostSettings, target: "default" | "selected" | "reset", ids: string[], rule: UnitCostRule): TotalUnitCostSettings {
  if (!validUnitCostRule(rule)) throw new Error("Enter a valid non-negative percentage and amount.");
  if (target === "default") return { ...settings, defaultRule: { ...rule } };
  const overrides = { ...settings.overrides };
  for (const id of ids) overrides[id] = target === "reset" ? null : { ...rule };
  return { ...settings, overrides };
}
