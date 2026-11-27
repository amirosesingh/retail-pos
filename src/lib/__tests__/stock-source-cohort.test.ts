import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildStockSourceCohort, verifyStockSourceMembership } from '../../../electron/shared/stock-source-cohort.mjs';
import { normalizeStockSourceManifest, stockSourceManifestJson } from '../../../electron/shared/stock-source-manifest.mjs';

const uid = (index: number) => `ABCDEF00-0000-4000-8000-${String(index).padStart(12, '0')}`;
const fixture = (product = 10, delta = '-3') => ({ version: 1, operationId: uid(1), action: 'ADJUST', document: { type: 'stock_adjustments', id: uid(2) },
  authorId: uid(3), terminalId: 'till-A', branchId: 'BranchA', productId: uid(product), delta,
  effectiveAt: '2026-11-06T08:00:00.1234567+08:00', recordedAt: '2026-11-06T00:00:01.1234567Z',
  sourceRefs: [['stock_delta_applied', uid(6), delta], ['item_activity_logs', uid(5), delta]] });
const trusted = (cohort: { count: number; root: string }) => Object.freeze({ count: cohort.count, root: cohort.root });
const hash = (bytes: Uint8Array) => new Uint8Array(createHash('sha256').update(bytes).digest());
const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
function independentTree(json: string[]) {
  const levels = [json.map((value, index) => hash(Buffer.concat([Buffer.from([0]), Buffer.from(JSON.stringify(['retail-pos.stock-source-leaf.v1', index, value]))])))];
  while (levels.at(-1)!.length > 1) {
    const rows = levels.at(-1)!;
    levels.push(Array.from({ length: Math.ceil(rows.length / 2) }, (_, index) => hash(Buffer.concat([Buffer.from([1]), rows[index * 2]!, rows[index * 2 + 1] ?? rows[index * 2]!]))));
  }
  return levels;
}

