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
