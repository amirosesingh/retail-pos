import type { Shift } from "@/core/types/pos-types";
import { sameBranchId } from "./branch-id";
import { sameRecordId } from "./sale-identity";

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

/** A missing row is not a closure. Only an answered row for this shift/branch
 * can replace the cached trading shift; an explicit close may reveal a newer
 * open shift returned in the same authoritative read. */
export function reconcileActiveShiftRows(previous: Shift | null, rows: readonly Shift[], branchId: string): Shift | null {
  const cached = shiftIsOpenForBranch(previous, branchId) ? previous : null;
  const answered = cached && rows.find(row => sameRecordId(row.id, cached.id) && sameBranchId(row.storeId, branchId));
  if (answered) return shiftIsOpenForBranch(answered, branchId) ? answered : latestOpenShiftForBranch(rows, branchId);
  return cached ?? latestOpenShiftForBranch(rows, branchId);
}
