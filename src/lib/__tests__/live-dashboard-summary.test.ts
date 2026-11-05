import { createElement as h, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sale } from "@/core/types/pos-types";

const fixture = vi.hoisted(() => ({ sales: [] as Sale[], loading: false, error: "", ready: true, costs: true, sponsor: 0 }));
vi.mock("@/lib/pos-auth", () => ({ useAuth: () => ({
  user: null, canSwitchStores: true, terminalStoreId: null,
  can: (flag: string) => flag !== "can_view_cost_margin" || fixture.costs,
}) }));
vi.mock("@/lib/pos-store", () => ({
  money: (value: number) => value.toFixed(2),
  usePos: () => ({
    ready: fixture.ready, loadPhase: fixture.ready ? "ready" : "loading", currentStore: { id: "a", name: "Shop A", groupId: "g" },
    state: { sales: fixture.sales, products: [], transfers: [], stores: [{ id: "a", name: "Shop A", groupId: "g" }], settings: { integrations: { includeSponsorshipInDailySales: fixture.sponsor !== 0 } } },
  }),
}));
vi.mock("@/lib/use-report-sales", () => ({ useReportSales: () => ({ sales: fixture.sales, loading: fixture.loading, error: fixture.error }) }));
vi.mock("@/lib/use-sponsorship-totals", () => ({ useSponsorshipTotals: () => ({ total: fixture.sponsor, rows: [{ day: "2026-10-27", value: fixture.sponsor }], loading: false, error: false }) }));
vi.mock("@/lib/drawer-events", () => ({ useDrawerEvents: () => [] }));
vi.mock("@/lib/ui-visibility", () => ({ useVisibility: () => ({ visible: (name: string) => name === "dashboard.revenueSummary" }) }));
vi.mock("@/lib/time-zone", () => ({ posDayKey: () => "2026-10-27", posHour: () => 12, shiftCalendarDay: () => "2026-10-27", formatTime: () => "12:00" }));
vi.mock("@/core/activation/terminal-platform", () => ({ terminalRuntimePlatform: () => "web" }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => ({ options }) }));
vi.mock("@/platforms/web/components/pos/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/platforms/web/components/pos/HomeShortcuts", () => ({ HomeShortcuts: () => null }));
vi.mock("@/platforms/web/components/pos/CashierBillList", () => ({ CashierBillList: () => null }));
vi.mock("@/platforms/web/components/pos/InventorySummaryCards", () => ({ InventorySummaryCards: () => null }));
vi.mock("@/components/ui/table", () => {
  const Part = ({ children }: { children?: ReactNode }) => h("div", null, children);
  return { Table: Part, TableHeader: Part, TableBody: Part, TableRow: Part, TableHead: Part, TableCell: Part };
});
vi.mock("recharts", () => {
  const Chart = ({ children }: { children?: ReactNode }) => h("div", null, children);
  return Object.fromEntries(["Bar", "BarChart", "CartesianGrid", "Line", "LineChart", "ResponsiveContainer", "Tooltip", "XAxis", "YAxis"].map(name => [name, Chart]));
});

import { Route } from "@/routes/dashboard";
const render = () => renderToStaticMarkup(h(Route.options.component as ComponentType));
const sale = (patch: Partial<Sale> = {}): Sale => ({
  id: "sale", receiptNo: "R1", storeId: "a", shiftId: "shift", createdAt: "2026-10-27T12:00:00Z", cashier: "C",
  lines: [{ productId: "p", name: "Item", price: 100, cost: 40, qty: 1, discount: 0, taxRate: 0 }],
  subtotal: 100, discount: 10, tax: 9, roundingAdjustment: -0.05, total: 98.95,
  paid: 100, change: 1.05, method: "cash", memberId: null, pointsEarned: 0, ...patch,
});
beforeEach(() => { fixture.sales = []; fixture.loading = false; fixture.error = ""; fixture.ready = true; fixture.costs = true; fixture.sponsor = 0; });

describe("live dashboard summary", () => {
  it("replaces loaded all-zero cards with a clear empty message", () => {
    const html = render();
    expect(html).toContain("No trading totals to show today");
    expect(html).not.toContain('class="summary-card');
    expect(html).not.toContain(">Bills</p>");
  });

  it("reveals changed totals in the same row and keeps Bills aligned with peers", () => {
    fixture.sales = [sale()];
    const html = render();
    expect(html).toContain('aria-label="Revenue summary"');
    expect(html).toContain("Sales collected today");
    expect(html).toContain(">Bills</p>");
    expect(html).not.toContain(">Refunds</p>");
    expect(html).not.toContain("No-sale drawer opens");
    expect(html.match(/class="summary-card/g)).toHaveLength(5);
    expect(html.match(/numeric mt-auto/g)).toHaveLength(5);
  });

  it("keeps zero-priced bill counts while hiding zero money and cost cards", () => {
    fixture.sales = [sale({ subtotal: 0, discount: 0, tax: 0, roundingAdjustment: 0, total: 0, lines: [] })];
    const html = render();
    expect(html).toContain(">Bills</p>");
    expect(html.match(/class="summary-card/g)).toHaveLength(1);
    expect(html).not.toContain("Sales collected today");
    expect(html).not.toContain("Total COGS");
  });

  it("preserves meaningful negative monetary values", () => {
    fixture.sales = [sale({ subtotal: -10, discount: 0, tax: 0, roundingAdjustment: 0, total: -10, lines: [{ productId: "p", name: "Return", price: 10, cost: 4, qty: -1, discount: 0, taxRate: 0 }] })];
    const html = render();
    expect(html).toContain("Sales collected today");
    expect(html).toContain("-10.00");
    expect(html).toContain("Total COGS");
    expect(html).toContain("-4.00");
    expect(html).not.toContain("No trading totals");
  });

  it("retains signed sponsorship under the saved inclusion policy", () => {
    fixture.sponsor = -20;
    const html = render();
    expect(html).toContain("Sales value with sponsorship · not collections");
    expect(html).toContain("Sponsorship value included");
    expect(html).toContain("-20.00");
  });

  it("does not describe loading or failed reports as loaded zero activity", () => {
    fixture.loading = true;
    expect(render()).toContain("Loading the complete sales history");
    expect(render()).not.toContain("No trading totals");
    fixture.loading = false;
    fixture.error = "Connection unavailable";
    expect(render()).toContain("Report incomplete: Connection unavailable");
    expect(render()).not.toContain("No trading totals");
  });

  it("keeps cost visibility unchanged", () => {
    fixture.sales = [sale()];
    fixture.costs = false;
    const html = render();
    expect(html).toContain("Sales collected today");
    expect(html).not.toContain("Total COGS");
    expect(html).not.toContain("Gross margin");
  });
});
