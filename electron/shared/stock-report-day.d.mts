export type StockReportDay = Readonly<{
  date: string;
  timeZone: string;
  start: string;
  endExclusive: string;
}>;
export const STOCK_MOVEMENT_MAX_CALENDAR_DAYS: 31;
/** Calendar data only, never an authorization, clock or coverage assertion. */
export function stockReportDay(date: string, timeZone: string): StockReportDay;
