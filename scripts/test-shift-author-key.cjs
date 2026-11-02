const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createShiftAuthorKeys } = require('../electron/security/shift-author-key.cjs');
const protocol = require('../electron/security/shift-author-protocol.cjs');

const binding = { projectOrigin: 'https://fixture.supabase.co', terminalId: 'fixture-terminal', authorId: '10000000-0000-4000-8000-000000000001' };
const facts = { subject: 'fixture.cashier', branchId: 'fixture-branch', shiftId: '20000000-0000-4000-8000-000000000001', intentId: '30000000-0000-4000-8000-000000000001', action: 'RECOUNT', payloadHash: 'a'.repeat(64) };
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-author-key-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const secret = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', secret, iv);
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    decryptString(value) {
      const decipher = crypto.createDecipheriv('aes-256-gcm', secret, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
  return { directory, safeStorage, keys: createShiftAuthorKeys({ safeStorage, directory: () => directory }) };
}
function verify(publicKey, message, signature) {
  return crypto.verify(null, Buffer.from(message), crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64url'), format: 'der', type: 'spki' }), Buffer.from(signature, 'base64url'));
}
test('dedicated sealed key survives reload and signs the exact author, action and payload', t => {
  const f = fixture(t), info = f.keys.prepare(binding);
  assert.deepEqual(Object.keys(info).sort(), ['authorId', 'enrolled', 'keyId', 'projectOrigin', 'publicKey', 'terminalId'].sort());
  assert.equal(info.enrolled, false);
  const attestation = f.keys.signIntent(binding, { ...facts, expectedKeyId: info.keyId });
  const { signature, ...unsigned } = attestation;
  assert.equal(verify(info.publicKey, protocol.intentMessage(unsigned), signature), true);
  for (const changed of [{ action: 'VARIANCE' }, { subject: 'fixture.admin' }, { payloadHash: 'b'.repeat(64) }, { branchId: 'other' }, { terminalId: 'other' }, { authorId: '10000000-0000-4000-8000-000000000002' }, { projectOrigin: 'https://other.supabase.co' }, { keyId: '40000000-0000-4000-8000-000000000001' }, { shiftId: '20000000-0000-4000-8000-000000000002' }, { intentId: '30000000-0000-4000-8000-000000000002' }]) {
    assert.equal(verify(info.publicKey, protocol.intentMessage({ ...unsigned, ...changed }), signature), false);
  }
  const reloaded = createShiftAuthorKeys({ safeStorage: f.safeStorage, directory: () => f.directory });
  assert.deepEqual(reloaded.prepare(binding, { expectedKeyId: info.keyId }), info);
  const encrypted = fs.readFileSync(path.join(f.directory, fs.readdirSync(f.directory)[0]));
  assert.equal(encrypted.includes(Buffer.from('PRIVATE KEY')), false);
  assert.equal(encrypted.includes(Buffer.from('fixture.cashier')), false);
});
test('enrollment proves possession with a separate signature domain and is idempotent', t => {
  const f = fixture(t), info = f.keys.prepare(binding), enrollment = f.keys.enrollment(binding, { expectedKeyId: info.keyId });
  const { signature, ...unsigned } = enrollment;
  assert.equal(verify(info.publicKey, protocol.enrollmentMessage(unsigned), signature), true);
  const intent = f.keys.signIntent(binding, { ...facts, expectedKeyId: info.keyId });
  const { signature: intentSignature, ...intentUnsigned } = intent;
  assert.equal(verify(info.publicKey, protocol.enrollmentMessage(unsigned), intentSignature), false);
  assert.equal(verify(info.publicKey, protocol.intentMessage(intentUnsigned), signature), false);
  assert.equal(f.keys.markEnrolled(binding, { keyId: info.keyId, publicKey: info.publicKey }).enrolled, true);
  assert.equal(f.keys.prepare(binding).enrolled, true);
  assert.equal(f.keys.prepare(binding).keyId, info.keyId);
});
test('another author, terminal or project gets independent keys', t => {
  const { keys } = fixture(t), first = keys.prepare(binding);
  for (const change of [{ authorId: '10000000-0000-4000-8000-000000000002' }, { terminalId: 'other-terminal' }, { projectOrigin: 'https://other.supabase.co' }]) {
    const next = keys.prepare({ ...binding, ...change });
    assert.notEqual(next.keyId, first.keyId);
    assert.notEqual(next.publicKey, first.publicKey);
  }
});
test('unavailable vault never writes a plaintext or replacement key', t => {
  const f = fixture(t), keys = createShiftAuthorKeys({ safeStorage: { ...f.safeStorage, isEncryptionAvailable: () => false }, directory: () => f.directory });
  assert.throws(() => keys.prepare(binding), { code: 'ESYNC_SHIFT_AUTHOR_VAULT_UNAVAILABLE' });
  assert.deepEqual(fs.readdirSync(f.directory), []);
});
test('missing or corrupt pending key is held without automatic replacement', t => {
  const f = fixture(t), info = f.keys.prepare(binding), file = path.join(f.directory, fs.readdirSync(f.directory)[0]);
  assert.throws(() => f.keys.prepare(binding, { expectedKeyId: '40000000-0000-4000-8000-000000000001' }), { code: 'ESYNC_SHIFT_AUTHOR_KEY_MISMATCH' });
  assert.throws(() => f.keys.markEnrolled(binding, { keyId: info.keyId, publicKey: crypto.generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64url') }), { code: 'ESYNC_SHIFT_AUTHOR_KEY_MISMATCH' });
  fs.writeFileSync(file, Buffer.from('corrupt fixture'));
  assert.throws(() => f.keys.prepare(binding), { code: 'ESYNC_SHIFT_AUTHOR_KEY_UNAVAILABLE' });
  assert.equal(fs.readFileSync(file).toString(), 'corrupt fixture');
  fs.unlinkSync(file);
  assert.throws(() => f.keys.prepare(binding, { expectedKeyId: info.keyId }), { code: 'ESYNC_SHIFT_AUTHOR_KEY_MISSING' });
  assert.deepEqual(fs.readdirSync(f.directory), []);
});
test('a sealed file cannot be copied to bind another author', t => {
  const f = fixture(t), first = f.keys.prepare(binding), originalFile = fs.readdirSync(f.directory)[0];
  const other = { ...binding, authorId: '10000000-0000-4000-8000-000000000002' };
  f.keys.prepare(other);
  const otherFile = fs.readdirSync(f.directory).find(x => x !== originalFile);
  fs.copyFileSync(path.join(f.directory, originalFile), path.join(f.directory, otherFile));
  assert.throws(() => f.keys.signIntent(other, { ...facts, expectedKeyId: first.keyId }), { code: 'ESYNC_SHIFT_AUTHOR_KEY_MISMATCH' });
});
test('strict public protocol rejects ambiguous identity, extra fields and invalid encodings', t => {
  const f = fixture(t), enrollment = f.keys.enrollment(binding), { signature, ...unsigned } = enrollment;
  for (const change of [{ publicKey: `${unsigned.publicKey}=` }, { publicKey: 'a'.repeat(59) }, { authorId: 'cashier' }, { terminalId: ' terminal ' }, { projectOrigin: 'http://fixture.supabase.co' }, { projectOrigin: 'https://user:pass@fixture.supabase.co' }, { projectOrigin: 'https://fixture.supabase.co/path' }, { projectOrigin: 'https://fixture.supabase.co?x=1' }, { version: 2 }, { algorithm: 'RSA' }, { extra: true }]) {
    assert.throws(() => protocol.enrollmentMessage({ ...unsigned, ...change }), { code: 'ESYNC_SHIFT_AUTHOR_INVALID' });
  }
  assert.throws(() => protocol.normalizeAttestation({ ...f.keys.signIntent(binding, facts), signature: `${signature}=` }), { code: 'ESYNC_SHIFT_AUTHOR_INVALID' });
  assert.throws(() => f.keys.signIntent(binding, { ...facts, privateKey: 'untrusted' }), { code: 'ESYNC_SHIFT_AUTHOR_INVALID' });
  assert.throws(() => f.keys.signIntent(binding, { ...facts, authorId: '10000000-0000-4000-8000-000000000002' }), { code: 'ESYNC_SHIFT_AUTHOR_INVALID' });
  assert.throws(() => f.keys.signIntent(binding, { ...facts, projectOrigin: 'https://other.supabase.co' }), { code: 'ESYNC_SHIFT_AUTHOR_INVALID' });
  assert.throws(() => f.keys.markEnrolled(binding, { keyId: undefined, publicKey: unsigned.publicKey }), { code: 'ESYNC_SHIFT_AUTHOR_INVALID' });
});
test('public signature verifies through the server WebCrypto algorithm', async t => {
  const f = fixture(t), enrollment = f.keys.enrollment(binding), { signature, ...unsigned } = enrollment;
  const publicKey = await crypto.webcrypto.subtle.importKey('spki', Buffer.from(enrollment.publicKey, 'base64url'), 'Ed25519', false, ['verify']);
  assert.equal(await crypto.webcrypto.subtle.verify('Ed25519', publicKey, Buffer.from(signature, 'base64url'), Buffer.from(protocol.enrollmentMessage(unsigned))), true);
});
