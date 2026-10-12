import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataProgress } from "@/components/shared/DataProgress";
import { beginDataTask } from "../data-progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
const headers = h(
  TableHeader,
  null,
  h(TableRow, null, h(TableHead, null, "Product"), h(TableHead, null, "Quantity")),
);
describe("progress inside the POS", () => {
  it("uses an inline strip and keeps unknown totals indeterminate", () => {
    const task = beginDataTask("Loading products");
    try {
      task.report(50);
      const html = renderToStaticMarkup(h(DataProgress));
      expect(html).toContain("50 records processed");
      expect(html).not.toContain("aria-valuenow=");
      expect(html).not.toContain("fixed");
    } finally {
      task.finish();
    }
  });
  it("shows real completion as 100 percent", () => {
    const task = beginDataTask("Exporting rows");
    try {
      task.report(100, 100);
      expect(renderToStaticMarkup(h(DataProgress))).toContain('aria-valuenow="100"');
    } finally {
      task.finish();
    }
    expect(renderToStaticMarkup(h(DataProgress))).toBe("");
  });
});
describe("table loading", () => {
  it("keeps loaded rows visible and marks a refreshing table busy", () => {
    const body = h(
      TableBody,
      null,
      h(TableRow, null, h(TableCell, null, "Existing product"), h(TableCell, null, 12)),
    );
    const html = renderToStaticMarkup(h(Table, { loading: true }, headers, body));
    expect(html).toContain("Existing product");
    expect(html).toContain("Refreshing rows…");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("animate-pulse");
  });
  it("replaces initial empty messages with skeletons until data arrives", () => {
    const body = h(TableBody, null, h(TableRow, null, h(TableCell, { colSpan: 2 }, "No products")));
    const html = renderToStaticMarkup(h(Table, { loading: true }, headers, body));
    expect(html).not.toContain("No products");
    expect(html).toContain("Loading rows…");
    expect(html).toContain("animate-pulse");
    expect(html).toContain("Product");
    expect(renderToStaticMarkup(h(Table, null, headers, body))).toContain("No products");
  });
});
