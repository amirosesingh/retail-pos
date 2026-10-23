import { auditDetails } from "@/lib/audit-row-normalization";
import type { Promotion } from "@/core/types/pos-types";

/** Sale headers carry the whole coupon saving for both bill and item scope.
 * Do not add line discounts again or include unrelated manual discounts.
 */
export function reusableCodeTotals(rows: Record<string, unknown>[], codeId: string) {
  const unique = new Map(rows.map(row => [String(row.id), row]));
  const matching = [...unique.values()].filter(row => row.coupon_promo_id === codeId && !row.is_refunded);
  return {
    count: matching.length,
    revenue: matching.reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0),
    discount: matching.reduce((sum, row) => sum + Number(row.coupon_discount ?? 0), 0),
  };
}

/** Sale snapshots survive removal of the editable campaign definition. */
export function reusableCodeReportEntries(codes: Promotion[], sales: Record<string, unknown>[], deleted: Record<string, unknown>[] = []): Promotion[] {
  const entries = new Map(codes.filter(code => code.type === "code").map(code => [code.id, code]));
  const known = new Map(codes.map(code => [code.id, code.type]));
  const deletedIds = new Set(deleted.map(row => auditDetails(row.details))
    .filter(detail => detail.promotionType === "code")
    .map(detail => String(detail.promotionId ?? "")));
  for (const sale of sales) {
    const id = String(sale.coupon_promo_id ?? "");
    if (!id || entries.has(id) || known.has(id) || !deletedIds.has(id)) continue;
    entries.set(id, {
      id, name: String(sale.coupon_code || "Deleted campaign"), type: "code", active: false,
      codeScope: sale.coupon_scope === "item" ? "item" : "bill",
    });
  }
  return [...entries.values()];
}
