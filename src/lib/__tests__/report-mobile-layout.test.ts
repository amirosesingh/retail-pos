import { describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SalesReportContext } from "../sales-report-context";
import { ReportHeader, ReportTable } from "@/platforms/web/components/pos/report-kit";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
vi.mock("@/lib/pos-auth", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/pos-auth")>()),
  useAuth: () => ({ can: () => true }),
}));

describe("compact report records", () => {
  it("keeps receipt column tables fully visible without hidden expandable fields", () => {
    const html = renderToStaticMarkup(h(ReportTable, { mobileCards: false },
      h(TableBody, {}, h(TableRow, {}, ...["Item", "1", "20", "4", "16"].map(value => h(TableCell, {key:value}, value)))),
    ));
    expect(html).toContain('data-mobile-cards="false"');
    expect(html).not.toContain('report-record');
    expect(html).not.toContain('report-row-toggle');
    expect(html).toContain('>16<');
  });
  it("preserves values and accessible labels when adding expandable mobile details", () => {
    const html = renderToStaticMarkup(h(ReportTable, {},
      h(TableHeader, {}, h(TableRow, {}, h(TableHead, {}, "Receipt"), h(TableHead, {}, "Total"))),
      h(TableBody, {}, h(TableRow, { key: "bill" }, h(TableCell, { className: "", ...{ "data-sort-value": "00123" } }, "00123"), h(TableCell, {}, "25.00"))),
    ));
    expect(html).toContain('data-label="Receipt"');
    expect(html).toContain('data-label="Total"');
    expect(html).toContain('data-sort-value="00123"');
    expect(html).toContain("25.00");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Show all details");
  });
  it("keeps loading and empty states as a single message", () => {
    const html = renderToStaticMarkup(h(ReportTable, {}, h(TableBody, {}, h(TableRow, {}, h(TableCell, { colSpan: 5 }, "No bills")))));
    expect(html).toContain("No bills");
    expect(html).not.toContain("Show all details");
  });
});


describe("sales workspace shared filters", () => {
  it("removes the legacy Store picker but retains unrelated date tools", () => {
    const set = () => undefined;
    const context = { from: "2026-10-01", to: "2026-10-26", storeId: "branch-a", cashier: "all", q: "", tender: "all", setFrom: set, setTo: set, setStoreId: set, setCashier: set, setQ: set, setTender: set, history: { sales: [], loading: false, refreshing: false, error: "" } };
    const html = renderToStaticMarkup(h(SalesReportContext.Provider, { value: context },
      h(ReportHeader, { title: "Payments", subtitle: "Payment history", from: context.from, to: context.to, onFrom: set, onTo: set },
        h("div", {}, h("label", {}, "Store"), h("button", {}, "Legacy store picker")),
        h("div", {}, h("label", {}, "Comparison period"), h("button", {}, "Choose comparison dates")),
      ),
    ));
    expect(html).not.toContain("Legacy store picker");
    expect(html).toContain("Choose comparison dates");
  });
});
