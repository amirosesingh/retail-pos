import type { Sale } from "@/core/types/pos-types";
import { sameRecordId, uniqueSales } from "./sale-identity";

export function branchReceiptHistory(live: Sale[], older: Sale[], branchId: string): Sale[] {
  return uniqueSales([...older, ...live]).filter(sale => sameRecordId(sale.storeId, branchId));
}

export function receiptMatchesShift(sale: Sale, shiftId: string | null): boolean {
  // The history screen promises branch history when there is no active shift.
  return !shiftId || sameRecordId(sale.shiftId, shiftId);
}
