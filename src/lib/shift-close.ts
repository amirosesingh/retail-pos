import { sameRecordId } from "./sale-identity";
/**
 * Shared maths and visibility rules for the shift-close (Z report) screen.
 *
 * Every close dialog — register header and Shifts page — reads this one
 * module so the closing screen behaves identically wherever it is opened.
 * The opening float always comes from the shift record: it is never typed in
 * again at close time.
 */
import type { PosRules } from "./pos-rules";
import type { Sale, Shift } from "@/core/types/pos-types";

export type TenderTotal = { method: string; label: string; count: number; value: number };

const TENDERS: { method: string; label: string }[] = [
  { method: "cash", label: "Cash" },
  { method: "card", label: "Card" },
  { method: "wallet", label: "Mobile / wallet" },
  { method: "points", label: "Points / vouchers" },
];

/** Sales that belong to this shift and were not refunded. */
export function shiftSalesOf(shift: Shift | null, sales: Sale[]): Sale[] {
  if (!shift) return [];
  return sales.filter((s) => sameRecordId(s.shiftId, shift.id) && !s.refunded);
}

/** Tender rows may be net single payments or gross split payments. Only
 * excess over the bill is change, and it comes out of cash, never cards. */
export function saleTenderAmounts(sale: Sale): Record<string, number> {
  if (!sale.payments?.length) return { [sale.method.toLowerCase()]: sale.total };
  const amounts: Record<string, number> = {};
  for (const payment of sale.payments) {
    const method = payment.method.toLowerCase();
    amounts[method] = (amounts[method] ?? 0) + payment.amount;
  }
  const paid = Object.values(amounts).reduce((sum, amount) => sum + amount, 0);
  if ((amounts.cash ?? 0) > 0) amounts.cash = Math.max(0, amounts.cash - Math.max(0, paid - sale.total));
  return Object.fromEntries(Object.entries(amounts).map(([method, amount]) => [method, Number(amount.toFixed(2))]));
}

export function tenderTotals(shift: Shift | null, sales: Sale[]): TenderTotal[] {
  const amounts = shiftSalesOf(shift, sales).map(saleTenderAmounts);
  const codes = new Set([...TENDERS.map(t => t.method), ...amounts.flatMap(row => Object.keys(row))]);
  return [...codes].map(method => ({method, label: TENDERS.find(t => t.method === method)?.label ?? method.replace(/_/g, " "),
    count: amounts.filter(row => (row[method] ?? 0) !== 0).length,
    value: Number(amounts.reduce((sum, row) => sum + (row[method] ?? 0), 0).toFixed(2)),
  }));
}

/** Opening float plus net CASH sales in this shift; card/wallet excluded. */
export function expectedDrawer(shift: Shift | null, sales: Sale[]): number {
  return expectedFor(shift, sales, "cash");
}

/** Net cash taken, derived from what the cashier counted. */
export function derivedCashSales(counted: number, openingFloat: number): number {
  return counted - openingFloat;
}

export type CloseScreenView = {
  openingFloat: number;
  showFloat: boolean;
  showExpected: boolean;
  showVariance: boolean;
  showTenders: boolean;
  expected: number;
  tenders: TenderTotal[];
};

/**
 * What the closing screen is allowed to show. A blind cash count always wins
 * over the display toggles — the counter must not see the target figure.
 */
export function closeScreenView(
  rules: PosRules,
  shift: Shift | null,
  sales: Sale[],
): CloseScreenView {
  const blind = rules.enable_blind_cash_count;
  return {
    openingFloat: shift?.openingFloat ?? 0,
    showFloat: rules.show_opening_float_at_close,
    showExpected: rules.show_expected_totals_at_close && !blind,
    showVariance: rules.show_live_variance_at_close && !blind,
    showTenders: rules.show_itemized_tender_breakdown && !blind,
    expected: expectedDrawer(shift, sales),
    tenders: tenderTotals(shift, sales),
  };
}

