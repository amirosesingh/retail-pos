import { describe, expect, it } from "vitest";
import { reconcileReceivingCounts } from "../receiving-counts";
describe("unfinished delivery counts", () => {
  it("preserves entered counts when the same delivery refreshes", () => {
    const counts = { a: "3", b: "0" };
    expect(reconcileReceivingCounts(counts, true, ["a", "b"])).toBe(counts);
    expect(reconcileReceivingCounts(counts, true, ["a", "c"])).toEqual({ a: "3", c: "" });
  });
  it("starts another delivery blank even if the products are the same", () => {
    expect(reconcileReceivingCounts({ a: "3" }, false, ["a", "b"])).toEqual({ a: "", b: "" });
  });
});
