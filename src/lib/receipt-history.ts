import type { Sale, Shift } from "@/core/types/pos-types";
import { sameRecordId, uniqueSales } from "./sale-identity";

export function branchReceiptHistory(live: Sale[], older: Sale[], branchId: string): Sale[] {
  return uniqueSales([...older, ...live]).filter(sale => sameRecordId(sale.storeId, branchId))
    .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
}

export function receiptMatchesShift(sale: Sale, shiftId: string | null): boolean {
  // A missing shift is never permission to silently show every other shift.
  return !!shiftId && sameRecordId(sale.shiftId, shiftId);
}

/** The latest cached shift belongs to this branch, regardless of array order. */
export function latestReceiptShift(shifts: readonly Shift[], branchId: string): Shift | null {
  return shifts.filter(shift => sameRecordId(shift.storeId, branchId) && Number.isFinite(Date.parse(shift.openedAt)))
    .reduce<Shift | null>((latest, shift) => !latest || Date.parse(shift.openedAt) > Date.parse(latest.openedAt) ? shift : latest, null);
}
