import type { ReactNode } from "react";

/** Charts stay in a finite vertical reading order; summary-card rails are separate. */
export function TradingChartGrid({ label, children }: { label: string; children: ReactNode }) {
  return <div role="region" aria-label={label} tabIndex={0}
    className="max-h-[min(80svh,58rem)] min-w-0 overflow-x-hidden overflow-y-auto overscroll-y-contain rounded-lg [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">{children}</div>
  </div>;
}

/** Fixed card and plot heights prevent a wrapped title or legend shrinking its peer. */
export function TradingChartCard({ title, description, controls, footer, children }: {
  title: ReactNode; description?: ReactNode; controls?: ReactNode; footer?: ReactNode; children: ReactNode;
}) {
  return <section className="summary-card flex h-[28rem] min-w-0 flex-col gap-3 overflow-hidden rounded-lg border border-border bg-card p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300" data-trading-chart-card="fixed">
    <header className="h-20 shrink-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><h2 className="min-w-0 text-sm font-semibold">{title}</h2>{controls}</div>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
    </header>
    <div className="h-64 min-w-0 shrink-0" data-trading-chart-plot="fixed">{children}</div>
    {footer && <div className="min-h-0 overflow-y-auto text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{footer}</div>}
  </section>;
}
