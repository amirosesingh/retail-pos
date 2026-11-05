import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Sale } from "@/core/types/pos-types";
import { salesReconciliation } from "../sales-reconciliation";
import { SalesReconciliation } from "@/platforms/web/components/pos/SalesReconciliation";
const line = (price = 100, discount = 0) => ({ productId: "p", name: "Item", price, qty: 1, discount, taxRate: 0 });
const sale = (patch: Partial<Sale> = {}): Sale => ({ id: "one", receiptNo: "R1", storeId: "A", shiftId: "S", lines: [line()], subtotal: 100, discount: 10, tax: 9, total: 98.95, roundingAdjustment: -0.05, paid: 100, change: 1.05, method: "cash", memberId: null, pointsEarned: 0, cashier: "Cashier", createdAt: "2026-10-01T10:00:00Z", ...patch });
describe("stored sales reconciliation", () => {
  it("reconciles exclusive and inclusive tax without subtracting discounts twice", () => {
    const totals = salesReconciliation([sale(), sale({ id: "inclusive", lines: [line(110)], subtotal: 110, discount: 0, tax: 10, total: 109.95 })]);
    expect(totals).toEqual({ bills: 2, subtotal: 210, discounts: 10, itemDiscounts: 0, billDiscounts: 10, includedTax: 10, recordDifference: 0, net: 190, tax: 19, rounding: -0.1, collected: 208.9 });
    expect(totals.net + totals.tax + totals.rounding).toBeCloseTo(totals.collected, 8);
  });
  it("separates item and bill discounts from complete snapshots and keeps legacy totals when lines are missing", () => {
    const totals = salesReconciliation([sale({ lines: [line(100, 10)], discount: 15, tax: 0, total: 85, roundingAdjustment: 0 })]);
    expect(totals).toMatchObject({ subtotal: 100, itemDiscounts: 10, billDiscounts: 5, net: 85, collected: 85 });
    expect(salesReconciliation([sale({ lines: [] })])).toMatchObject({ discounts: 10, itemDiscounts: null, billDiscounts: null });
  });
  it("keeps inclusive-tax discounts on their recorded basis instead of inventing an ex-tax subtotal", () => {
    const totals = salesReconciliation([sale({ subtotal: 110, discount: 11, tax: 9, total: 99, roundingAdjustment: 0 })]);
    expect(totals).toMatchObject({ subtotal: 110, discounts: 11, includedTax: 9, net: 90, tax: 9, collected: 99 });
    expect(totals.subtotal - totals.discounts - totals.includedTax + totals.tax + totals.rounding).toBe(totals.collected);
  });
  it("uses sale identity, excludes refunded bills and retains returns in stored bill totals", () => {
    const adjustment = sale({ id: "exchange", subtotal: 60, discount: 0, tax: 0, total: 60, roundingAdjustment: 0 });
    expect(salesReconciliation([sale(), sale(), sale({ id: "refund", refunded: true }), adjustment])).toMatchObject({ bills: 2, net: 150, collected: 158.95 });
  });
  it("handles thousands of bills without losing cents", () => {
    const totals = salesReconciliation(Array.from({ length: 10000 }, (_, id) => sale({ id: String(id), subtotal: 0.1, discount: 0.01, tax: 0, total: 0.1, roundingAdjustment: 0.01 })));
    expect(totals).toMatchObject({ bills: 10000, subtotal: 1000, discounts: 100, net: 900, rounding: 100, collected: 1000 });
  });
  it("renders a vertical breakdown ending in collected; zero tax and zero sponsorship are absent", () => {
    const html = renderToStaticMarkup(createElement(SalesReconciliation, { sales: [sale({ tax: 0, total: 89.95 })] }));
    expect(html).not.toContain(">Tax<");
    expect(html).not.toContain("Sponsorship value");
    expect(html.indexOf("Subtotal")).toBeLessThan(html.indexOf("Bill discounts"));
    expect(html.indexOf("Bill discounts")).toBeLessThan(html.indexOf("Net sales"));
    expect(html.indexOf("Rounding adjustment")).toBeLessThan(html.indexOf("Total collected"));
  });
});
