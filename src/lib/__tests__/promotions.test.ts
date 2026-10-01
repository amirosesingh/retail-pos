import { describe, expect, it } from "vitest";

import type { Member, Product, Promotion } from "@/core/types/pos-types";
import { evaluatePromotions, focLine, isLive, pointsPolicy } from "@/lib/pos-promotions";

const now = new Date("2026-10-01T12:00:00.000Z");
const promotion = (patch: Partial<Promotion>): Promotion => ({
  id: patch.id ?? crypto.randomUUID(),
  name: patch.name ?? "Rule",
  type: patch.type ?? "points",
  active: patch.active ?? true,
  ...patch,
});

describe("promotions, discounts and points", () => {
  it("uses only an active point rule inside its date window", () => {
    const expired = promotion({
      id: "expired",
      type: "points",
      pointsPerDollar: 50,
      endDate: "2026-09-30",
    });
    const current = promotion({
      id: "current",
      type: "points",
      pointsPerDollar: 3,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });

    expect(isLive(expired, now)).toBe(false);
    expect(pointsPolicy([expired, current], now)).toMatchObject({ rule: current, rate: 3 });
  });

  it("applies member and highest qualifying threshold discounts without exceeding the bill", () => {
    const member = {
      id: "m1",
      name: "Nur",
      tier: "Gold",
      birthday: "1990-10-15",
    } as Member;
    const result = evaluatePromotions({
      promotions: [
        promotion({ id: "points", type: "points", pointsPerDollar: 2 }),
        promotion({ id: "birthday", type: "birthday", value: 10 }),
        promotion({
          id: "tier",
          type: "tier",
          tierRates: { Bronze: 0, Silver: 5, Gold: 15 },
        }),
        promotion({
          id: "small-threshold",
          type: "threshold",
          minBill: 50,
          value: 5,
          valueType: "amount",
        }),
        promotion({
          id: "large-threshold",
          type: "threshold",
          minBill: 100,
          value: 20,
          valueType: "percent",
        }),
      ],
      products: [],
      base: 100,
      member,
      now,
    });

    expect(result.pointsRate).toBe(2);
    expect(result.promoDiscount).toBe(45);
    expect(result.applied.map((item) => item.id)).toEqual([
      "points",
      "birthday",
      "tier",
      "large-threshold",
    ]);
  });

  it("selects the strongest qualifying FOC rule and creates a zero-price cart line", () => {
    const product = { id: "gift", name: "Gift bottle" } as Product;
    const rule = promotion({
      id: "foc-high",
      type: "foc",
      minBill: 100,
      focProductId: product.id,
      focQty: 2,
    });
    const result = evaluatePromotions({
      promotions: [
        promotion({
          id: "foc-low",
          type: "foc",
          minBill: 50,
          focProductId: product.id,
          focQty: 1,
        }),
        rule,
      ],
      products: [product],
      base: 120,
      member: null,
      now,
    });

    expect(result.foc).toMatchObject({ promo: { id: "foc-high" }, qty: 2 });
    expect(focLine(rule, product, 2)).toMatchObject({
      productId: "gift",
      price: 0,
      qty: 2,
      foc: true,
      promoId: "foc-high",
    });
  });
});
