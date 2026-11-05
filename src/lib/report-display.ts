import type { Sale } from "@/core/types/pos-types";
import { uniqueSales } from "./sale-identity";
import { canonicalBranchId } from "./branch-id";
/** A reporting cohort only; never changes the stored transaction. */
export const completedReportBills = (rows: Sale[]) => uniqueSales(rows).filter(sale => !sale.refunded);
export function reportSponsorshipStores(selected: string, available: string[], authorized?: string[]): string[] {
  const allowed = [...new Set((authorized ?? available).map(canonicalBranchId).filter(Boolean))];
  return selected === "all" ? allowed : allowed.filter(id => id === canonicalBranchId(selected));
}
export function receiptAdjustmentLabel(rows: Sale[]): string {
  const adjusted = completedReportBills(rows).filter(sale => Math.abs(sale.roundingAdjustment ?? 0) >= 0.005);
  const labels = new Set(adjusted.map(sale => sale.roundingLabel?.trim() || "Receipt adjustment"));
  return labels.size === 1 ? [...labels][0] : "Receipt adjustments";
}
