import type { ReactNode } from "react";
import { AnimatedMetric } from "./AnimatedMetric";

/** Counts are supplied by the already-authorized catalogue, before table filters. */
export function InventoryCatalogueStatus({ ready, loadPhase, activeCount, archivedCount, shownCount, showArchived, filters, children }: {
  ready: boolean;
  loadPhase?: "loading" | "ready" | "stalled" | "failed";
  activeCount: number;
  archivedCount: number;
  shownCount: number;
  showArchived: boolean;
  filters: readonly string[];
  children?: ReactNode;
}) {
  const mode = showArchived ? "archived" : "active";
  return <section aria-label="Catalogue status" aria-busy={!ready} className="min-w-0 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs">
    {!ready ? <p role={loadPhase === "failed" ? "alert" : "status"} className="text-muted-foreground">
      {loadPhase === "failed" ? "Catalogue unavailable. Reconnect to verify product counts." : loadPhase === "stalled" ? "Catalogue is taking longer to load…" : "Loading catalogue…"}
    </p> : <div className="min-w-0 space-y-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 [overflow-wrap:anywhere]"><span className="font-medium">Viewing {showArchived ? "Archived" : "Active"}</span><span className="text-muted-foreground"> · Search / advanced matches: {shownCount.toLocaleString()} of {(showArchived ? archivedCount : activeCount).toLocaleString()} {mode} products</span></p>
        <dl className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">
          <div className="flex min-w-0 items-baseline gap-1"><dt className="text-muted-foreground">Active products</dt><dd className="font-medium [overflow-wrap:anywhere]"><AnimatedMetric value={activeCount} /></dd></div>
          <div className="flex min-w-0 items-baseline gap-1"><dt className="text-muted-foreground">Archived products</dt><dd className="font-medium [overflow-wrap:anywhere]"><AnimatedMetric value={archivedCount} /></dd></div>
        </dl>
      </div>
      {filters.length > 0 && <div className="flex min-w-0 flex-wrap items-start gap-1" aria-label="Applied search and advanced filters"><span className="py-0.5 text-muted-foreground">Search &amp; advanced filters:</span>{filters.map(filter => <span key={filter} className="min-w-0 max-w-full rounded border border-border bg-background px-1.5 py-0.5 [overflow-wrap:anywhere]">{filter}</span>)}</div>}
      <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-muted-foreground"><p>Inventory totals below use active products only.</p>{children}</div>
    </div>}
  </section>;
}
