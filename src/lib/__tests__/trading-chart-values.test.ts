import { describe, expect, it } from "vitest";
import type { Sale } from "@/core/types/pos-types";
import { chartRangePreset, comparisonGrain, comparisonHeaderHours, comparisonHourPoints, comparisonPoints, comparisonSalesHours, comparisonShopSeries } from "../shop-comparison";
import type { StoreDayRow } from "../analytics-board";

const shops = [{ id: "A", name: "Airport" }, { id: "B", name: "Town" }];
const series = comparisonShopSeries(shops);
const bill = { id: "s", storeId: "A", createdAt: "2026-11-01T04:00:00Z", refunded: false,
  total: 98.95, tax: 9, roundingAdjustment: -0.05, lines: [{ productId: "p", qty: 1, price: 100, cost: 40 }] } as Sale;
const daily = { store_id: "A", sale_day: "2026-11-01", sale_month: "2026-11", revenue: 90, cost: 40, profit: 50 } as StoreDayRow;

describe("confirmed chart values", () => {
  it("keeps saved net revenue, signed costs and refunds in actual hourly buckets", () => {
    const rows = comparisonSalesHours([bill, { ...bill, id: "r", refunded: true },
      { ...bill, id: "exchange", total: -20, tax: 0, roundingAdjustment: 0, lines: [{ ...bill.lines[0]!, qty: -1, cost: 10 }] }], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ store_id: "A", bills: 2, revenue: 70, cost: 30, profit: 40 });
    expect(rows[0]!.hour).toBeGreaterThanOrEqual(0); expect(rows[0]!.hour).toBeLessThan(24);
  });
  it("uses bill headers for transactions only, never a fabricated hourly profit", () => {
    const headers = comparisonHeaderHours([{ store_id: "A", created_at: bill.createdAt }]);
    expect(headers[0]).toMatchObject({ bills: 1, revenue: 0, cost: 0, profit: 0 });
  });
  it("never leaks another branch through hourly plots and preserves negative profit", () => {
    const rows = [{ store_id: "A", hour: 8, bills: 1, revenue: 5, cost: 10, profit: -5 },
      { store_id: "B", hour: 8, bills: 20, revenue: 999, cost: 0, profit: 999 }];
    const points = comparisonHourPoints(rows, series, ["A"], "profit");
    expect(points).toHaveLength(24);
    expect(points[8]).toEqual({ label: "8:00", [series[0]!.key]: -5 });
    expect(points.every(point => !(series[1]!.key in point))).toBe(true);
  });
  it("fills actual confirmed empty days and excludes rows outside the selected dates", () => {
    const points = comparisonPoints([daily, { ...daily, sale_day: "2026-10-31", revenue: 900 }], series, ["A"], "revenue", "daily", { from: "2026-11-01", to: "2026-11-03" });
    expect(points).toEqual([{ label: "2026-11-01", [series[0]!.key]: 90 }, { label: "2026-11-02", [series[0]!.key]: 0 }, { label: "2026-11-03", [series[0]!.key]: 0 }]);
  });
  it("bounds sparse long-range chart buckets without dropping represented facts", () => {
    const range = { from: "2020-01-01", to: "2026-11-01" };
    expect(comparisonGrain([daily], "daily", range)).toBe("monthly");
    const points = comparisonPoints([daily], series, ["A"], "profit", "monthly", range);
    expect(points.length).toBeLessThan(100);
    expect(points.reduce((sum, row) => sum + Number(row[series[0]!.key]), 0)).toBe(50);
  });
  it("uses inclusive Today, 15-day, 20-day and month windows across year boundaries", () => {
    expect(chartRangePreset("2026-01-05", "today")).toEqual({ from: "2026-01-05", to: "2026-01-05" });
    expect(chartRangePreset("2026-01-05", "15")).toEqual({ from: "2025-12-22", to: "2026-01-05" });
    expect(chartRangePreset("2026-01-05", "20")).toEqual({ from: "2025-12-17", to: "2026-01-05" });
    expect(chartRangePreset("2026-01-05", "month")).toEqual({ from: "2026-01-01", to: "2026-01-05" });
  });
});
