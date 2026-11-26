import { canonicalStockInstant } from "./stock-as-of";
import { stockDateTimeInput, stockEndOfDay } from "./stock-history-selection";
import { STOCK_MOVEMENT_MAX_CALENDAR_DAYS } from "../../electron/shared/stock-report-day.mjs";
import type { StockActivityPage } from "./stock-activity-query";
import type { StockHistoryMovementPage } from "./stock-history-movements";
import type { StockHistoryPage, StockHistoryRequest, StockHistoryRow } from "./stock-history-report";

export { STOCK_MOVEMENT_MAX_CALENDAR_DAYS };
export type StockMovementDateRange = { from: string; to: string };
export type StockMovementRange = {
  opening: string;
  cutoff: string;
  aggregateRequest: StockHistoryRequest | null;
};

export function stockMovementRange(dates: StockMovementDateRange, branchId: string, timeZone: string, now = new Date()): StockMovementRange {
  const today = stockDateTimeInput(now, timeZone).slice(0, 10);
  if (!dates.from || !dates.to || dates.to < dates.from) throw new Error("Choose a valid start and end date.");
  if (dates.to > today) throw new Error("Choose an end date that has already started.");
  const { start: opening } = stockEndOfDay(dates.from, timeZone);
  const cutoff = dates.to === today ? canonicalStockInstant(now.toISOString()) : stockEndOfDay(dates.to, timeZone).cutoff;
  const withinLimit = Date.parse(dates.to) - Date.parse(dates.from) < STOCK_MOVEMENT_MAX_CALENDAR_DAYS * 86_400_000;
  return { opening, cutoff, aggregateRequest: withinLimit ? { branchId, timeZone, cutoff, periodStart: opening } : null };
}

export function movementActivityWithinRange(page: StockActivityPage | null, range: StockMovementRange | null) {
  if (!page || !range) return { rows: [], hasEarlierPage: false };
  return {
    rows: page.rows.filter(row => row.occurredAt >= range.opening && row.occurredAt <= range.cutoff),
    hasEarlierPage: Boolean(page.next && page.next.occurredAt >= range.opening),
  };
}

export function verifiedMovementSummary(page: StockHistoryPage | null, startedAfter: string | null) {
  // A keyset page is only a product subset when either cursor is present.
  if (page?.status !== "complete" || !page.period || page.next || startedAfter) return null;
  let incoming = 0n;
  let outgoing = 0n;
  for (const row of page.rows) {
    if (row.inQuantity == null || row.outQuantity == null) return null;
    incoming += BigInt(row.inQuantity);
    outgoing += BigInt(row.outQuantity);
  }
  return { incoming, outgoing };
}

export function verifiedMovementBreakdown(product: StockHistoryRow, page: StockHistoryMovementPage | null) {
  if (!page || page.status !== "complete" || !page.periodStart || page.next ||
      page.productId !== product.productId || page.branchId !== product.locationId ||
      product.inQuantity == null || product.outQuantity == null) return null;
  const figures = new Map<string, { kind: string; incoming: bigint; outgoing: bigint }>();
  let incoming = 0n;
  let outgoing = 0n;
  for (const movement of page.rows) {
    const delta = BigInt(movement.delta);
    const group = figures.get(movement.kind) ?? { kind: movement.kind, incoming: 0n, outgoing: 0n };
    if (delta > 0n) { group.incoming += delta; incoming += delta; }
    else { group.outgoing -= delta; outgoing -= delta; }
    figures.set(movement.kind, group);
  }
  return incoming === BigInt(product.inQuantity) && outgoing === BigInt(product.outQuantity) ? [...figures.values()] : null;
}

export function verifiedMovementTimeline(openingQuantity: string | null | undefined, closingQuantity: string | null,
  page: StockHistoryMovementPage | null) {
  if (!page || page.status !== "complete" || closingQuantity === null || openingQuantity == null || !page.periodStart) return null;
  let balance = BigInt(openingQuantity);
  const points = [{ label: page.periodStart, quantity: Number(balance) }];
  // Several movements can share an effective instant. The stable ID order is
  // for pagination, so chart one combined balance for those movements.
  let index = 0;
  while (index < page.rows.length) {
    const time = page.rows[index].effectiveAt;
    do { balance += BigInt(page.rows[index++].delta); } while (page.rows[index]?.effectiveAt === time);
    if (index === page.rows.length && page.next) break;
    points.push({ label: time, quantity: Number(balance) });
  }
  if (!page.next) {
    if (BigInt(closingQuantity) !== balance) return null;
    if (points.at(-1)?.label !== page.cutoff) points.push({ label: page.cutoff, quantity: Number(balance) });
  }
  return points.length > 1 && points.every(point => Number.isSafeInteger(point.quantity)) ? points : null;
}
