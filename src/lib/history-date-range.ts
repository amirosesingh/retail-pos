import { posDayKey, shiftCalendarDay } from "./time-zone";

/** Move an explicit history range by calendar days, independent of device DST. */
export function moveHistoryDateRange(from: string, to: string, days: number, today = posDayKey()) {
  const start = from || to || today;
  const end = to || from || today;
  return { from: shiftCalendarDay(start, days), to: shiftCalendarDay(end, days) };
}
