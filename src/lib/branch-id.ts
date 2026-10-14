import { recordId } from "./sale-identity";

/** UUID identifiers share the same comparison format across SQL and JavaScript. */

export function canonicalBranchId(value: unknown): string {
  const id = String(value ?? "").trim();
  return recordId(id);
}

export function sameBranchId(left: unknown, right: unknown): boolean {
  return canonicalBranchId(left) === canonicalBranchId(right);
}

/**
 * Collapse legacy upper/lower-case copies of the same UUID and preserve their
 * net quantity. No units are discarded: split buckets are added together.
 */
export function canonicalStockMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const stock: Record<string, number> = {};
  for (const [rawId, rawQuantity] of Object.entries(value as Record<string, unknown>)) {
    const id = canonicalBranchId(rawId);
    if (!id) continue;
    const quantity = Number(rawQuantity);
    if (!Number.isFinite(quantity)) continue;
    stock[id] = (stock[id] ?? 0) + quantity;
  }
  return stock;
}
