import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../activity-events";
import { visibleActivityRows } from "../notification-visibility";

const row = (id: string, clearedBy: string[] = [], meta = {}) =>
  ({ id, clearedBy, meta }) as ActivityEvent;
const ids = (rows: ActivityEvent[]) => rows.map(item => item.id);

describe("optimistic notification visibility", () => {
  it("hides a pending batch immediately but keeps new arrivals", () => {
    expect(ids(visibleActivityRows([row("a"), row("b"), row("new")], [],
      new Set(["user:branch:a", "user:branch:b"]), "user:branch"))).toEqual(["new"]);
  });
  it("restores failed items when pending clears finish and retains partial successes", () => {
    expect(ids(visibleActivityRows([row("saved"), row("failed"), row("new")], ["saved"],
      new Set(), "user:branch"))).toEqual(["failed", "new"]);
  });
  it("does not hide another user's or branch's feed with an old pending request", () => {
    expect(ids(visibleActivityRows([row("a")], [], new Set(["old:branch:a"]),
      "new:branch"))).toEqual(["a"]);
  });
  it("applies only the current user's remote clear and keeps system resolution and audit-only filtering", () => {
    const rows = [row("active"), row("remote", ["manager"]), row("audit", [], {auditOnly: true})];
    expect(ids(visibleActivityRows(rows, [], new Set(), "user:branch", ["user"]))).toEqual(["active", "remote"]);
    expect(ids(visibleActivityRows(rows, [], new Set(), "manager:branch", ["MANAGER"]))).toEqual(["active"]);
    expect(visibleActivityRows([row("resolved", ["system:approval-resolved"])], [], new Set(), "user:branch", ["user"])).toEqual([]);
    expect(rows[0].clearedBy).toEqual([]);
  });
});
