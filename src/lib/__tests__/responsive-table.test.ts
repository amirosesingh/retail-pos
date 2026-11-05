import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
const portals = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("react-dom", async importOriginal => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  createPortal: (children: ReactNode, target: unknown) => {
    portals.render(children, target);
    return createElement("div", { "data-controls-target": "heading" }, children);
  },
}));
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

describe("responsive tables", () => {
  it("copies desktop headers to mobile-card cell labels", () => {
    const html = renderToStaticMarkup(
      createElement(
        Table,
        { "aria-label": "Products" },
        createElement(
          TableHeader,
          null,
          createElement(
            TableRow,
            null,
            createElement(TableHead, null, "Product"),
            createElement(TableHead, null, "Quantity"),
            createElement(TableHead),
          ),
        ),
        createElement(
          TableBody,
          null,
          createElement(
            TableRow,
            null,
            createElement(TableCell, null, "Shuttle"),
            createElement(TableCell, null, "12"),
            createElement(TableCell, null, "Open"),
          ),
        ),
      ),
    );
    expect(html).toContain('data-mobile-cards="true"');
    expect(html).toContain('data-label="Product"');
    expect(html).toContain('data-label="Quantity"');
    expect(html).toContain('data-label=""');
  });

  it("allows specialised tables to opt out of card mode", () => {
    const html = renderToStaticMarkup(
      createElement(Table, { mobileCards: false }, createElement(TableBody)),
    );
    expect(html).toContain('data-mobile-cards="false"');
  });

  it("uses container-aware layout and fluid typography tokens", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain("@container (max-width: 900px)");
    expect(css).toContain("--text-sm: clamp(");
    expect(css).toContain("0.4cqi");
  });

  it("limits Expand to the phone breakpoint while retaining normal table controls", () => {
    const html = renderToStaticMarkup(createElement(Table, { "aria-label": "Products", columnControls: true },
      createElement(TableHeader, null, createElement(TableRow, null, createElement(TableHead, null, "Product"), createElement(TableHead, null, "Quantity"))),
      createElement(TableBody, null, createElement(TableRow, null, createElement(TableCell, null, "Shuttle"), createElement(TableCell, null, "12"))),
    ));
    expect(html).toMatch(/<div class="[^"]*sm:hidden[^"]*"><button[^>]*aria-label="Expand Products"/);
    expect(html).toContain("Expand table");
    expect(html).toContain("Columns");
    expect(html).toContain("Sort ascending");
    expect(html).toContain("Filter Quantity");
    expect(html).toContain('data-label="Quantity"');
  });

  it("reuses the existing heading control target without losing column actions", () => {
    portals.render.mockClear();
    const target = { id: "split-payment-columns" } as unknown as HTMLElement;
    const html = renderToStaticMarkup(createElement(Table, { columnControls: true, controlsTarget: target },
      createElement(TableHeader, null, createElement(TableRow, null, createElement(TableHead, null, "Receipt"), createElement(TableHead, null, "Total"))),
      createElement(TableBody, null, createElement(TableRow, null, createElement(TableCell, null, "R1"), createElement(TableCell, null, "25.00"))),
    ));
    expect(portals.render).toHaveBeenCalledOnce();
    expect(portals.render.mock.calls[0][1]).toBe(target);
    expect(html).toContain('data-controls-target="heading"');
    expect(html).toContain("Columns");
    expect(html).toContain("25.00");
  });
});