describe('bounded original stock-source cohort representation', () => {
  it('canonicalizes input permutations, UUID/time/ref spelling and exact source bytes deterministically', async () => {
    const original = [fixture(12), fixture(10), fixture(11)], first = await buildStockSourceCohort(original);
    const equivalent = [...original].reverse().map(value => ({ ...Object.fromEntries(Object.entries(value).reverse()),
      productId: value.productId.toLowerCase(), effectiveAt: '2026-11-06T00:00:00.1234567Z', sourceRefs: [...value.sourceRefs].reverse() }));
    expect(await buildStockSourceCohort(equivalent)).toEqual(first);
    expect(first).toMatchObject({ version: 1, operationId: uid(1).toLowerCase(), authorId: uid(3).toLowerCase(), action: 'ADJUST', terminalId: 'till-A', branchId: 'BranchA', count: 3 });
    expect(first.members.map(member => JSON.parse(member.manifestJson).productId)).toEqual([10, 11, 12].map(n => uid(n).toLowerCase()));
    expect(original[0]!.productId).toBe(uid(12));
  });

  it.each([1, 3, 5])('matches independent domain-separated SHA256 vectors for %s leaves, including duplicate-last odd levels', async count => {
    const cohort = await buildStockSourceCohort(Array.from({ length: count }, (_, i) => fixture(10 + i)));
    const tree = independentTree(cohort.members.map(member => member.manifestJson));
    expect(cohort.root).toBe(toHex(tree.at(-1)![0]!));
    for (const member of cohort.members) {
      expect(await verifyStockSourceMembership(member, trusted(cohort))).toEqual(normalizeStockSourceManifest(fixture(10 + member.index)));
      let position = member.index;
      for (let level = 0; level < member.siblings.length; level++) {
        expect(member.siblings[level]).toBe(toHex(tree[level]![position ^ 1] ?? tree[level]![position]!));
        position = Math.floor(position / 2);
      }
    }
  });

  it('bounds actual native WebCrypto concurrency and supports exactly2000 distinct products', async () => {
    const native = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle); let active = 0, peak = 0;
    const spy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(async (...args) => {
      active++; peak = Math.max(peak, active);
      try { return await native(...args); } finally { active--; }
    });
    try {
      const cohort = await buildStockSourceCohort(Array.from({ length: 2000 }, (_, i) => fixture(100 + i)));
      expect(cohort.count).toBe(2000); expect(peak).toBeGreaterThan(1); expect(peak).toBeLessThanOrEqual(8);
      expect(cohort.root).toBe(toHex(independentTree(cohort.members.map(member => member.manifestJson)).at(-1)![0]!));
      for (const index of [0, 998, 1999]) {
        expect(cohort.members[index]!.siblings).toHaveLength(11);
        expect((await verifyStockSourceMembership(cohort.members[index], trusted(cohort))).productId).toBe(uid(100 + index).toLowerCase());
      }
    } finally { spy.mockRestore(); }
  });

  it('freezes all emitted membership and manifest data without providing a signer or admission capability', async () => {
    const cohort = await buildStockSourceCohort([fixture()]), member = cohort.members[0]!;
    for (const value of [cohort, cohort.members, member, member.siblings]) expect(Object.isFrozen(value)).toBe(true);
    const manifest = await verifyStockSourceMembership(member, trusted(cohort));
    for (const value of [manifest, manifest.document, manifest.sourceRefs, ...manifest.sourceRefs]) expect(Object.isFrozen(value)).toBe(true);
    expect(() => { (member.siblings as string[]).push('0'.repeat(64)); }).toThrow();
    for (const key of ['sign', 'allowed', 'accepted', 'clockVerified', 'complete']) expect(cohort).not.toHaveProperty(key);
  });

  it.each(['0', '-0', '-3', '3', '9007199254740993', '-9007199254740993', '9'.repeat(38)])('preserves exact source integer %s; zero remains representation only', async delta => {
    const cohort = await buildStockSourceCohort([fixture(10, delta)]);
    expect((await verifyStockSourceMembership(cohort.members[0], trusted(cohort))).delta).toBe(String(BigInt(delta)));
  });

  it.each(['1.5', '1e3', '01', '+3', '--3', '9'.repeat(39), 3, 0.5])('rejects noncanonical/fractional source quantity %s', async delta => {
    await expect(buildStockSourceCohort([{ ...fixture(), delta }])).rejects.toThrow();
  });

  it.each(['operationId', 'action', 'authorId', 'terminalId', 'branchId'])('rejects mixed original %s instead of combining unrelated operations/authors/scopes', async field => {
    const second = { ...fixture(11), [field]: field === 'action' ? 'RECEIVE' : field.endsWith('Id') && !['terminalId', 'branchId'].includes(field) ? uid(99) : 'other' };
    if (field === 'action') second.document = { type: 'receivings', id: uid(2) };
    await expect(buildStockSourceCohort([fixture(), second])).rejects.toMatchObject({ code: 'ESTOCK_SOURCE_COHORT_INVALID' });
  });

  it('normalizes UUID identities but preserves code case and exact100ns/Unicode claims without certifying clocks', async () => {
    const input = { ...fixture(), branchId: uid(80), terminalId: uid(81), effectiveAt: '2030-01-01T00:00:00.0000001Z', recordedAt: '2030-01-01T00:00:00.0000002Z' };
    const cohort = await buildStockSourceCohort([input, { ...input, productId: uid(11).toLowerCase(), branchId: uid(80).toLowerCase(), terminalId: uid(81).toLowerCase() }]);
    expect(cohort.branchId).toBe(uid(80).toLowerCase());
    expect((await verifyStockSourceMembership(cohort.members[0], trusted(cohort))).effectiveAt).toBe(input.effectiveAt);
    const unicode = await buildStockSourceCohort([{ ...fixture(), branchId: '分店📦', terminalId: '收银台一' }]);
    expect(unicode.branchId).toBe('分店📦'); expect(unicode.terminalId).toBe('收银台一');
    await expect(buildStockSourceCohort([fixture(), { ...fixture(11), branchId: 'brancha' }])).rejects.toThrow();
  });

  it.each(['empty', 'too-many', 'duplicate', 'case-duplicate', 'not-array', 'extra-array-field', 'sparse-array', 'prototype', 'extra-manifest-field', 'symbol', 'accessor'])('rejects invalid cohort shape %s before hashing', async mode => {
    let input: unknown = [fixture()]; const values = input as Array<ReturnType<typeof fixture>>;
    if (mode === 'empty') input = [];
    if (mode === 'too-many') input = Array.from({ length: 2001 }, (_, i) => fixture(100 + i));
    if (mode === 'duplicate') values.push(fixture());
    if (mode === 'case-duplicate') values.push({ ...fixture(), productId: fixture().productId.toLowerCase() });
    if (mode === 'not-array') input = { 0: fixture(), length: 1 };
    if (mode === 'extra-array-field') Object.assign(values, { injected: true });
    if (mode === 'sparse-array') input = new Array(1);
    if (mode === 'prototype') Object.setPrototypeOf(values[0]!, { authorId: uid(9) });
    if (mode === 'extra-manifest-field') Object.assign(values[0]!, { approved: true });
    if (mode === 'symbol') Object.defineProperty(values[0]!, Symbol('injected'), { value: true });
    if (mode === 'accessor') Object.defineProperty(values[0]!, 'authorId', { enumerable: true, get: () => { throw Error('Accessor must not run'); } });
    const spy = vi.spyOn(globalThis.crypto.subtle, 'digest');
    try { await expect(buildStockSourceCohort(input)).rejects.toThrow(); expect(spy).not.toHaveBeenCalled(); } finally { spy.mockRestore(); }
  });

  it('enforces the individual16384-byte and aggregate8MiB canonical UTF8 bounds before hashing', async () => {
    const refs = Array.from({ length: 128 }, (_, index) => ['item_activity_logs', uid(3000 + index), '0']);
    const large = { ...fixture(10, '0'), branchId: '店'.repeat(64), terminalId: '📦'.repeat(64), sourceRefs: refs };
    const size = new TextEncoder().encode(stockSourceManifestJson(large)).length; expect(size).toBeLessThanOrEqual(16384);
    const number = Math.floor(8 * 1024 * 1024 / size) + 1; expect(number).toBeLessThanOrEqual(2000);
    expect(stockSourceManifestJson(large).length * number).toBeLessThan(8 * 1024 * 1024); // UTF8 bytes, not JS string length.
    const spy = vi.spyOn(globalThis.crypto.subtle, 'digest');
    try {
      await expect(buildStockSourceCohort(Array.from({ length: number }, (_, i) => ({ ...large, productId: uid(10000 + i) })))).rejects.toMatchObject({ code: 'ESTOCK_SOURCE_COHORT_OVERSIZED' });
      await expect(buildStockSourceCohort([{ ...large, sourceRefs: Array.from({ length: 300 }, (_, i) => ['item_activity_logs', uid(3000 + i), '0']) }])).rejects.toMatchObject({ code: 'ESTOCK_SOURCE_OVERSIZED' });
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});

describe('stock-source membership requires the independently signed count and root', () => {
  it.each(['missing', 'extra', 'prototype', 'count', 'root', 'string-count', 'accessor'])('rejects invalid/unbound expected context %s', async mode => {
    const cohort = await buildStockSourceCohort([fixture()]), member = cohort.members[0]!;
    let expected: unknown = { ...trusted(cohort) };
    if (mode === 'missing') expected = undefined;
    if (mode === 'extra') Object.assign(expected as object, { allowed: true });
    if (mode === 'prototype') Object.setPrototypeOf(expected as object, { allowed: true });
    if (mode === 'count') Object.assign(expected as object, { count: 2 });
    if (mode === 'root') Object.assign(expected as object, { root: '0'.repeat(64) });
    if (mode === 'string-count') Object.assign(expected as object, { count: '1' });
    if (mode === 'accessor') Object.defineProperty(expected, 'root', { enumerable: true, get: () => { throw Error('Accessor must not run'); } });
    await expect(verifyStockSourceMembership(member, expected as never)).rejects.toThrow();
  });

  it.each(['version', 'index', 'count', 'root', 'upper-root', 'manifest', 'noncanonical', 'siblings', 'extra-sibling', 'bad-sibling', 'upper-sibling', 'extra', 'prototype', 'accessor'])('rejects tampered member %s', async mode => {
    const cohort = await buildStockSourceCohort([fixture(10), fixture(11), fixture(12)]);
    const member = { ...cohort.members[0]!, siblings: [...cohort.members[0]!.siblings] };
    if (mode === 'version') member.version = 2 as 1;
    if (mode === 'index') member.index = 1;
    if (mode === 'count') member.count = 4;
    if (mode === 'root') member.root = '0'.repeat(64);
    if (mode === 'upper-root') member.root = member.root.toUpperCase();
    if (mode === 'manifest') member.manifestJson = member.manifestJson.replace('BranchA', 'BranchB');
    if (mode === 'noncanonical') member.manifestJson += ' ';
    if (mode === 'siblings') member.siblings.pop();
    if (mode === 'extra-sibling') member.siblings.push('0'.repeat(64));
    if (mode === 'bad-sibling') member.siblings[0] = 'not-a-hash';
    if (mode === 'upper-sibling') member.siblings[0] = member.siblings[0]!.toUpperCase();
    if (mode === 'extra') Object.assign(member, { allowed: true });
    if (mode === 'prototype') Object.setPrototypeOf(member, { authorId: uid(99) });
    if (mode === 'accessor') Object.defineProperty(member, 'manifestJson', { enumerable: true, get: () => { throw Error('Accessor must not run'); } });
    await expect(verifyStockSourceMembership(member, trusted(cohort))).rejects.toThrow();
  });

  it.each([0, -1, 0.5, 2001, NaN, Infinity])('rejects invalid member count %s even when supplied as expected', async count => {
    const cohort = await buildStockSourceCohort([fixture()]), member = { ...cohort.members[0]!, count };
    await expect(verifyStockSourceMembership(member, { count, root: cohort.root })).rejects.toThrow();
  });

  it.each([-1, 0.5, 1, NaN, Infinity])('rejects invalid singleton index %s', async index => {
    const cohort = await buildStockSourceCohort([fixture()]);
    await expect(verifyStockSourceMembership({ ...cohort.members[0], index }, trusted(cohort))).rejects.toThrow();
  });

  it('enforces duplicate-last sibling equality and binds count separately from an otherwise ambiguous root', async () => {
    const cohort = await buildStockSourceCohort([fixture(10), fixture(11), fixture(12)]), last = cohort.members[2]!;
    const member = { ...last, siblings: [...last.siblings] }; member.siblings[0] = '0'.repeat(64);
    await expect(verifyStockSourceMembership(member, trusted(cohort))).rejects.toThrow();
    // Count3 and a hypothetical repeated-last count4 have the same Merkle
    // root. Requiring the separately signed expected count rejects that swap.
    const first = { ...cohort.members[0]!, count: 4 };
    await expect(verifyStockSourceMembership(first, trusted(cohort))).rejects.toThrow();
  });

  it('captures the signed expected root and proof before awaiting crypto instead of trusting in-flight mutations', async () => {
    const cohort = await buildStockSourceCohort([fixture()]);
    const member = { ...cohort.members[0]!, manifestJson: cohort.members[0]!.manifestJson.replace('BranchA', 'BranchB') };
    const expected = { ...trusted(cohort) }, native = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    const spy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(async (...args) => {
      const result = await native(...args);
      member.root = toHex(new Uint8Array(result)); member.count = 2000;
      expected.root = member.root; expected.count = 2000;
      return result;
    });
    try { await expect(verifyStockSourceMembership(member, expected)).rejects.toThrow(); } finally { spy.mockRestore(); }
  });
});
