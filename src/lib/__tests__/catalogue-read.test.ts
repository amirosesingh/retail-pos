import { describe, expect, it } from "vitest";
import { readCataloguePages } from "../catalogue-read";
import { createCatalogueVisibility } from "../branch-policy";
import { defaultSettings } from "../pos-seed";
import type { Product, Store } from "@/core/types/pos-types";

describe("count-free product catalogue", () => {
  it.each([100, 500])("retains all 600 archived owned products across catalogue pages of %i", async pageSize => {
    const products = Array.from({ length: 2169 }, (_, i): Product => ({
      id: String(i).padStart(6, "0"), name: "Item", sku: `SKU-${i}`, barcode: `code-${i}`,
      category: "Default", cost: 2, price: 4, reorderLevel: 1, taxRate: 0,
      ownerStoreId: "str1", archived: i < 600, stockByStore: { str1: i < 600 ? 0 : 2 },
    }));
    const result = await readCataloguePages(async (after, limit) => ({
      data: products.filter(p => p.id > after).slice(0, limit), error: null,
    }), () => {}, { pageSize, maxRows: 10000 });
    const stores = [{ id: "str1", groupId: "sports", privateCatalogue: true },
      { id: "str2", groupId: "sports", privateCatalogue: true },
      { id: "foreign", groupId: "different", privateCatalogue: true }] as Store[];
    const visible = createCatalogueVisibility(defaultSettings, stores);
    expect(result.data).toHaveLength(2169);
    for (const branch of ["str1", "str2"]) {
      expect(result.data!.filter(p => visible(p, branch) && p.archived)).toHaveLength(600);
      expect(result.data!.filter(p => visible(p, branch) && !p.archived)).toHaveLength(1569);
    }
    expect(result.data!.filter(p => visible(p, "foreign"))).toHaveLength(0);
  });
  it.each([0, 1, 6, 7, 9])("loads %i rows completely, including an exact ceiling", async count => {
    const all = Array.from({ length: count }, (_, i) => ({ id: String(i + 1).padStart(4, "0") }));
    const limits: number[] = [];
    const result = await readCataloguePages(async (after, limit) => {
      limits.push(limit);
      return { data: all.filter(row => row.id > after).slice(0, limit), error: null };
    }, () => {}, { pageSize: 3, maxRows: 9 });
    expect(result).toEqual({ data: all, error: null, total: count, capped: false });
    if (count === 9) expect(limits).toEqual([3, 3, 3, 1]);
  });

  it("detects extra rows without exposing an incomplete catalogue as complete", async () => {
    const all = Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1).padStart(4, "0") }));
    const result = await readCataloguePages(async (after, limit) => ({
      data: all.filter(row => row.id > after).slice(0, limit), error: null,
    }), () => {}, { pageSize: 3, maxRows: 9 });
    expect(result.capped).toBe(true);
    expect(result.data).toHaveLength(9);
    expect(result.total).toBeNull();
  });

  it("fails closed if a later page or ceiling probe fails", async () => {
    let calls = 0;
    const result = await readCataloguePages(async () => ++calls === 1
      ? { data: [{ id: "a" }], error: null }
      : { data: null, error: { message: "session ended" } }, () => {}, { pageSize: 1, maxRows: 1 });
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe("session ended");
  });

  it("rejects a non-advancing cursor instead of looping", async () => {
    const result = await readCataloguePages(async () => ({ data: [{ id: "a" }], error: null }), () => {}, { pageSize: 1, maxRows: 5 });
    expect(result.data).toBeNull();
    expect(result.error?.message).toContain("cursor");
  });
});
