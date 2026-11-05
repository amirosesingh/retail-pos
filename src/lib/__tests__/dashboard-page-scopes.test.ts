import { createElement as h, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ branch: "A", terminal: null as string | null, assigned: null as string | null,
  switchStores: true, cost: true, management: false, loading: false, error: "", boardIds: [] as string[], lifetimeIds: [] as string[], salesIds: [] as string[] }));
const stores = [{ id: "A", code: "A", name: "Airport", groupId: "one" },
  { id: "A2", code: "A2", name: "Town", groupId: "one" }, { id: "B", code: "B", name: "Riverside", groupId: "two" }];
vi.mock("@/lib/pos-auth", () => ({ useAuth: () => ({ ready: true, isAdmin: true,
  user: { staffId: "test", role: "admin", storeId: fixture.assigned, permissions: {} }, terminalStoreId: fixture.terminal,
  canSwitchStores: fixture.switchStores, can: (flag: string) => flag !== "can_view_cost_margin" || fixture.cost }) }));
vi.mock("@/lib/pos-store", () => ({ money: (value: number) => value.toFixed(2), stockAt: () => 0, usePos: () => ({
  ready: true, loadPhase: "ready", currentStore: stores.find(store => store.id === fixture.branch), stores, allStores: stores,
  state: { stores, products: [], sales: [], transfers: [], shifts: [], settings: { integrations: {} } },
}) }));
vi.mock("@/lib/use-report-sales", () => ({ useReportSales: (_seed: unknown, ids: string[]) => {
  fixture.salesIds = ids; return { sales: [], loading: fixture.loading, error: fixture.error, refreshing: false };
} }));
vi.mock("@/lib/use-all-shops-lifetime", () => ({ useAllShopsLifetime: (ids: string[]) => {
  fixture.lifetimeIds = ids; return { totals: Object.fromEntries(ids.map(id => [id, { revenue: 0, profit: 0, bills: 0 }])), loading: false, error: "" };
} }));
vi.mock("@/lib/management-device", () => ({ isManagementDevice: () => fixture.management }));
vi.mock("@/core/local-db/local-db", () => ({ localDb: () => null }));
vi.mock("@/lib/use-sponsorship-totals", () => ({ useSponsorshipTotals: () => ({ rows: [], loading: false, error: false }) }));
vi.mock("@/lib/drawer-events", () => ({ useDrawerEvents: () => [] }));
vi.mock("@/lib/ui-visibility", () => ({ useVisibility: () => ({ visible: () => true }) }));
vi.mock("@/lib/page-data-cache", () => ({ PAGE_DATA_CACHE: {}, pageDataScope: () => ["scope"] }));
vi.mock("@/core/activation/terminal-platform", () => ({ terminalRuntimePlatform: () => "web" }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => ({ options }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: { queryKey: unknown[] }) => {
  fixture.boardIds = String(options.queryKey[3]).split("|").filter(Boolean);
  return { isLoading: fixture.loading, isFetching: false, isError: !!fixture.error, error: new Error(fixture.error), refetch: vi.fn(),
    data: fixture.loading || fixture.error ? undefined : { storeDays: [], itemDays: [], bills: [], storeNames: {}, liveStoreIds: fixture.boardIds } };
} }));
vi.mock("@/platforms/web/components/pos/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/platforms/web/components/pos/HomeShortcuts", () => ({ HomeShortcuts: () => null }));
vi.mock("@/platforms/web/components/pos/CashierBillList", () => ({ CashierBillList: () => null }));
vi.mock("@/platforms/web/components/pos/InventorySummaryCards", () => ({ InventorySummaryCards: () => null }));
vi.mock("@/platforms/web/components/pos/ReportReceiptLink", () => ({ ReportReceiptLink: () => null }));
vi.mock("@/platforms/web/components/pos/ShopComparisonCharts", () => ({ ShopComparisonCharts: ({ selectedIds }: { selectedIds: string[] }) => h("div", { "data-comparison-shops": selectedIds.join("|") }) }));
vi.mock("@/components/ui/table", () => {
  const Part = ({ children }: { children?: ReactNode }) => h("div", null, children);
  return { Table: Part, TableHeader: Part, TableBody: Part, TableRow: Part, TableHead: Part, TableCell: Part };
});
vi.mock("recharts", () => {
  const Chart = ({ children }: { children?: ReactNode }) => h("div", null, children);
  return Object.fromEntries(["Bar", "BarChart", "CartesianGrid", "Cell", "ComposedChart", "Legend", "Line", "LineChart", "Pie", "PieChart", "ResponsiveContainer", "Tooltip", "XAxis", "YAxis"].map(name => [name, Chart]));
});
import { Route as Dashboard } from "@/routes/dashboard";
import { Route as Board } from "@/routes/analytics";
import { Route as AllShops } from "@/routes/all-shops";
const render = (route: { options: { component?: unknown } }) => renderToStaticMarkup(h(route.options.component as ComponentType));
beforeEach(() => { fixture.branch = "A"; fixture.terminal = null; fixture.assigned = null; fixture.switchStores = true;
  fixture.cost = true; fixture.management = false; fixture.loading = false; fixture.error = ""; });

describe("dashboard page adapter scope and zero cards", () => {
  it("requests only the selected branch on Dashboard and keeps its graphs in place", () => {
    const html = render(Dashboard);
    expect(fixture.salesIds).toEqual(["A"]);
    expect(html).toContain("Live dashboard · Airport");
    expect(html).not.toContain("All authorized shops");
    expect(html).not.toContain("carousel");
  });
  it("requests all authorized clusters on Business Board with explicit scope text", () => {
    const html = render(Board);
    expect(fixture.boardIds).toEqual(["A", "A2", "B"]);
    expect(html).toContain("All authorized company shops across clusters");
    expect(html).toContain('data-comparison-shops="A|A2|B"');
  });
  it("keeps administrator-on-normal-terminal reads on its registered branch on both pages", () => {
    fixture.terminal = "A2"; fixture.branch = "B";
    render(Dashboard); expect(fixture.salesIds).toEqual(["A2"]);
    render(Board); expect(fixture.boardIds).toEqual(["A2"]);
  });
  it("shows zero-valued cards only within the selected cluster and offers explicit All clusters", () => {
    const html = render(AllShops);
    expect(fixture.lifetimeIds).toEqual(["A", "A2"]);
    expect(html).toContain("Airport"); expect(html).toContain("Town"); expect(html).not.toContain("Riverside");
    expect(html).toContain("All authorized clusters");
    fixture.branch = "B";
    const other = render(AllShops);
    expect(fixture.lifetimeIds).toEqual(["B"]);
    expect(other).toContain("Riverside"); expect(other).not.toContain(">Airport</p>");
  });
  it("keeps period totals hidden on initial loading or failure rather than showing temporary zero KPIs", () => {
    fixture.loading = true;
    expect(render(AllShops)).not.toContain('aria-label="Selected-period shop totals"');
    expect(render(Board)).not.toContain('aria-label="Business totals"');
    fixture.loading = false; fixture.error = "Unavailable";
    expect(render(AllShops)).toContain("Could not refresh trading data");
    expect(render(AllShops)).not.toContain('aria-label="Selected-period shop totals"');
  });
});
