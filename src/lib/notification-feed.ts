import type { ActivityEvent } from "./activity-events";
/** Merge delivered updates by immutable event id; never clear another queued message. */
export function mergeNotificationFeed(previous: ActivityEvent[], incoming: ActivityEvent[], from: string): ActivityEvent[] {
  const byId = new Map(previous.map(row => [row.id, row]));
  for (const row of incoming) {
    const old = byId.get(row.id);
    byId.set(row.id, old ? { ...row, clearedBy: [...new Set([...old.clearedBy, ...row.clearedBy])] } : row);
  }
  return [...byId.values()].filter(row => row.createdAt >= from)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
}

/** A paged/catch-up overlap is history, not a newly delivered toast. */
export function notificationArrivals(rows: ActivityEvent[], announced: ReadonlySet<string>, initialReadThrough: string): ActivityEvent[] {
  return rows.filter(row => !announced.has(row.id) && row.createdAt > initialReadThrough);
}
