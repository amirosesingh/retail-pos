import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeStockSourceManifest, stockSourceManifestJson, STOCK_SOURCE_ACTIONS } from '../../../electron/shared/stock-source-manifest.mjs';

const require = createRequire(import.meta.url);
const stock = require('../../../electron/db/stock-history-contract.cjs');
const uid = (index: number) => `ABCDEF00-0000-4000-8000-${String(index).padStart(12, '0')}`;
const fixture = () => ({
  version: 1, operationId: uid(1), action: 'ADJUST', document: { type: 'stock_adjustments', id: uid(2) },
  authorId: uid(3), terminalId: 'till-A', branchId: 'BranchA', productId: uid(4), delta: '-3',
  effectiveAt: '2026-11-06T08:00:00.1234567+08:00', recordedAt: '2026-11-06T00:00:01.1234567Z',
  sourceRefs: [['stock_delta_applied', uid(6), '-3'], ['item_activity_logs', uid(5), '-3']],
});

describe('canonical immutable original stock-source claims', () => {
  it('produces exact stable bytes regardless of object/ref order or equivalent UUID/time spelling', () => {
    const input = fixture(), output = normalizeStockSourceManifest(input);
    expect(output).toEqual({ ...input,
      operationId: uid(1).toLowerCase(), document: { type: 'stock_adjustments', id: uid(2).toLowerCase() },
      authorId: uid(3).toLowerCase(), productId: uid(4).toLowerCase(), effectiveAt: '2026-11-06T00:00:00.1234567Z',
      sourceRefs: [['item_activity_logs', uid(5).toLowerCase(), '-3'], ['stock_delta_applied', uid(6).toLowerCase(), '-3']],
    });
    const reordered = Object.fromEntries(Object.entries(input).reverse());
    reordered.sourceRefs = [...input.sourceRefs].reverse();
    expect(stockSourceManifestJson(reordered)).toBe(stockSourceManifestJson(output));
    expect(stockSourceManifestJson(JSON.parse(stockSourceManifestJson(input)))).toBe(stockSourceManifestJson(input));
    expect(stockSourceManifestJson(input)).toBe(`{"version":1,"operationId":"${uid(1).toLowerCase()}","action":"ADJUST","document":{"type":"stock_adjustments","id":"${uid(2).toLowerCase()}"},"authorId":"${uid(3).toLowerCase()}","terminalId":"till-A","branchId":"BranchA","productId":"${uid(4).toLowerCase()}","delta":"-3","effectiveAt":"2026-11-06T00:00:00.1234567Z","recordedAt":"2026-11-06T00:00:01.1234567Z","sourceRefs":[["item_activity_logs","${uid(5).toLowerCase()}","-3"],["stock_delta_applied","${uid(6).toLowerCase()}","-3"]]}`);
    expect(input.sourceRefs[0]![0]).toBe('stock_delta_applied');
  });

  it.each(Object.entries(STOCK_SOURCE_ACTIONS))('accepts only its concrete %s / %s pairing', (action, type) => {
    expect(normalizeStockSourceManifest({ ...fixture(), action, document: { type, id: uid(2) } })).toMatchObject({ action, document: { type } });
  });

  it('deeply freezes claims without exposing an authorization or signer capability', () => {
    const output = normalizeStockSourceManifest(fixture());
    for (const value of [output, output.document, output.sourceRefs, ...output.sourceRefs]) expect(Object.isFrozen(value)).toBe(true);
    expect(() => { (output as unknown as { action: string }).action = 'SALE'; }).toThrow();
    expect(output).not.toHaveProperty('allowed');
    expect(output).not.toHaveProperty('clockVerified');
    expect(output).not.toHaveProperty('sign');
    const source = readFileSync('electron/shared/stock-source-manifest.mjs', 'utf8');
    expect(source).not.toMatch(/\b(?:import|require)\s*(?:\(|.*\bfrom\b)/);
  });

  it('preserves branch/terminal code case and Unicode while canonicalizing UUID identity', () => {
    const lower = normalizeStockSourceManifest({ ...fixture(), branchId: 'branch-a', terminalId: '店铺📦' });
    const upper = normalizeStockSourceManifest({ ...fixture(), branchId: 'BRANCH-A', terminalId: '店铺📦' });
    expect(lower.branchId).not.toBe(upper.branchId);
    expect(lower.terminalId).toBe('店铺📦');
    expect(normalizeStockSourceManifest({ ...fixture(), branchId: uid(9), terminalId: uid(10) })).toMatchObject({ branchId: uid(9).toLowerCase(), terminalId: uid(10).toLowerCase() });
  });

  it.each(['0', '-0', '3', '-3', '9007199254740993', '-9007199254740993', '9'.repeat(38)])('preserves exact integer %s and permits zero source evidence only', delta => {
    const output = normalizeStockSourceManifest({ ...fixture(), delta, sourceRefs: [] });
    expect(output.delta).toBe(String(BigInt(delta)));
    expect(output.sourceRefs).toEqual([]);
  });

  it('sums separate references per representation, rather than counting the same movement twice', () => {
    const output = normalizeStockSourceManifest({ ...fixture(), sourceRefs: [
      ['item_activity_logs', uid(8), '-1'], ['item_activity_logs', uid(7), '-2'], ['stock_delta_applied', uid(6), '-3'],
    ] });
    expect(output.sourceRefs).toHaveLength(3);
    expect(output.delta).toBe('-3');
  });

  it.each(['0.5', '1e3', '+1', '01', '-01', 'NaN', '1'.repeat(39), '', 1, null, 1n])('rejects malformed or non-string integer %s', delta => {
    expect(() => normalizeStockSourceManifest({ ...fixture(), delta, sourceRefs: [] })).toThrow();
  });

  it.each([
    null, [], 'json', new Date(), {}, { ...fixture(), extra: true }, { ...fixture(), allowed: true },
    { ...fixture(), version: '1' }, { ...fixture(), action: 'SALE' }, { ...fixture(), action: 'GENERAL' },
    { ...fixture(), action: '__proto__' }, { ...fixture(), action: { toString: () => 'ADJUST' } },
    { ...fixture(), document: { type: 'products', id: uid(2) } },
    { ...fixture(), document: { type: 'stock_adjustments', id: uid(2), extra: true } },
    { ...fixture(), operationId: 'operation' }, { ...fixture(), authorId: null }, { ...fixture(), productId: 'product' },
    { ...fixture(), document: { type: 'stock_adjustments', id: 'doc' } },
    { ...fixture(), branchId: ' BranchA' }, { ...fixture(), branchId: '' }, { ...fixture(), terminalId: 'x'.repeat(129) },
    { ...fixture(), terminalId: 'till\nA' }, { ...fixture(), terminalId: '\ud800' }, { ...fixture(), branchId: '\udc00' },
  ])('rejects malformed or widened source claim %#', input => {
    expect(() => normalizeStockSourceManifest(input)).toThrow();
  });

  it('rejects duplicate, conflicting, malformed and unsupported source references', () => {
    const input = fixture();
    for (const sourceRefs of [null, {}, [input.sourceRefs[0], input.sourceRefs[0]],
      [input.sourceRefs[0], ['stock_delta_applied', uid(6).toLowerCase(), '-2']],
      [['products', uid(6), '-3']], [['stock_delta_applied', 'bad-id', '-3']],
      [['stock_delta_applied', uid(6), '-3', 'extra']], [['stock_delta_applied', uid(6), -3]],
      [['stock_delta_applied', uid(6), '-2']], Array(2001).fill(['stock_delta_applied', uid(6), '-3']),
    ]) expect(() => normalizeStockSourceManifest({ ...input, sourceRefs })).toThrow();
  });

  it('bounds original canonical UTF-8 bytes and rejects large manifests without truncation', () => {
    const input = { ...fixture(), delta: '0', sourceRefs: Array.from({ length: 300 }, (_, index) => ['item_activity_logs', uid(index + 100), '0']) };
    expect(() => normalizeStockSourceManifest(input)).toThrowError(expect.objectContaining({ code: 'ESTOCK_SOURCE_OVERSIZED' }));
    const small = { ...fixture(), delta: '0', branchId: '店'.repeat(128), sourceRefs: Array.from({ length: 100 }, (_, index) => ['item_activity_logs', uid(index + 100), '0']) };
    const text = stockSourceManifestJson(small);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(16384);
    expect(JSON.parse(text).sourceRefs).toHaveLength(100);
  });

  it('enforces the exact byte boundary, including multibyte identifiers', () => {
    const bytes = (value: string) => new TextEncoder().encode(value).length;
    const candidate = { ...fixture(), branchId: 'a', delta: '0', sourceRefs: [] as string[][] };
    for (let index = 0; index < 300; index++) {
      const next = [...candidate.sourceRefs, ['item_activity_logs', uid(index + 100), '0']];
      try { stockSourceManifestJson({ ...candidate, sourceRefs: next }); candidate.sourceRefs = next; }
      catch { break; }
    }
    const gap = 16384 - bytes(stockSourceManifestJson(candidate));
    expect(gap).toBeLessThan(127);
    candidate.branchId = 'a'.repeat(gap + 1);
    expect(bytes(stockSourceManifestJson(candidate))).toBe(16384);
    expect(() => stockSourceManifestJson({ ...candidate, branchId: candidate.branchId + 'a' }))
      .toThrowError(expect.objectContaining({ code: 'ESTOCK_SOURCE_OVERSIZED' }));
    expect(() => stockSourceManifestJson({ ...candidate, branchId: candidate.branchId.slice(0, -1) + '店' }))
      .toThrowError(expect.objectContaining({ code: 'ESTOCK_SOURCE_OVERSIZED' }));
  });

  it.each(['0001-01-01T00:00:00.0000001Z', '1960-01-01T01:00:00.9999999+01:00', '2026-11-06 00:00:00Z',
    '2030-01-01T00:00:00.1234567Z', '9999-12-31T23:59:59.9999999Z'])('matches the existing exact stock timestamp semantics for %s without proving a clock', raw => {
    const expected = stock.canonicalInstant(raw);
    const output = normalizeStockSourceManifest({ ...fixture(), effectiveAt: raw, recordedAt: raw });
    expect(output.effectiveAt).toBe(expected);
    expect(output.recordedAt).toBe(expected);
    expect(output).not.toHaveProperty('clockState');
  });

  it('keeps 100ns differences and rejects effective-after-recorded or ambiguous/invalid time', () => {
    const input = fixture();
    const one = stockSourceManifestJson({ ...input, effectiveAt: '2026-11-06T00:00:00.1234567Z' });
    const two = stockSourceManifestJson({ ...input, effectiveAt: '2026-11-06T00:00:00.1234566Z' });
    expect(one).not.toBe(two);
    for (const effectiveAt of ['2026-11-06T00:00:02Z', '2026-02-30T00:00:00Z', '2026-11-06T00:00:00',
      '2026-11-06T24:00:00Z', '2026-11-06T00:00:00.12345678Z', '2026-11-06T00:00:00+14:01',
      '0001-01-01T00:00:00+14:00', '9999-12-31T23:59:59-14:00',
    ]) expect(() => normalizeStockSourceManifest({ ...input, effectiveAt })).toThrow();
  });
});
