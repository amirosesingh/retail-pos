import { describe, expect, it, vi } from "vitest";
import { animateSummaryCardLayout } from "../summary-card-motion";

function card(left: number, top: number, order?: string[]) {
  const cancel = vi.fn();
  const node = {
    getBoundingClientRect: vi.fn(() => { order?.push("measure"); return { left, top }; }),
    animate: vi.fn(() => { order?.push("animate"); return { cancel }; }),
  };
  return { node: node as unknown as HTMLElement, animate: node.animate, cancel };
}

describe("summary card appearance and layout motion", () => {
  it("reveals new cards once and keeps surviving keyed cards in place", () => {
    const existing = card(10, 20);
    const added = card(240, 20);
    const first = animateSummaryCardLayout(new Map(), new Map([["a", existing.node]]), false);
    expect(existing.animate).toHaveBeenCalledOnce();
    const next = animateSummaryCardLayout(first.positions, new Map([["a", existing.node], ["b", added.node]]), false);
    expect(existing.animate).toHaveBeenCalledOnce();
    expect(added.animate).toHaveBeenCalledExactlyOnceWith(
      [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
      expect.objectContaining({ duration: 220 }),
    );
    animateSummaryCardLayout(next.positions, new Map([["a", existing.node], ["b", added.node]]), false);
    expect(added.animate).toHaveBeenCalledOnce();
  });

  it("moves surviving cards smoothly into a removed card's gap without cloning it", () => {
    const surviving = card(10, 20);
    const motion = animateSummaryCardLayout(new Map([["removed", { left: 10, top: 20 }], ["survives", { left: 240, top: 20 }]]), new Map([["survives", surviving.node]]), false);
    expect(motion.positions.has("removed")).toBe(false);
    expect(surviving.animate).toHaveBeenCalledExactlyOnceWith(
      [{ transform: "translate(230px, 0px)" }, { transform: "none" }],
      expect.objectContaining({ duration: 220 }),
    );
    motion.cancel();
    expect(surviving.cancel).toHaveBeenCalledOnce();
  });

  it("measures first, then animates, and ignores page scrolling through its local origin", () => {
    const order: string[] = [];
    const one = card(100, 520, order);
    const two = card(330, 520, order);
    const motion = animateSummaryCardLayout(new Map([["one", { left: 0, top: 20 }]]), new Map([["one", one.node], ["two", two.node]]), false, { origin: { left: 100, top: 500 } });
    expect(order).toEqual(["measure", "measure", "animate"]);
    expect(one.animate).not.toHaveBeenCalled();
    expect(motion.positions.get("two")).toEqual({ left: 230, top: 20 });
  });

  it("leaves existing slide transforms to Embla while still revealing newly visible cards", () => {
    const existing = card(-300, 20);
    const added = card(250, 20);
    animateSummaryCardLayout(new Map([["old", { left: 20, top: 20 }]]), new Map([["old", existing.node], ["new", added.node]]), false, { reflow: false });
    expect(existing.animate).not.toHaveBeenCalled();
    expect(added.animate).toHaveBeenCalledOnce();
  });

  it("respects reduced motion and updates the next layout baseline without animation", () => {
    const item = card(30, 40);
    const motion = animateSummaryCardLayout(new Map(), new Map([["item", item.node]]), true);
    expect(item.animate).not.toHaveBeenCalled();
    expect(motion.positions.get("item")).toEqual({ left: 30, top: 40 });
    motion.cancel();
    expect(item.cancel).not.toHaveBeenCalled();
  });

  it("keeps cards usable when native animation is unavailable", () => {
    const node = { getBoundingClientRect: () => ({ left: 0, top: 0 }) } as HTMLElement;
    expect(animateSummaryCardLayout(new Map(), new Map([["item", node]]), false).positions.size).toBe(1);
  });
});
