import type { Shift } from "@/core/types/pos-types";
import { sameBranchId } from "./branch-id";

export function shiftIsOpenForBranch(shift: Shift | null | undefined, branchId: string): shift is Shift {
  return !!shift && sameBranchId(shift.storeId, branchId) && !shift.closedAt && shift.status !== "CLOSED";
}
export function latestOpenShiftForBranch(shifts: readonly Shift[], branchId: string): Shift | null {
  return shifts.filter(shift => shiftIsOpenForBranch(shift, branchId))
    .sort((a, b) => (Date.parse(b.openedAt) || 0) - (Date.parse(a.openedAt) || 0))[0] ?? null;
}
/** Ignore a late response, including when the user switches A → B → A. */
export function branchReadApplies(requestBranch: string, currentBranch: string, request: number, latestRequest: number): boolean {
  return request === latestRequest && sameBranchId(requestBranch, currentBranch);
}
