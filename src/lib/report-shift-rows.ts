import type { Shift } from "@/core/types/pos-types";
import { canonicalBranchId } from "./branch-id";
import { inPosDayRange } from "./time-zone";

/** Native snapshots can carry Date objects; never round an existing SQL string. */
function reportOpenedAt(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return null;
}

/** Presentation-only merge. Paged history overrides its matching snapshot row. */
export function mergeReportShiftRows(
  seed: Shift[], loaded: Shift[], branchId: string, from: string, to: string, zone: string,
): Shift[] {
  const rows = new Map<string, Shift>();
  for (const shift of [...seed, ...loaded]) {
    if (canonicalBranchId(shift.storeId) !== canonicalBranchId(branchId)) continue;
    const openedAt = reportOpenedAt(shift.openedAt);
    if (openedAt !== null && inPosDayRange(openedAt, from, to, zone)) {
      rows.set(canonicalBranchId(shift.id), openedAt === shift.openedAt ? shift : { ...shift, openedAt });
    }
  }
  return [...rows.values()].sort((a, b) => b.openedAt.localeCompare(a.openedAt) || b.id.localeCompare(a.id));
}
