import { AnimatedMetric } from "./AnimatedMetric";

/** Counts are supplied by the already-authorized catalogue, before table filters. */
export function InventoryCatalogueStatus({ ready, loadPhase, activeCount, archivedCount }: {
  ready: boolean;
  loadPhase?: "loading" | "ready" | "stalled" | "failed";
  activeCount: number;
  archivedCount: number;
}) {
  return <footer aria-label="Catalogue totals" aria-busy={!ready} className="min-w-0 border-t border-border pt-3 text-sm">
    {!ready ? <p role={loadPhase === "failed" ? "alert" : "status"} className="text-muted-foreground">
      {loadPhase === "failed" ? "Catalogue unavailable. Reconnect to verify product counts." : loadPhase === "stalled" ? "Catalogue is taking longer to load…" : "Loading catalogue…"}
    </p> : <dl className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1">
      {([["Total products", activeCount + archivedCount], ["Active", activeCount], ["Archived", archivedCount]] as const).map(([label, count]) => <div key={label} className="flex min-w-0 items-baseline gap-2">
        <dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 font-medium tabular-nums [overflow-wrap:anywhere]"><AnimatedMetric value={count} /></dd>
      </div>)}
    </dl>}
  </footer>;
}
