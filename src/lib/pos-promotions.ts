import type { CartLine, Member, Product, Promotion } from "@/core/types/pos-types";
import { r2 } from "@/core/types/pos-types";

/** A promotion counts as live when it is active and today sits inside its window. */
export function isLive(p: Promotion, now = new Date()) {
  if (!p.active) return false;
  const today = now.toISOString().slice(0, 10);
  if (p.startDate && today < p.startDate) return false;
  if (p.endDate && today > p.endDate) return false;
  return true;
}

export const DEFAULT_POINTS_PER_DOLLAR = 1;

/** Currently enforced points policy (first live rule wins). */
export function pointsPolicy(promotions: Promotion[], now = new Date()) {
  const rule = promotions.find((p) => p.type === "points" && isLive(p, now));
  return {
    rule: rule ?? null,
    rate: rule?.pointsPerDollar ?? DEFAULT_POINTS_PER_DOLLAR,
  };
}

export function isBirthdayMonth(member: Member | null, now = new Date()) {
  if (!member?.birthday) return false;
  const month = Number(member.birthday.slice(5, 7));
  return month === now.getMonth() + 1;
}

export type AppliedPromo = { id: string; name: string; detail: string };

export type PromoEvaluation = {
  /** extra bill-level discount in currency from promotions */
  promoDiscount: number;
  applied: AppliedPromo[];
  pointsRate: number;
  /** foc rule that currently qualifies, if any */
  foc: { promo: Promotion; product: Product; qty: number } | null;
};

/**
 * Evaluate every live rule against the open ticket.
 * `base` is the subtotal after line discounts, before bill discounts and tax.
 */
export function evaluatePromotions({
  promotions,
  products,
  base,
  member,
  now = new Date(),
}: {
  promotions: Promotion[];
  products: Product[];
  base: number;
  member: Member | null;
  now?: Date;
}): PromoEvaluation {
  const applied: AppliedPromo[] = [];
  const live = promotions.filter((p) => isLive(p, now));
  let promoDiscount = 0;

  const { rule: pointsRule, rate: pointsRate } = pointsPolicy(promotions, now);
  if (pointsRule) {
    applied.push({
      id: pointsRule.id,
      name: pointsRule.name,
      detail: `${pointsRate} pt${pointsRate === 1 ? "" : "s"} per $1`,
    });
  }

  const birthday = live.find((p) => p.type === "birthday");
  if (birthday && isBirthdayMonth(member, now) && base > 0) {
    const off = r2((base * (birthday.value ?? 0)) / 100);
    if (off > 0) {
      promoDiscount += off;
      applied.push({
        id: birthday.id,
        name: birthday.name,
        detail: `${birthday.value}% birthday discount for ${member?.name}`,
      });
    }
  }

  const tierRule = live.find((p) => p.type === "tier");
  if (tierRule && member && base > 0) {
    const pct = tierRule.tierRates?.[member.tier] ?? 0;
    const off = r2((base * pct) / 100);
    if (off > 0) {
      promoDiscount += off;
      applied.push({
        id: tierRule.id,
        name: tierRule.name,
        detail: `${pct}% ${member.tier} member discount`,
      });
    }
  }

  const thresholdList = live
    .filter((p) => p.type === "threshold" && base >= (p.minBill ?? 0))
    .sort((a, b) => (b.minBill ?? 0) - (a.minBill ?? 0));
  const threshold = thresholdList[0];
  if (threshold && base > 0) {
    const off =
      threshold.valueType === "percent"
        ? r2((base * (threshold.value ?? 0)) / 100)
        : r2(threshold.value ?? 0);
    if (off > 0) {
      promoDiscount += off;
      applied.push({
        id: threshold.id,
        name: threshold.name,
        detail:
          threshold.valueType === "percent"
            ? `${threshold.value}% off bills over $${threshold.minBill ?? 0}`
            : `$${(threshold.value ?? 0).toFixed(2)} off bills over $${threshold.minBill ?? 0}`,
      });
    }
  }

  let foc: PromoEvaluation["foc"] = null;
  const focRule = live
    .filter((p) => p.type === "foc" && base >= (p.minBill ?? 0) && p.focProductId)
    .sort((a, b) => (b.minBill ?? 0) - (a.minBill ?? 0))[0];
  if (focRule) {
    const product = products.find((p) => p.id === focRule.focProductId);
    if (product) {
      const qty = Math.max(1, focRule.focQty ?? 1);
      foc = { promo: focRule, product, qty };
      applied.push({
        id: focRule.id,
        name: focRule.name,
        detail: `Free ${qty} × ${product.name} over $${focRule.minBill ?? 0}`,
      });
    }
  }

  return { promoDiscount: r2(Math.min(promoDiscount, base)), applied, pointsRate, foc };
}

/** Build the $0 promo line for a qualifying FOC rule. */
export function focLine(promo: Promotion, product: Product, qty: number): CartLine {
  return {
    productId: product.id,
    name: product.name,
    price: 0,
    qty,
    taxRate: 0,
    discount: 0,
    discountType: "amount",
    foc: true,
    promoId: promo.id,
  };
}
