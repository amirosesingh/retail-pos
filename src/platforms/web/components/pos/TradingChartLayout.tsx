import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Finite native horizontal chart rail; no cloned slides or automatic movement. */
export function TradingChartGrid({ label, children }: { label: string; children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; left: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [edges, setEdges] = useState({ previous: false, next: false });
  const measure = useCallback(() => {
    const node = viewport.current;
    if (!node) return;
    const next = { previous: node.scrollLeft > 1, next: node.scrollLeft + node.clientWidth < node.scrollWidth - 1 };
    setEdges(old => old.previous === next.previous && old.next === next.next ? old : next);
  }, []);
  useEffect(() => {
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (viewport.current) observer?.observe(viewport.current);
    if (track.current) observer?.observe(track.current);
    return () => observer?.disconnect();
  }, [children, measure]);
  const step = (direction: number) => {
    const node = viewport.current;
    if (!node) return;
    const width = track.current?.firstElementChild?.getBoundingClientRect().width ?? node.clientWidth;
    node.scrollBy({ left: direction * (width + 16), behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  return <section className="min-w-0 space-y-2">
    <div className="flex justify-end gap-1">
      <button type="button" aria-label={`Previous graph: ${label}`} disabled={!edges.previous} onClick={() => step(-1)} className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-muted disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ChevronLeft className="size-4" aria-hidden="true" /></button>
      <button type="button" aria-label={`Next graph: ${label}`} disabled={!edges.next} onClick={() => step(1)} className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-muted disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ChevronRight className="size-4" aria-hidden="true" /></button>
    </div>
    <div ref={viewport} role="region" aria-label={label} tabIndex={0} onScroll={measure}
      onPointerDown={event => {
        suppressClick.current = false;
        drag.current = null;
        if (event.pointerType !== "mouse" || event.button !== 0 || (event.target as Element).closest("button,a,input,select,textarea,summary,[role=button],[role=slider],[contenteditable],.recharts-tooltip-wrapper")) return;
        drag.current = { id: event.pointerId, x: event.clientX, left: event.currentTarget.scrollLeft, moved: false };
      }}
      onPointerMove={event => {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        const distance = event.clientX - current.x;
        if (!current.moved && Math.abs(distance) < 6) return;
        current.moved = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
        event.currentTarget.scrollLeft = current.left - distance;
      }}
      onPointerUp={event => {
        const current = drag.current;
        if (!current || current.id !== event.pointerId) return;
        suppressClick.current = current.moved;
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; suppressClick.current = false; }}
      onLostPointerCapture={() => { drag.current = null; }}
      onClickCapture={event => { if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); } }}
      className="trading-chart-scroll min-w-0 max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div ref={track} className="flex w-max min-w-full items-stretch gap-4">{children}</div>
    </div>
  </section>;
}

/** Fixed card and plot heights prevent a wrapped title or legend shrinking its peer. */
export function TradingChartCard({ title, description, controls, footer, children }: {
  title: ReactNode; description?: ReactNode; controls?: ReactNode; footer?: ReactNode; children: ReactNode;
}) {
  return <section className="summary-card flex h-[26rem] w-[min(82vw,36rem)] shrink-0 min-w-0 flex-col gap-3 overflow-hidden rounded-xl border border-border bg-card p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300" data-trading-chart-card="fixed">
    <header className="trading-chart-scroll h-20 shrink-0 overflow-y-auto" tabIndex={0}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><h2 className="min-w-0 text-sm font-semibold">{title}</h2>{controls}</div>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
    </header>
    <div className="trading-chart-surface h-56 min-w-0 shrink-0" data-trading-chart-plot="fixed">{children}</div>
    {footer && <div className="trading-chart-scroll min-h-0 overflow-y-auto text-xs" tabIndex={0}
      aria-label={`${typeof title === "string" ? title : "Chart"} details`}>{footer}</div>}
  </section>;
}