/** True when the shortage/overage is large enough to need a manager. */
export function varianceNeedsPin(rules: PosRules, variance: number): boolean {
  if (!rules.require_manager_pin_on_variance) return false;
  const limit = Math.abs(Number(rules.variance_pin_threshold) || 0);
  return Math.abs(variance) > limit;
}

export type VarianceOutcome = {
  /** counted − expected, to the cent. Negative is short, positive is over. */
  variance: number;
  status: "NO_VARIANCE" | "OVER" | "SHORT";
  /** The shift always finishes closing, whatever was counted. */
  closes: true;
  /** Any non-zero difference raises one admin notification. No threshold. */
  notifies: boolean;
};

/**
 * What happens when a drawer is counted. This mirrors the database routine
 * `shift_reconcile_now`: the counted amount is final, the shift closes either
 * way, and any difference at all is reported to the admins.
 */
export function varianceOutcome(expected: number, counted: number): VarianceOutcome {
  const variance = Number((counted - expected).toFixed(2));
  const status =
    Math.abs(variance) <= 0.005 ? "NO_VARIANCE" : variance > 0 ? "OVER" : "SHORT";
  return { variance, status, closes: true, notifies: status !== "NO_VARIANCE" };
}

/** The stable identity of a shift's cash-variance notification. */
export function varianceEventId(shiftId: string): string {
  return `shift:${shiftId}:cash_variance`;
}

/* ------------------------ blind reconciliation ------------------------ */

/** Payment codes that roll up into each counted box on the closing screen. */
const TENDER_GROUPS = {
  cash: ["cash"],
  card: ["card"],
  digital: ["wallet", "bank_transfer", "transfer", "qr", "online", "ewallet"],
} as const;

export type TenderKey = keyof typeof TENDER_GROUPS;

/** Net sales taken this shift on one tender group. */
export function tenderSales(shift: Shift | null, sales: Sale[], tender: TenderKey): number {
  const codes = TENDER_GROUPS[tender] as readonly string[];
  return Number(shiftSalesOf(shift, sales).reduce((sum, sale) => {
    const amounts = saleTenderAmounts(sale);
    return sum + codes.reduce((value, code) => value + (amounts[code] ?? 0), 0);
  }, 0).toFixed(2));
}

/** What each tender should hold: cash carries the opening float, the rest do not. */
export function expectedFor(shift: Shift | null, sales: Sale[], tender: TenderKey): number {
  const base = tenderSales(shift, sales, tender);
  return Number((tender === "cash" ? (shift?.openingFloat ?? 0) + base : base).toFixed(2));
}

/** What the cashier typed in. A blank card / digital box means "not counted". */
export type CountedTotals = {
  cash: number;
  card: number | null;
  digital: number | null;
};

export type TenderVariance = {
  tender: TenderKey;
  label: string;
  counted: number | null;
  expected: number;
  /** counted − expected; null when the box was left blank */
  variance: number | null;
};

export type Reconciliation = {
  lines: TenderVariance[];
  /** Combined over/short across the tenders that were actually counted. */
  total: number;
};

const TENDER_LABELS: Record<TenderKey, string> = {
  cash: "Cash",
  card: "Card",
  digital: "Digital / wallet",
};

/**
 * Over/Short per tender: `Counted − (Starting float + Net shift sales)`.
 * The float only applies to cash; card and digital settle against sales only.
 */
export function reconcileShift(
  shift: Shift | null,
  sales: Sale[],
  counted: CountedTotals,
): Reconciliation {
  const lines = (Object.keys(TENDER_LABELS) as TenderKey[]).map((tender) => {
    const expected = expectedFor(shift, sales, tender);
    const typed = tender === "cash" ? counted.cash : counted[tender];
    return {
      tender,
      label: TENDER_LABELS[tender],
      counted: typed ?? null,
      expected,
      variance: typed == null ? null : Number((typed - expected).toFixed(2)),
    };
  });
  const total = lines.reduce((a, l) => a + (l.variance ?? 0), 0);
  return { lines, total: Number(total.toFixed(2)) };
}