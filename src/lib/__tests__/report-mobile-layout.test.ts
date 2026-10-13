import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportTable } from "@/platforms/web/components/pos/report-kit";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
