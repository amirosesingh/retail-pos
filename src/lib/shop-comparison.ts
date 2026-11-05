import type { Product, Sale, Store } from "@/core/types/pos-types";
import { indexProducts, lineCost, saleNetRevenue } from "@/core/pricing/profit";
import type { StoreDayRow } from "./analytics-board";
import { branchChartColor } from "./analytics-design";
import { canonicalBranchId } from "./branch-id";
import { posDayKey, posHour, shiftCalendarDay } from "./time-zone";

export type ComparisonShop = Pick<Store, "id" | "name">;
export type ComparisonPoint = { label: string; [key: string]: string | number };

/** Use the full authorized directory, never a filtered/ranked chart slice. */
export function comparisonShopSeries(directory: readonly ComparisonShop[]) {
  const shops = [...new Map(directory.map(shop => [canonicalBranchId(shop.id), shop])).entries()]
    .filter(([id]) => id).sort(([a], [b]) => a.localeCompare(b));
  const hues: number[] = [];
  const separation = Math.min(35, 120 / Math.max(1, shops.length));
  const names = new Map<string, number>();
  for (const [, shop] of shops) names.set(shop.name, (names.get(shop.name) ?? 0) + 1);
  return shops.map(([id, shop], index) => {
    const seed = Number(branchChartColor(id).match(/([\d.]+)\)$/)?.[1] ?? 0);
    let hue = seed;
    // Nearby hash hues are visually indistinguishable. Resolve them against
    // the full directory so filtering/ranking cannot recolor the remaining shops.
    for (let attempt = 0; attempt < 360 && hues.some(previous => {
      const distance = Math.abs(previous - hue); return Math.min(distance, 360 - distance) < separation;
    }); attempt++) hue = (hue + 137.508) % 360;
    hues.push(hue);
    const color = `oklch(var(--analytics-category-lightness) 0.2 ${hue})`;
    return { id, name: (names.get(shop.name) ?? 0) > 1 ? `${shop.name} · ${id}` : shop.name, key: `shop${index}`, color };
  });
}

export type StoreHourRow = { store_id: string; hour: number; bills: number; revenue: number; cost: number; profit: number };
export type FinancialShopRow = { id: string; name: string; revenue: number; cost: number; profit: number; marginPct: number };

/** Bill headers prove hourly transaction counts only, never their cost/profit. */
export function comparisonHeaderHours(bills: readonly { store_id: string | null; created_at: string }[]): StoreHourRow[] {
  const hours = new Map<string, StoreHourRow>();
  for (const bill of bills) {
    const store = canonicalBranchId(bill.store_id), hour = posHour(bill.created_at);
    if (!store || !Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    const key = JSON.stringify([store, hour]);
    const row = hours.get(key) ?? { store_id: store, hour, bills: 0, revenue: 0, cost: 0, profit: 0 };
    row.bills++; hours.set(key, row);
  }
  return [...hours.values()];
}

/** The existing receipt/captured-cost formulas, grouped only by actual trading hour. */
export function comparisonSalesHours(sales: readonly Sale[], products: Product[]): StoreHourRow[] {
  const lookup = indexProducts(products), hours = new Map<string, StoreHourRow>();
  for (const sale of sales) {
    if (sale.refunded) continue;
    const hour = posHour(sale.createdAt), store = canonicalBranchId(sale.storeId);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !store) continue;
    const key = JSON.stringify([store, hour]);
    const row = hours.get(key) ?? { store_id: store, hour, bills: 0, revenue: 0, cost: 0, profit: 0 };
    row.bills++; row.revenue += saleNetRevenue(sale);
    row.cost += sale.lines.reduce((sum, line) => sum + lineCost(line, lookup), 0);
    hours.set(key, row);
  }
  return [...hours.values()].map(row => ({ ...row, revenue: Number(row.revenue.toFixed(2)),
    cost: Number(row.cost.toFixed(2)), profit: Number((row.revenue - row.cost).toFixed(2)) }));
}

/** Never derive hourly cost from daily values or expose an unselected shop. */
export function comparisonHourPoints(rows: readonly StoreHourRow[], series: ReturnType<typeof comparisonShopSeries>,
  selectedIds: readonly string[], metric: "bills" | "profit") {
  const selected = new Set(selectedIds.map(canonicalBranchId));
  const shown = series.filter(shop => selected.has(shop.id));
  const keys = new Map(shown.map(shop => [shop.id, shop.key]));
  const result: ComparisonPoint[] = Array.from({ length: 24 }, (_, hour) => ({ label: `${hour}:00`,
    ...Object.fromEntries(shown.map(shop => [shop.key, 0])) }));
  for (const row of rows) {
    const key = keys.get(canonicalBranchId(row.store_id));
    if (!key || !Number.isInteger(row.hour) || row.hour < 0 || row.hour > 23) continue;
    const value = metric === "bills" ? row.bills : row.revenue - row.cost;
    if (Number.isFinite(value)) result[row.hour]![key] = Number(result[row.hour]![key] ?? 0) + value;
  }
  return result.map(point => Object.fromEntries(Object.entries(point).map(([key, value]) =>
    [key, typeof value === "number" ? Number(value.toFixed(2)) : value])) as ComparisonPoint);
}

