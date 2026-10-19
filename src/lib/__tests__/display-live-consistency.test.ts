import { afterEach, expect, it } from "vitest";
import { formatDate, formatDateTime, posDayKey, setPosFormats, setPosTimeZone } from "../time-zone";
import { reconcileLiveRows } from "../live-state";
import { statusLabelTone } from "../status-label";
afterEach(() => { setPosTimeZone(""); setPosFormats("dmy", "24h"); });
it("formats dates consistently without changing business day keys", () => {
  setPosTimeZone("Asia/Singapore"); setPosFormats("mdy", "24h");
  expect(formatDate("2026-10-18T18:00:00Z")).toBe("19-10-2026");
  expect(posDayKey("2026-10-18T18:00:00Z")).toBe("2026-10-19");
  expect(formatDateTime("2026-10-18T18:00:00Z", { dateStyle: "medium", timeStyle: "short" })).toContain("19-10-2026");
  expect(formatDate("bad date")).toBe("—");
});
it("keeps unchanged rows and reconciles updates, removals and additions", () => {
 const old = [{ id: "a", value: 1 }, { id: "b", value: 2 }];
 expect(reconcileLiveRows(old, old.map(row => ({ ...row })))).toBe(old);
 const next = reconcileLiveRows(old, [{ id: "a", value: 1 }, { id: "b", value: 3 }]);
 expect(next[0]).toBe(old[0]); expect(next[1]).not.toBe(old[1]);
 expect(reconcileLiveRows(old, [{ id: "c", value: 4 }])).toEqual([{ id: "c", value: 4 }]);
});
it("maps statuses consistently while leaving unknown states neutral", () => {
 expect(statusLabelTone("POSTED")).toContain("emerald");
 for (const state of ["draft", "pending"]) expect(statusLabelTone(state)).toContain("amber");
 for (const state of ["failed", "rejected"]) expect(statusLabelTone(state)).toContain("red");
 expect(statusLabelTone("archived")).toContain("muted");
});
