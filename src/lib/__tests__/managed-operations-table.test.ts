import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell, TableFooter, getManagedRows, sumManagedRows, hideTableColumns, filterTableBodies, sortTableBodies } from "@/components/ui/table";

const rows = Array.from({length: 30}, (_, i) => h(TableRow, {key: i, summaryValues: {Units: i + 1, Amount: (i + 1) * 2}}, h(TableCell, null, `Item-${i + 1}`), h(TableCell, null, i + 1)));
const head = h(TableHeader, null, h(TableRow, null, h(TableHead, null, "Product"), h(TableHead, null, "Quantity")));
const body = h(TableBody, null, rows);
describe("operational table controls", () => {
  it("paginates supplied rows while totaling the entire matching list", () => {
    const html = renderToStaticMarkup(h(Table, {managed: true}, head, body));
    expect(html).toContain("Item-25"); expect(html).not.toContain("Item-26");
    expect(html).toContain("465"); expect(html).toContain("930");
    expect(html).toContain("Columns"); expect(html).toContain("Next page");
    expect(renderToStaticMarkup(h(Table, null, head, body))).toContain("Item-30");
  });
  it("sorts and filters the whole dataset before pagination, keeping totals with their records", () => {
    const filtered = filterTableBodies(body, {0: "Item-3"});
    expect(sumManagedRows(getManagedRows(filtered))).toEqual({Units: 33, Amount: 66});
    const sorted = getManagedRows(sortTableBodies(body, {column: 1, direction: "desc"}));
    expect(renderToStaticMarkup(h(Table, {managed:true}, head, h(TableBody, null, sorted)))).toContain("Item-30");
  });
  it("does not count spanning empty states or document footer totals as rows", () => {
    const empty = h(TableBody, null, h(TableRow, null, h(TableCell, {colSpan:2}, "No items")));
    expect(getManagedRows(empty)).toEqual([]);
    expect(getManagedRows(h(TableFooter, null, rows))).toEqual([]);
  });
  it("hides both header and body cells while keeping correct empty-state spans", () => {
    const hidden = hideTableColumns([head, body], [1]);
    const html = renderToStaticMarkup(h(Table, null, hidden));
    expect(html.match(/display:none/g)).toHaveLength(31);
    const empty = h(TableBody, null, h(TableRow, null, h(TableCell, {colSpan:2}, "No items")));
    expect(renderToStaticMarkup(h(Table, null, hideTableColumns(empty, [1])))).toContain('colSpan="1"');
  });
});
