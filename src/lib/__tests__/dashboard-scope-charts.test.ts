import { describe, expect, it } from "vitest";
import type { Sale, Store } from "@/core/types/pos-types";
import { dashboardPageStores } from "../dashboard-scope";
import { allShopsTotalsScope } from "../all-shops-scope";
import { comparisonGrain, comparisonPoints, comparisonSalesDays, comparisonShopSeries } from "../shop-comparison";
import type { StoreDayRow } from "../analytics-board";

const stores = [{ id: "A", name: "Airport", groupId: "one" }, { id: "A2", name: "Town", groupId: "one" },
  { id: "B", name: "Riverside", groupId: "two" }] as Store[];
const ids = (rows: Store[]) => rows.map(row => row.id);
const day = (store_id: string, revenue = 100, cost = 40, date = "2026-11-01"): StoreDayRow => ({ store_id, sale_day: date,
  sale_month: date.slice(0, 7), revenue, cost, profit: revenue - cost, bills: 1, discount: 0, foc_value: 0, units: 1 });

describe("explicit dashboard view scopes", () => {
  it("keeps every live-dashboard KPI/chart on the selected branch even for unbound management", () => {
    expect(ids(dashboardPageStores(stores, "A2", null, null, true, "branch"))).toEqual(["A2"]);
    expect(ids(dashboardPageStores(stores, "B", null, null, true, "branch"))).toEqual(["B"]);
  });
  it("uses authorized shops across clusters for company comparison", () => {
    expect(ids(dashboardPageStores(stores, "A", null, null, true, "company"))).toEqual(["A", "A2", "B"]);
    expect(ids(dashboardPageStores([stores[0], stores[2]], "A", null, null, true, "company"))).toEqual(["A", "B"]);
    expect(dashboardPageStores([], "A", null, null, true, "company")).toEqual([]);
  });
  it("never widens a normal terminal for its administrator or a branch-assigned manager", () => {
    for (const view of ["branch", "company"] as const) {
      expect(ids(dashboardPageStores(stores, "B", "A", null, true, view))).toEqual(["A"]);
      expect(ids(dashboardPageStores(stores, "B", null, "A2", true, view))).toEqual(["A2"]);
      expect(dashboardPageStores(stores, "B", "missing", null, true, view)).toEqual([]);
    }
  });
  it("filters All Shops cards and charts by cluster, retaining zero shops and explicit All", () => {
    const authorized = dashboardPageStores(stores, "A", null, null, true, "company");
    expect(ids(allShopsTotalsScope(authorized, "cluster:one"))).toEqual(["A", "A2"]);
    expect(ids(allShopsTotalsScope(authorized, "cluster:two"))).toEqual(["B"]);
    expect(ids(allShopsTotalsScope(authorized, "all"))).toEqual(["A", "A2", "B"]);
    expect(allShopsTotalsScope(dashboardPageStores(stores, "A", "A", null, true, "company"), "cluster:two")).toEqual([]);
  });
});

describe("per-shop chart values and identity", () => {
  it("keeps distinct colors/keys across directory order, ranking, periods and filtered selections", () => {
    const series = comparisonShopSeries(stores), reversed = comparisonShopSeries([...stores].reverse());
    expect(series).toEqual(reversed);
    expect(new Set(series.map(row => row.color)).size).toBe(3);
    const hues = series.map(row => Number(row.color.match(/([\d.]+)\)$/)?.[1]));
    for (let index = 0; index < hues.length; index++) for (const hue of hues.slice(index + 1)) {
      const distance = Math.abs(hue - hues[index]);
      expect(Math.min(distance, 360 - distance)).toBeGreaterThanOrEqual(35);
    }
    const before = JSON.stringify(series);
    comparisonPoints([day("B", 500), day("A", 1)], series, ["B"], "revenue", "daily");
    comparisonPoints([day("A", 999)], series, ["A", "B"], "profit", "monthly");
    expect(JSON.stringify(series)).toBe(before);
  });
  it("combines duplicate daily facts, keeps losses/zero shops and excludes unselected/unknown scope", () => {
    const series = comparisonShopSeries(stores), [a, a2, b] = series;
    const points = comparisonPoints([day("A", 10, 20), day("A", 0.1, 0), day("B", 500), day("unknown", 900)],
      series, ["A", "A2"], "profit", "daily");
    expect(points).toEqual([{ label: "2026-11-01", [a.key]: -9.9, [a2.key]: 0 }]);
    expect(points[0]).not.toHaveProperty(b.key);
    expect(comparisonPoints([day("B")], series, [], "revenue", "daily")).toEqual([]);
  });
  it("monthly grouping preserves the exact sum of the selected daily totals", () => {
    const series = comparisonShopSeries(stores), a = series[0];
    expect(comparisonPoints([day("A", 1.25), day("A", 2.5, 0, "2026-11-02")], series, ["A"], "revenue", "monthly"))
      .toEqual([{ label: "2026-11", [a.key]: 3.75 }]);
  });
  it("distinguishes old hashed-color collisions and keeps color across page/cluster/branch directories", () => {
    const directory = [{ id: "shop-627", name: "Shop" }, { id: "shop-2100", name: "Shop" }];
    const series = comparisonShopSeries(directory);
    expect(new Set(series.map(shop => shop.color)).size).toBe(2);
    expect(new Set(series.map(shop => shop.name)).size).toBe(2);
    expect(comparisonShopSeries([...directory].reverse())).toEqual(series);
    // Every surface supplies the full existing authorized directory; selection
    // never reallocates colors. Directory membership changes are a stated limit.
    const company = comparisonShopSeries(stores);
    for (const shop of company) {
      const filteredPoints = comparisonPoints([day(shop.id)], company, [shop.id], "revenue", "daily");
      expect(filteredPoints[0]).toHaveProperty(shop.key);
      expect(comparisonShopSeries([...stores].reverse()).find(row=>row.id===shop.id)?.color).toBe(shop.color);
    }
    const twelve = comparisonShopSeries(Array.from({length:12},(_,index)=>({id:String(index),name:String(index)})));
    expect(new Set(twelve.map(shop=>shop.color)).size).toBe(12);
    expect(twelve.every(shop=>shop.color!==shop.profitColor)).toBe(true);
    const two = comparisonShopSeries(directory);
    expect(new Set(two.flatMap(shop=>[shop.color,shop.profitColor])).size).toBe(4);

  });
  it("aggregates long ranges monthly without truncating any revenue", () => {
    const rows = Array.from({ length: 800 }, (_, index) => day("A", 1, 0, new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10)));
    const grain = comparisonGrain(rows, "daily");
    expect(grain).toBe("monthly");
    const series = comparisonShopSeries(stores);
    expect(comparisonPoints(rows, series, ["A"], "revenue", grain).reduce((sum, row) => sum + Number(row[series[0].key]), 0)).toBe(800);
  });
  it("uses existing saved-bill net revenue/cost rules without counting refunded bills or sponsorship as cash", () => {
    const base = { id: "s", storeId: "A", createdAt: "2026-11-01T04:00:00Z", refunded: false,
      total: 98.95, tax: 9, roundingAdjustment: -0.05,
      lines: [{ productId: "p", price: 100, qty: 1, cost: 40 }] } as Sale;
    const rows = comparisonSalesDays([base, { ...base, id: "r", refunded: true, total: 900 }], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ store_id: "A", bills: 1, revenue: 90, cost: 40, profit: 50 });
  });
});
