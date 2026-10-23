import { lineDiscountTotal, r2, type CartLine, type Promotion } from "@/core/types/pos-types";
import { isLive } from "@/lib/pos-promotions";
import type { CartCoupon } from "@/lib/register/use-cart";

export const normalizeCampaignCode = (value: string) => value.trim().toUpperCase();

/** Codes are deliberately short enough to read aloud or type at the till. */
export function generateCampaignCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return `LC-${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")}`;
}

export function validateReusableCode(rule: Promotion, existing: Promotion[]): string | null {
  const code = normalizeCampaignCode(rule.name);
  if (!/^[A-Z0-9][A-Z0-9-]{3,30}[A-Z0-9]$/.test(code)) {
    return "Use 5–32 letters, numbers or hyphens for the code.";
  }
  if (existing.some((item) => item.id !== rule.id && normalizeCampaignCode(item.name) === code)) {
    return "That code is already used by another promotion.";
  }
  if (!Number.isFinite(rule.value) || (rule.value ?? 0) <= 0) {
    return "Enter a discount greater than zero.";
  }
  if (rule.valueType === "percent" && (rule.value ?? 0) > 100) {
    return "A percentage discount cannot exceed 100%.";
  }
  if (rule.valueType !== "percent" && rule.valueType !== "amount") return "Choose a discount type.";
  if (rule.codeScope !== "bill" && rule.codeScope !== "item") return "Choose whole bill or per item.";
  if (rule.startDate && rule.endDate && rule.endDate < rule.startDate) {
    return "End date must be on or after the start date.";
  }
  return null;
}

export const reusableCodeScopeLabel = (scope?: "bill" | "item") =>
  scope === "item" ? "Per item" : "Whole bill";

export const reusableCodeAllowsCluster = (rule: Promotion, clusterId?: string | null) =>
  !rule.codeClusterId || rule.codeClusterId === clusterId;

export function clearCouponLines(lines: CartLine[], code?: string): CartLine[] {
  return lines.map((line) => line.couponCode && (!code || line.couponCode === code)
    ? { ...line, couponCode: undefined, couponDiscount: undefined }
    : line);
}

/** A synchronous projection keeps display, checkout and quantity changes in step.
 * Per-item fixed discounts apply per unit; free gifts, returns and credits are excluded.
 * Existing voucher and legacy coupon calculations are left to their existing path.
 */
export function projectReusableCoupon(
  lines: CartLine[], coupon: CartCoupon | null, promotions: Promotion[], now = new Date(), clusterId?: string | null,
): { lines: CartLine[]; coupon: CartCoupon | null } {
  if (!coupon?.reusable) return { lines, coupon };
  const clean = clearCouponLines(lines, coupon.code);
  const rule = promotions.find((p) => p.id === coupon.promoId && p.type === "code");
  if (!rule || !reusableCodeAllowsCluster(rule, clusterId) || !isLive(rule, now) || validateReusableCode({ ...rule, codeScope: rule.codeScope ?? "bill" }, [])) {
    return { lines: clean, coupon: null };
  }
  const scope = rule.codeScope ?? "bill";
  const eligible = (line: CartLine) => !line.credit && !line.foc && line.qty > 0 && line.price > 0;
  let discount = 0;
  const nextLines = scope === "item" ? clean.map((line) => {
    if (!eligible(line)) return line;
    const gross = r2(line.price * line.qty);
    const value = Math.min(gross, r2(rule.valueType === "percent"
      ? gross * rule.value! / 100 : rule.value! * line.qty));
    discount = r2(discount + value);
    return { ...line, couponCode: rule.name, couponDiscount: value };
  }) : clean;
  if (scope === "bill") {
    const base = r2(clean.filter(eligible).reduce((sum, line) =>
      sum + Math.max(0, line.price * line.qty - lineDiscountTotal(line)), 0));
    discount = Math.min(base, r2(rule.valueType === "percent" ? base * rule.value! / 100 : rule.value!));
  }
  return {
    lines: nextLines,
    coupon: { ...coupon, code: rule.name, scope, discount, productId: undefined, productName: undefined },
  };
}

export function findReusableCode(promotions: Promotion[], input: string, now = new Date()) {
  const code = normalizeCampaignCode(input);
  return promotions.find(
    (rule) => rule.type === "code" && normalizeCampaignCode(rule.name) === code && isLive(rule, now),
  ) ?? null;
}
