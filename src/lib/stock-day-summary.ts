import { stockReportDay } from '../../electron/shared/stock-report-day.mjs';
import {
  calculateStockAsOf, canonicalStockInstant, stockInstant,
  type StockAsOfInput, type StockAsOfResult, type StockPair,
} from './stock-as-of';

export type StockDaySummaryResult = Omit<StockAsOfResult, 'rows'> & {
  period: { start: string; endExclusive: string; through: string; fullDay: boolean };
  rows: Array<StockAsOfResult['rows'][number] & {
    openingQuantity: string | null;
    inQuantity: string | null;
    outQuantity: string | null;
  }>;
};

function invalid(code = 'STOCK_DAY_INVALID'): never {
  throw Object.assign(new Error('The daily stock report cannot be calculated from this evidence.'), { code });
}
function localDate(instant: string, timeZone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone, calendar: 'gregory', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit', era: 'short',
    }).formatToParts(new Date(instant));
  } catch { invalid(); }
  const part = (name: string) => parts.find(value => value.type === name)?.value ?? '';
  if (part('era') !== 'AD') invalid();
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}
const identity = (value: string) => /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value) ? value.toLowerCase() : value;
const pairKey = (pair: StockPair) => JSON.stringify([identity(pair.productId), identity(pair.locationId)]);
function bounded(value: bigint): string {
  const result = String(value);
  if (result.replace('-', '').length > 38) invalid('STOCK_HISTORY_OVERSIZED');
  return result;
}

/** Pure calculation over ONE authorized, complete snapshot. input.cutoff keeps
 * its existing exact inclusive meaning; no current stock or second read is used.
 * Pair membership/birth/opening and coverage evidence belong to the loader.
 * Existing stock quantities are integers; every published quantity stays exact
 * text, and unavailable evidence never becomes an apparent zero balance. */
export function calculateStockDaySummary(input: StockAsOfInput, periodStart: string): StockDaySummaryResult {
  const start = canonicalStockInstant(periodStart);
  const day = stockReportDay(localDate(start, input.timeZone), input.timeZone);
  if (day.start !== start) invalid();
  const endExclusive = day.endExclusive;
  const startTicks = stockInstant(start), endTicks = stockInstant(endExclusive);
  const cutoff = stockInstant(input.cutoff), endInclusive = endTicks - 1n;
  if (cutoff < startTicks || cutoff >= endTicks) invalid();
  const result = calculateStockAsOf(input);
  const reasons = new Set(result.reasons);
  if (stockInstant(input.baseline.at) >= startTicks) reasons.add('BEFORE_BASELINE');
  const status = reasons.has('BEFORE_BASELINE') || reasons.has('FUTURE_CUTOFF')
    ? 'unsupported' : reasons.size ? 'incomplete' : 'complete';
  const totals = new Map<string, { incoming: bigint; outgoing: bigint }>();
  if (status === 'complete') {
    const seen = new Set<string>();
    for (const movement of input.movements) {
      const id = identity(movement.movementId);
      if (seen.has(id)) continue; // The existing kernel already checked exact replay/conflict.
      seen.add(id);
      const effective = stockInstant(movement.effectiveAt);
      if (effective < startTicks || effective > cutoff) continue;
      const key = pairKey(movement), total = totals.get(key) ?? { incoming: 0n, outgoing: 0n };
      const delta = BigInt(movement.quantityDelta);
      if (delta > 0n) total.incoming += delta;
      else total.outgoing -= delta;
      totals.set(key, total);
    }
  }
  return {
    ...result, status, reasons: [...reasons],
    period: { start, endExclusive, through: input.cutoff, fullDay: cutoff === endInclusive },
    rows: result.rows.map(row => {
      if (status !== 'complete') return {
        ...row, quantity: null, negative: null, openingQuantity: null, inQuantity: null, outQuantity: null,
      };
      const total = totals.get(pairKey(row)) ?? { incoming: 0n, outgoing: 0n };
      return {
        ...row, openingQuantity: bounded(BigInt(row.quantity!) - total.incoming + total.outgoing),
        inQuantity: bounded(total.incoming), outQuantity: bounded(total.outgoing),
      };
    }),
  };
}
