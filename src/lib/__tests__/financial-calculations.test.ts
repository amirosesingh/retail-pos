import { describe, expect, it } from "vitest";
import type { CartLine, Product, Sale } from "@/core/types/pos-types";
import { hourlyProfit, lineCost, lineRevenue, profitOf, saleLineRevenues, saleNetRevenue } from "@/core/pricing/profit";
import { soldLines, sumLines } from "@/lib/sales-analytics";

const product: Product = {
  id: "p1",
  name: "Item",
  sku: "SKU-1",
  barcode: "1",
  category: "General",
  price: 100,
  cost: 90,
  stockByStore: { store: 10 },
  reorderLevel: 2,
  taxRate: 0.1,
};

const line = (patch: Partial<CartLine> = {}): CartLine => ({
  productId: "p1",
  name: "Item",
  price: 100,
  qty: 1,
  taxRate: 0.1,
  discount: 0,
  cost: 40,
  ...patch,
});

const sale = (patch: Partial<Sale> = {}): Sale => ({
  id: "s1",
  receiptNo: "R-1",
  storeId: "store",
  shiftId: "shift",
  lines: [line()],
  subtotal: 100,
  discount: 0,
  tax: 10,
  total: 110,
  paid: 110,
  change: 0,
  method: "cash",
  memberId: null,
  pointsEarned: 0,
  cashier: "Cashier",
  createdAt: "2026-01-01T10:00:00.000Z",
  ...patch,
});

describe("financial reporting authority", () => {
  it("indexes the catalogue once for a large batch while preserving legacy cost and first-match metadata", () => {
    let reads = 0;
    const products = Array.from({ length: 2000 }, (_, index) => ({
      ...product,
      get id() { reads++; return `p${index}`; },
    }));
    products.push({ ...product, id: "p1999", cost: 999, sku: "duplicate" });
    const lines = Array.from({ length: 1000 }, () => line({ productId: "p1999", cost: undefined }));
    const bill = sale({ lines });
    const rows = soldLines([bill], products);
    expect(rows).toHaveLength(1000);
    expect(rows.every(row => row.cost === 90 && row.sku === "SKU-1" && row.estimatedCost)).toBe(true);
    expect(reads).toBeLessThanOrEqual(6000);
    reads = 0;
    expect(profitOf([bill], products).cogs).toBe(90000);
    expect(reads).toBeLessThanOrEqual(6000);
    reads = 0;
    expect(hourlyProfit([bill], products, () => 10)[10].cogs).toBe(90000);
    expect(reads).toBeLessThanOrEqual(6000);
    // No index survives a calculation: new product costs are seen on the next read.
    products[1999].cost = 80;
    expect(profitOf([bill], products).cogs).toBe(80000);
  });

  it("retains captured zero costs, missing products and returns in indexed reports", () => {
    const bill = sale({ lines: [line({ cost: 0 }), line({ cost: undefined, qty: -2 }),
      line({ productId: "missing", cost: undefined })] });
    expect(soldLines([bill], [product]).map(row => row.cost)).toEqual([0, -180, 0]);
    expect(profitOf([bill], [product]).cogs).toBe(-180);
  });

  it("uses the stored cost snapshot even when it is zero", () => {
    expect(lineCost(line({ cost: 0 }), [product])).toBe(0);
    expect(lineCost(line({ cost: undefined }), [product])).toBe(90);
  });

  it("subtracts bill discounts before calculating profit", () => {
    const discounted = sale({ discount: 20, total: 88, tax: 8 });
    expect(saleNetRevenue(discounted)).toBe(80);
    expect(profitOf([discounted], [product])).toEqual({
      revenue: 80,
      cogs: 40,
      profit: 40,
      marginPct: 50,
    });
  });

  it("applies a line coupon exactly once before a second percentage discount", () => {
    const discountedLine = line({ qty: 2, couponDiscount: 20, discount: 10, discountType: "percent" });
    // 200 - 20 coupon, then 10% of the remaining 180.
    expect(lineRevenue(discountedLine)).toBe(162);
  });

  it("removes inclusive tax and cash rounding from revenue", () => {
    const inclusive = sale({ subtotal: 110, tax: 10, total: 109.95, roundingAdjustment: -0.05 });
    expect(saleNetRevenue(inclusive)).toBe(100);
    expect(saleLineRevenues(inclusive)).toEqual([100]);
  });

  it("allocates a bill discount and tax to lines without losing cents", () => {
    const multi = sale({
      lines: [line({ productId: "p1", price: 33.33 }), line({ productId: "p2", price: 66.67, cost: 20 })],
      subtotal: 100,
      discount: 10,
      tax: 9,
      total: 99,
    });
    expect(saleLineRevenues(multi)).toEqual([30, 60]);
    const rows = soldLines([multi], [product]);
    expect(rows.reduce((sum, row) => sum + row.revenue, 0)).toBe(90);
    expect(rows.reduce((sum, row) => sum + row.tax, 0)).toBe(9);
    expect(sumLines(rows).profit).toBe(30);
  });

  it("nets exchange returns and ignores fully refunded bills", () => {
    const exchange = sale({
      lines: [line(), line({ productId: "old", price: 40, qty: -1, credit: true, cost: 15 })],
      subtotal: 60,
      tax: 0,
      total: 60,
    });
    expect(profitOf([exchange], [product])).toMatchObject({ revenue: 60, cogs: 25, profit: 35 });
    expect(profitOf([{ ...exchange, refunded: true }], [product])).toMatchObject({ revenue: 0, cogs: 0, profit: 0 });
  });
});
