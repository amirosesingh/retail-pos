import { createElement as h, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ sales: true, costs: false, fetch: vi.fn(), queries: vi.fn(), revenue: 125, cost: 63.25, bills: 5, given: 20, loading: false, error: false }));
vi.mock("@/lib/pos-auth", () => ({ useAuth: () => ({
  isAdmin: false, user: null, terminalStoreId: null, canSwitchStores: true,
  can: (flag: string) => flag === "can_view_sales_reports" ? fixture.sales : flag === "can_view_cost_margin" && fixture.costs,
}) }));
vi.mock("@/lib/pos-store", () => ({
  money: (value: number) => value.toFixed(2),
  usePos: () => ({ allStores: [{ id: "a", code: "A", name: "Shop A" }], currentStore: { id: "a" } }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: unknown) => {
  fixture.queries(options);
  return { data: { storeNames: {}, storeDays: [], itemDays: [] }, isLoading: fixture.loading, isFetching: fixture.loading, isError: fixture.error, error: new Error("Read failed"), refetch: vi.fn() };
} }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => ({ options }) }));
vi.mock("@/lib/page-data-cache", () => ({ PAGE_DATA_CACHE: {}, pageDataScope: () => [] }));
vi.mock("@/lib/analytics-board", () => ({
  fetchBoard: fixture.fetch,
  boardTradingPeriods: () => ({ days: 2, months: 1 }),
  shopSlices: () => [{ storeId: "a", name: "Shop A", revenue: fixture.revenue, cost: fixture.cost, profit: fixture.revenue - fixture.cost, marginPct: 49.4, sharePct: 100, bills: fixture.bills, givenAway: fixture.given, itemDiscount: 5, billDiscount: 3, coupon: 2, focValue: 10 }],
  topCategories: () => [], topItems: () => [], trendSeries: () => [],
}));
vi.mock("@/platforms/web/components/pos/report-kit", () => ({
  StatCard: ({ label, value, hint, info }: { label: string; value: string; hint?: string; info?: ReactNode }) => h("article", null, h("p", null, label), h("p", null, value), hint && h("p", null, hint), info),
  ReportFilters: ({ children }: { children: ReactNode }) => children,
  isoDay: () => "2026-10-27", downloadReport: vi.fn(),
}));
vi.mock("@/platforms/web/components/pos/HomeShortcuts", () => ({ HomeShortcuts: () => null }));
vi.mock("@/platforms/web/components/pos/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/platforms/web/components/pos/AnalyticsCardRail", () => ({ AnalyticsCardRail: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/platforms/web/components/pos/AnalyticsErrorPanel", () => ({ AnalyticsErrorPanel: () => h("p", { role: "alert" }, "Report could not be loaded") }));
vi.mock("recharts", () => {
  const Chart = ({ children }: { children?: ReactNode }) => h("div", null, children);
  return Object.fromEntries(["Bar", "BarChart", "CartesianGrid", "Cell", "ComposedChart", "Legend", "Line", "LineChart", "Pie", "PieChart", "ResponsiveContainer", "Tooltip", "XAxis", "YAxis"].map(name => [name, Chart]));
});

import { Route } from "@/routes/analytics";
const render = () => renderToStaticMarkup(h(Route.options.component as ComponentType));
beforeEach(() => { fixture.sales = true; fixture.costs = false; fixture.revenue = 125; fixture.cost = 63.25; fixture.bills = 5; fixture.given = 20; fixture.loading = false; fixture.error = false; fixture.fetch.mockClear(); fixture.queries.mockClear(); });

describe("financial summary visibility", () => {
  it("explains revenue and loaded deductions without exposing cost/profit or loading bill details", () => {
    const html = render();
    expect(html).toContain("Net revenue");
    expect(html).toContain("Item discounts");
    expect(html).toContain("Do not deduct these values again");
    expect(html).not.toContain("Subtotal before discounts");
    expect(html).not.toContain("Less cost of goods sold");
    expect(html).not.toContain("Gross profit");
    expect(html).not.toContain("63.25");
    expect(fixture.queries).toHaveBeenCalledOnce();
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("shows the existing cost/profit values only when cost visibility is granted", () => {
    fixture.costs = true;
    const html = render();
    expect(html).toContain("Less cost of goods sold");
    expect(html).toContain("Gross profit");
    expect(html).toContain("63.25");
    expect(html).toContain("61.75");
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it("does not render financial detail without reporting permission", () => {
    fixture.sales = false;
    const html = render();
    expect(html).toContain("You do not have permission");
    expect(html).not.toContain("Net revenue");
    expect(html).not.toContain("Less cost of goods sold");
  });

  it("hides loaded zero cards with an explanatory empty summary", () => {
    fixture.revenue = 0; fixture.cost = 0; fixture.bills = 0; fixture.given = 0;
    const html = render();
    expect(html).toContain("No financial totals to show");
    expect(html).not.toContain("<article");
  });

  it("preserves negative money and reveals the same cards as values change", () => {
    fixture.revenue = -20; fixture.cost = 0; fixture.given = 0; fixture.costs = true;
    const html = render();
    expect(html).toContain("<p>Net revenue before adjustments</p>");
    expect(html).toContain("<p>Gross profit</p>");
    expect(html).toContain("-20.00");
    expect(html).not.toContain("<p>Given away</p>");
    expect(html).not.toContain("No financial totals");
  });

  it("shows a peer Bills card only when zero revenue would hide its positive bill count", () => {
    expect(render()).toContain("5 bills");
    expect(render()).not.toContain("<p>Bills</p>");
    fixture.revenue = 0; fixture.cost = 0; fixture.given = 0;
    const html = render();
    expect(html).toContain("<p>Bills</p>");
    expect(html.match(/<article/g)).toHaveLength(1);
    expect(html).not.toContain("<p>Net revenue before adjustments</p>");
  });

  it("keeps loading and error states distinct from a loaded all-zero summary", () => {
    fixture.revenue = 0; fixture.cost = 0; fixture.bills = 0; fixture.given = 0; fixture.loading = true;
    expect(render()).toContain("Loading live figures");
    expect(render()).not.toContain("No financial totals");
    fixture.loading = false; fixture.error = true;
    expect(render()).toContain("Report could not be loaded");
    expect(render()).not.toContain("No financial totals");
  });
});
