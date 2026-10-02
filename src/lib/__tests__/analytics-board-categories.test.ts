import { describe, expect, it } from "vitest";
import {
  resolveStoreNames,
  shopSlices,
  topCategories,
  type BoardData,
  type ItemDayRow,
} from "@/lib/analytics-board";

const item = (overrides: Partial<ItemDayRow>): ItemDayRow => ({
  sale_day: "2026-09-27",
  store_id: "store-1",
  product_id: "product-1",
  product_name: "Item one",
  product_category: "Drinks",
  units: 1,
  revenue: 10,
  cost: 6,
  profit: 4,
  ...overrides,
});

describe("business board category drilldown", () => {
  it("uses each live directory name instead of stale sale snapshots", () => {
    expect(
      resolveStoreNames(
        [
          { id: "branch-a", name: "Airport" },
          { id: "branch-b", name: "Riverside" },
        ],
        [
          { store_id: "branch-a", store_name_snapshot: "Same old name" },
          { store_id: "branch-b", store_name_snapshot: "Same old name" },
          { store_id: "deleted", store_name_snapshot: "Closed kiosk" },
        ],
      ),
    ).toEqual({
      "branch-a": "Airport",
      "branch-b": "Riverside",
      deleted: "Closed kiosk",
    });
  });
  it("disambiguates live branches that currently share the same name", () => {
    expect(
      resolveStoreNames(
        [
          { id: "branch-a", code: "A1", name: "Main Shop" },
          { id: "branch-b", code: "B1", name: "Main Shop" },
        ],
        [],
      ),
    ).toEqual({
      "branch-a": "Main Shop · A1",
      "branch-b": "Main Shop · B1",
    });
  });
  it("keeps every live branch visible when one has no sales", () => {
    const data: BoardData = {
      storeDays: [
        {
          sale_day: "2026-10-02",
          sale_month: "2026-10",
          store_id: "branch-a",
          bills: 1,
          revenue: 20,
          cost: 10,
          profit: 10,
          discount: 0,
          foc_value: 0,
          units: 1,
        },
      ],
      itemDays: [],
      bills: [],
      storeNames: { "branch-a": "Gardong-361", "branch-b": "Airport" },
      liveStoreIds: ["branch-a", "branch-b"],
    };
    expect(shopSlices(data, (id) => data.storeNames[id] ?? "Unknown")).toMatchObject([
      { storeId: "branch-a", name: "Gardong-361", revenue: 20 },
      { storeId: "branch-b", name: "Airport", revenue: 0 },
    ]);
  });
  it("aggregates categories before exposing individual items", () => {
    const result = topCategories(
      [
        item({ product_id: "coffee", product_name: "Coffee", revenue: 14, units: 2 }),
        item({ product_id: "tea", product_name: "Tea", revenue: 6, units: 1 }),
        item({
          product_id: "bread",
          product_name: "Bread",
          product_category: "Bakery",
          revenue: 8,
        }),
      ],
      "revenue",
      10,
    );

    expect(result).toEqual([
      { name: "Drinks", revenue: 20, units: 3, itemCount: 2 },
      { name: "Bakery", revenue: 8, units: 1, itemCount: 1 },
    ]);
    expect(result.map((category) => category.name)).not.toContain("Coffee");
  });

  it("normalizes blank categories and respects the selected ranking", () => {
    const result = topCategories(
      [
        item({ product_id: "unknown", product_category: "  ", revenue: 100, units: 1 }),
        item({ product_id: "popular", product_category: "Snacks", revenue: 5, units: 8 }),
      ],
      "units",
      1,
    );
    expect(result).toEqual([{ name: "Snacks", revenue: 5, units: 8, itemCount: 1 }]);
  });
});
