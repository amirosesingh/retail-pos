import { describe, expect, it } from "vitest";
import { fromCouponLocalInput, toCouponLocalInput } from "@/lib/coupon-date-input";

describe("coupon campaign schedule editor", () => {
  it("round-trips an existing stored time when the user saves without changing it", () => {
    const saved = "2026-10-23T09:12:00.000Z";
    expect(fromCouponLocalInput(toCouponLocalInput(saved))).toBe(saved);
  });

  it("preserves empty optional dates", () => {
    expect(toCouponLocalInput(null)).toBe("");
    expect(fromCouponLocalInput("")).toBeNull();
  });
});
