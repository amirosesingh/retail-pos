import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stockReportDay } from '../../../electron/shared/stock-report-day.mjs';
import { calculateStockDaySummary } from '../stock-day-summary';
import { calculateStockAsOf, stockInstant, type StockAsOfInput, type StockMovement } from '../stock-as-of';

const pair = { productId: 'product-a', locationId: 'branch-a' };
const start = '2026-11-05T16:00:00.0000000Z';
const end = '2026-11-06T16:00:00.0000000Z';
const input = (): StockAsOfInput => ({
  cutoff: '2026-11-06T08:00:00.1234567Z', timeZone: 'Asia/Brunei',
  readAt: '2026-11-07T00:00:00Z', sourceRevision: 'one-authorized-snapshot-42',
  pairs: [pair], baseline: {
    at: '2026-11-05T00:00:00Z', capturedAt: '2026-11-05T00:00:00Z',
    rows: [{ ...pair, quantity: '10' }],
  },
  coverage: { status: 'complete', from: '2026-11-05T00:00:00Z', through: '2026-11-07T00:00:00Z' },
  movements: [],
});
const movement = (values: Partial<StockMovement> = {}): StockMovement => ({
  ...pair, movementId: 'move-1', quantityDelta: '5',
  effectiveAt: '2026-11-06T01:00:00Z', recordedAt: '2026-11-06T01:00:01Z', ...values,
});
const terms = (result: ReturnType<typeof calculateStockDaySummary>) => result.rows.map(row => ({
  opening: row.openingQuantity, incoming: row.inQuantity, outgoing: row.outQuantity,
  closing: row.quantity, negative: row.negative,
}));

