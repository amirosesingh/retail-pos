import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/platforms/web/components/pos/AnimatedMetric", () => ({
  AnimatedMetric: ({ value }: { value: number }) => h("span", { "data-count": value }, value),
}));
import { InventoryCatalogueStatus } from "@/platforms/web/components/pos/InventoryCatalogueStatus";

const render = (props: Partial<Parameters<typeof InventoryCatalogueStatus>[0]> = {}) => renderToStaticMarkup(h(InventoryCatalogueStatus, {
  ready: true, activeCount: 40, archivedCount: 5, shownCount: 5, showArchived: true, filters: [], ...props,
}));

describe("inventory catalogue status", () => {
  it("distinguishes archived product count from the active-only inventory totals", () => {
    const html = render();
    expect(html).toContain("Viewing Archived");
    expect(html).toContain("Search / advanced matches: 5 of 5 archived products");
    expect(html).toContain("Active products");
    expect(html).toContain('data-count="40"');
    expect(html).toContain("Archived products");
    expect(html).toContain('data-count="5"');
    expect(html).toContain("Inventory totals below use active products only");
    expect(html).not.toContain("Applied search and advanced filters");
  });

  it("retains the mode total when search and advanced filters narrow visible results", () => {
    const html = render({ shownCount: 1, filters: ["Search", "Category: Rackets", "Stock: Out of stock", "Min price: 20"] });
    expect(html).toContain("Search / advanced matches: 1 of 5 archived products");
    expect(html).toContain('aria-label="Applied search and advanced filters"');
    for (const label of ["Search", "Category: Rackets", "Stock: Out of stock", "Min price: 20"]) expect(html).toContain(label);
    expect(html).toContain('data-count="40"');
    expect(html).toContain('data-count="5"');
  });

  it("uses the active total in active mode and reports an authoritative empty archive", () => {
    const active = render({ showArchived: false, shownCount: 12, filters: ["SKU / barcode"] });
    expect(active).toContain("Viewing Active");
    expect(active).toContain("Search / advanced matches: 12 of 40 active products");
    const empty = render({ archivedCount: 0, shownCount: 0 });
    expect(empty).toContain("Search / advanced matches: 0 of 0 archived products");
    expect(empty).toContain('data-count="0"');
    expect(empty).not.toContain("Loading catalogue");
  });

  it.each(["loading", "stalled", "failed"] as const)("does not misreport a %s catalogue as zero or leak stale filters/cost hints", loadPhase => {
    const html = render({ ready: false, loadPhase, activeCount: 0, archivedCount: 0, filters: ["Search"], children: h("p", null, "Active purchase cost value 1234.56") });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain(loadPhase === "failed" ? 'role="alert"' : 'role="status"');
    expect(html).not.toContain("Search / advanced matches");
    expect(html).not.toContain("data-count");
    expect(html).not.toContain("1234.56");
    expect(html).not.toContain("Applied search and advanced filters");
  });

  it("shows only supplied permission-filtered cost hints and wraps long filter text", () => {
    expect(render()).not.toContain("purchase cost");
    const html = render({ children: h("p", null, "Active purchase cost value 1234.56"), filters: ["Category: A very long category <script>"] });
    expect(html).toContain("1234.56");
    expect(html).toContain("[overflow-wrap:anywhere]");
    expect(html).toContain("max-w-full");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
