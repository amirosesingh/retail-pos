/** UUID-shaped location identifiers are case-insensitive in PostgreSQL but not in JS objects. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function canonicalBranchId(value: unknown): string {
  const id = String(value ?? "").trim();
  return UUID.test(id) ? id.toLowerCase() : id;
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
