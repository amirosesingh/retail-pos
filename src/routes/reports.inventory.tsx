import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { AdvancedStockReport } from "@/platforms/web/components/pos/AdvancedStockReport";
import { usePos } from "@/lib/pos-store";

export const Route = createFileRoute("/reports/inventory")({
  head: () => ({ meta: [{ title: "Stock Report — Retail" }] }),
  component: StockAtTimeReport,
});

export function StockAtTimeReport() {
  const { currentStore } = usePos();
  return <AppShell><div className="pos-page-container">
    <AdvancedStockReport branchId={currentStore.id} branchName={currentStore.name} />
  </div></AppShell>;
}
