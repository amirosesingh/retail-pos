import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import type { Product } from "@/core/types/pos-types";
import { negativeStockCountAllowed, negativeStockProducts, reviewedPhysicalCounts } from "../inventory-negative-stock";
import { stockCountChanges } from "../stock-count-plan";

const a = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const b = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const product = (id: string, qty: number, otherQty = 20): Product => ({ id, name: id, sku: id, barcode: id, category: "Default", price: 5, cost: 1, taxRate: 0, reorderLevel: 2, stockByStore: { [a]: qty, [b]: otherQty } });

describe("negative-stock review and explicit physical counts", () => {
  it("reviews only negative quantities in the selected branch's permitted catalogue", () => {
    const products = [product("negative", -2), product("positive", 2, -10), product("zero", 0), product("foreign-cluster", -3)];
    const before = JSON.stringify(products);
    expect(negativeStockProducts(products, a.toUpperCase(), p => p.id !== "foreign-cluster").map(p => p.id)).toEqual(["negative"]);
    expect(JSON.stringify(products)).toBe(before);
  });
  it("requires the current branch and existing stock-adjustment grant; a URL grants nothing", () => {
    expect(negativeStockCountAllowed(a, a.toUpperCase(), true)).toBe(true);
    expect(negativeStockCountAllowed(b, a, true)).toBe(false);
    expect(negativeStockCountAllowed(a, a, false)).toBe(false);
    expect(negativeStockCountAllowed(undefined, a, true)).toBe(false);
  });
  it.each(["denied", "wrong-branch", "empty-catalogue"])("retries the actual route review effect after %s is corrected and opens once", initial => {
    const source = readFileSync("src/routes/stock-operations.tsx", "utf8");
    const start = source.indexOf('    if (!ready || !authReady || search.review !== "negative"');
    const end = source.indexOf("  }, [ready, authReady, search.review", start);
    expect(start).toBeGreaterThan(-1); expect(end).toBeGreaterThan(start);
    // Execute the real read-only effect body with state setters replaced by
    // spies, rather than copying its consume/retry ordering into a fake helper.
    const effect = `(function () { ${source.slice(start, end)} })()`;
    const context = {
      ready: true, authReady: true, search: { review: "negative", branch: a },
      reviewRequest: { current: null as string | null },
      currentStore: { id: initial === "wrong-branch" ? b : a },
      canAdjustStock: initial !== "denied",
      state: { products: initial === "empty-catalogue" ? [] as Product[] : [product("negative", -2)], settings: {}, stores: [], transfers: [] },
      createCatalogueVisibility: () => () => true,
      negativeStockCountAllowed, negativeStockProducts,
      toast: { error: vi.fn(), info: vi.fn() },
      setInitialProductIds: vi.fn(), setResuming: vi.fn(), setActiveCountStoreId: vi.fn(), setCountOpen: vi.fn(),
    };
    runInNewContext(effect, context);
    expect(context.reviewRequest.current).toBeNull();
    expect(context.setCountOpen).not.toHaveBeenCalled();
    context.currentStore.id = a; context.canAdjustStock = true;
    context.state.products = [product("negative", -2)];
    runInNewContext(effect, context);
    expect(context.reviewRequest.current).toBe(a);
    expect(context.setInitialProductIds).toHaveBeenCalledExactlyOnceWith(["negative"]);
    expect(context.setActiveCountStoreId).toHaveBeenCalledExactlyOnceWith(a);
    expect(context.setCountOpen).toHaveBeenCalledExactlyOnceWith(true);
    runInNewContext(effect, context);
    expect(context.setCountOpen).toHaveBeenCalledOnce();
    expect(context.state.products[0].stockByStore[a]).toBe(-2);
  });
  it("leaves every seeded physical count blank until explicitly entered", () => {
    expect(() => reviewedPhysicalCounts(["one", "two"], {})).toThrow("every product");
    expect(() => reviewedPhysicalCounts(["one", "two"], { one: "0" })).toThrow("every product");
    for (const value of ["-1", "1.5", "NaN", "Infinity", "  "])
      expect(() => reviewedPhysicalCounts(["one"], { one: value })).toThrow("whole physical count");
    expect(reviewedPhysicalCounts(["one", "two"], { one: "0", two: "2" })).toEqual([{ productId: "one", counted: 0 }, { productId: "two", counted: 2 }]);
  });
  it("uses the existing count plan to correct only the selected branch after review", () => {
    const products = [product("one", -3), product("two", -1, 42)];
    const before = JSON.stringify(products);
    const entries = reviewedPhysicalCounts(["one", "two"], { one: "0", two: "2" });
    const plan = stockCountChanges(products, entries, a);
    expect(plan.map(row => ({ before: row.before, counted: row.counted, delta: row.delta }))).toEqual([{ before: -3, counted: 0, delta: 3 }, { before: -1, counted: 2, delta: 3 }]);
    expect(products[1].stockByStore[b]).toBe(42);
    expect(JSON.stringify(products)).toBe(before);
    expect(() => stockCountChanges(products, [...entries, { productId: "one", counted: 9 }], a)).toThrow("conflicting");
  });
  it("keeps the existing audited/idempotent posting path and no stock write on Inventory", () => {
    const inventory = readFileSync("src/routes/inventory.tsx", "utf8");
    const dialog = readFileSync("src/platforms/web/components/pos/StockCountDialog.tsx", "utf8");
    const route = readFileSync("src/routes/stock-operations.tsx", "utf8");
    expect(inventory).not.toContain("applyStockCount(");
    expect(inventory).toContain('search: { review: "negative", branch: currentStore.id }');
    expect(route).toContain("negativeStockCountAllowed(search.branch, currentStore.id, canAdjustStock)");
    expect(dialog).toContain("setPhysicalCounts({})");
    expect(dialog).toContain("if (suggestedIds.length)");
    expect(dialog).toContain("reviewedPhysicalCounts(suggestedProducts.map(product => product.id), physicalCounts)");
    expect(dialog).toContain("await applyStockCount(");
    expect(dialog).toContain("adjustmentAttemptId,");
  });
});
