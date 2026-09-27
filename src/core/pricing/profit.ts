/**
 * One place for gross profit, so the dashboard and the business report can
 * never drift apart.
 *
 * The wholesale cost is the product's cost price. A line captures that cost at
 * the moment it is sold, so historic bills keep their true margin even after
 * the buying price changes. Exchange credits (negative quantity) subtract from
 * both takings and cost; free-of-charge lines earn nothing but still cost.
 */
import type { CartLine, Product, Sale } from "@/core/types/pos-types";
import { lineDiscountTotal, r2 } from "@/core/types/pos-types";

export type ProfitTotals = {
  /** Takings excluding tax. */
  revenue: number;
  /** Cost of goods sold. */
  cogs: number;
  /** revenue − cogs */
  profit: number;
  /** profit as a percentage of revenue */
  marginPct: number;
};

/** Wholesale cost for one line: the captured cost, else today's cost price. */
export function lineCost(line: CartLine, products: Product[] = []): number {
  const captured = typeof line.cost === "number" ? line.cost : undefined;
  const unit = captured ?? products.find((p) => p.id === line.productId)?.cost ?? 0;
  return r2(unit * line.qty);
}

/** Net selling value of one line, after its own discounts, before tax. */
export function lineRevenue(line: CartLine): number {
  if (line.foc) return 0;
  const gross = Math.abs(line.price * line.qty);
  const net = r2(gross - lineDiscountTotal(line));
  return line.qty < 0 ? -net : net;
}

/** Authoritative bill revenue after every discount and excluding tax/rounding. */
export function saleNetRevenue(sale: Sale): number {
  return r2(sale.total - sale.tax - (sale.roundingAdjustment ?? 0));
}

const allocate = (weights: number[], target: number): number[] => {
  const weightTotal = r2(weights.reduce((sum, value) => sum + value, 0));
  if (!weights.length) return [];
  if (!weightTotal) return weights.map(() => 0);
  const last = weights.reduce((found, value, index) => (value ? index : found), weights.length - 1);
  let assigned = 0;
  return weights.map((value, index) => {
    const valueAtLine = index === last ? r2(target - assigned) : r2((target * value) / weightTotal);
    assigned = r2(assigned + valueAtLine);
    return valueAtLine;
  });
};

const saleUsesInclusiveTax = (sale: Sale) => {
  if (!sale.tax) return false;
  const discountedTicket = r2(sale.subtotal - sale.discount);
  const settled = r2(sale.total - (sale.roundingAdjustment ?? 0));
  return Math.abs(settled - discountedTicket) <= 0.02;
};

/** Allocate the stored tax total using each line's taxable weight. */
export function saleLineTaxes(sale: Sale): number[] {
  const raw = sale.lines.map(lineRevenue);
  const discounted = allocate(raw, r2(sale.subtotal - sale.discount));
  return allocate(
    discounted.map((value, index) => value * Math.max(0, sale.lines[index]?.taxRate ?? 0)),
    sale.tax,
  );
}

/**
 * Allocate the stored bill revenue back to its lines. This is what reports use:
 * it includes bill-level discounts, coupons and inclusive tax while preserving
 * the exact stored total down to the final cent.
 */
export function saleLineRevenues(sale: Sale): number[] {
  const raw = sale.lines.map(lineRevenue);
  if (!raw.length) return [];
  const discounted = allocate(raw, r2(sale.subtotal - sale.discount));
  if (!saleUsesInclusiveTax(sale)) return discounted;
  const taxes = saleLineTaxes(sale);
  return discounted.map((value, index) => r2(value - (taxes[index] ?? 0)));
}

/** Gross profit of one line: (selling price − wholesale cost) × quantity. */
export function lineProfit(line: CartLine, products: Product[] = []): number {
  return r2(lineRevenue(line) - lineCost(line, products));
}

/** Roll a set of bills up into revenue, COGS, profit and margin. */
export function profitOf(sales: Sale[], products: Product[] = []): ProfitTotals {
  let revenue = 0;
  let cogs = 0;
  for (const sale of sales) {
    if (sale.refunded) continue;
    revenue += saleNetRevenue(sale);
    for (const line of sale.lines) cogs += lineCost(line, products);
  }
  revenue = r2(revenue);
  cogs = r2(cogs);
  const profit = r2(revenue - cogs);
  return { revenue, cogs, profit, marginPct: revenue > 0 ? (profit / revenue) * 100 : 0 };
}

export type HourlyProfit = { hour: string; revenue: number; cogs: number; profit: number };

/** Revenue and profit per hour of the day, for the trading-pattern chart. */
export function hourlyProfit(
  sales: Sale[],
  products: Product[] = [],
  hourOf: (value: string) => number = (value) => new Date(value).getHours(),
): HourlyProfit[] {
  const hours: HourlyProfit[] = Array.from({ length: 24 }, (_, h) => ({
    hour: `${h}:00`,
    revenue: 0,
    cogs: 0,
    profit: 0,
  }));
  for (const sale of sales) {
    if (sale.refunded) continue;
    const bucket = hours[hourOf(sale.createdAt)];
    if (!bucket) continue;
    bucket.revenue += saleNetRevenue(sale);
    for (const line of sale.lines) bucket.cogs += lineCost(line, products);
  }
  return hours.map((h) => ({
    hour: h.hour,
    revenue: r2(h.revenue),
    cogs: r2(h.cogs),
    profit: r2(h.revenue - h.cogs),
  }));
}
