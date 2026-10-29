import { createElement as h, Fragment, type CSSProperties, type KeyboardEventHandler, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
  keyDown: null as KeyboardEventHandler<HTMLDivElement> | null,
  reduced: false,
  geometry: { width: 326, windowWidth: 390, minCardWidth: 208 },
  slideWidths: [] as number[],
  api: { scrollNext: vi.fn(), scrollPrev: vi.fn() },
}));
vi.mock("react", async importOriginal => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: (initial: unknown) => [initial === null ? fixture.geometry : fixture.api, vi.fn()],
  useMemo: (calculate: () => unknown) => calculate(),
}));
vi.mock("@/components/ui/carousel", () => ({
  Carousel: ({ opts, onKeyDownCapture, children, ...props }: { opts: Record<string, unknown>; onKeyDownCapture: KeyboardEventHandler<HTMLDivElement>; children: ReactNode; setApi?: unknown; [key: string]: unknown }) => {
    fixture.options = opts;
    fixture.keyDown = onKeyDownCapture;
    return h("div", { "aria-label": props["aria-label"] as string, "data-card-count": props["data-card-count"] as number }, children);
  },
  CarouselContent: ({ children, className, style }: { children: ReactNode; className: string; style?: CSSProperties }) => h("div", { className, style }, children),
  CarouselItem: ({ children, className, style }: { children: ReactNode; className: string; style?: CSSProperties }) => {
    if (style?.flex) fixture.slideWidths.push(Number.parseFloat(String(style.flex).split(" ").at(-1)!));
    return h("div", { className, style, "data-summary-slide": "true" }, children);
  },
}));
import { SummaryCardRail } from "@/platforms/web/components/pos/SummaryCardRail";

const card = (id: string) => h("article", { key: id }, id);
const render = (children: ReactNode, options: Partial<Parameters<typeof SummaryCardRail>[0]> = {}) => renderToStaticMarkup(h(SummaryCardRail, { label: "Totals", children, ...options }));

beforeEach(() => {
  fixture.options = null; fixture.keyDown = null; fixture.reduced = false;
  fixture.geometry = { width: 326, windowWidth: 390, minCardWidth: 208 }; fixture.slideWidths = [];
  fixture.api.scrollNext.mockClear(); fixture.api.scrollPrev.mockClear();
  vi.stubGlobal("window", { matchMedia: () => ({ matches: fixture.reduced }) });
});
afterEach(() => vi.unstubAllGlobals());

