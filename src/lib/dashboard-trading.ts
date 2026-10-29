import type { Sale } from "@/core/types/pos-types";
import { posDayKey, shiftCalendarDay } from "./time-zone";

/** Bounded chart construction; longer selections aggregate by month, never truncate sales. */
export function dashboardDailyTrading(
  sales: readonly Sale[],
  sponsorship: readonly { day: string; value: number }[],
  from: string,
  to: string,
  includeSponsorship: boolean,
) {
  const monthly = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 >= 731;
  const key = (day: string) => monthly ? day.slice(0, 7) : day;
  const buckets = new Map<string, { sales: number; sponsorship: number }>();
  if (!monthly) for (let day = from, count = 0; day <= to && count <= 731; day = shiftCalendarDay(day, 1), count++) buckets.set(day, { sales: 0, sponsorship: 0 });
  const add = (day: string, value: number, type: "sales" | "sponsorship") => {
    if (day < from || day > to || !Number.isFinite(value)) return;
    const id = key(day), bucket = buckets.get(id) ?? { sales: 0, sponsorship: 0 };
    bucket[type] += value;
    buckets.set(id, bucket);
  };
  for (const sale of sales) if (!sale.refunded) add(posDayKey(sale.createdAt), sale.total, "sales");
  if (includeSponsorship) for (const row of sponsorship) add(row.day, Number(row.value), "sponsorship");
  return [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([day, bucket]) => ({
    day: monthly ? day : day.slice(5),
    sales: Number(bucket.sales.toFixed(2)),
    sponsorship: Number(bucket.sponsorship.toFixed(2)),
    total: Number((bucket.sales + bucket.sponsorship).toFixed(2)),
  }));
}
