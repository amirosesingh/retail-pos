const crypto = require("node:crypto");
const protocol = require("./security/shift-author-protocol.cjs");
const { recordId } = require("./sync/uuid-fields.cjs");
const permissions = {
  START_CLOSE: ["can_close_shift"],
  ORIGINAL: ["can_shift_cash_count", "can_close_shift"],
  RECOUNT: ["can_shift_cash_recount"],
  VARIANCE: ["can_shift_variance_approve"],
  ENROLL: [],
};
const fail = (code = "ESYNC_SHIFT_AUTHOR_CHANGED") => {
  throw Object.assign(
    new Error(
      "The protected shift author could not be confirmed. Keep the work for review or sign in again as its author.",
    ),
    { code, table: "shifts" },
  );
};
const scopeHash = (binding) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify([binding.projectOrigin, binding.terminalId, binding.authorId]))
    .digest("hex");

class ShiftAuthorAuthority {
  constructor({
    keys,
    session,
    connectionManager,
    terminal,
    project,
    branch,
    isManagementDevice = () => false,
    backendUrl,
    fetcher = fetch,
  }) {
    Object.assign(this, {
      keys,
      session,
      connectionManager,
      terminal,
      project,
      branch,
      isManagementDevice,
      backendUrl,
      fetcher,
    });
    this.captures = new WeakSet();
    this.enrollments = new Map();
  }
  binding(authorId) {
    const terminal = this.terminal();
    return protocol.normalizeBinding({
      projectOrigin: this.project(),
      terminalId: recordId(String(terminal?.tokenId ?? "").trim()),
      authorId,
    });
  }
  terminalIdentity() {
    const terminal = this.terminal() ?? {};
    return JSON.stringify([
      terminal.tokenId,
      terminal.deviceUse,
      terminal.deviceType,
      terminal.locationId,
      terminal.storeId,
      terminal.branchId,
      terminal.deviceBindingProof,
      terminal.deviceClaimProof,
    ]);
  }
  capture(action) {
    const identity = this.session.identity(),
      epoch = this.session.epoch();
    const management = this.isManagementDevice();
    if (
      !Object.hasOwn(permissions, action) ||
      !identity ||
      identity.source !== "pos" ||
      (management && action !== "ENROLL") ||
      (permissions[action].length &&
        !permissions[action].some((key) => this.session.hasPermission(key)))
    )
      fail("PERMISSION_DENIED");
    const binding = this.binding(identity.authorId),
      subject = identity.canonicalSubject;
    if (
      typeof subject !== "string" ||
      !subject ||
      subject !== subject.trim() ||
      subject.length > 200 ||
      /[\u0000-\u001f\u007f]/u.test(subject)
    )
      fail("ESYNC_SHIFT_AUTHOR_IDENTITY_PENDING");
    const branchId = String(this.branch() ?? "");
    if ((!branchId && action !== "ENROLL") || branchId.length > 128) fail("EBRANCH");
    if (branchId && identity.branchId && recordId(String(identity.branchId)) !== recordId(branchId))
      fail("SYNC_BRANCH_FORBIDDEN");
    const terminalIdentity = this.terminalIdentity(),
      pool = this.connectionManager.pool;
    const capture = {
      binding: Object.freeze(binding),
      subject,
      branchId,
      action,
      epoch,
      pool,
      assertCurrent: () => {
        const now = this.session.identity();
        if (
          !now ||
          now.source !== "pos" ||
          this.session.epoch() !== epoch ||
          now.authorId !== binding.authorId ||
          now.canonicalSubject !== subject ||
          this.terminalIdentity() !== terminalIdentity ||
          String(this.branch() ?? "") !== branchId ||
          this.connectionManager.pool !== pool ||
          this.isManagementDevice() !== management ||
          (permissions[action].length &&
            !permissions[action].some((key) => this.session.hasPermission(key))) ||
          JSON.stringify(this.binding(now.authorId)) !== JSON.stringify(binding)
        )
          fail();
      },
    };
    this.captures.add(capture);
    return Object.freeze(capture);
  }
  query(transaction, statement, inputs = {}) {
    const request = new (this.connectionManager.sql().Request)(
      transaction ?? this.connectionManager.pool,
    );
    for (const [name, value] of Object.entries(inputs)) request.input(name, value);
    return request.query(statement);
  }
  async prepare(capture) {
    if (!this.captures.has(capture)) fail("ESYNC_SHIFT_AUTHOR_INVALID");
    capture.assertCurrent();
    if (!this.connectionManager.pool) fail("ESYNC_SHIFT_AUTHOR_SETUP_PENDING");
    const sql = this.connectionManager.sql(),
      transaction = new sql.Transaction(this.connectionManager.pool);
    await transaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
    try {
      const hash = scopeHash(capture.binding),
        saved = (
          await this.query(
            transaction,
            "SELECT * FROM dbo.pos_sync_shift_author_keys WITH(UPDLOCK,HOLDLOCK) WHERE scope_hash=@scope;",
            { scope: hash },
          )
        ).recordset?.[0];
      const references =
        (
          await this.query(
            transaction,
            "SELECT DISTINCT TOP(2) key_id FROM (SELECT key_id FROM dbo.pos_sync_shift_authors WITH(UPDLOCK,HOLDLOCK) WHERE scope_hash=@scope UNION ALL SELECT CONVERT(uniqueidentifier,JSON_VALUE(proof_json,'$.keyId')) key_id FROM dbo.pos_sync_shift_closing_starts WITH(UPDLOCK,HOLDLOCK) WHERE JSON_VALUE(proof_json,'$.projectOrigin')=@project AND JSON_VALUE(proof_json,'$.terminalId')=@terminal AND JSON_VALUE(proof_json,'$.authorId')=@author) proofs;",
            { scope: hash, project: capture.binding.projectOrigin, terminal: capture.binding.terminalId, author: capture.binding.authorId },
          )
        ).recordset ?? [];
      if (
        references.length > 1 ||
        (saved &&
          references.some(
            (row) => String(row.key_id).toLowerCase() !== String(saved.key_id).toLowerCase(),
          ))
      )
        fail("ESYNC_SHIFT_AUTHOR_KEY_MISMATCH");
      capture.assertCurrent();
      if (
        saved &&
        (saved.project_origin !== capture.binding.projectOrigin ||
          saved.terminal_id !== capture.binding.terminalId ||
          recordId(String(saved.author_id)) !== capture.binding.authorId)
      )
        fail("ESYNC_SHIFT_AUTHOR_KEY_MISMATCH");
      const expectedKeyId = saved?.key_id ?? references[0]?.key_id;
      const info = this.keys.prepare(
        capture.binding,
        expectedKeyId ? { expectedKeyId: String(expectedKeyId).toLowerCase() } : {},
      );
      if (
        saved &&
        (String(saved.key_id).toLowerCase() !== info.keyId || saved.public_key !== info.publicKey)
      )
        fail("ESYNC_SHIFT_AUTHOR_KEY_MISMATCH");
      if (!saved)
        await this.query(
          transaction,
          "INSERT dbo.pos_sync_shift_author_keys(scope_hash,project_origin,terminal_id,author_id,key_id,public_key) VALUES(@scope,@project,@terminal,@author,@key,@public);",
          {
            scope: hash,
            project: info.projectOrigin,
            terminal: info.terminalId,
            author: info.authorId,
            key: info.keyId,
            public: info.publicKey,
          },
        );
      capture.assertCurrent();
      await transaction.commit();
      return Object.freeze({
        binding: capture.binding,
        keyId: info.keyId,
        subject: capture.subject,
        assertCurrent: capture.assertCurrent,
        sign: ({ branchId, shiftId, intentId, action, payloadHash }) => {
          capture.assertCurrent();
          if (branchId !== capture.branchId || action !== capture.action)
            fail("ESYNC_SHIFT_AUTHOR_INVALID");
          const attestation = this.keys.signIntent(capture.binding, {
            expectedKeyId: info.keyId,
            subject: capture.subject,
            branchId,
            shiftId,
            intentId,
            action,
            payloadHash,
          });
          capture.assertCurrent();
          return attestation;
        },
        signClosingStart: ({ branchId, shiftId, eventId, payloadJson }) => {
          capture.assertCurrent();
          if (capture.action !== 'START_CLOSE' || branchId !== capture.branchId) fail('ESYNC_SHIFT_AUTHOR_INVALID');
          const proof = this.keys.signClosingStart(capture.binding, { expectedKeyId: info.keyId, subject: capture.subject,
            branchId, shiftId, eventId, payloadJson, payloadHash: crypto.createHash('sha256').update(payloadJson, 'utf8').digest('hex') });
          capture.assertCurrent();
          return proof;
        },
        save: async (transaction, attestation) => {
          capture.assertCurrent();
          await this.query(
            transaction,
            "INSERT dbo.pos_sync_shift_authors(intent_id,scope_hash,key_id,attestation_json) VALUES(@intent,@scope,@key,@attestation);",
            {
              intent: attestation.intentId,
              scope: hash,
              key: info.keyId,
              attestation: JSON.stringify(attestation),
            },
          );
        },
      });
    } catch (error) {
      await Promise.resolve(transaction.rollback()).catch(() => undefined);
      throw error;
    }
  }
  validatePending(value) {
    const attestation = protocol.normalizeAttestation(value),
      binding = this.binding(attestation.authorId);
    if (
      JSON.stringify(binding) !==
      JSON.stringify({
        projectOrigin: attestation.projectOrigin,
        terminalId: attestation.terminalId,
        authorId: attestation.authorId,
      })
    )
      fail("ESYNC_SHIFT_AUTHOR_BINDING_MISMATCH");
    const info = this.keys.prepare(binding, { expectedKeyId: attestation.keyId });
    if (!info.enrolled) fail("ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING");
    const { signature, ...unsigned } = attestation;
    if (
      !crypto.verify(
        null,
        Buffer.from(protocol.intentMessage(unsigned)),
        crypto.createPublicKey({
          key: Buffer.from(info.publicKey, "base64url"),
          format: "der",
          type: "spki",
        }),
        Buffer.from(signature, "base64url"),
      )
    )
      fail("ESYNC_SHIFT_AUTHOR_INVALID");
    return attestation;
  }
  validatePendingClosingStart(value) {
    const proof = protocol.normalizeClosingStart(value), binding = this.binding(proof.authorId);
    if (binding.projectOrigin !== proof.projectOrigin || binding.terminalId !== proof.terminalId) fail('ESYNC_SHIFT_AUTHOR_BINDING_MISMATCH');
    const info = this.keys.prepare(binding, { expectedKeyId: proof.keyId });
    if (!info.enrolled) fail('ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING');
    const { signature, ...unsigned } = proof;
    if (crypto.createHash('sha256').update(proof.payloadJson, 'utf8').digest('hex') !== proof.payloadHash ||
      !crypto.verify(null, Buffer.from(protocol.closingStartMessage(unsigned)), crypto.createPublicKey({key:Buffer.from(info.publicKey,'base64url'),format:'der',type:'spki'}), Buffer.from(signature,'base64url'))) fail('ESYNC_SHIFT_AUTHOR_INVALID');
    return proof;
  }
  async enrollOnline(proof) {
    try {
      if (!proof?.cashierToken && !proof?.accessToken)
        return { ok: false, code: "ESYNC_SHIFT_AUTHOR_IDENTITY_PENDING" };
      const capture = this.capture("ENROLL"),
        enrollmentKey = `${scopeHash(capture.binding)}:${capture.epoch}`;
      // An earlier session may be waiting on SQL and about to fail its epoch
      // check. A fresh verified login must retain its own enrollment attempt.
      if (this.enrollments.has(enrollmentKey)) return this.enrollments.get(enrollmentKey);
      const work = (async () => {
        try {
          const author = await this.prepare(capture);
          capture.assertCurrent();
          const signed = this.keys.enrollment(capture.binding, { expectedKeyId: author.keyId }),
            { signature, ...enrollment } = signed;
          const base = String(this.backendUrl() ?? "").replace(/\/+$/, "");
          if (!base) return { ok: false, code: "ESYNC_SHIFT_AUTHOR_SETUP_PENDING" };
          const response = await this.fetcher(`${base}/api/v1/pos/shift-author-enroll`, {
            method: "POST",
            redirect: "error",
            headers: { "content-type": "application/json" },
            signal: AbortSignal.timeout(10_000),
            body: JSON.stringify({
              ...(proof.accessToken ? { accessToken: proof.accessToken } : {}),
              ...(proof.cashierToken ? { cashierToken: proof.cashierToken } : {}),
              ...(proof.sessionToken ? { sessionToken: proof.sessionToken } : {}),
              terminalToken: capture.binding.terminalId,
              deviceBindingProof: this.terminal()?.deviceBindingProof,
              enrollment,
              signature,
            }),
          });
          const result = await response.json();
          if (
            !response.ok ||
            result?.ok !== true ||
            result.enrolled !== true ||
            result.keyId !== author.keyId ||
            result.authorId !== capture.binding.authorId ||
            result.subject !== capture.subject ||
            result.projectOrigin !== capture.binding.projectOrigin ||
            result.terminalId !== capture.binding.terminalId ||
            result.publicKey !== signed.publicKey
          )
            return { ok: false, code: "ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING" };
          // This updates only the captured author's exact key. It never adopts
          // the completed request as the current person's session or grants.
          this.keys.markEnrolled(capture.binding, {
            keyId: author.keyId,
            publicKey: result.publicKey,
          });
          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            code:
              typeof error?.code === "string"
                ? error.code
                : "ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING",
          };
        }
      })();
      this.enrollments.set(enrollmentKey, work);
      try {
        return await work;
      } finally {
        if (this.enrollments.get(enrollmentKey) === work) this.enrollments.delete(enrollmentKey);
      }
    } catch (error) {
      return {
        ok: false,
        code:
          typeof error?.code === "string" ? error.code : "ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING",
      };
    }
  }
}
module.exports = { ShiftAuthorAuthority, scopeHash };