describe("manual summary card rails", () => {
  it("flattens sponsorship fragments, removes hidden nodes and renders every card once", () => {
    const html = render([false, card("Net"), h(Fragment, { key: "sponsorship" }, card("Sponsor"), null, card("Combined"))]);
    expect(html).toContain('data-card-count="3"');
    expect(html.match(/data-summary-slide="true"/g)).toHaveLength(3);
    for (const label of ["Net", "Sponsor", "Combined"]) expect(html.match(new RegExp(`<article>${label}</article>`, "g"))).toHaveLength(1);
    expect(fixture.options).toMatchObject({ active: true, loop: true, watchSlides: true, watchResize: true });
    expect(fixture.slideWidths.every(width => width > 270 && width < 326)).toBe(true);
  });

  it("uses full-width two-card slides so Embla can loop without duplicate cards", () => {
    const html = render([card("First"), card("Second")]);
    expect(html.match(/data-summary-slide="true"/g)).toHaveLength(2);
    expect(fixture.slideWidths).toEqual([327, 327]);
    expect(fixture.options?.loop).toBe(true);
  });

  it("keeps empty and single-card groups static as visibility/counts change", () => {
    expect(render([])).toBe("");
    expect(fixture.options).toBeNull();
    expect(render(card("Only"))).toContain('data-card-count="1"');
    expect(fixture.options).toMatchObject({ active: false, loop: false });
    render([card("Only"), card("New")]);
    expect(fixture.options).toMatchObject({ active: true, loop: true });
    render(card("Only"));
    expect(fixture.options).toMatchObject({ active: false, loop: false });
  });

  it("keeps a fitting desktop row and loops Windows overflow with a full spare slide", () => {
    fixture.geometry = { width: 1392, windowWidth: 2148, minCardWidth: 208 };
    const cards = Array.from({ length: 6 }, (_, index) => card(String(index)));
    const fitted = render(cards);
    expect(fixture.options).toMatchObject({ active: false, loop: false });
    expect(fitted).toContain("grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))]");
    fixture.slideWidths = [];
    const overflow = render([...cards, card("Extra")]);
    expect(fixture.options).toMatchObject({ active: true, loop: true });
    expect(fixture.slideWidths).toHaveLength(7);
    expect(fixture.slideWidths[0]).toBeGreaterThanOrEqual(208);
    expect(fixture.slideWidths[0]).toBeLessThan(250);
    expect(6 * fixture.slideWidths[0]).toBeGreaterThan(1392);
    expect(overflow).toContain("flex-wrap:nowrap");
    expect(fixture.options?.breakpoints).toMatchObject({ "(prefers-reduced-motion: reduce)": { duration: 0 } });
    expect(overflow).not.toContain("overflow-x-auto");
  });

  it("responds to container resizing and hidden-card changes rather than device labels", () => {
    const cards = [card("One"), card("Two"), card("Three")];
    fixture.geometry = { width: 1000, windowWidth: 1400, minCardWidth: 208 };
    render(cards);
    expect(fixture.options?.loop).toBe(false);
    fixture.geometry = { width: 400, windowWidth: 1400, minCardWidth: 208 };
    fixture.slideWidths = [];
    render(cards);
    expect(fixture.options?.loop).toBe(true);
    expect(2 * fixture.slideWidths[0]).toBeGreaterThan(400);
    render(card("One"));
    expect(fixture.options).toMatchObject({ active: false, loop: false });
  });

  it("retains finite desktop category carousels without changing graph rails", () => {
    fixture.geometry = { width: 1200, windowWidth: 1400, minCardWidth: 208 };
    const html = render([card("One"), card("Two")], { desktopBehavior: "finite-carousel" });
    expect(fixture.options).toMatchObject({ active: true, loop: false, containScroll: "trimSnaps" });
    expect(html).toContain("basis-[48%]");
    fixture.slideWidths = [];
    render([card("One"), card("Two"), card("Three")], { desktopBehavior: "finite-carousel" });
    expect(fixture.options?.loop).toBe(true);
    expect(2 * fixture.slideWidths[0]).toBeGreaterThan(1200);
    const graphs = readFileSync("src/platforms/web/components/pos/AnalyticsCardRail.tsx", "utf8");
    expect(graphs).toContain('opts={{ align: "start", containScroll: "trimSnaps" }}');
    expect(graphs).not.toContain("loop:");
    const dashboard = readFileSync("src/routes/dashboard.tsx", "utf8");
    expect(dashboard).toContain('<DisplayElement name="dashboard.tradingGraphs"><Carousel');
    expect(dashboard).toContain('opts={{ align: "start", containScroll: "trimSnaps" }}');
  });

  it("only handles root-focused arrows, respects child controls and reduced motion", () => {
    render([card("One"), card("Two")]);
    const rail = {};
    const event = { key: "ArrowRight", target: {}, currentTarget: rail, preventDefault: vi.fn() };
    fixture.keyDown?.(event as unknown as Parameters<KeyboardEventHandler<HTMLDivElement>>[0]);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(fixture.api.scrollNext).not.toHaveBeenCalled();
    event.target = rail;
    fixture.keyDown?.(event as unknown as Parameters<KeyboardEventHandler<HTMLDivElement>>[0]);
    expect(fixture.api.scrollNext).toHaveBeenCalledWith(false);
    fixture.reduced = true;
    event.key = "ArrowLeft";
    fixture.keyDown?.(event as unknown as Parameters<KeyboardEventHandler<HTMLDivElement>>[0]);
    expect(fixture.api.scrollPrev).toHaveBeenCalledWith(true);
    fixture.geometry = { width: 1392, windowWidth: 2148, minCardWidth: 208 };
    render([card("One"), card("Two")]);
    fixture.api.scrollNext.mockClear(); event.key = "ArrowRight";
    fixture.keyDown?.(event as unknown as Parameters<KeyboardEventHandler<HTMLDivElement>>[0]);
    expect(fixture.api.scrollNext).not.toHaveBeenCalled();
  });

  it("leaves a complete spare viewport in the six-card Windows regression", () => {
    fixture.geometry = { width: 1278, windowWidth: 2148, minCardWidth: 208 };
    render(Array.from({ length: 6 }, (_, index) => card(String(index))));
    expect(fixture.options?.loop).toBe(true);
    expect(fixture.slideWidths).toHaveLength(6);
    expect(fixture.slideWidths[0]).toBe(257);
    expect(5 * fixture.slideWidths[0]).toBeGreaterThan(1278);
  });

  it("covers the requested non-chart groups without moving forms or table actions", () => {
    for (const [path, labels] of [
      ["src/routes/dashboard.tsx", ["Revenue summary"]],
      ["src/routes/analytics.tsx", ["Business totals", "Categories", "Top categories per shop"]],
      ["src/routes/all-shops.tsx", ["Shop summaries", "Selected-period shop totals"]],
      ["src/routes/shifts.tsx", ["Shift page shop totals", "Active shift overview"]],
      ["src/routes/reports.sales.tsx", ["Sales report totals"]],
      ["src/platforms/web/components/pos/TerminalWorkspaceHome.tsx", ["Workspace overview"]],
      ["src/platforms/web/components/pos/InventorySummaryCards.tsx", ["Inventory metrics"]],
    ] as const) {
      const source = readFileSync(path, "utf8");
      for (const label of labels) expect(source).toContain(`<SummaryCardRail label="${label}"`);
    }
    const inventory = readFileSync("src/routes/inventory.tsx", "utf8");
    expect(inventory).toContain("<InventorySummaryCards");
    const shifts = readFileSync("src/routes/shifts.tsx", "utf8");
    expect(shifts.indexOf("</SummaryCardRail>", shifts.indexOf('label="Active shift overview"'))).toBeLessThan(shifts.indexOf("Loading all transactions for this shift"));
  });
});
