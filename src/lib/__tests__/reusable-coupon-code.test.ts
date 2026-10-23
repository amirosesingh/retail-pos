import { describe, expect, it } from "vitest";
import type { CartLine, Promotion } from "@/core/types/pos-types";
import type { CartCoupon } from "@/lib/register/use-cart";
import { projectReusableCoupon, validateReusableCode, reusableCodeAllowsCluster } from "../reusable-coupon-code";

const rule: Promotion = { id: "promo", name: "CLUB-10", type: "code", active: true, value: 10, valueType: "percent", codeScope: "bill" };
const line: CartLine = { productId: "p", name: "Racket", price: 100, qty: 2, taxRate: 0, discount: 0 };
const coupon: CartCoupon = { code: rule.name, promoId: rule.id, scope: "bill", discount: 0, reusable: true, appliedAt: "2026-10-23T00:00:00Z" };
const now = new Date("2026-10-23T04:00:00Z");
describe("reusable campaign codes", () => {
  it("allows global codes and rejects mismatched or unknown clusters", () => {
    expect(reusableCodeAllowsCluster(rule)).toBe(true);
    const scoped = { ...rule, codeClusterId: "sports" };
    expect(reusableCodeAllowsCluster(scoped, "sports")).toBe(true);
    expect(reusableCodeAllowsCluster(scoped, "other")).toBe(false);
    expect(projectReusableCoupon([line], coupon, [scoped], now).coupon).toBeNull();
    expect(projectReusableCoupon([line], coupon, [scoped], now, "sports").coupon?.discount).toBe(20);
  });
  it("recalculates whole bill discounts when quantity changes", () => {
    expect(projectReusableCoupon([line], coupon, [rule], now).coupon?.discount).toBe(20);
    expect(projectReusableCoupon([{ ...line, qty: 3 }], coupon, [rule], now).coupon?.discount).toBe(30);
  });
  it("applies fixed per-unit discounts to eligible items only", () => {
    const result = projectReusableCoupon([line, { ...line, productId: "return", qty: -1, credit: true }, { ...line, productId: "gift", foc: true }], coupon, [{ ...rule, codeScope: "item", valueType: "amount", value: 15 }], now);
    expect(result.coupon?.scope).toBe("item");
    expect(result.coupon?.discount).toBe(30);
    expect(result.lines.map((l) => l.couponDiscount)).toEqual([30, undefined, undefined]);
  });
  it("removes stale line discounts when the code is disabled", () => {
    const result = projectReusableCoupon([{ ...line, couponCode: rule.name, couponDiscount: 20 }], coupon, [{ ...rule, active: false }], now);
    expect(result.coupon).toBeNull();
    expect(result.lines[0].couponDiscount).toBeUndefined();
  });
  it("rejects expired rules and clamps fixed discounts", () => {
    expect(projectReusableCoupon([line], coupon, [{ ...rule, endDate: "2026-10-22" }], now).coupon).toBeNull();
    expect(projectReusableCoupon([line], coupon, [{ ...rule, value: 500, valueType: "amount" }], now).coupon?.discount).toBe(200);
  });
  it("does not change legacy voucher calculations or automatically apply codes", () => {
    const lines = [line];
    const legacy = { ...coupon, reusable: false };
    expect(projectReusableCoupon(lines, legacy, [rule], now)).toEqual({ lines, coupon: legacy });
    expect(projectReusableCoupon(lines, null, [rule], now).coupon).toBeNull();
  });
  it("rejects duplicate codes and invalid percentage values", () => {
    expect(validateReusableCode({ ...rule, id: "other", name: "club-10" }, [rule])).toContain("already used");
    expect(validateReusableCode({ ...rule, value: 101 }, [])).toContain("100%");
    expect(validateReusableCode(rule, [])).toBeNull();
  });
});
