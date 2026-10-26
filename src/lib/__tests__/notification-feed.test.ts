import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../activity-events";
import { mergeNotificationFeed, notificationArrivals } from "../notification-feed";
const event = (id: string, createdAt: string, clearedBy: string[] = []) => ({ id, createdAt, clearedBy }) as ActivityEvent;
describe("incremental notification feed", () => {
  it("does not replay overlap or old paged history as new toasts", () => {
    const known = event("known", "2026-10-26T12:00:00Z");
    const history = event("older-page", "2026-10-26T11:59:00Z");
    const fresh = event("new", "2026-10-26T12:01:00Z");
    expect(notificationArrivals([known, history, fresh], new Set([known.id]), "2026-10-26T12:00:30Z")).toEqual([fresh]);
  });
  it("adds only the new event and keeps older uncleared messages in the queue", () => {
    const old = event("old", "2026-10-25T12:00:00Z");
    const fresh = event("new", "2026-10-26T12:00:00Z");
    expect(mergeNotificationFeed([old], [fresh], "2026-10-20T00:00:00Z")).toEqual([fresh, old]);
    expect(old.clearedBy).toEqual([]);
  });
  it("deduplicates cursor overlap and retains confirmed personal acknowledgements", () => {
    const old = event("same", "2026-10-26T12:00:00Z", ["person"]);
    const rows = mergeNotificationFeed([old], [event(old.id, old.createdAt)], "2026-10-20T00:00:00Z");
    expect(rows).toHaveLength(1);
    expect(rows[0].clearedBy).toEqual(["person"]);
  });
  it("expires only the live projection outside retention, without mutating audit records", () => {
    const old = event("old", "2026-10-01T12:00:00Z");
    expect(mergeNotificationFeed([old], [], "2026-10-20T00:00:00Z")).toEqual([]);
    expect(old.clearedBy).toEqual([]);
  });
});