/** Calendar arithmetic uses the existing business-date helper, including DST boundaries. */
export function chartRangePreset(today: string, preset: "today" | "7" | "15" | "20" | "30" | "month") {
  return { from: preset === "month" ? `${today.slice(0, 7)}-01`
    : preset === "today" ? today : shiftCalendarDay(today, 1 - Number(preset)), to: today };
}

/** Long ranges aggregate instead of dropping history or rendering thousands of points. */
export function comparisonGrain(rows: readonly StoreDayRow[], requested: "daily" | "monthly", range?: { from: string; to: string }) {
  if (requested === "monthly") return requested;
  if (range && Date.parse(range.to) - Date.parse(range.from) > 730 * 86_400_000) return "monthly";
  const days = new Set<string>();
  for (const row of rows) { days.add(row.sale_day); if (days.size > 731) return "monthly"; }
  return requested;
}

/** Existing bill profit calculation, grouped without changing refund/discount rules. */
export function comparisonSalesDays(sales: readonly Sale[], products: Product[]): StoreDayRow[] {
  const lookup = indexProducts(products), days = new Map<string, StoreDayRow>();
  for (const sale of sales) {
    if (sale.refunded) continue;
    const day = posDayKey(sale.createdAt), store = canonicalBranchId(sale.storeId), key = JSON.stringify([day, store]);
    const row = days.get(key) ?? { sale_day: day, sale_month: day.slice(0, 7), store_id: store,
      bills: 0, revenue: 0, cost: 0, profit: 0, discount: 0, foc_value: 0, units: 0 };
    row.bills++; row.revenue += saleNetRevenue(sale);
    row.cost += sale.lines.reduce((sum, line) => sum + lineCost(line, lookup), 0);
    days.set(key, row);
  }
  return [...days.values()].map(row => ({ ...row, revenue: Number(row.revenue.toFixed(2)),
    cost: Number(row.cost.toFixed(2)), profit: Number((row.revenue - row.cost).toFixed(2)) }));
}

/** Aggregate only allowed shop IDs; missing days are zero, never hidden shops. */
export function comparisonPoints(rows: readonly StoreDayRow[], series: ReturnType<typeof comparisonShopSeries>,
  selectedIds: readonly string[], metric: "revenue" | "profit", grain: "daily" | "monthly", range?: { from: string; to: string }) {
  const selected = new Set(selectedIds.map(canonicalBranchId));
  const allowed = series.filter(shop => selected.has(shop.id));
  const byId = new Map(allowed.map(shop => [shop.id, shop.key]));
  const buckets = new Map<string, ComparisonPoint>();
  // This helper is called only with a confirmed complete range. Empty trading
  // days are real zeros; an unconfirmed/incomplete report never reaches it.
  if (allowed.length && range && /^\d{4}-\d{2}-\d{2}$/.test(range.from) && /^\d{4}-\d{2}-\d{2}$/.test(range.to) && range.from <= range.to) {
    let label = grain === "daily" ? range.from : range.from.slice(0, 7);
    const end = grain === "daily" ? range.to : range.to.slice(0, 7);
    const limit = grain === "daily" ? 731 : 2400;
    for (let index = 0; label <= end && index < limit; index++) {
      buckets.set(label, { label, ...Object.fromEntries(allowed.map(shop => [shop.key, 0])) });
      if (grain === "daily") label = shiftCalendarDay(label, 1);
      else { const [year, month] = label.split("-").map(Number); label = month === 12 ? `${year! + 1}-01` : `${year}-${String(month! + 1).padStart(2, "0")}`; }
    }
  }
  for (const row of rows) {
    if (range && (row.sale_day < range.from || row.sale_day > range.to)) continue;
    const key = byId.get(canonicalBranchId(row.store_id));
    if (!key) continue;
    const label = grain === "daily" ? row.sale_day : row.sale_month;
    const point = buckets.get(label) ?? { label, ...Object.fromEntries(allowed.map(shop => [shop.key, 0])) };
    const value = metric === "revenue" ? row.revenue : row.revenue - row.cost;
    if (Number.isFinite(value)) point[key] = Number(point[key] ?? 0) + value;
    buckets.set(label, point);
  }
  return [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label)).map(point =>
    Object.fromEntries(Object.entries(point).map(([key, value]) => [key,
      typeof value === "number" ? Number(value.toFixed(2)) : value])) as ComparisonPoint);
}
