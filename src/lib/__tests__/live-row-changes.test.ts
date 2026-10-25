import { expect, it, vi } from "vitest";
import { applyLiveRowChanges } from "../live-state";
it("keeps the cached array and unrelated row identities when a changed record has no new values", () => {
  const serialize = vi.fn();
  const previous = Array.from({ length: 10_000 }, (_, i) => ({ id: String(i), value: i,
    toJSON() { serialize(); return { id: this.id, value: this.value }; } }));
  const result = applyLiveRowChanges(previous, new Set(["42"]), [{ ...previous[42] }]);
  expect(result).toBe(previous);
  expect(serialize).toHaveBeenCalledTimes(2); // Only the changed row, never the full catalogue.
});
it("applies additions, edits and deletions without dropping unrelated records", () => {
  const previous = [{ id: "a", value: 1 }, { id: "b", value: 2 }, { id: "c", value: 3 }];
  const incoming = [{ id: "b", value: 4 }, { id: "d", value: 5 }];
  const result = applyLiveRowChanges(previous, new Set(["b", "c", "d"]), incoming);
  expect(result).toEqual([previous[0], incoming[0], incoming[1]]);
  expect(result[0]).toBe(previous[0]);
  expect(previous).toHaveLength(3);
});
it("preserves prepend ordering and ignores unrequested incoming records", () => {
  const previous = [{ id: "a" }];
  expect(applyLiveRowChanges(previous, new Set(["b"]), [{ id: "b" }, { id: "x" }], undefined, true))
    .toEqual([{ id: "b" }, { id: "a" }]);
});
it("supports canonical database identities", () => {
  const previous = [{ id: "ABC", value: 1 }];
  expect(applyLiveRowChanges(previous, new Set(["abc"]), [{ id: "abc", value: 2 }], row => row.id.toLowerCase()))
    .toEqual([{ id: "abc", value: 2 }]);
});
