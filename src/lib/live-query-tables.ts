/** Queries opt into live refresh by naming the tables they actually read. */
export function queryReadsChangedTables(
  meta: Record<string, unknown> | undefined,
  changed: ReadonlySet<string>,
): boolean {
  return (
    Array.isArray(meta?.tables) &&
    meta.tables.some((table) => typeof table === "string" && changed.has(table))
  );
}

/** Immediate queued-write retries; sparse reconciliation for missed live events. */
export function needsIdleCatchup(pending: number, lastCatchup: number, now: number): boolean {
  return pending > 0 || now - lastCatchup >= 300_000;
}
// These tables supply the primary snapshot or determine its read authority.
// Audit/notification traffic must not keep restarting an unrelated full read.
const PRIMARY_SNAPSHOT_TABLES = new Set([
  "products", "product_barcodes", "members", "sales", "sale_items", "payment_transactions",
  "promotions", "stores", "store_groups", "shifts", "pos_settings",
  "settings_overrides", "settings_scoped", "settings_locks", "app_users", "staff_roles",
]);
export const primarySnapshotReadsTable = (table: string) => PRIMARY_SNAPSHOT_TABLES.has(table);
