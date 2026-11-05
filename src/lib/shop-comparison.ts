import type { Product, Sale, Store } from "@/core/types/pos-types";
import { indexProducts, lineCost, saleNetRevenue } from "@/core/pricing/profit";
import type { StoreDayRow } from "./analytics-board";
import { branchChartColor } from "./analytics-design";
import { canonicalBranchId } from "./branch-id";
import { posDayKey } from "./time-zone";

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
    const color = `oklch(var(--analytics-category-lightness) 0.16 ${hue})`;
    return { id, name: (names.get(shop.name) ?? 0) > 1 ? `${shop.name} · ${id}` : shop.name, key: `shop${index}`, color };
  });
}

/** Long ranges aggregate instead of dropping history or rendering thousands of points. */
export function comparisonGrain(rows: readonly StoreDayRow[], requested: "daily" | "monthly") {
  if (requested === "monthly") return requested;
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
  selectedIds: readonly string[], metric: "revenue" | "profit", grain: "daily" | "monthly") {
  const selected = new Set(selectedIds.map(canonicalBranchId));
  const allowed = series.filter(shop => selected.has(shop.id));
  const byId = new Map(allowed.map(shop => [shop.id, shop.key]));
  const buckets = new Map<string, ComparisonPoint>();
  for (const row of rows) {
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
