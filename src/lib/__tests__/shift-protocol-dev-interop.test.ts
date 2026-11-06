import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { expect, it } from 'vitest';
import { shiftProtocolDevInterop } from '../../../scripts/shift-protocol-dev-interop.mjs';

const root = process.cwd();
const path = resolve(root, 'electron/security/shift-author-protocol.cjs');
const native = createRequire(import.meta.url)(path);

const companions = ['shift-financial-protocol.cjs', 'financial-author-protocol.cjs', 'legacy-shift-recovery-protocol.cjs', 'stock-event-author-protocol.cjs'];

it.each(companions)('keeps %s development interop bounded to its reviewed exports and dependency', async file => {
  const plugin = shiftProtocolDevInterop();
  plugin.configResolved({ root });
  const companionPath = resolve(root, 'electron/security', file);
  const source = await readFile(companionPath, 'utf8');
  expect(plugin.transform(source, companionPath)?.code).toContain("import { normalizeBinding } from './shift-author-protocol.cjs';");
  expect(plugin.transform(source, `${companionPath}.other`)).toBeNull();
  expect(() => plugin.transform(source.replace('./shift-author-protocol.cjs', './other.cjs'), companionPath)).toThrow('Unexpected shared shift protocol imports');
  expect(() => plugin.transform(`const extra = require('node:fs');\n${source}`, companionPath)).toThrow('Unexpected shared shift protocol imports');
  expect(() => plugin.transform(`${source}\nmodule.exports = {};`, companionPath)).toThrow('Unexpected shared shift protocol exports');
});

it('limits the serve transform to the canonical file and rejects changed export contracts', async () => {
  const plugin = shiftProtocolDevInterop();
  plugin.configResolved({ root });
  expect(plugin.apply).toBe('serve');
  expect(plugin.enforce).toBe('pre');
  const source = await readFile(path, 'utf8');
  expect(plugin.transform(source, `${path}.other`)).toBeNull();
  expect(plugin.transform(source, resolve(root, 'other/shift-author-protocol.cjs'))).toBeNull();
  expect(plugin.transform(source, `${path}?v=dev`)?.code).toContain('export { normalizeClosingStart');
  expect(() => plugin.transform(source.replace('module.exports =', 'exports.changed ='), path)).toThrow('Unexpected shared shift protocol exports');
  expect(() => plugin.transform(`${source}\nmodule.exports = {};`, path)).toThrow('Unexpected shared shift protocol exports');
});

