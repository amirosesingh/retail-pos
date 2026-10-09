import type { Sale } from "@/core/types/pos-types";

/** SQL Server returns UUIDs in uppercase; PostgreSQL and checkout use lowercase. */
export function recordId(value: string): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase() : value;
}

export function sameRecordId(left: string, right: string): boolean {
  return !!left && !!right && recordId(left) === recordId(right);
}

/** Deduplicate identities, never bill numbers: distinct financial rows remain visible. */
export function uniqueSales(rows: Sale[]): Sale[] {
  const byId = new Map<string, Sale>();
  for (const row of rows) byId.set(recordId(row.id), row);
  return [...byId.values()];
}
