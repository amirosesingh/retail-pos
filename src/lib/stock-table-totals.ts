import type { Product, TransferItem } from "@/core/types/pos-types";

/** Transfers have no captured monetary value; label current-cost estimates explicitly. */
export function transferTableTotals(items: TransferItem[], products: ReadonlyMap<string, Product>, includeCosts = false): Record<string, number> {
  const totals: Record<string, number> = { Items: items.length, Requested: 0, Approved: 0, Sent: 0, Counted: 0 };
  if (includeCosts) { totals["Requested estimate"] = 0; totals["Sent estimate"] = 0; }
  let unpriced = 0;
  for (const item of items) {
    totals.Requested += item.qty;
    totals.Approved += item.approvedQty ?? 0;
    totals.Sent += item.dispatchedQty ?? 0;
    totals.Counted += item.verifiedQty ?? 0;
    if (!includeCosts) continue;
    const product = products.get(item.productId);
    if (!product || !Number.isFinite(product.cost)) { unpriced++; continue; }
    totals["Requested estimate"] += item.qty * product.cost;
    totals["Sent estimate"] += (item.dispatchedQty ?? 0) * product.cost;
  }
  if (unpriced) totals["Unpriced lines"] = unpriced;
  return totals;
}
