import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { StockReport } from "@/platforms/web/components/pos/StockReport";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";

export const Route = createFileRoute("/reports/inventory")({
  head: () => ({ meta: [{ title: "Stock report — Retail" }] }),
  component: StockAtTimeReport,
});

export function StockAtTimeReport() {
  const { can } = useAuth();
  const { currentStore } = usePos();
  return <AppShell><div className="pos-page-container space-y-4">
    <header><h1 className="text-2xl font-semibold tracking-tight">Stock report</h1>
      <p className="text-sm text-muted-foreground">Stock quantities for {currentStore.name}.</p></header>
    {can("can_view_inventory") ? <StockReport branchId={currentStore.id} branchName={currentStore.name} /> : <p role="status" className="text-sm text-muted-foreground">Inventory permission is required to view this report.</p>}
  </div></AppShell>;
}
