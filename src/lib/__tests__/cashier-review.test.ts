import { describe, expect, it } from "vitest";
import { cashierReviewTotals, hasSplitPayments } from "../cashier-review";
const sale = {cashier: "Cashier", subtotal: 100, discount: 20, total: 80, refunded: false};
describe("cashier review discount basis", () => {
  it("reports twenty dollars off one hundred as 20 percent, not 25", () => {
    expect(cashierReviewTotals([sale], [])[0]).toMatchObject({bills: 1, original: 100, discount: 20, revenue: 80, discountPct: 20});
  });
  it("keeps refunded bills and their discounts outside completed sale totals", () => {
    expect(cashierReviewTotals([sale, {...sale, refunded: true}], [])[0]).toMatchObject({bills: 1, original: 100, discount: 20, revenue: 80, discountPct: 20, refunds: 1, refundValue: 80});
  });
  it("uses weighted original totals rather than averaging bill rates", () => {
    expect(cashierReviewTotals([sale, {...sale, subtotal: 900, discount: 0, total: 900}], [])[0].discountPct).toBe(2);
  });
  it("does not let tax or rounding change the discount rate", () => {
    expect(cashierReviewTotals([{...sale, total: 84.05}], [])[0].discountPct).toBe(20);
  });
  it("handles free bills, refund-only staff and drawer-only staff", () => {
    expect(cashierReviewTotals([{...sale, discount: 100, total: 0}], [])[0].discountPct).toBe(100);
    const rows = cashierReviewTotals([{...sale, refunded: true, total: -80}], [{staffName: "Supervisor"}]);
    expect(rows[0]).toMatchObject({bills: 0, discount: 0, discountPct: 0, refunds: 1, refundValue: 80});
    expect(rows[1]).toMatchObject({name: "Supervisor", noSale: 1, discountPct: 0});
  });
  it("preserves captured bill values including exchange credits", () => {
    expect(cashierReviewTotals([{...sale, subtotal: 0, discount: 0, total: 0}], [])[0].discountPct).toBe(0);
  });
});

describe("dashboard split-payment classification", () => {
  const card = {id:"card",method:"card",amount:100,bankName:"Card machine"};
  const cash = {id:"cash",method:"cash",amount:50};
  it("excludes a full card payment even when its bank is recorded", () => {
    expect(hasSplitPayments([card])).toBe(false);
  });
  it("excludes ordinary full cash and transfer payments", () => {
    expect(hasSplitPayments([cash])).toBe(false);
    expect(hasSplitPayments([{...card,method:"bank_transfer"}])).toBe(false);
  });
  it("includes cash plus card and three-part payments", () => {
    expect(hasSplitPayments([cash,{...card,amount:50}])).toBe(true);
    expect(hasSplitPayments([cash,{...card,amount:25},{id:"wallet",method:"wallet",amount:25}])).toBe(true);
  });
  it("keeps two separate card payments as a genuine split", () => {
    expect(hasSplitPayments([{...card,amount:50},{...card,id:"card2",bankName:"Another card",amount:50}])).toBe(true);
  });
  it("ignores unpaid placeholders and invalid legacy amounts", () => {
    expect(hasSplitPayments([card,{...cash,amount:0}])).toBe(false);
    expect(hasSplitPayments([card,{...cash,amount:Number.NaN}])).toBe(false);
    expect(hasSplitPayments(undefined)).toBe(false);
  });
});
