import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { StockHistoryDialog } from "@/platforms/web/components/pos/StockHistoryDialog";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";

export const Route = createFileRoute("/reports/inventory")({
  head: () => ({ meta: [{ title: "Stock at Selected Time — Retail" }] }),
  component: StockAtTimeReport,
});

export function StockAtTimeReport() {
  const { can } = useAuth();
  const { currentStore } = usePos();
  const [open, setOpen] = useState(false);
  return <AppShell><div className="pos-page-container space-y-4">
    <header><h1 className="text-2xl font-semibold tracking-tight">Inventory · Stock at time</h1>
      <p className="text-sm text-muted-foreground">Stock quantities for {currentStore.name} at a selected date, time or saved shift closing.</p></header>
    {can("can_view_inventory") ? <>
      <p className="max-w-2xl text-sm text-muted-foreground">The report uses verified opening balances and stock movements. Dates with missing history show incomplete coverage instead of estimated quantities. Late offline uploads may update an earlier report.</p>
      <Button onClick={() => setOpen(true)}><CalendarClock className="size-4" />Select date and time</Button>
      <StockHistoryDialog open={open} onOpenChange={setOpen} branchId={currentStore.id} branchName={currentStore.name} />
    </> : <p role="status" className="text-sm text-muted-foreground">Inventory permission is required to view this report.</p>}
  </div></AppShell>;
}
