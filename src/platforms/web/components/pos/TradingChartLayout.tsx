import { createContext, useContext, useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ChartPhase } from "@/lib/use-chart-transition";
import { Tooltip } from "recharts";
const PlotScope = createContext<{phase:ChartPhase;stamp:number;previousLabel?:string}|null>(null);
export function ChartPlotScope({children,...phase}: {phase:ChartPhase;stamp:number;previousLabel?:string;children:ReactNode}) {
  return <PlotScope.Provider value={phase}>{children}</PlotScope.Provider>;
}

/** Preserve Recharts point/keyboard behavior and each caller's exact formatter. */
export function TradingTooltip(props: ComponentProps<typeof Tooltip>) {
  return <Tooltip {...props} allowEscapeViewBox={{x:false,y:false}} content={({active,label,payload}) => {
    if (!active || !payload?.length) return null;
    return <div role="tooltip" className="max-w-[min(18rem,70vw)] space-y-1 text-xs font-medium text-foreground" style={{background:"transparent",border:"none",boxShadow:"none",color:"var(--foreground)"}}>
      {label !== undefined && <p>{props.labelFormatter?props.labelFormatter(label,payload):String(label)}</p>}
      {payload.filter(item=>item.type!=="none"&&item.value!==undefined&&item.value!==null).map((item,index)=>{
        const formatted=props.formatter?.(item.value,item.name,item,index,payload)??String(item.value);
        const value=Array.isArray(formatted)?formatted[0]:formatted;
        const name=Array.isArray(formatted)?formatted[1]:item.name;
        return <p key={`${String(item.dataKey??item.name)}:${index}`} className="flex min-w-0 items-start gap-1.5">
          <span aria-hidden="true" className="mt-1 size-2 shrink-0 rounded-full" style={{backgroundColor:item.color}} />
          <span className="min-w-0 break-words">{name}:</span><span className="numeric min-w-0 break-words">{value}</span>
        </p>;
      })}
    </div>;
  }} />;
}

/** Animate pixels only. The saved/confirmed numeric data is never interpolated. */
export function ChartPlotStage({ phase, stamp, previousLabel, children }: {
  phase: ChartPhase; stamp: number; previousLabel?: string; children: ReactNode;
}) {
  const node = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const target = node.current;
    if (!target || typeof target.animate !== "function" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !["exit", "enter"].includes(phase)) return;
    const animation = target.animate(phase === "exit"
      ? [{ opacity: 1, transform: "scaleY(1)" }, { opacity: 0, transform: "scaleY(0.03)" }]
      : [{ opacity: 0, transform: "scaleY(0.03)" }, { opacity: 1, transform: "scaleY(1)" }],
    { duration: phase === "exit" ? 120 : 300, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "both" });
    return () => animation.cancel();
  }, [phase, stamp]);
  return <div className="relative h-full min-w-0" data-chart-phase={phase}>
    {phase === "waiting" ? <p role="status" className="flex h-full items-center justify-center text-sm text-muted-foreground">Waiting for confirmed graph data…</p>
      : <div ref={node} className="h-full min-w-0 origin-bottom">{children}</div>}
    {phase === "exit" && <p role="status" className="absolute inset-x-0 top-0 bg-card/90 px-2 py-1 text-xs text-muted-foreground">Updating graph{previousLabel ? ` · previous ${previousLabel}` : ""}…</p>}
  </div>;
}

/** Finite native horizontal chart rail; no cloned slides or automatic movement. */
export function TradingChartGrid({ label, children }: { label: string; children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const previousButton = useRef<HTMLButtonElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ id: number; x: number; left: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [edges, setEdges] = useState({ previous: false, next: false });
  const measure = useCallback(() => {
    const node = viewport.current;
    if (!node) return;
    const next = { previous: node.scrollLeft > 1, next: node.scrollLeft + node.clientWidth < node.scrollWidth - 1 };
    // Hiding an edge control must not strand keyboard focus on the document.
    if ((!next.previous && document.activeElement === previousButton.current) || (!next.next && document.activeElement === nextButton.current)) node.focus({preventScroll:true});
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
    const gap=track.current?Number.parseFloat(getComputedStyle(track.current).columnGap)||0:0;
    node.scrollBy({ left: direction * (width + gap), behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  return <section className="relative min-w-0">
    {edges.previous && <button ref={previousButton} type="button" aria-label={`Previous graph: ${label}`} onClick={() => step(-1)} className="absolute left-0 top-1/2 z-10 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ChevronLeft className="size-4" aria-hidden="true" /></button>}
    {edges.next && <button ref={nextButton} type="button" aria-label={`Next graph: ${label}`} onClick={() => step(1)} className="absolute right-0 top-1/2 z-10 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ChevronRight className="size-4" aria-hidden="true" /></button>}
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
  const phase=useContext(PlotScope);
  return <section className="summary-card flex h-[26rem] w-[min(82vw,36rem)] shrink-0 min-w-0 flex-col gap-3 overflow-hidden rounded-xl border border-border bg-card p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300" data-trading-chart-card="fixed">
    <header className="trading-chart-scroll h-20 shrink-0 overflow-y-auto" tabIndex={0}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><h2 className="min-w-0 text-sm font-semibold">{title}</h2>{controls}</div>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
    </header>
    <div className="trading-chart-surface h-56 min-w-0 shrink-0" data-trading-chart-plot="fixed">{phase?<ChartPlotStage {...phase}>{children}</ChartPlotStage>:children}</div>
    {footer && phase?.phase !== "waiting" && <div className="trading-chart-scroll min-h-0 overflow-y-auto text-xs" tabIndex={0}
      aria-label={`${typeof title === "string" ? title : "Chart"} details`}>{footer}</div>}
  </section>;
}
