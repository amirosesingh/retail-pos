import { describe, expect, it } from "vitest";
import { blankCampaign } from "@/lib/coupons";
import { validateCouponCampaign } from "@/lib/coupon-campaign-validation";

describe("coupon campaign editor validation", () => {
  const valid = () => ({ ...blankCampaign(), name: "October sale", slug: "october-sale" });

  it("accepts a valid whole-bill campaign", () => {
    expect(validateCouponCampaign(valid())).toBeNull();
  });

  it("rejects values that cannot represent a valid discount", () => {
    expect(validateCouponCampaign({ ...valid(), discountValue: 0 })).toMatch(/greater than zero/);
    expect(validateCouponCampaign({ ...valid(), discountValue: 101 })).toMatch(/100%/);
    expect(validateCouponCampaign({ ...valid(), discountValue: Number.NaN })).toMatch(/greater than zero/);
  });

  it("requires a target for product campaigns and a coherent time window", () => {
    expect(validateCouponCampaign({ ...valid(), scope: "PRODUCT", scopeValue: null })).toMatch(/product/);
    expect(validateCouponCampaign({ ...valid(), startsAt: "2026-10-24T00:00:00Z", expiresAt: "2026-10-23T00:00:00Z" })).toMatch(/expiry/);
  });
});