it('reproduces the real Vite SSR failure and preserves native protocol bytes after interop', async () => {
  const options = { configFile: false as const, root, logLevel: 'silent' as const,
    server: { middlewareMode: true, hmr: false as const, watch: null } };
  const broken = await createServer(options);
  try {
    await expect(broken.ssrLoadModule('/electron/security/shift-author-protocol.cjs')).rejects.toThrow(/module is not defined/);
  } finally { await broken.close(); }
  const fixed = await createServer({ ...options, plugins: [shiftProtocolDevInterop()] });
  try {
    const esm = await fixed.ssrLoadModule('/electron/security/shift-author-protocol.cjs');
    expect(Object.keys(esm).sort()).toEqual(Object.keys(native).sort());
    const binding = { projectOrigin: 'https://PUBLIC.fixture/', terminalId: 'fixture-terminal', authorId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' };
    const enrollment = { ...binding, version: 1, algorithm: 'Ed25519', keyId: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
      publicKey: generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64url') };
    const { publicKey: _publicKey, ...base } = enrollment;
    const intent = { ...base, subject: 'fixture-cashier', branchId: 'branch-a', shiftId: 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC',
      intentId: 'DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD', action: 'ORIGINAL', payloadHash: 'a'.repeat(64) };
    const { intentId, action: _action, ...startBase } = intent;
    const start = { ...startBase, eventId: intentId, payloadJson: '{"fixture":"unchanged bytes"}' };
    const signature = Buffer.alloc(64).toString('base64url');
    for (const [name, input] of [
      ['normalizeBinding', binding], ['normalizeEnrollment', enrollment],
      ['normalizeAttestation', { ...intent, signature }], ['normalizeClosingStart', { ...start, signature }],
      ['enrollmentMessage', enrollment], ['intentMessage', intent], ['closingStartMessage', start],
    ] as const) {
      expect(esm[name](input)).toEqual(native[name](input));
      if (name.endsWith('Message')) expect(Buffer.from(esm[name](input))).toEqual(Buffer.from(native[name](input)));
      for (const invalid of [null, {}, { ...input, unexpected: true }]) {
        expect(() => esm[name](invalid)).toThrow('The shift author proof is invalid.');
        expect(() => native[name](invalid)).toThrow('The shift author proof is invalid.');
      }
    }
  } finally { await fixed.close(); }
}, 30_000);

it('loads the actual financial and recovery protocol dependency graph with unchanged signed bytes', async () => {
  const options = { configFile: false as const, root, logLevel: 'silent' as const,
    server: { middlewareMode: true, hmr: false as const, watch: null } };
  const broken = await createServer(options);
  try {
    await expect(broken.ssrLoadModule('/electron/security/shift-financial-protocol.cjs')).rejects.toThrow(/require is not defined/);
  } finally { await broken.close(); }
  const fixed = await createServer({ ...options, plugins: [shiftProtocolDevInterop()] });
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const binding = { version: 1, algorithm: 'Ed25519', keyId: uuid(1), projectOrigin: 'https://PUBLIC.fixture/', terminalId: uuid(2), authorId: uuid(3), subject: 'fixture-author', branchId: uuid(4) };
  const basis = { ...binding, shiftId: uuid(5), intentId: uuid(6), action: 'ORIGINAL', graphPayloadHash: 'a'.repeat(64), basisHash: 'b'.repeat(64), serverBasisId: uuid(7), formula: 'canonical-exact-decimal-v2' };
  const { serverBasisId: _serverBasisId, ...openingFields } = basis;
  const opening = { ...openingFields, openingOrigin: { localAggregateId: uuid(8), rowHash: 'c'.repeat(64) } };
  const operation = { ...binding, operationId: uuid(9), action: 'SALE', payloadHash: 'd'.repeat(64) };
  const cohort={...binding,operationId:uuid(9),sourceDatabaseId:uuid(11),sourceSequence:'1',sourcePredecessorRoot:null,action:'ADJUST',sourceRoot:'a'.repeat(64),sourceCount:3};
  const recovery = { ...binding, shiftId: uuid(5), recoveryId: uuid(10), action: 'LEGACY_CLOSING_RECOVERY_V1', payloadHash: 'e'.repeat(64) };
  const payload = { version: 1, recoveryId: uuid(10), branchId: uuid(4), terminalId: uuid(2), shiftId: uuid(5), evidenceHash: 'f'.repeat(64), cloudWitnessHash: 'a'.repeat(64), reason: 'Review retained fixture closing', localGraphText: '[]', cloudGraphText: '[]', financialVerification: 'UNVERIFIED_HISTORICAL' };
  const signature = Buffer.alloc(64).toString('base64url');
  const cases: Record<string, [string, unknown[]][]> = {
    'shift-financial-protocol.cjs': [
      ['financialBasisMessage', [basis]], ['normalizeFinancialBasisAttestation', [{ ...basis, signature }]],
      ['openingFinancialBasisMessage', [opening]], ['normalizeOpeningFinancialBasisAttestation', [{ ...opening, signature }]],
    ],
    'financial-author-protocol.cjs': [
      ['financialOperationMessage', [operation]], ['normalizeFinancialAttestation', [{ ...operation, signature }]],
    ],
    'stock-event-author-protocol.cjs': [
      ['unsignedStockEvent', [{ ...operation, movementId: uuid(8) }]],
      ['stockEventMessage', [{ ...operation, movementId: uuid(8) }]],
      ['normalizeStockEvent', [{ ...operation, movementId: uuid(8), signature }]],
      ['unsignedStockSourceCohort',[cohort]],['stockSourceCohortMessage',[cohort]],['normalizeStockSourceCohortProof',[{...cohort,signature}]],
    ],
    'legacy-shift-recovery-protocol.cjs': [
      ['normalizeLegacyPayload', [payload]], ['unsignedLegacyRecovery', [recovery]],
      ['normalizeLegacyRecovery', [{ ...recovery, signature }]], ['legacyRecoveryMessage', [recovery]],
      ['legacyRecoveryWire', [JSON.stringify(payload), { ...recovery, signature }]],
    ],
  };
  try {
    for (const file of companions) {
      const nativeModule = createRequire(import.meta.url)(resolve(root, 'electron/security', file));
      const esm = await fixed.ssrLoadModule(`/electron/security/${file}`);
      expect(Object.keys(esm).sort()).toEqual(Object.keys(nativeModule).sort());
      for (const [name, args] of cases[file]!) {
        const expected = nativeModule[name](...args);
        expect(esm[name](...args)).toEqual(expected);
        if (typeof expected === 'string') expect(Buffer.from(esm[name](...args))).toEqual(Buffer.from(expected));
        for (const invalid of [null, {}, { ...(args[0] as object), unexpected: true }]) {
          const bad = [invalid, ...args.slice(1)];
          expect(() => nativeModule[name](...bad)).toThrow();
          expect(() => esm[name](...bad)).toThrow();
        }
      }
      for (const name of ['ACTION', 'ACTIONS', 'MAX_UPLOAD_BYTES']) if (name in nativeModule) expect(esm[name]).toEqual(nativeModule[name]);
    }
  } finally { await fixed.close(); }
}, 30_000);
