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
  const rows = new Map<string, { shift: Shift; milliseconds: number; remainder: number }>();
  for (const shift of [...seed, ...loaded]) {
    if (canonicalBranchId(shift.storeId) !== canonicalBranchId(branchId)) continue;
    const openedAt = reportOpenedAt(shift.openedAt);
    if (openedAt !== null && inPosDayRange(openedAt, from, to, zone)) {
      // Date.parse retains milliseconds; keep SQL's remaining 100 ns digits for
      // display ordering without changing its original timestamp/cursor text.
      const fraction = /\.([0-9]+)(?:Z|[+-][0-9]{2}(?::?[0-9]{2})?)?$/i.exec(openedAt)?.[1] ?? "";
      rows.set(canonicalBranchId(shift.id), {
        shift: openedAt === shift.openedAt ? shift : { ...shift, openedAt },
        milliseconds: Date.parse(openedAt),
        remainder: Number(fraction.padEnd(7, "0").slice(3, 7)),
      });
    }
  }
  return [...rows.values()].sort((a, b) => b.milliseconds - a.milliseconds || b.remainder - a.remainder ||
    b.shift.id.localeCompare(a.shift.id)).map(row => row.shift);
}
