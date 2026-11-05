import type { Shift } from "@/core/types/pos-types";
import { sameBranchId } from "./branch-id";
import { shiftIsOpenForBranch } from "./branch-shift-state";
import { shiftDuration } from "./shift-hours";

export type ShiftHistoryStatus = "all" | "open" | "closed";

type ShiftHistoryView = {
  branchId: string;
  from: string;
  to: string;
  search: string;
  status: ShiftHistoryStatus;
  columnFilters: Readonly<Record<string, string>>;
  countedCashVisible: boolean;
  varianceVisible: boolean;
  hiddenColumns?: readonly string[];
  correctionVisible?: boolean;
  reportVisible?: boolean;
  dayKey: (value: string) => string;
  formatDateTime: (value: string) => string;
  formatMoney: (value: number) => string;
  now?: Date;
};

export const shiftHistoryStatus = (shift: Shift): "OPEN" | "CLOSED" =>
  shiftIsOpenForBranch(shift, shift.storeId) ? "OPEN" : "CLOSED";

/** Filter the complete authorized result, before the route takes a page.
 * Only displayed financial fields participate; stale filters on a removed
 * column cannot reveal hidden values through changes in matching row counts. */
export function filterShiftHistory(shifts: readonly Shift[], view: ShiftHistoryView): Shift[] {
  if (!view.branchId.trim() || (view.from && view.to && view.from > view.to)) return [];
  const needle = view.search.trim().toLocaleLowerCase();
  const filters = Object.entries(view.columnFilters)
    .map(([label, value]) => [label, value.trim().toLocaleLowerCase()] as const)
    .filter(([, value]) => value);
  const now = view.now ?? new Date();
  return shifts.filter(shift => {
    if (!sameBranchId(shift.storeId, view.branchId)) return false;
    const status = shiftHistoryStatus(shift);
    if (view.status !== "all" && status.toLowerCase() !== view.status) return false;
    const day = view.dayKey(shift.openedAt);
    if ((view.from && day < view.from) || (view.to && day > view.to)) return false;
    const fields: Record<string, string> = {
      Cashier: `${shift.cashier} Ref ${shift.id}`,
      Status: status,
      Opened: view.formatDateTime(shift.openedAt),
      Closed: `${shift.closedAt ? view.formatDateTime(shift.closedAt) : status === "OPEN" ? "open" : "—"}${shift.overdue ? " OVERDUE" : ""}`,
      "Closed by": shift.closedBy ?? "—",
      Terminal: shift.terminalName ?? "—",
      Duration: shiftDuration(shift, now),
      Float: view.formatMoney(shift.openingFloat),
    };
    if (view.countedCashVisible) {
      const counted = shift.closingFloat ?? shift.countedCash;
      fields["Closing float"] = counted == null ? "—" : view.formatMoney(counted);
    }
    if (view.varianceVisible)
      fields["Over / short"] = shift.varianceTotal == null ? "—" : view.formatMoney(shift.varianceTotal);
    if (view.correctionVisible) fields.Correction = "Correct";
    if (view.reportVisible) fields["Z report"] = "";
    for (const label of view.hiddenColumns ?? []) delete fields[label];
    if (filters.some(([label, value]) => !Object.hasOwn(fields, label) || !fields[label].toLocaleLowerCase().includes(value)))
      return false;
    // Keep the main search on the existing metadata, with the reference added.
    // Amounts belong only to permitted visible column filters.
    return !needle || [fields.Cashier, fields.Status, fields.Opened, fields.Terminal,
      ...(Object.hasOwn(fields, "Opened") ? [shift.openedAt] : [])]
      .join(" ").toLocaleLowerCase().includes(needle);
  });
}
