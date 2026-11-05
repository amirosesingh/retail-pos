"use strict";

// Main-only approval authority. This signs a CURRENT Administrator recovery
// decision, never an old cashier's ORIGINAL/RECOUNT or financial snapshot.
const crypto = require("node:crypto");
const bindingProtocol = require("./security/shift-author-protocol.cjs");
const protocol = require("./security/legacy-shift-recovery-protocol.cjs");
const { binding: terminalBinding } = require("./verified-activation.cjs");
const { recordId } = require("./sync/uuid-fields.cjs");
const { scopeHash } = require("./shift-authority.cjs");
const fail = (code = "ESYNC_LEGACY_RECOVERY_AUTHORITY") => {
  throw Object.assign(new Error("Administrator recovery approval is unavailable. Saved shift evidence remains intact."), { code, table: "shifts" });
};

class LegacyShiftRecoveryAuthority {
  constructor({ keys, session, connectionManager, terminal, project, branch, backendUrl, isManagementDevice = () => false }) {
    Object.assign(this, { keys, session, connectionManager, terminal, project, branch, backendUrl, isManagementDevice });
    this.captures = new WeakSet(); this.reviewers = new WeakSet();
  }
  binding(authorId) {
    return bindingProtocol.normalizeBinding({ projectOrigin: this.project(), terminalId: this.terminal()?.tokenId, authorId });
  }
  context() {
    const saved = this.terminal();
    const terminal = terminalBinding(saved);
    const branch = recordId(String(this.branch() ?? ""));
    if (!terminal || terminal.mode !== "operations" || terminal.platform !== "pc" ||
        this.isManagementDevice() || !branch || branch !== terminal.branchId) fail("SYNC_BRANCH_FORBIDDEN");
    let url;
    try { url = new URL(String(this.backendUrl() ?? "")); } catch { fail(); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) fail();
    return JSON.stringify([saved, this.project(), branch, url.href]);
  }
  capture() {
    const person = this.session.identity();
    if (!person || person.source !== "pos" || person.level !== "admin") fail("PERMISSION_DENIED");
    const binding = Object.freeze(this.binding(person.authorId));
    const branchId = recordId(String(this.branch() ?? ""));
    const subject = person.canonicalSubject;
    if (typeof subject !== "string" || !subject || subject !== subject.trim() || subject.length > 200 || /[\u0000-\u001f\u007f]/.test(subject)) fail();
    if (person.branchId && recordId(String(person.branchId)) !== branchId) fail("SYNC_BRANCH_FORBIDDEN");
    const epoch = this.session.epoch(), context = this.context(), pool = this.connectionManager.pool;
    if (!pool) fail("ESYNC_SHIFT_AUTHOR_SETUP_PENDING");
    const capture = Object.freeze({ binding, subject, branchId, assertCurrent: () => {
      const now = this.session.identity();
      if (!now || now.source !== "pos" || now.level !== "admin" || this.session.epoch() !== epoch ||
          now.authorId !== binding.authorId || now.canonicalSubject !== subject ||
          (now.branchId && recordId(String(now.branchId)) !== branchId) || this.connectionManager.pool !== pool ||
          this.context() !== context || JSON.stringify(this.binding(now.authorId)) !== JSON.stringify(binding)) fail();
    } });
    this.captures.add(capture); return capture;
  }
  async prepare(capture) {
    if (!this.captures.has(capture)) fail();
    capture.assertCurrent();
    const sql = this.connectionManager.sql(), tx = new sql.Transaction(this.connectionManager.pool);
    await tx.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
    try {
      capture.assertCurrent();
      const result = await new sql.Request(tx).input("scope", scopeHash(capture.binding)).query(
        "SELECT scope_hash,project_origin,terminal_id,author_id,key_id,public_key FROM dbo.pos_sync_shift_author_keys WITH(UPDLOCK,HOLDLOCK) WHERE scope_hash=@scope;",
      );
      const rows = result.recordset ?? [];
      if (rows.length !== 1) fail("ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING");
      const row = rows[0];
      if (row.project_origin !== capture.binding.projectOrigin || row.terminal_id !== capture.binding.terminalId ||
          recordId(String(row.author_id)) !== capture.binding.authorId) fail("ESYNC_SHIFT_AUTHOR_KEY_MISMATCH");
      const info = this.keys.prepare(capture.binding, { expectedKeyId: recordId(String(row.key_id)) });
      if (!info.enrolled || info.keyId !== recordId(String(row.key_id)) || info.publicKey !== row.public_key) fail("ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING");
      capture.assertCurrent(); await tx.commit(); capture.assertCurrent();
      const reviewer = Object.freeze({ binding: capture.binding, subject: capture.subject, branchId: capture.branchId, keyId: info.keyId,
        assertCurrent: capture.assertCurrent,
        signRecovery: ({ branchId, shiftId, recoveryId, payloadHash }) => {
          capture.assertCurrent();
          if (branchId !== capture.branchId) fail("SYNC_BRANCH_FORBIDDEN");
          const signed = this.keys.signLegacyRecovery(capture.binding, { expectedKeyId: info.keyId, subject: capture.subject,
            branchId, shiftId, recoveryId, action: "LEGACY_CLOSING_RECOVERY_V1", payloadHash });
          capture.assertCurrent(); return signed;
        },
      });
      this.reviewers.add(reviewer); return reviewer;
    } catch (error) { await Promise.resolve(tx.rollback()).catch(() => undefined); throw error; }
  }
  assertPrepared(reviewer) {
    if (!this.reviewers.has(reviewer)) fail();
    reviewer.assertCurrent();
  }
  validatePending(value) {
    const proof = protocol.normalizeLegacyRecovery(value), binding = this.binding(proof.authorId);
    this.context();
    // A later cashier may replay a frozen approval; the cloud rechecks the
    // real reviewer's current administrator role. No new signature is issued.
    if (binding.projectOrigin !== proof.projectOrigin || binding.terminalId !== proof.terminalId ||
        terminalBinding(this.terminal())?.mode !== "operations" || this.isManagementDevice() ||
        recordId(String(this.branch() ?? "")) !== proof.branchId) fail("SYNC_BRANCH_FORBIDDEN");
    const info = this.keys.prepare(binding, { expectedKeyId: proof.keyId });
    if (!info.enrolled) fail("ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING");
    const { signature, ...unsigned } = proof;
    if (!crypto.verify(null, Buffer.from(protocol.legacyRecoveryMessage(unsigned)),
      crypto.createPublicKey({ key: Buffer.from(info.publicKey, "base64url"), format: "der", type: "spki" }),
      Buffer.from(signature, "base64url"))) fail();
    return proof;
  }
}
module.exports = { LegacyShiftRecoveryAuthority };
