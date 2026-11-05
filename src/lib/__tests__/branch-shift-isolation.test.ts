import { describe, expect, it } from "vitest";
import type { Shift } from "@/core/types/pos-types";
import { branchReadApplies, latestOpenShiftForBranch, shiftIsOpenForBranch } from "../branch-shift-state";
const branchA = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const shift = (id: string, storeId: string, openedAt: string, closedAt: string | null = null) => ({ id, storeId, openedAt, closedAt, status: closedAt ? "CLOSED" : "OPEN" }) as Shift;
describe("branch-scoped open shift reads", () => {
  it("keeps only the latest open shift from the selected branch, using canonical UUID casing", () => {
    const older = shift("old", branchA, "2026-10-25T10:00:00Z");
    const latest = shift("latest", branchA.toUpperCase(), "2026-10-26T10:00:00Z");
    const foreign = shift("foreign", "other", "2026-10-27T10:00:00Z");
    const closed = shift("closed", branchA, "2026-10-28T10:00:00Z", "2026-10-28T20:00:00Z");
    expect(latestOpenShiftForBranch([older, foreign, closed, latest], branchA)).toBe(latest);
    expect(shiftIsOpenForBranch(foreign, branchA)).toBe(false);
    expect(shiftIsOpenForBranch(closed, branchA)).toBe(false);
    expect(latestOpenShiftForBranch([foreign, closed], branchA)).toBeNull();
  });
  it("rejects delayed success or failure after switching branches or starting a newer read", () => {
    expect(branchReadApplies(branchA, "other", 1, 2)).toBe(false);
    expect(branchReadApplies(branchA, branchA, 1, 3)).toBe(false);
    expect(branchReadApplies(branchA.toUpperCase(), branchA, 3, 3)).toBe(true);
  });
});
