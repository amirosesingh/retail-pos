export type StockReportDay = Readonly<{
  date: string;
  timeZone: string;
  start: string;
  endExclusive: string;
}>;
/** Calendar data only, never an authorization, clock or coverage assertion. */
export function stockReportDay(date: string, timeZone: string): StockReportDay;
