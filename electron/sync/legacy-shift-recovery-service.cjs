"use strict";
// Main-only adapter inside the existing sync coordinator. It does not adopt
// business graphs, clear retained work or advance Change Tracking checkpoints.
const { randomUUID } = require("node:crypto");
const { recordId } = require("./uuid-fields.cjs");
const { exactGraph, stringifyExactJson, isExactNumber } = require("./shift-recovery-exact.cjs");
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const fail = (code = "ELEGACY_RECOVERY_SCOPE") => { throw Object.assign(new Error("Saved closing recovery is not ready or requires administrator review. Existing shift records remain intact."), { code, table: "shifts" }); };
const id = value => { const text = recordId(value); if (!UUID.test(text)) fail(); return text; };
const limitOf = value => { if (!Number.isSafeInteger(value) || value < 1 || value > 100) fail(); return value; };
class LegacyShiftRecoveryService {
  constructor({ connectionManager, registry, cloud, evidenceStore, outbox, authority, readContext }) {
    if (!connectionManager || !registry || !cloud || !evidenceStore || !outbox || !authority || typeof readContext !== "function") fail();
    Object.assign(this, { connectionManager, registry, cloud, evidenceStore, outbox, authority, readContext });
    this.transactions = new WeakMap(); this.capabilities = new WeakMap(); this.pushing = null;
  }
  invalidateCapability() { this.capabilities = new WeakMap(); }
  capability() {
    const pool = this.connectionManager.pool;
    if (!pool || typeof pool !== "object") return Promise.reject(Object.assign(new Error("The local recovery capability cannot be read while SQL Server is unavailable."), { code: "ELEGACY_RECOVERY_CAPABILITY_UNAVAILABLE", table: "shifts", retryable: true }));
    const cached = this.capabilities.get(pool);
    if (cached) return cached;
    const capabilities = this.capabilities;
    const work = async () => {
      try {
        const available = await this.hasSchema(pool);
        if (this.connectionManager.pool !== pool) fail("SYNC_BRANCH_FORBIDDEN");
        return available;
      } catch (error) {
        capabilities.delete(pool);
        if (["ELEGACY_RECOVERY_SCHEMA", "SYNC_BRANCH_FORBIDDEN"].includes(error?.code)) throw error;
        throw Object.assign(new Error("The local recovery capability could not be read. Pending work has not been changed."), { code: "ELEGACY_RECOVERY_CAPABILITY_UNAVAILABLE", table: "shifts", retryable: true, cause: error });
      }
    };
    const result = work(); capabilities.set(pool, result); return result;
  }
  context() {
    const context = this.readContext();
    if (!context || typeof context !== "object" || !HASH.test(context.backendOriginHash) || typeof context.profileKey !== "string" || !context.profileKey || context.profileKey.length > 16384) fail();
    return { branchId: id(context.branchId), terminalId: id(context.terminalId), backendOriginHash: context.backendOriginHash, profileKey: context.profileKey };
  }
  capture(admin = false) {
    const context = this.context(), pool = this.connectionManager.pool, approval = admin ? this.authority.capture() : null;
    if (!pool) fail();
    return { context, pool, approval, databaseGuid: null };
  }
  assertCurrent(capture) {
    if (capture.pool !== this.connectionManager.pool || JSON.stringify(this.context()) !== JSON.stringify(capture.context)) fail("SYNC_BRANCH_FORBIDDEN");
    capture.approval?.assertCurrent();
  }
  async query(tx, text, values = {}) {
    const request = new (this.connectionManager.sql().Request)(tx);
    for (const [key, value] of Object.entries(values)) request.input(key, value);
    return request.query(text);
  }
  assertScope(tx, scope) {
    const active = this.transactions.get(tx);
    if (!active || JSON.stringify(active.scope) !== JSON.stringify(scope)) return false;
    this.assertCurrent(active.capture); return true;
  }
  async atomic(capture, work) {
    this.assertCurrent(capture);
    const sql = this.connectionManager.sql(), tx = new sql.Transaction(capture.pool);
    await tx.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
    try {
      this.assertCurrent(capture);
      const result = await this.query(tx, "SELECT CONVERT(varchar(36),database_guid) database_guid FROM sys.database_recovery_status WHERE database_id=DB_ID();");
      this.assertCurrent(capture);
      if (result.recordset?.length !== 1) fail();
      const databaseGuid = id(result.recordset[0].database_guid);
      if (capture.databaseGuid !== null && capture.databaseGuid !== databaseGuid) fail("SYNC_BRANCH_FORBIDDEN");
      capture.databaseGuid = databaseGuid;
      const scope = { databaseGuid, branchId: capture.context.branchId, terminalId: capture.context.terminalId, backendOriginHash: capture.context.backendOriginHash };
      this.transactions.set(tx, { scope, capture });
      const value = await work(tx, scope);
      this.assertCurrent(capture); await tx.commit(); this.assertCurrent(capture); return value;
    } catch (error) { await Promise.resolve(tx.rollback()).catch(() => undefined); throw error; }
    finally { this.transactions.delete(tx); }
  }
  async hasSchema(tx) {
    const result = await this.query(tx, `SELECT OBJECT_ID(N'dbo.pos_shift_recovery_evidence',N'U') evidence_id,
      OBJECT_ID(N'dbo.pos_sync_shift_legacy_recoveries',N'U') event_id,OBJECT_ID(N'dbo.pos_sync_shift_legacy_recovery_receipts',N'U') receipt_id;`);
    if (result.recordset?.length !== 1) fail("ELEGACY_RECOVERY_SCHEMA");
    const row = result.recordset[0];
    if (row.event_id === null && row.receipt_id === null) return false;
    if (!row.evidence_id || !row.event_id || !row.receipt_id) fail("ELEGACY_RECOVERY_SCHEMA");
    return true;
  }
  async countPending(tx, scope) {
    await this.outbox.preflight(tx, scope); await this.evidenceStore.preflight(tx, scope);
    const result = await this.query(tx, `SELECT CONVERT(nvarchar(30),COUNT_BIG(*)) pending_count FROM dbo.pos_sync_shift_legacy_recoveries e WITH(HOLDLOCK)
      WHERE e.database_guid=@database AND e.branch_id=@branch AND e.terminal_id=@terminal AND e.backend_origin_hash=@backend
      AND NOT EXISTS(SELECT 1 FROM dbo.pos_sync_shift_legacy_recovery_receipts r WHERE r.recovery_id=e.recovery_id);`,
    { database: scope.databaseGuid, branch: scope.branchId, terminal: scope.terminalId, backend: scope.backendOriginHash });
    const value = result.recordset?.[0]?.pending_count;
    if (result.recordset?.length !== 1 || typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) fail("ELEGACY_RECOVERY_PENDING_STATE");
    return Number(value);
  }
  async pendingSummary() {
    // Older installations do not have this optional queue. A harmless schema
    // probe must precede requirements belonging only to the new protocol.
    if (!await this.capability()) return Object.freeze({ available: false, pending: 0 });
    const capture = this.capture();
    return this.atomic(capture, async (tx, scope) => {
      if (!await this.hasSchema(tx)) return Object.freeze({ available: false, pending: 0 });
      return Object.freeze({ available: true, pending: await this.countPending(tx, scope) });
    });
  }
  async list({ afterId = null, limit = 25 } = {}) {
    this.invalidateCapability();
    const capture = this.capture(true); limitOf(limit); if (afterId !== null) id(afterId);
    return this.atomic(capture, async (tx, scope) => {
      if (!await this.hasSchema(tx)) return Object.freeze({ available: false, reason: "UPGRADE_REQUIRED", items: [] });
      const result = await this.query(tx, `SELECT TOP(@limit) CONVERT(varchar(36),id) id,status,state,
        CONVERT(nvarchar(40),opened_at,127) opened_at,CONVERT(nvarchar(40),closed_at,127) closed_at
        FROM dbo.shifts WITH(UPDLOCK,HOLDLOCK) WHERE store_id=@branch AND terminal_id=@terminal AND (@after IS NULL OR id>@after) ORDER BY id;`,
      { limit, branch: scope.branchId, terminal: scope.terminalId, after: afterId });
      const rows = Array.from(result.recordset ?? []); if (rows.length > limit) fail();
      const items = rows.map(row => Object.freeze({ shiftId: id(row.id), status: row.status, state: row.state, openedAt: row.opened_at, closedAt: row.closed_at }));
      return Object.freeze({ available: true, items: Object.freeze(items), nextAfterId: rows.length === limit ? items.at(-1).shiftId : null });
    });
  }
  summary(parent) {
    const text = key => { const value = parent[key]; if (value === null) return null; if (typeof value === "string") return value; if (isExactNumber(value)) return stringifyExactJson(value); fail(); };
    return Object.freeze({ status: text("status"), openedAt: text("opened_at"), closedAt: text("closed_at"),
      countedCash: text("counted_cash"), countedCard: text("counted_card"), countedDigital: text("counted_digital"),
      expectedCash: text("expected_cash"), expectedCard: text("expected_card"), expectedDigital: text("expected_digital") });
  }
  async preview(shiftId) {
    this.invalidateCapability();
    shiftId = id(shiftId); const capture = this.capture(true);
    // Check local identity and database before contacting the cloud, release
    // this transaction, then capture current SQL rows after the response.
    await this.atomic(capture, async (tx, scope) => {
      if (!await this.hasSchema(tx)) fail("ELEGACY_RECOVERY_UPGRADE_REQUIRED");
      const r = await this.query(tx, "SELECT store_id,terminal_id FROM dbo.shifts WITH(UPDLOCK,HOLDLOCK) WHERE id=@id;", { id: shiftId });
      if (r.recordset?.length !== 1 || recordId(r.recordset[0].store_id) !== scope.branchId || recordId(r.recordset[0].terminal_id) !== scope.terminalId) fail("SYNC_BRANCH_FORBIDDEN");
    });
    this.assertCurrent(capture);
    const response = await this.cloud.shiftGraph({ branchId: capture.context.branchId, shiftId });
    this.assertCurrent(capture);
    const exact = exactGraph(response, capture.context.branchId, shiftId);
    if (!exact || !Array.isArray(exact.tables)) fail("ELEGACY_RECOVERY_EXACT_GRAPH_REQUIRED");
    const cloudGraphText = stringifyExactJson(exact.tables);
    return this.atomic(capture, async (tx, scope) => {
      const localTables = await this.outbox.localGraph(tx, scope, shiftId), localGraphText = JSON.stringify(localTables);
      this.outbox.assertOwnedGraphs(scope, localGraphText, cloudGraphText);
      const evidence = await this.evidenceStore.capture(tx, { scope, shiftId, jobId: randomUUID(), localGraphText, cloudGraphText });
      const local = localTables.find(part => part.table === "shifts")?.rows, remote = exact.tables.find(part => part.table === "shifts")?.rows;
      if (local?.length !== 1 || remote?.length !== 1) fail();
      return Object.freeze({ shiftId, captureKey: evidence.captureKey, classification: evidence.classification,
        canApprove: evidence.classification === "legacy-local-closing-needs-review", financialVerification: "UNVERIFIED_HISTORICAL",
        local: this.summary(local[0]), cloud: this.summary(remote[0]) });
    });
  }
  async approve({ captureKey, recoveryId, reason }) {
    this.invalidateCapability();
    const capture = this.capture(true); if (!HASH.test(captureKey)) fail(); recoveryId = id(recoveryId);
    const reviewer = await this.authority.prepare(capture.approval); this.assertCurrent(capture);
    return this.atomic(capture, async (tx, scope) => {
      if (!await this.hasSchema(tx)) fail("ELEGACY_RECOVERY_UPGRADE_REQUIRED");
      const event = await this.outbox.create(tx, { scope, captureKey, recoveryId, reason, reviewer });
      return Object.freeze({ recoveryId: event.recoveryId, state: "PENDING", financialVerification: "UNVERIFIED_HISTORICAL" });
    });
  }
  pushPending({ branchId, limit = 5 }) {
    branchId = id(branchId); limitOf(limit);
    const pool = this.connectionManager.pool;
    if (this.pushing) {
      if (this.pushing.pool !== pool || this.pushing.branchId !== branchId) fail("ELEGACY_RECOVERY_BUSY");
      if (this.pushing.capture) this.assertCurrent(this.pushing.capture);
      return this.pushing.promise;
    }
    const run = { pool, branchId, capture: null, promise: null };
    const work = async () => {
      if (!await this.capability()) return Object.freeze({ skipped: true, reason: "UPGRADE_REQUIRED", acknowledged: 0, pushed: 0, pending: 0 });
      const capture = this.capture(); run.capture = capture;
      if (capture.pool !== pool || branchId !== capture.context.branchId) fail("SYNC_BRANCH_FORBIDDEN");
      const events = await this.atomic(capture, async (tx, scope) => {
        if (!await this.hasSchema(tx)) return null;
        return this.outbox.pending(tx, scope, { limit });
      });
      if (events === null) return Object.freeze({ skipped: true, reason: "UPGRADE_REQUIRED", acknowledged: 0, pushed: 0, pending: 0 });
      let acknowledged = 0;
      for (const event of events) {
        this.assertCurrent(capture);
        // No SQL transaction/locks are held during transport. Lost responses
        // leave the immutable approval pending for the same idempotent retry.
        const witness = await this.cloud.pushLegacyRecovery(event);
        this.assertCurrent(capture);
        await this.atomic(capture, (tx, scope) => this.outbox.acknowledge(tx, { scope, recoveryId: event.recoveryId, witness }));
        acknowledged++;
      }
      const pending = await this.atomic(capture, (tx, scope) => this.countPending(tx, scope));
      return Object.freeze({ skipped: false, acknowledged, pushed: acknowledged, pending, downloadRecoveryComplete: false });
    };
    this.pushing = run;
    run.promise = work().finally(() => { if (this.pushing === run) this.pushing = null; });
    return run.promise;
  }
}
module.exports = { LegacyShiftRecoveryService };
