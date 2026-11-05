"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createShiftAuthorKeys } = require("../electron/security/shift-author-key.cjs");
const { LegacyShiftRecoveryAuthority } = require("../electron/legacy-shift-recovery-authority.cjs");
const protocol = require("../electron/security/legacy-shift-recovery-protocol.cjs");
const { scopeHash } = require("../electron/shift-authority.cjs");
const AUTHOR = "10000000-0000-4000-8000-000000000001", TERMINAL = "20000000-0000-4000-8000-000000000001";
const BRANCH = "30000000-0000-4000-8000-000000000001", SHIFT = "40000000-0000-4000-8000-000000000001", RECOVERY = "50000000-0000-4000-8000-000000000001";
function fixture(t) {
  const root = path.resolve(__dirname, "../.tmp"); fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, "legacy-author-"));
  t.after(() => { assert(directory.startsWith(root + path.sep + "legacy-author-")); fs.rmSync(directory, { recursive: true, force: true }); });
  const secret = crypto.randomBytes(32);
  const storage = { isEncryptionAvailable: () => true };
  storage.encryptString = text => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", secret, iv); const data = Buffer.concat([c.update(text, "utf8"), c.final()]); return Buffer.concat([iv, c.getAuthTag(), data]); };
  storage.decryptString = data => { const d = crypto.createDecipheriv("aes-256-gcm", secret, data.subarray(0, 12)); d.setAuthTag(data.subarray(12, 28)); return Buffer.concat([d.update(data.subarray(28)), d.final()]).toString("utf8"); };
  const keys = createShiftAuthorKeys({ safeStorage: storage, directory: () => directory });
  const binding = { projectOrigin: "https://fixture.supabase.co", terminalId: TERMINAL, authorId: AUTHOR };
  const info = keys.prepare(binding); keys.markEnrolled(binding, { keyId: info.keyId, publicKey: info.publicKey });
  const identity = { source: "pos", level: "admin", authorId: AUTHOR, canonicalSubject: "admin.fixture", branchId: null };
  const terminal = { tokenId: TERMINAL, deviceUse: "operations", deviceType: "pc", locationId: BRANCH, deviceBindingProof: "a".repeat(64) };
  let epoch = 1, branch = BRANCH, project = binding.projectOrigin, backend = "https://pos.fixture", management = false, hook = () => {}, saved = true;
  const queries = [], pool = {};
  class Transaction { async begin() {} async commit() {} async rollback() {} }
  class Request {
    constructor(tx) { assert(tx instanceof Transaction); this.inputs = {}; }
    input(name, value) { this.inputs[name] = value; return this; }
    async query(sql) { queries.push(sql); await hook(); return { recordset: saved ? [{ scope_hash: scopeHash(binding), project_origin: binding.projectOrigin,
      terminal_id: TERMINAL, author_id: AUTHOR, key_id: info.keyId, public_key: info.publicKey }] : [] }; }
  }
  const cm = { pool, sql: () => ({ Transaction, Request, ISOLATION_LEVEL: { SERIALIZABLE: "serializable" } }) };
  const authority = new LegacyShiftRecoveryAuthority({ keys, session: { identity: () => identity, epoch: () => epoch }, connectionManager: cm,
    terminal: () => terminal, project: () => project, branch: () => branch, backendUrl: () => backend, isManagementDevice: () => management });
  return { authority, keys, binding, info, identity, terminal, cm, directory, queries,
    epoch: () => { epoch++; }, branch: value => { branch = value; }, project: value => { project = value; },
    backend: value => { backend = value; }, management: () => { management = true; }, hook: value => { hook = value; }, noSavedKey: () => { saved = false; } };
}
const facts = () => ({ branchId: BRANCH, shiftId: SHIFT, recoveryId: RECOVERY, payloadHash: "b".repeat(64) });
test("only a real current POS admin can capture recovery authority", t => {
  const f = fixture(t);
  for (const change of [{ level: "supervisor" }, { level: "staff" }, { source: "manual" }]) {
    const original = { ...f.identity }; Object.assign(f.identity, change);
    assert.throws(() => f.authority.capture(), { code: "PERMISSION_DENIED" }); Object.assign(f.identity, original);
  }
  assert.doesNotThrow(() => f.authority.capture());
});
test("management or another branch cannot use Operations recovery", t => {
  const f = fixture(t); f.management(); assert.throws(() => f.authority.capture(), { code: "SYNC_BRANCH_FORBIDDEN" });
});
test("account and configured branch both remain subordinate to the registered branch", t => {
  const f = fixture(t); f.identity.branchId = SHIFT; assert.throws(() => f.authority.capture(), { code: "SYNC_BRANCH_FORBIDDEN" });
  f.identity.branchId = null; f.branch(SHIFT); assert.throws(() => f.authority.capture(), { code: "SYNC_BRANCH_FORBIDDEN" });
});
test("preparation reads the existing enrolled key and issues only the new recovery signature domain", async t => {
  const f = fixture(t), before = fs.readFileSync(path.join(f.directory, fs.readdirSync(f.directory)[0]));
  const reviewer = await f.authority.prepare(f.authority.capture());
  const signed = reviewer.signRecovery(facts());
  assert.equal(signed.action, "LEGACY_CLOSING_RECOVERY_V1"); assert.equal(signed.authorId, AUTHOR);
  assert.equal(f.authority.validatePending(signed).subject, "admin.fixture");
  assert.equal(f.queries.every(sql => /^SELECT /.test(sql)), true);
  assert.deepEqual(fs.readFileSync(path.join(f.directory, fs.readdirSync(f.directory)[0])), before);
  const { signature, ...unsigned } = signed;
  assert(crypto.verify(null, Buffer.from(protocol.legacyRecoveryMessage(unsigned)), crypto.createPublicKey({ key: Buffer.from(f.info.publicKey, "base64url"), type: "spki", format: "der" }), Buffer.from(signature, "base64url")));
  assert.throws(() => f.authority.assertPrepared({ ...reviewer }), { code: "ESYNC_LEGACY_RECOVERY_AUTHORITY" });
});
test("missing SQL enrollment never generates or enrolls a replacement key", async t => {
  const f = fixture(t), files = fs.readdirSync(f.directory); f.noSavedKey();
  await assert.rejects(f.authority.prepare(f.authority.capture()), { code: "ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING" });
  assert.deepEqual(fs.readdirSync(f.directory), files);
});
test("a missing sealed key is held instead of regenerated", async t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.directory, fs.readdirSync(f.directory)[0]));
  await assert.rejects(f.authority.prepare(f.authority.capture()), { code: "ESYNC_SHIFT_AUTHOR_KEY_MISSING" });
  assert.deepEqual(fs.readdirSync(f.directory), []);
});
for (const change of ["epoch", "person", "role", "branch", "profile", "project", "backend", "proof"]) test(`authority changes during key preparation fail closed: ${change}`, async t => {
  const f = fixture(t), capture = f.authority.capture();
  f.hook(() => {
    if (change === "epoch") f.epoch(); if (change === "person") f.identity.authorId = SHIFT;
    if (change === "role") f.identity.level = "supervisor"; if (change === "branch") f.branch(SHIFT);
    if (change === "profile") f.cm.pool = {}; if (change === "project") f.project("https://other.supabase.co");
    if (change === "backend") f.backend("https://other.fixture"); if (change === "proof") f.terminal.deviceBindingProof = "c".repeat(64);
  });
  await assert.rejects(f.authority.prepare(capture));
});
test("90/365-day frozen approvals replay under a later cashier without re-signing as that cashier", async t => {
  const f = fixture(t), reviewer = await f.authority.prepare(f.authority.capture()), proof = reviewer.signRecovery(facts());
  f.identity.level = "staff"; f.identity.authorId = SHIFT; f.identity.canonicalSubject = "cashier.fixture"; f.epoch();
  for (const days of [90, 365]) { assert.equal(f.authority.validatePending(proof).authorId, AUTHOR); assert(days > 0); }
  assert.throws(() => reviewer.signRecovery(facts()));
  assert.throws(() => f.authority.validatePending({ ...proof, payloadHash: "d".repeat(64) }));
});
