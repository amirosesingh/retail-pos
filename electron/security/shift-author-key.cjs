// Main-owned dedicated signing material. No IPC export or generic signing API.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const protocol = require('./shift-author-protocol.cjs');
const financialProtocol = require('./shift-financial-protocol.cjs');
const operationProtocol = require('./financial-author-protocol.cjs');
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
  function signClosingStart(binding, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('ESYNC_SHIFT_AUTHOR_INVALID');
    const { expectedKeyId, ...facts } = input;
    const factKeys = ['subject', 'branchId', 'shiftId', 'eventId', 'payloadHash', 'payloadJson'];
    if (Object.keys(facts).length !== factKeys.length || Object.keys(facts).some(key => !factKeys.includes(key))) throw failure('ESYNC_SHIFT_AUTHOR_INVALID');
    const parsedBinding = protocol.normalizeBinding(binding);
    const unsigned = { version: 1, algorithm: 'Ed25519', keyId: '00000000-0000-0000-0000-000000000000', ...parsedBinding, ...facts };
    protocol.closingStartMessage(unsigned);
    if (crypto.createHash('sha256').update(unsigned.payloadJson, 'utf8').digest('hex') !== unsigned.payloadHash) throw failure('ESYNC_SHIFT_AUTHOR_INVALID');
    const saved = load(parsedBinding, { expectedKeyId });
    unsigned.keyId = saved.keyId;
    return protocol.normalizeClosingStart({ ...unsigned, signature: crypto.sign(null, Buffer.from(protocol.closingStartMessage(unsigned)), saved.privateKey).toString('base64url') });
  }
  function signFinancialBasis(binding, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('ESYNC_SHIFT_AUTHOR_INVALID');
    const { expectedKeyId, ...facts } = input;
    const factKeys = ['subject', 'branchId', 'shiftId', 'intentId', 'action', 'graphPayloadHash', 'basisHash', 'serverBasisId', 'formula'];
    if (Object.keys(facts).length !== factKeys.length || Object.keys(facts).some(key => !factKeys.includes(key))) throw failure('ESYNC_SHIFT_AUTHOR_INVALID');
    // This companion may reuse only the exact existing captured key. Missing
    // or unreadable material is never generated/replaced during signing.
    const requiredKey = expected({ expectedKeyId });
    if (!requiredKey) throw failure('ESYNC_SHIFT_AUTHOR_INVALID');
    const parsedBinding = protocol.normalizeBinding(binding);
    const unsigned = { version: 1, algorithm: 'Ed25519', keyId: requiredKey, ...parsedBinding, ...facts };
    financialProtocol.financialBasisMessage(unsigned);
    const saved = load(parsedBinding, { expectedKeyId: requiredKey });
    return financialProtocol.normalizeFinancialBasisAttestation({ ...unsigned, signature: crypto.sign(null, Buffer.from(financialProtocol.financialBasisMessage(unsigned)), saved.privateKey).toString('base64url') });
  }
  function signOpeningFinancialBasis(binding, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('ESYNC_SHIFT_AUTHOR_INVALID');
    const { expectedKeyId, ...facts } = input;
    const factKeys = ['subject', 'branchId', 'shiftId', 'intentId', 'action', 'graphPayloadHash', 'basisHash', 'openingOrigin', 'formula'];
    if (Object.keys(facts).length !== factKeys.length || Object.keys(facts).some(key => !factKeys.includes(key))) throw failure('ESYNC_SHIFT_AUTHOR_INVALID');
    const requiredKey = expected({ expectedKeyId });
    if (!requiredKey) throw failure('ESYNC_SHIFT_AUTHOR_INVALID');
    const parsedBinding = protocol.normalizeBinding(binding);
    const unsigned = { version: 1, algorithm: 'Ed25519', keyId: requiredKey, ...parsedBinding, ...facts };
    financialProtocol.openingFinancialBasisMessage(unsigned);
    const saved = load(parsedBinding, { expectedKeyId: requiredKey });
    return financialProtocol.normalizeOpeningFinancialBasisAttestation({ ...unsigned, signature: crypto.sign(null, Buffer.from(financialProtocol.openingFinancialBasisMessage(unsigned)), saved.privateKey).toString('base64url') });
  }
  function signFinancialOperation(binding, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('ESYNC_SHIFT_AUTHOR_INVALID');
    const { expectedKeyId, ...facts } = input;
    const factKeys = ['subject', 'branchId', 'operationId', 'action', 'payloadHash'];
    if (Object.keys(facts).length !== factKeys.length || Object.keys(facts).some(key => !factKeys.includes(key))) throw failure('ESYNC_SHIFT_AUTHOR_INVALID');
    const requiredKey = expected({ expectedKeyId });
    if (!requiredKey) throw failure('ESYNC_SHIFT_AUTHOR_INVALID');
    const parsedBinding = protocol.normalizeBinding(binding);
    const unsigned = { version: 1, algorithm: 'Ed25519', keyId: requiredKey, ...parsedBinding, ...facts };
    operationProtocol.financialOperationMessage(unsigned);
    const saved = load(parsedBinding, { expectedKeyId: requiredKey });
    return operationProtocol.normalizeFinancialAttestation({ ...unsigned, signature: crypto.sign(null, Buffer.from(operationProtocol.financialOperationMessage(unsigned)), saved.privateKey).toString('base64url') });
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
  function signLegacyRecovery(binding, input) {
    const legacy = require('./legacy-shift-recovery-protocol.cjs');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('ESYNC_SHIFT_AUTHOR_INVALID');
    const { expectedKeyId, ...facts } = input;
    const fields = ['subject', 'branchId', 'shiftId', 'recoveryId', 'action', 'payloadHash'];
    if (Object.keys(facts).length !== fields.length || fields.some(key => !Object.hasOwn(facts, key))) throw failure('ESYNC_SHIFT_AUTHOR_INVALID');
    const keyId = expected({ expectedKeyId });
    if (!keyId) throw failure('ESYNC_SHIFT_AUTHOR_INVALID');
    const parsedBinding = protocol.normalizeBinding(binding);
    const unsigned = { version: 1, algorithm: 'Ed25519', keyId, ...parsedBinding, ...facts };
    legacy.legacyRecoveryMessage(unsigned);
    // Existing enrolled key only. Recovery never creates, rotates or enrolls it.
    const saved = load(parsedBinding, { expectedKeyId: keyId });
    if (!saved.enrolled) throw failure('ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING');
    return legacy.normalizeLegacyRecovery({ ...unsigned, signature: crypto.sign(null, Buffer.from(legacy.legacyRecoveryMessage(unsigned)), saved.privateKey).toString('base64url') });
  }
  function signStockEvent(binding, input) {
    const stock = require('./stock-event-author-protocol.cjs');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('ESTOCK_AUTHOR_INVALID');
    const { expectedKeyId, ...facts } = input;
    const fields = ['subject', 'branchId', 'operationId', 'movementId', 'action', 'payloadHash'];
    if (Object.keys(facts).length !== fields.length || fields.some(key => !Object.hasOwn(facts, key))) throw failure('ESTOCK_AUTHOR_INVALID');
    const keyId = expected({ expectedKeyId });
    if (!keyId) throw failure('ESTOCK_AUTHOR_INVALID');
    const parsedBinding = protocol.normalizeBinding(binding);
    const unsigned = stock.unsignedStockEvent({ version: 1, algorithm: 'Ed25519', keyId, ...parsedBinding, ...facts });
    // Exact existing enrolled material only. Signing cannot create/rotate a key.
    const saved = load(parsedBinding, { expectedKeyId: keyId });
    if (!saved.enrolled) throw failure('ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING');
    return stock.normalizeStockEvent({ ...unsigned, signature: crypto.sign(null, Buffer.from(stock.stockEventMessage(unsigned)), saved.privateKey).toString('base64url') });
  }
  return { prepare, enrollment, signIntent, signClosingStart, signFinancialBasis, signOpeningFinancialBasis, signFinancialOperation, signLegacyRecovery, signStockEvent, markEnrolled };
}
module.exports = { createShiftAuthorKeys };
