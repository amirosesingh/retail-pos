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
