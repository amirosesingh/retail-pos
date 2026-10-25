import type { ActivityEvent } from "./activity-events";

/** System resolution hides an obsolete request for everyone; personal clears do not. */
export function notificationAcknowledgedBy(
  row: Pick<ActivityEvent, "clearedBy">,
  userIds: readonly string[],
): boolean {
  const acknowledged = new Set(row.clearedBy.map(id => id.toLowerCase()));
  return acknowledged.has("system:approval-resolved") || userIds.some(id => acknowledged.has(id.toLowerCase()));
}

/** Pending dismissals are a temporary view overlay, never a durable acknowledgement. */
export function visibleActivityRows(
  rows: ActivityEvent[],
  cleared: readonly string[],
  pending: ReadonlySet<string>,
  scope: string,
  userIds: readonly string[] = [],
): ActivityEvent[] {
  const hidden = new Set(cleared);
  return rows.filter(row => !hidden.has(row.id) && !pending.has(`${scope}:${row.id}`)
    && !notificationAcknowledgedBy(row, userIds) && row.meta["auditOnly"] !== true);
}
