// Main-owned dedicated signing material. No IPC export or generic signing API.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const protocol = require('./shift-author-protocol.cjs');
function failure(code) {
  return Object.assign(new Error('Shift author verification setup is unavailable. Keep the pending correction for review.'), { code });
}
function createShiftAuthorKeys({ safeStorage, directory }) {
  function vault() {
    if (!safeStorage?.isEncryptionAvailable()) throw failure('ESYNC_SHIFT_AUTHOR_VAULT_UNAVAILABLE');
  }
  function fileFor(binding) {
    const digest = crypto.createHash('sha256').update(JSON.stringify([binding.projectOrigin, binding.terminalId, binding.authorId])).digest('hex');
    return path.join(directory(), `shift-author-${digest}.enc`);
  }
  function publicInfo(saved) {
    return { ...saved.binding, keyId: saved.keyId, publicKey: saved.publicKey, enrolled: saved.enrolled };
  }
  function expected(options = {}) {
    if (!options || typeof options !== 'object' || Object.keys(options).some(key => key !== 'expectedKeyId')) throw failure('ESYNC_SHIFT_AUTHOR_INVALID');
    const value = options.expectedKeyId;
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw failure('ESYNC_SHIFT_AUTHOR_INVALID');
    return value.toLowerCase();
  }
  function encrypted(saved) {
    try { return safeStorage.encryptString(JSON.stringify(saved)); }
    catch { throw failure('ESYNC_SHIFT_AUTHOR_KEY_UNAVAILABLE'); }
  }
  function load(input, options) {
    vault();
    const binding = protocol.normalizeBinding(input), expectedKeyId = expected(options), file = fileFor(binding);
    if (!fs.existsSync(file)) {
      if (expectedKeyId) throw failure('ESYNC_SHIFT_AUTHOR_KEY_MISSING');
      const pair = crypto.generateKeyPairSync('ed25519');
      const saved = { version: 1, binding, keyId: crypto.randomUUID(), publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'), privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), enrolled: false };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // Exclusive creation never replaces a concurrently saved or unreadable key.
      try { fs.writeFileSync(file, encrypted(saved), { flag: 'wx', mode: 0o600 }); }
      catch { throw failure('ESYNC_SHIFT_AUTHOR_KEY_UNAVAILABLE'); }
      return saved;
    }
    let saved;
    try {
      if (fs.statSync(file).size > 16_384) throw new Error('oversized');
      saved = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
      if (saved.version !== 1 || typeof saved.privateKey !== 'string' || saved.privateKey.length > 8192 || typeof saved.enrolled !== 'boolean') throw new Error('invalid');
      const parsedBinding = protocol.normalizeBinding(saved.binding);
      if (JSON.stringify(parsedBinding) !== JSON.stringify(binding)) throw failure('ESYNC_SHIFT_AUTHOR_KEY_MISMATCH');
      protocol.normalizeEnrollment({ version: 1, algorithm: 'Ed25519', keyId: saved.keyId, ...binding, publicKey: saved.publicKey });
      const privateKey = crypto.createPrivateKey(saved.privateKey);
      if (privateKey.asymmetricKeyType !== 'ed25519' || crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64url') !== saved.publicKey) throw new Error('invalid');
    } catch (error) {
      if (error?.code === 'ESYNC_SHIFT_AUTHOR_KEY_MISMATCH') throw error;
      throw failure('ESYNC_SHIFT_AUTHOR_KEY_UNAVAILABLE');
    }
    if (expectedKeyId && saved.keyId !== expectedKeyId) throw failure('ESYNC_SHIFT_AUTHOR_KEY_MISMATCH');
    return saved;
  }
  function prepare(binding, options) { return publicInfo(load(binding, options)); }
  function enrollment(binding, options) {
    const saved = load(binding, options);
    const unsigned = protocol.normalizeEnrollment({ version: 1, algorithm: 'Ed25519', keyId: saved.keyId, ...saved.binding, publicKey: saved.publicKey });
    return { ...unsigned, signature: crypto.sign(null, Buffer.from(protocol.enrollmentMessage(unsigned)), saved.privateKey).toString('base64url') };
  }
  function signIntent(binding, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('ESYNC_SHIFT_AUTHOR_INVALID');
    const { expectedKeyId, ...facts } = input;
    const factKeys = ['subject', 'branchId', 'shiftId', 'intentId', 'action', 'payloadHash'];
    if (Object.keys(facts).length !== factKeys.length || Object.keys(facts).some(key => !factKeys.includes(key))) throw failure('ESYNC_SHIFT_AUTHOR_INVALID');
    // Validate facts before generating any key or writing to the vault.
    const parsedBinding = protocol.normalizeBinding(binding);
    const unsigned = { version: 1, algorithm: 'Ed25519', keyId: '00000000-0000-0000-0000-000000000000', ...parsedBinding, ...facts };
    protocol.intentMessage(unsigned);
    const saved = load(parsedBinding, { expectedKeyId });
    unsigned.keyId = saved.keyId;
    return protocol.normalizeAttestation({ ...unsigned, signature: crypto.sign(null, Buffer.from(protocol.intentMessage(unsigned)), saved.privateKey).toString('base64url') });
  }
  function markEnrolled(binding, response) {
    if (!response || typeof response !== 'object' || Object.keys(response).length !== 2 || !Object.hasOwn(response, 'keyId') || !Object.hasOwn(response, 'publicKey')) throw failure('ESYNC_SHIFT_AUTHOR_INVALID');
    protocol.normalizeEnrollment({ version: 1, algorithm: 'Ed25519', ...protocol.normalizeBinding(binding), keyId: response.keyId, publicKey: response.publicKey });
    const saved = load(binding, { expectedKeyId: response.keyId });
    if (saved.publicKey !== response.publicKey) throw failure('ESYNC_SHIFT_AUTHOR_KEY_MISMATCH');
    if (!saved.enrolled) {
      saved.enrolled = true;
      const file = fileFor(saved.binding), temporary = `${file}.${crypto.randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, encrypted(saved), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, file);
      } catch { throw failure('ESYNC_SHIFT_AUTHOR_KEY_UNAVAILABLE'); }
      finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    return publicInfo(saved);
  }
  return { prepare, enrollment, signIntent, markEnrolled };
}
module.exports = { createShiftAuthorKeys };
