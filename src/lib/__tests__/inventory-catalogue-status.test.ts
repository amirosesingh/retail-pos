import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/platforms/web/components/pos/AnimatedMetric", () => ({
  AnimatedMetric: ({ value }: { value: number }) => h("span", { "data-count": value }, value),
}));
import { InventoryCatalogueStatus } from "@/platforms/web/components/pos/InventoryCatalogueStatus";
const render = (props: Partial<Parameters<typeof InventoryCatalogueStatus>[0]> = {}) => renderToStaticMarkup(h(InventoryCatalogueStatus, {
  ready: true, activeCount: 40, archivedCount: 5, ...props,
}));

describe("inventory catalogue footer totals", () => {
  it("shows only total, active and archived counts without the removed status box", () => {
    const html = render();
    expect(html).toContain('<footer aria-label="Catalogue totals"');
    expect(html).toContain("Total products");
    expect(html).toContain('data-count="45"');
    expect(html).toContain(">Active</dt>");
    expect(html).toContain('data-count="40"');
    expect(html).toContain(">Archived</dt>");
    expect(html).toContain('data-count="5"');
    for (const removed of ["Viewing", "Search / advanced matches", "Applied search", "purchase cost", "rounded-lg", "bg-muted"]) expect(html).not.toContain(removed);
  });

  it("keeps authoritative zero counts visible without pretending to be loading", () => {
    const html = render({ activeCount: 0, archivedCount: 0 });
    expect(html.match(/data-count="0"/g)).toHaveLength(3);
    expect(html).not.toContain("Loading catalogue");
  });

  it.each(["loading", "stalled", "failed"] as const)("does not misreport a %s catalogue as zero", loadPhase => {
    const html = render({ ready: false, loadPhase, activeCount: 0, archivedCount: 0 });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain(loadPhase === "failed" ? 'role="alert"' : 'role="status"');
    expect(html).not.toContain("data-count");
    expect(html).not.toContain("Total products");
  });

  it("wraps large counts in a compact responsive footer", () => {
    const html = render({ activeCount: 123456789, archivedCount: 987654321 });
    expect(html).toContain('data-count="1111111110"');
    expect(html).toContain("flex-wrap");
    expect(html).toContain("[overflow-wrap:anywhere]");
  });

  it("places scoped catalogue totals after pagination and preserves search and mode controls", () => {
    const source = readFileSync("src/routes/inventory.tsx", "utf8");
    expect(source.indexOf("<TablePagination")).toBeLessThan(source.indexOf("<InventoryCatalogueStatus"));
    expect(source).toContain("branchInventoryCounts(catalogProducts, currentStore.id)");
    expect(source).toContain("activeCount={branchCounts.active} archivedCount={archivedCount}");
    expect(source).toContain('aria-label="Search products"');
    expect(source).toContain('aria-label="Advanced product filters"');
    expect(source).toContain('showArchived ? "Show active" : "Show archived"');
  });
});