describe('exact business-calendar stock day boundaries', () => {
  it.each([
    ['2026-11-06', 'Asia/Brunei', '2026-11-05T16:00:00.0000000Z', '2026-11-06T16:00:00.0000000Z', 24],
    ['2026-03-08', 'America/New_York', '2026-03-08T05:00:00.0000000Z', '2026-03-09T04:00:00.0000000Z', 23],
    ['2026-11-01', 'America/New_York', '2026-11-01T04:00:00.0000000Z', '2026-11-02T05:00:00.0000000Z', 25],
    ['2026-10-04', 'Australia/Lord_Howe', '2026-10-03T13:30:00.0000000Z', '2026-10-04T13:00:00.0000000Z', 23.5],
    ['2026-04-05', 'Australia/Lord_Howe', '2026-04-04T13:00:00.0000000Z', '2026-04-05T13:30:00.0000000Z', 24.5],
    ['2018-11-04', 'America/Sao_Paulo', '2018-11-04T03:00:00.0000000Z', '2018-11-05T02:00:00.0000000Z', 23],
    ['2016-11-06', 'America/Havana', '2016-11-06T04:00:00.0000000Z', '2016-11-07T05:00:00.0000000Z', 25],
    ['1969-09-30', 'Pacific/Kwajalein', '1969-09-29T13:00:00.0000000Z', '1969-10-01T12:00:00.0000000Z', 47],
    ['1890-01-01', 'Europe/Paris', '1889-12-31T23:50:39.0000000Z', '1890-01-01T23:50:39.0000000Z', 24],
    ['2024-02-29', 'UTC', '2024-02-29T00:00:00.0000000Z', '2024-03-01T00:00:00.0000000Z', 24],
  ] as const)('resolves %s in %s without assuming a 24-hour or viewer-local day', (date, timeZone, beginning, ending, hours) => {
    const result = stockReportDay(date, timeZone);
    expect(result).toEqual({ date, timeZone, start: beginning, endExclusive: ending });
    expect(stockInstant(ending) - stockInstant(beginning)).toBe(BigInt(hours * 3600) * 10_000_000n);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    ['2011-12-30', 'Pacific/Apia'], ['1993-08-21', 'Pacific/Kwajalein'],
  ])('explicitly rejects the skipped date %s / %s', (date, zone) => {
    expect(() => stockReportDay(date!, zone!)).toThrowError(expect.objectContaining({ code: 'STOCK_DAY_SKIPPED' }));
  });
  it('rejects a noncontiguous repeated date instead of including another local date in its interval', () => {
    expect(() => stockReportDay('1867-10-18', 'America/Juneau'))
      .toThrowError(expect.objectContaining({ code: 'STOCK_DAY_NONCONTIGUOUS' }));
  });
  it.each(['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-01', '2026-11-00',
    '2026-11-06T00:00', '2026-1-1', '0000-01-01', ' 2026-11-06', '', null, 20261106])('rejects invalid calendar data %s', date => {
    expect(() => stockReportDay(date as string, 'UTC')).toThrow();
  });
  it.each(['not/a-zone', '', ' Asia/Brunei', '+08:00', null, undefined, 8])('requires an explicit valid IANA zone %s', zone => {
    expect(() => stockReportDay('2026-11-06', zone as string)).toThrow();
  });
  it('rejects boundaries outside the supported SQL instant years', () => {
    expect(() => stockReportDay('0001-01-01', 'Asia/Tokyo')).toThrow();
    expect(() => stockReportDay('9999-12-31', 'UTC')).toThrow();
  });
  it('has no runtime I/O, clock-certainty, signing or authorization capability', () => {
    const source = readFileSync('electron/shared/stock-report-day.mjs', 'utf8');
    expect(source).not.toMatch(/\b(?:import|require)\s*(?:\(|.*\bfrom\b)|Date\.now\s*\(|fetch\s*\(/);
    const day = stockReportDay('2026-11-06', 'Asia/Brunei');
    expect(day).not.toHaveProperty('complete');
    expect(day).not.toHaveProperty('allowed');
    expect(day).not.toHaveProperty('clockVerified');
  });
});

describe('one-snapshot opening + stock in - stock out = selected-time stock', () => {
  it('uses exact inclusive selected time, signed legs and prior-day changes from the same snapshot', () => {
    const request = input();
    request.movements = [
      movement({ movementId: 'before-day', quantityDelta: '3', effectiveAt: '2026-11-05T12:00:00Z', recordedAt: '2026-11-05T12:00:01Z' }),
      movement({ movementId: 'at-start', quantityDelta: '-2', effectiveAt: start, recordedAt: start }),
      movement(),
      movement({ movementId: 'at-cutoff', quantityDelta: '-4', effectiveAt: request.cutoff, recordedAt: request.cutoff }),
      movement({ movementId: 'one-tick-later', quantityDelta: '99', effectiveAt: '2026-11-06T08:00:00.1234568Z', recordedAt: '2026-11-06T08:00:00.1234568Z' }),
    ];
    const result = calculateStockDaySummary(request, start);
    expect(result).toMatchObject({ status: 'complete', sourceRevision: request.sourceRevision, readAt: request.readAt,
      cutoff: request.cutoff, period: { start, endExclusive: end, through: request.cutoff, fullDay: false } });
    expect(terms(result)).toEqual([{ opening: '13', incoming: '5', outgoing: '6', closing: '12', negative: false }]);
    expect(result.rows[0]!.quantity).toBe(calculateStockAsOf(request).rows[0]!.quantity);
  });
  it('does not clamp a future selected instant to the source clock or claim current-day completeness', () => {
    const request = input(); request.readAt = '2026-11-06T07:00:00Z'; request.coverage.through = request.readAt;
    const result = calculateStockDaySummary(request, start);
    expect(result).toMatchObject({ status: 'unsupported', cutoff: request.cutoff, period: { through: request.cutoff, fullDay: false } });
    expect(result.reasons).toContain('FUTURE_CUTOFF');
    expect(terms(result)).toEqual([{ opening: null, incoming: null, outgoing: null, closing: null, negative: null }]);
  });
  it('keeps an offset-equivalent exact cutoff unchanged and canonicalizes only the period boundary', () => {
    const request = input(); request.cutoff = '2026-11-06T16:00:00.1234567+08:00';
    const result = calculateStockDaySummary(request, '2026-11-06T00:00:00+08:00');
    expect(result.cutoff).toBe(request.cutoff);
    expect(result.period).toEqual({ start, endExclusive: end, through: request.cutoff, fullDay: false });
  });
  it('supports an explicitly selected full day without including the next midnight', () => {
    const request = input(); request.cutoff = '2026-11-06T15:59:59.9999999Z';
    request.movements = [movement({ quantityDelta: '-11', effectiveAt: request.cutoff }),
      movement({ movementId: 'tomorrow', quantityDelta: '100', effectiveAt: end, recordedAt: end })];
    const result = calculateStockDaySummary(request, start);
    expect(result.period.fullDay).toBe(true);
    expect(terms(result)).toEqual([{ opening: '10', incoming: '0', outgoing: '11', closing: '-1', negative: true }]);
  });
  it('supports a source-verified partial day without treating its later movements as zero', () => {
    const request = input(); request.readAt = request.cutoff; request.coverage.through = request.cutoff;
    request.movements = [movement()];
    expect(calculateStockDaySummary(request, start)).toMatchObject({ status: 'complete', period: { fullDay: false, through: request.cutoff } });
  });
  it('restates late offline movements by original effective time while preserving source revision/read time', () => {
    const request = input(); request.movements = [movement({ recordedAt: '2026-11-06T20:00:00Z' })];
    const result = calculateStockDaySummary(request, start);
    expect(result).toMatchObject({ status: 'complete', lateMovements: 1, restatable: true, sourceRevision: request.sourceRevision, readAt: request.readAt });
    expect(terms(result)).toEqual([{ opening: '10', incoming: '5', outgoing: '0', closing: '15', negative: false }]);
  });
  it('deduplicates the same exact movement and rejects changed evidence under its identity', () => {
    const request = input();
    const one = movement({ movementId: 'ABCDEF00-0000-4000-8000-000000000001' });
    request.movements = [one, { ...one, movementId: one.movementId.toLowerCase() }];
    expect(terms(calculateStockDaySummary(request, start))[0]).toMatchObject({ incoming: '5', closing: '15' });
    request.movements = [...request.movements, { ...one, quantityDelta: '6' }];
    expect(() => calculateStockDaySummary(request, start)).toThrowError(expect.objectContaining({ code: 'STOCK_HISTORY_MOVEMENT_CONFLICT' }));
  });
  it('preserves exact quantities above the floating-point integer range', () => {
    const request = input(); request.baseline.rows = [{ ...pair, quantity: '9007199254740993' }];
    request.movements = [movement({ quantityDelta: '7' }), movement({ movementId: 'out', quantityDelta: '-2' })];
    expect(terms(calculateStockDaySummary(request, start))).toEqual([
      { opening: '9007199254740993', incoming: '7', outgoing: '2', closing: '9007199254740998', negative: false },
    ]);
  });
  it('retains authorized zero, archived and new-product pairs without inventing membership', () => {
    const request = input(); const others = ['zero', 'archived', 'new'].map(productId => ({ ...pair, productId }));
    request.pairs = [...request.pairs, ...others];
    request.baseline.rows = [...request.baseline.rows, ...others.map(value => ({ ...value, quantity: '0' }))];
    const result = calculateStockDaySummary(request, start);
    expect(result.rows).toHaveLength(4);
    expect(result.rows.filter(row => row.productId !== pair.productId).every(row => row.quantity === '0' && row.openingQuantity === '0')).toBe(true);
    request.baseline.rows = request.baseline.rows.filter(row => row.productId !== 'new');
    request.movements = [movement({ productId: 'new', quantityDelta: '1' })];
    const missing = calculateStockDaySummary(request, start);
    expect(missing.reasons).toContain('MISSING_OPENING');
    expect(missing.rows.every(row => row.openingQuantity === null && row.inQuantity === null && row.outQuantity === null && row.quantity === null)).toBe(true);
  });
  it('keeps each supplied product/location pair and transfer leg separate', () => {
    const request = input(), second = { ...pair, locationId: 'warehouse-b' };
    request.pairs = [pair, second]; request.baseline.rows = [{ ...pair, quantity: '10' }, { ...second, quantity: '0' }];
    request.movements = [movement({ quantityDelta: '-3' }), movement({ ...second, movementId: 'transfer-in', quantityDelta: '3' })];
    expect(terms(calculateStockDaySummary(request, start))).toEqual([
      { opening: '10', incoming: '0', outgoing: '3', closing: '7', negative: false },
      { opening: '0', incoming: '3', outgoing: '0', closing: '3', negative: false },
    ]);
  });
  it.each(['unknown', 'incomplete'] as const)('publishes no quantity terms for %s coverage', status => {
    const request = input(); request.coverage.status = status; request.movements = [movement()];
    const result = calculateStockDaySummary(request, start);
    expect(result).toMatchObject({ status: 'incomplete', reasons: ['INCOMPLETE_MOVEMENTS'] });
    expect(terms(result)).toEqual([{ opening: null, incoming: null, outgoing: null, closing: null, negative: null }]);
  });
  it.each(['missing', 'gap', 'late-prebaseline'] as const)('preserves the kernel %s reason and hides every quantity term', scenario => {
    const request = input();
    const reason = scenario === 'missing' ? 'MISSING_OPENING' : scenario === 'gap' ? 'COVERAGE_GAP' : 'BASELINE_PREHISTORY_CHANGED';
    if (scenario === 'missing') request.baseline.rows = [];
    if (scenario === 'gap') request.coverage.through = '2026-11-06T07:00:00Z';
    if (scenario === 'late-prebaseline') request.movements = [movement({ effectiveAt: '2026-11-04T23:00:00Z' })];
    const result = calculateStockDaySummary(request, start);
    expect(result.status).toBe('incomplete'); expect(result.reasons).toContain(reason);
    expect(terms(result)).toEqual([{ opening: null, incoming: null, outgoing: null, closing: null, negative: null }]);
  });
  it('requires a baseline strictly before opening, rather than assigning a midnight movement twice', () => {
    const request = input(); request.baseline.at = start; request.baseline.capturedAt = start;
    const result = calculateStockDaySummary(request, start);
    expect(result).toMatchObject({ status: 'unsupported', reasons: ['BEFORE_BASELINE'] });
    expect(terms(result)).toEqual([{ opening: null, incoming: null, outgoing: null, closing: null, negative: null }]);
  });
  it.each(['2026-11-05T15:59:59.9999999Z', end, '2026-11-07T00:00:00Z'])('rejects cutoff %s outside its chosen day', cutoff => {
    expect(() => calculateStockDaySummary({ ...input(), cutoff }, start)).toThrowError(expect.objectContaining({ code: 'STOCK_DAY_INVALID' }));
  });
  it('rejects a non-day opening and preserves actual kernel scope/invalid-unit denials', () => {
    expect(() => calculateStockDaySummary(input(), '2026-11-05T17:00:00Z')).toThrow();
    let request = input(); request.movements = [movement({ locationId: 'other-branch' })];
    expect(() => calculateStockDaySummary(request, start)).toThrowError(expect.objectContaining({ code: 'STOCK_HISTORY_SCOPE_FORBIDDEN' }));
    request = input(); request.movements = [movement({ quantityDelta: '0.5' })];
    expect(() => calculateStockDaySummary(request, start)).toThrow();
  });
  it('bounds positive in/out totals even if large opposite legs cancel to a valid closing', () => {
    const request = input(), maximum = '9'.repeat(38);
    request.movements = [movement({ quantityDelta: maximum }), movement({ movementId: 'in-extra', quantityDelta: '1' }),
      movement({ movementId: 'out-maximum', quantityDelta: `-${maximum}` }), movement({ movementId: 'out-extra', quantityDelta: '-1' })];
    expect(calculateStockAsOf(request).rows[0]!.quantity).toBe('10');
    expect(() => calculateStockDaySummary(request, start)).toThrowError(expect.objectContaining({ code: 'STOCK_HISTORY_OVERSIZED' }));
  });
  it('bounds a reconstructed opening even when a later out leg brings closing within bounds', () => {
    const request = input(); request.baseline.rows = [{ ...pair, quantity: '9'.repeat(38) }];
    request.movements = [movement({ movementId: 'pre-day', quantityDelta: '1', effectiveAt: '2026-11-05T15:00:00Z' }), movement({ quantityDelta: '-1' })];
    expect(calculateStockAsOf(request).status).toBe('complete');
    expect(() => calculateStockDaySummary(request, start)).toThrowError(expect.objectContaining({ code: 'STOCK_HISTORY_OVERSIZED' }));
  });
  it('is movement-order independent and never mutates or supplements the supplied snapshot', () => {
    const request = input(); request.movements = [movement(), movement({ movementId: 'out', quantityDelta: '-3' })];
    const before = JSON.stringify(request), result = calculateStockDaySummary(request, start);
    expect(JSON.stringify(request)).toBe(before);
    const reordered = { ...request, movements: [...request.movements].reverse() };
    expect(calculateStockDaySummary(reordered, start)).toEqual(result);
    expect(readFileSync('src/lib/stock-day-summary.ts', 'utf8')).not.toMatch(/\bfetch\s*\(|Date\.now\s*\(|localDb|supabase|loadStockHistoryPage/);
  });
  it('retains the existing bounded snapshot limits instead of summing arbitrary client pages', () => {
    const request = input(); request.movements = Array.from({ length: 100_001 }, () => movement());
    expect(() => calculateStockDaySummary(request, start)).toThrowError(expect.objectContaining({ code: 'STOCK_HISTORY_OVERSIZED' }));
  });
  it('calculates a selected instant inside a 23-hour business day with the same one-snapshot terms', () => {
    const request = input(); request.timeZone = 'America/New_York';
    request.cutoff = '2026-03-08T07:30:00.0000001Z'; request.readAt = '2026-03-09T12:00:00Z';
    request.baseline.at = request.baseline.capturedAt = '2026-03-07T00:00:00Z';
    request.coverage = { status: 'complete', from: request.baseline.at, through: request.readAt };
    request.movements = [movement({ quantityDelta: '-2', effectiveAt: request.cutoff, recordedAt: request.cutoff })];
    const result = calculateStockDaySummary(request, '2026-03-08T05:00:00Z');
    expect(result.period).toEqual({ start: '2026-03-08T05:00:00.0000000Z', endExclusive: '2026-03-09T04:00:00.0000000Z', through: request.cutoff, fullDay: false });
    expect(terms(result)).toEqual([{ opening: '10', incoming: '0', outgoing: '2', closing: '8', negative: false }]);
  });
});
