/**
 * Total rounding.
 *
 * Applies ONLY to the final bill total, after subtotal → discounts/coupons →
 * tax. Line items and tax are never touched: `cartTotals()` stays the single
 * calculation path and this runs on the number it produces.
 */
import type { Payment, PaymentMethod, RoundingSettings } from "@/core/types/pos-types";

export const ROUNDING_UNITS = [1, 0.5, 0.1, 0.05, 0.01] as const;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export type RoundingResult = {
  /** The total the customer actually pays. */
  total: number;
  /** rounded − original: negative for round-down, positive for round-up. */
  adjustment: number;
};

/**
 * Round a total to the nearest `unit`, or always up / always down.
 * For a negative total (refund) "up"/"down" follow the number line, so a
 * refund rounded down gives the customer slightly more back.
 */
export function roundTotal(
  total: number,
  unit: number,
  direction: RoundingSettings["direction"],
): RoundingResult {
  if (!unit || unit <= 0 || !Number.isFinite(total)) return { total: r2(total), adjustment: 0 };
  const steps = total / unit;
  const stepped =
    direction === "up" ? Math.ceil(r4(steps)) : direction === "down" ? Math.floor(r4(steps)) : Math.round(r4(steps));
  const rounded = r2(stepped * unit);
  return { total: rounded, adjustment: r2(rounded - r2(total)) };
}

/** Defaults + coercion for the stored settings block. */
export function roundingOf(raw: Partial<RoundingSettings> | undefined): RoundingSettings {
  return {
    enabled: !!raw?.enabled,
    unit: Number(raw?.unit) > 0 ? Number(raw?.unit) : 0.05,
    direction: raw?.direction === "up" || raw?.direction === "down" ? raw.direction : "nearest",
    appliesTo: raw?.appliesTo === "cash" ? "cash" : "all",
    showOnReceipt: raw?.showOnReceipt ?? true,
    receiptLabel: (raw?.receiptLabel ?? "").trim() || "Extra Discount",
  };
}

/**
 * Rounding for one ticket: honours the on/off switch and the cash-only rule.
 * `method` is the tender the bill is being settled with (headline tender on a
 * split payment).
 */
export function applyRounding(
  total: number,
  raw: Partial<RoundingSettings> | undefined,
  method: PaymentMethod | null | undefined,
): RoundingResult {
  const cfg = roundingOf(raw);
  if (!cfg.enabled) return { total: r2(total), adjustment: 0 };
  if (cfg.appliesTo === "cash" && method !== "cash") return { total: r2(total), adjustment: 0 };
  return roundTotal(total, cfg.unit, cfg.direction);
}

/**
 * The customer only ever sees a rounding line when they paid LESS: a round-up
 * still applies silently.
 */
export function showsRoundingLine(
  adjustment: number | undefined,
  raw: Partial<RoundingSettings> | undefined,
): boolean {
  return !!roundingOf(raw).showOnReceipt && (adjustment ?? 0) < 0;
}

/** Split checkout uses the largest tender as its headline payment method. */
export function roundingPaymentMethod(method: PaymentMethod, tenders: Payment[]): PaymentMethod {
  return tenders.length
    ? tenders.reduce((largest, tender) => tender.amount > largest.amount ? tender : largest, tenders[0]!).method
    : method;
}
