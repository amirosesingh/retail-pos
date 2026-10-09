import { useAuth } from "@/lib/pos-auth";
import { useVisibility } from "@/lib/ui-visibility";

/** Match Inventory's existing cost visibility permissions in transfer summaries. */
export function useStockTableCosts() {
  const { can } = useAuth();
  const { visible } = useVisibility();
  return can("can_view_sales_reports") && visible("inventory.costColumns");
}
