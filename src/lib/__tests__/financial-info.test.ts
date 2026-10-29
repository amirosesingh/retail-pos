import { createElement as h, isValidElement, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sale } from "@/core/types/pos-types";
import { salesReconciliation } from "../sales-reconciliation";

const interaction = vi.hoisted(() => ({ open: false }));
vi.mock("react", async importOriginal => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: () => [interaction.open, (next: boolean | ((value: boolean) => boolean)) => {
    interaction.open = typeof next === "function" ? next(interaction.open) : next;
  }],
}));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => children,
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: ({ children, className }: { children: ReactNode; className?: string }) => h("div", { className }, children),
}));

import { FinancialInfoTip, GrossProfitInfo, SalesTotalInfo } from "@/platforms/web/components/pos/FinancialInfo";

const sale = (patch: Partial<Sale> = {}): Sale => ({
  id: "one", receiptNo: "R1", storeId: "A", shiftId: "S", lines: [{ productId: "p", name: "Item", price: 100, qty: 1, discount: 0, taxRate: 0 }],
  subtotal: 100, discount: 10, tax: 9, total: 98.95, roundingAdjustment: -0.05,
  paid: 100, change: 1.05, method: "cash", memberId: null, pointsEarned: 0, cashier: "Cashier", createdAt: "2026-10-01T10:00:00Z", ...patch,
});

function findButton(node: ReactNode): ReactElement<ButtonHTMLAttributes<HTMLButtonElement>> | undefined {
  if (!isValidElement<{ children?: ReactNode }>(node)) return;
  if (node.type === "button") return node as ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
  const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
  for (const child of children) {
    const found = findButton(child);
    if (found) return found;
  }
}

beforeEach(() => { interaction.open = false; });

describe("compact financial information", () => {
  it("uses a named keyboard button with a small glyph and viewport-bounded tooltip", () => {
    const html = renderToStaticMarkup(h(FinancialInfoTip, { label: "Revenue", children: "Recorded amounts" }));
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Revenue information"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("size-6");
    expect(html).toContain("size-3");
    expect(html).not.toContain("size-4");
    expect(html).toContain("max-w-[min(20rem,calc(100vw-2rem))]");
  });

  it.each(["mouse", "touch"])("opens and closes on %s activation without Radix's default dismissal", pointerType => {
    const pointerEvent = { pointerType, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const clickEvent = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const render = () => findButton(FinancialInfoTip({ label: "Revenue", children: "Amounts" }))!;
    render().props.onPointerDown?.(pointerEvent as unknown as Parameters<NonNullable<ButtonHTMLAttributes<HTMLButtonElement>["onPointerDown"]>>[0]);
    expect(pointerEvent.preventDefault).toHaveBeenCalledOnce();
    render().props.onClick?.(clickEvent as unknown as Parameters<NonNullable<ButtonHTMLAttributes<HTMLButtonElement>["onClick"]>>[0]);
    expect(clickEvent.preventDefault).toHaveBeenCalledOnce();
    expect(clickEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(render().props["aria-expanded"]).toBe(true);
    render().props.onClick?.(clickEvent as unknown as Parameters<NonNullable<ButtonHTMLAttributes<HTMLButtonElement>["onClick"]>>[0]);
    expect(render().props["aria-expanded"]).toBe(false);
  });

  it("shows stored inclusive tax and discounts in order, without costs in sales detail", () => {
    const totals = salesReconciliation([sale({ subtotal: 110, discount: 11, tax: 9, total: 99, roundingAdjustment: 0, lines: [{ productId: "p", name: "Item", price: 110, qty: 1, discount: 0, taxRate: 0 }] })]);
    const html = renderToStaticMarkup(h(SalesTotalInfo, { totals }));
    expect(html.indexOf("Subtotal before discounts")).toBeLessThan(html.indexOf("Less bill discounts"));
    expect(html.indexOf("Less tax included in subtotal")).toBeLessThan(html.indexOf("Net sales before receipt adjustments (ex tax)"));
    expect(html.indexOf("Net sales before receipt adjustments (ex tax)")).toBeLessThan(html.indexOf("Tax collected"));
    expect(html).toContain("Total collected");
    expect(html).not.toContain("cost");
    expect(html).not.toContain("profit");
  });

  it("hides zero tax/sponsorship while retaining rounding and saved legacy discounts", () => {
    const html = renderToStaticMarkup(h(SalesTotalInfo, { totals: salesReconciliation([sale({ tax: 0, total: 89.95, lines: [] })]) }));
    expect(html).not.toContain("Tax collected");
    expect(html).not.toContain("Sponsorship value");
    expect(html).toContain("Less recorded discounts");
    expect(html).toContain("historical lines are unavailable");
    expect(html).toContain("Receipt adjustments");
  });

  it("keeps policy-included sponsorship distinct from customer collections", () => {
    const html = renderToStaticMarkup(h(SalesTotalInfo, { totals: salesReconciliation([sale()]), sponsorshipValue: 20 }));
    expect(html).toContain("Sponsorship value");
    expect(html).toContain("Sales value with sponsorship · not collections");
    expect(html).toContain("stock value, separate from customer payments");
    expect(html).toContain("118.95");
  });

  it("explains nonzero negative sponsorship values without changing stored collections", () => {
    const html = renderToStaticMarkup(h(SalesTotalInfo, { totals: salesReconciliation([sale()]), sponsorshipValue: -20 }));
    expect(html).toContain("Sponsorship value");
    expect(html).toContain("78.95");
    expect(html).toContain("98.95");
  });

  it("explains existing net sales, cost deduction, profit and cost estimates", () => {
    const html = renderToStaticMarkup(h(GrossProfitInfo, { revenue: 100, cost: 60, profit: 40, marginPct: 40 }));
    expect(html.indexOf("Net sales excluding tax")).toBeLessThan(html.indexOf("Less cost of goods sold"));
    expect(html.indexOf("Less cost of goods sold")).toBeLessThan(html.indexOf("Gross profit"));
    expect(html).toContain("40.0%");
    expect(html).toContain("Missing costs use the current product cost");
  });
});
