import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { InventoryMetrics } from "../inventory-metrics";

vi.mock("@/platforms/web/components/pos/AnimatedMetric", () => ({
  AnimatedMetric: ({ value, format }: { value: number; format?: (value: number) => string }) => h("span", { "data-animated-value": value }, format ? format(value) : value.toLocaleString()),
}));
import { InventorySummaryCards } from "@/platforms/web/components/pos/InventorySummaryCards";

const empty: InventoryMetrics = { products: 0, categories: 0, units: 0, lowStock: 0, outOfStock: 0, negativeStock: 0, costValue: 0, retailValue: 0, potentialProfit: 0 };
const render = (metrics: Partial<InventoryMetrics> = {}, options: Partial<Parameters<typeof InventorySummaryCards>[0]> = {}) =>
  renderToStaticMarkup(h(InventorySummaryCards, { metrics: { ...empty, ...metrics }, ready: true, showStockValue: false, ...options }));

describe("inventory summary cards", () => {
  it("combines product and category counts in one compact animated card", () => {
    const html = render({ products: 25, categories: 4 });
    expect(html.match(/class="summary-card/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Products and categories"');
    expect(html).toContain('data-animated-value="25"');
    expect(html).toContain('data-animated-value="4"');
    expect(html).toContain(">Products</dt>");
    expect(html).toContain(">Categories</dt>");
    expect(html).not.toContain("Low stock");
    expect(html).not.toContain("Negative stock");
    expect(html).not.toContain("On-hand units");
  });

  it("hides loaded zero inventory values and preserves an honest empty state", () => {
    const html = render({}, { showStockValue: true, totalUnitCostValue: 0, showPotentialProfit: true });
    expect(html).toContain("No active products at this branch");
    expect(html).not.toContain('class="summary-card');
    expect(html).not.toContain("Purchase cost value");
    expect(html).not.toContain("Potential profit");
    expect(html).not.toContain('data-animated-value="0"');
    const categoriesOnly = render({ categories: 2 });
    expect(categoriesOnly).toContain(">Categories</dt>");
    expect(categoriesOnly).not.toContain(">Products</dt>");
  });

  it.each(["loading", "stalled", "failed"] as const)("does not turn %s into loaded zero inventory", loadPhase => {
    const html = render({}, { ready: false, loadPhase });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain(loadPhase === "failed" ? 'role="alert"' : 'role="status"');
    expect(html).not.toContain("No active products");
    expect(html).not.toContain('data-animated-value="0"');
  });

  it("reveals changed warnings and signed stock values without empty slots", () => {
    const html = render({ products: 3, categories: 1, units: -0.25, lowStock: 2, negativeStock: 1, retailValue: -5 }, { showStockValue: true });
    expect(html.match(/class="summary-card/g)).toHaveLength(4);
    expect(html).toContain("Low stock");
    expect(html).toContain("Negative stock");
    expect(html).toContain('data-animated-value="-0.25"');
    expect(html).toContain('data-animated-value="-5"');
    expect(html).not.toContain("Purchase cost value");
  });

  it("combines stock alerts and makes only their numbers actionable when handlers are supplied", () => {
    const html = render({ lowStock: 2, negativeStock: 1 }, { onReviewLowStock: () => undefined, onReviewNegativeStock: () => undefined });
    expect(html.match(/class="summary-card/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Stock alerts"');
    expect(html).toContain('aria-label="Review 2 low stock products"');
    expect(html).toContain('aria-label="Review 1 negative stock products"');
    expect(html.match(/<button/g)).toHaveLength(2);
    const zero = render({ lowStock: 0, negativeStock: 1 }, { onReviewNegativeStock: () => undefined });
    expect(zero).not.toContain(">Low stock</dt>");
    expect(zero.match(/<button/g)).toHaveLength(1);
  });

  it("retains cost visibility and unavailable configured-cost state", () => {
    const hidden = render({ products: 1, costValue: 12345, retailValue: 67890, potentialProfit: 55545 }, { totalUnitCostValue: null, showPotentialProfit: true });
    expect(hidden).not.toContain("12345");
    expect(hidden).not.toContain("Purchase cost value");
    expect(hidden).not.toContain("Total unit cost value unavailable");
    const shown = render({ products: 1, costValue: 12345 }, { showStockValue: true, totalUnitCostValue: null });
    expect(shown).toContain("Purchase cost value");
    expect(shown).toContain("Total unit cost value unavailable");
    expect(shown).toContain('data-card-count="2"');
  });

  it("contains large values with wrapping and a responsive minimum card width", () => {
    const html = render({ products: 123456789012, categories: 987654321, costValue: 9876543210123.45 }, { showStockValue: true });
    expect(html).toContain("minmax(min(100%,13rem),1fr)");
    expect(html).toContain("[overflow-wrap:anywhere]");
    expect(html).toContain('data-animated-value="9876543210123.45"');
    expect(html).not.toContain("truncate");
  });
});
