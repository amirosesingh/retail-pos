/** One business meaning per color across analytics pages. */
export const ANALYTICS_COLORS = {
  revenue: "var(--analytics-revenue)", profit: "var(--analytics-profit)",
  cost: "var(--analytics-cost)", discount: "var(--analytics-discount)",
  units: "var(--analytics-units)", margin: "var(--analytics-margin)", loss: "var(--destructive)",
} as const;
export type AnalyticsTone = keyof typeof ANALYTICS_COLORS;

/** Category identity stays stable when ranking changes; there is no finite palette wrap. */
export function branchChartColor(id: string) {
  let hash = 2166136261;
  for (const char of id.trim().toLowerCase()) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const hue = ((hash >>> 0) % 36000) / 100;
  return "oklch(var(--analytics-category-lightness) 0.16 " + hue + ")";
}
export const compactChartNumber = (value: number) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
