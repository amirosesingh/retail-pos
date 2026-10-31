export type SummaryCardPosition = { left: number; top: number };

/** Animate only a changed set of visible cards; never clone hidden data or poll. */
export function animateSummaryCardLayout(
  previous: ReadonlyMap<string, SummaryCardPosition>,
  nodes: ReadonlyMap<string, HTMLElement>,
  reducedMotion: boolean,
  { origin = { left: 0, top: 0 }, reflow = true }: { origin?: SummaryCardPosition; reflow?: boolean } = {},
) {
  const positions = new Map<string, SummaryCardPosition>();
  const animations: Animation[] = [];
  // Read every position before writing animations, avoiding repeated layout work.
  for (const [key, node] of nodes) {
    const { left, top } = node.getBoundingClientRect();
    positions.set(key, { left: left - origin.left, top: top - origin.top });
  }
  if (!reducedMotion) {
    for (const [key, node] of nodes) {
      if (typeof node.animate !== "function") continue;
      const current = positions.get(key)!;
      const before = previous.get(key);
      // Embla owns slide movement while a rail is active; animate only arrivals.
      if (before && !reflow) continue;
      const x = before ? before.left - current.left : 0;
      const y = before ? before.top - current.top : 6;
      if (before && Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue;
      const frames: Keyframe[] = before
        ? [{ transform: `translate(${x}px, ${y}px)` }, { transform: "none" }]
        : [{ opacity: 0, transform: `translateY(${y}px)` }, { opacity: 1, transform: "none" }];
      animations.push(node.animate(frames, { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }));
    }
  }
  return {
    positions,
    cancel: () => { for (const animation of animations) animation.cancel(); },
  };
}
