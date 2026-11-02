import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  totals: { bills: 0, net: 0, collected: 0, discounts: 0, tax: 0 }, loading: false, error: "",
}));
vi.mock("@/lib/pos-store", () => ({
  money: (value: number) => value.toFixed(2),
  usePos: () => ({ state: { sales: [], products: [], settings: { integrations: {} } }, stores: [{ id: "a" }] }),
}));
vi.mock("@/lib/sales-report-context", () => ({
  useSalesReportFilters: () => ({ from: "2026-10-01", to: "2026-10-30", storeId: "a", cashier: "all", q: "" }),
  useSalesReportContext: () => null,
}));
vi.mock("@/lib/use-report-sales", () => ({ useReportSales: () => ({ sales: [], loading: fixture.loading, error: fixture.error }) }));
vi.mock("@/lib/sales-reconciliation", () => ({ salesReconciliation: () => fixture.totals }));
vi.mock("@/lib/use-sponsorship-totals", () => ({ useSponsorshipTotals: () => ({ total: 0, loading: false, error: false }) }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => ({ options }) }));
vi.mock("@/platforms/web/components/pos/SalesReportWorkspace", () => ({ SalesReportWorkspace: () => null }));
vi.mock("@/platforms/web/components/pos/FinancialInfo", () => ({ FinancialInfoTip: () => null, SalesTotalInfo: () => null, FinancialBreakdown: () => null }));
vi.mock("@/platforms/web/components/pos/ReportReceiptLink", () => ({ ReportReceiptLink: () => null }));
vi.mock("@/platforms/web/components/pos/report-kit", () => {
  const Part = ({ children }: { children?: ReactNode }) => h("div", null, children);
  return { ReportTable: Part, ReportFrame: Part, ReportHeader: () => null, defaultRange: () => ({}), downloadReport: vi.fn(), inRange: () => true, stamp: () => "" };
});
vi.mock("@/platforms/web/components/pos/TablePagination", () => ({ TablePagination: () => null, usePagination: () => ({ pageItems: [] }) }));
vi.mock("@/components/ui/table", () => {
  const Part = ({ children }: { children?: ReactNode }) => h("div", null, children);
  return { TableBody: Part, TableCell: Part, TableHead: Part, TableHeader: Part, TableRow: Part };
});
import { BillsReport } from "@/routes/reports.sales";
const render = () => renderToStaticMarkup(h(BillsReport));

beforeEach(() => { fixture.totals = { bills: 0, net: 0, collected: 0, discounts: 0, tax: 0 }; fixture.loading = false; fixture.error = ""; });

describe("sales report summary visibility", () => {
  it("hides all zero summary cards while retaining the actual empty table message", () => {
    const html = render();
    expect(html).not.toContain('aria-label="Sales report totals"');
    expect(html).not.toContain("Completed bills");
    expect(html).not.toContain("Discounts given");
    expect(html).toContain("No bills in this date range.");
  });
  it("reveals positive cards but leaves zero discounts and tax hidden", () => {
    fixture.totals = { bills: 3, net: 120, collected: 120, discounts: 0, tax: 0 };
    const html = render();
    expect(html).toContain('aria-label="Sales report totals"');
    expect(html).toContain("Completed bills");
    expect(html).toContain("120.00");
    expect(html).not.toContain("Discounts given");
    expect(html).not.toContain("Tax collected");
  });
  it("preserves meaningful signed balances instead of hiding negative financial data", () => {
    fixture.totals = { bills: 1, net: -20, collected: -20, discounts: -2, tax: -1 };
    const html = render();
    expect(html).toContain("-20.00");
    expect(html).toContain("Discounts given");
    expect(html).toContain("Tax collected");
  });
  it("keeps loading and failed reads distinct from loaded zero data", () => {
    fixture.loading = true;
    expect(render()).toContain("Updating report data");
    fixture.loading = false; fixture.error = "Report unavailable";
    expect(render()).toContain("Report unavailable");
    expect(render()).not.toContain('aria-label="Sales report totals"');
  });
});
