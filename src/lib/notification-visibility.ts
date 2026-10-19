import type { ActivityEvent } from "./activity-events";

/** Pending dismissals are a temporary view overlay, never a durable acknowledgement. */
export function visibleActivityRows(
  rows: ActivityEvent[],
  cleared: readonly string[],
  pending: ReadonlySet<string>,
  scope: string,
): ActivityEvent[] {
  const hidden = new Set(cleared);
  return rows.filter(row => !hidden.has(row.id) && !pending.has(`${scope}:${row.id}`)
    && !row.clearedBy.length && row.meta["auditOnly"] !== true);
}
