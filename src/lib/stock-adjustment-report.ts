import { routedQuery, type QueryOptions } from "@/core/api/db-query";
import { canonicalBranchId } from "./branch-id";

export type StockReportRow = {
  id: string;
  at: string;
  name: string;
  sku: string;
  storeId: string;
  reason: string;
  note: string;
  before: number;
  after: number;
  delta: number;
  cost: number;
  staff: string;
};
const numeric = (value: unknown) => Number(value) || 0;
export async function loadStockAdjustmentReport(
  storeIds: string[],
  from: string,
  to: string,
): Promise<StockReportRow[]> {
  const start = from ? Date.parse(from + "T00:00:00") : -Infinity;
  const end = to ? Date.parse(to + "T23:59:59.999") : Infinity;
  const found = new Map<string, StockReportRow>();
  for (const storeId of [...new Set(storeIds.map(canonicalBranchId).filter(Boolean))]) {
    let cursor: QueryOptions["cursor"];
    for (;;) {
      const page = await routedQuery("stock_adjustments", {
        match: { store_id: storeId },
        orderBy: { column: "created_at", ascending: false },
        limit: 500,
        ...(cursor ? { cursor } : {}),
      });
      for (const row of page) {
        const at = String(row.created_at ?? "");
        const timestamp = Date.parse(at);
        if (timestamp < start || timestamp > end || !Number.isFinite(timestamp)) continue;
        const id = String(row.id);
        found.set(id, {
          id,
          at,
          name: String(row.product_name ?? "Unknown item"),
          sku: String(row.sku ?? ""),
          storeId: String(row.store_id ?? storeId),
          reason: String(row.reason ?? "manual"),
          note: String(row.note ?? ""),
          before: numeric(row.previous_stock),
          after: numeric(row.updated_stock),
          delta: numeric(row.delta),
          cost: numeric(row.cost_impact),
          staff: String(row.staff_name ?? row.staff_id ?? "Unknown"),
        });
      }
      const last = page.at(-1);
      if (page.length < 500 || !last || Date.parse(String(last.created_at)) < start) break;
      const next = { column: "created_at", value: String(last.created_at), id: String(last.id) };
      if (cursor?.id === next.id && cursor.value === next.value)
        throw new Error("Stock history pagination did not advance. Try refreshing.");
      cursor = next;
    }
  }
  return [...found.values()].sort((a, b) => b.at.localeCompare(a.at));
}
