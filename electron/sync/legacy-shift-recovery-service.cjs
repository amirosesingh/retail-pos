"use strict";
// Main-only adapter inside the existing sync coordinator. Reviewed adoption
// changes only the proved local graph; existing lifecycle recovery owns V0.
const { randomUUID } = require("node:crypto");
const { recordId } = require("./uuid-fields.cjs");
const { exactGraph, stringifyExactJson, isExactNumber } = require("./shift-recovery-exact.cjs");
const { classifyRetainedShiftGraph } = require("./shift-recovery-classification.cjs");
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const fail = (code = "ELEGACY_RECOVERY_SCOPE") => { throw Object.assign(new Error("Saved closing recovery is not ready or requires administrator review. Existing shift records remain intact."), { code, table: "shifts" }); };
const id = value => { const text = recordId(value); if (!UUID.test(text)) fail(); return text; };
const limitOf = value => { if (!Number.isSafeInteger(value) || value < 1 || value > 100) fail(); return value; };
class LegacyShiftRecoveryService {
  constructor({ connectionManager, registry, cloud, evidenceStore, outbox, authority, readContext, adopter = null }) {
    if (!connectionManager || !registry || !cloud || !evidenceStore || !outbox || !authority || typeof readContext !== "function") fail();
    Object.assign(this, { connectionManager, registry, cloud, evidenceStore, outbox, authority, readContext, adopter });
    this.transactions = new WeakMap(); this.capabilities = new WeakMap(); this.pushing = null;
    this.reviewedDecisions = new Map(); this.coverageTokens = new WeakMap();
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
  async withRecoveryTransaction(capture, tx, work) {
    this.assertCurrent(capture);
    if (!tx || tx.parent !== capture.pool || this.transactions.has(tx)) fail("ELEGACY_RECOVERY_SCOPE");
    const result = await this.query(tx, `SELECT CONVERT(varchar(36),database_guid) database_guid,
      CASE WHEN @@TRANCOUNT>0 AND EXISTS(SELECT 1 FROM sys.dm_exec_sessions WHERE session_id=@@SPID AND transaction_isolation_level=4) THEN 1 ELSE 0 END ready
      FROM sys.database_recovery_status WHERE database_id=DB_ID();`);
    if (result.recordset?.length !== 1 || result.recordset[0].ready !== 1 || id(result.recordset[0].database_guid) !== capture.databaseGuid) fail("ELEGACY_RECOVERY_SCOPE");
    this.assertCurrent(capture);
    const scope = { databaseGuid: capture.databaseGuid, branchId: capture.context.branchId, terminalId: capture.context.terminalId, backendOriginHash: capture.context.backendOriginHash };
    this.transactions.set(tx, { scope, capture });
    try { const value = await work(scope); this.assertCurrent(capture); return value; }
    finally { this.transactions.delete(tx); }
  }
  // Only requested gap graphs enter here. No network runs under SQL locks;
  // persisted ACK/adoption rows are hints until a fresh private proof is read.
  async prepareCoverage(graph) {
    if (!this.adopter) return null;
    const capture = this.capture(), shiftId = id(graph?.shiftId);
    if (!exactGraph(graph, capture.context.branchId, shiftId)) fail("ELEGACY_RECOVERY_EXACT_GRAPH_REQUIRED");
    let review = this.reviewedDecisions.get(shiftId);
    if (review) { try { this.authority.assertPrepared(review.reviewer); this.assertCurrent(review.capture); } catch { this.reviewedDecisions.delete(shiftId); review = null; } }
    const saved = await this.atomic(capture, async (tx, scope) => {
      if (!await this.hasSchema(tx) || !await this.adoptionAvailable(tx)) return null;
      const rows = (await this.query(tx, `SELECT TOP(1) CONVERT(varchar(36),decision_id) decision_id,CONVERT(varchar(36),receipt_recovery_id) receipt_recovery_id,target_graph_json
        FROM dbo.pos_shift_recovery_adoptions WITH(HOLDLOCK) WHERE database_guid=@database AND branch_id=@branch AND terminal_id=@terminal
        AND backend_origin_hash=@backend AND shift_id=@shift AND ${review ? "decision_id=@decision" : "decision_kind='RECEIPT_NORMALIZATION'"}
        ORDER BY decided_at DESC,decision_id DESC;`, { database: scope.databaseGuid, branch: scope.branchId, terminal: scope.terminalId,
        backend: scope.backendOriginHash, shift: shiftId, ...(review ? { decision: review.decisionId } : {}) })).recordset ?? [];
      if (!rows.length) return null;
      const row = rows[0], event = review ? null : await this.outbox.load(tx, scope, id(row.receipt_recovery_id));
      if (!review && !event) fail("ELEGACY_RECOVERY_PENDING_STATE");
      return { decisionId: id(row.decision_id), event,targetGraphJson:row.target_graph_json,scope };
    });
    if (!saved) return null;
    const witness = saved.event ? await this.cloud.pushLegacyRecovery(saved.event) : null;
    this.assertCurrent(capture); if (review) this.authority.assertPrepared(review.reviewer);
    if(saved.event&&saved.targetGraphJson!==this.adopter.target(graph,saved.scope).graphJson){
      const result=await this.normalizeAccepted(capture,saved.event,witness,{priorDecisionId:saved.decisionId,graph});
      saved.decisionId=result.decisionId;
    }
    const token = Object.freeze({});
    this.coverageTokens.set(token, { capture, graph, decisionId: saved.decisionId, reviewer: review?.reviewer ?? null, event: saved.event, witness });
    return token;
  }
  async verifyCoverage(tx, token, graph, branchId) {
    const saved = this.coverageTokens.get(token);
    if (!saved || saved.graph !== graph || saved.capture.context.branchId !== branchId || !exactGraph(graph, branchId, graph.shiftId)) fail("ELEGACY_RECOVERY_EXACT_GRAPH_REQUIRED");
    return this.withRecoveryTransaction(saved.capture, tx, scope => this.adopter.reviewedCoverage(tx, { ...saved, scope, graph }));
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
  async adoptionAvailable(tx) {
    if (!this.adopter) return false;
    const result = await this.query(tx, "SELECT OBJECT_ID(N'dbo.pos_shift_recovery_adoptions',N'U') adoption_id;");
    if (result.recordset?.length !== 1 || !Object.hasOwn(result.recordset[0], "adoption_id")) fail("ELEGACY_RECOVERY_SCHEMA");
    if (result.recordset[0].adoption_id === null) return false;
    await this.adopter.schema(tx); return true;
  }
  async convergence(tx, scope, { limit = null, available, shiftId = null } = {}) {
    if (!this.adopter) return limit === null ? 0 : [];
    const predicate = available ? "AND NOT EXISTS(SELECT 1 FROM dbo.pos_shift_recovery_adoptions a WHERE a.receipt_recovery_id=e.recovery_id)" : "";
    const select = limit === null ? "CONVERT(nvarchar(30),COUNT_BIG(*)) pending_count" : "TOP(@limit) CONVERT(varchar(36),e.recovery_id) recovery_id";
    const result = await this.query(tx, `SELECT ${select} FROM dbo.pos_sync_shift_legacy_recoveries e WITH(HOLDLOCK)
      WHERE e.database_guid=@database AND e.branch_id=@branch AND e.terminal_id=@terminal AND e.backend_origin_hash=@backend
      AND EXISTS(SELECT 1 FROM dbo.pos_sync_shift_legacy_recovery_receipts r WHERE r.recovery_id=e.recovery_id) ${predicate}
      ${shiftId === null ? "" : "AND e.shift_id=@shift"}
      ${limit === null ? "" : "ORDER BY e.created_at,e.recovery_id"};`,
    { database: scope.databaseGuid, branch: scope.branchId, terminal: scope.terminalId, backend: scope.backendOriginHash, ...(limit === null ? {} : { limit }), ...(shiftId === null ? {} : { shift: shiftId }) });
    if (limit !== null) {
      if (!Array.isArray(result.recordset) || result.recordset.length > limit) fail("ELEGACY_RECOVERY_PENDING_STATE");
      return result.recordset.map(row => id(row.recovery_id));
    }
    const value = result.recordset?.[0]?.pending_count;
    if (result.recordset?.length !== 1 || typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) fail("ELEGACY_RECOVERY_PENDING_STATE");
    return Number(value);
  }
  async summaryPending(tx, scope) {
    const uploadPending = await this.countPending(tx, scope);
    if (!this.adopter) return Object.freeze({ available: true, pending: uploadPending });
    const adoptionAvailable = await this.adoptionAvailable(tx), convergencePending = await this.convergence(tx, scope, { available: adoptionAvailable });
    return Object.freeze({ available: true, adoptionAvailable, uploadPending, convergencePending, pending: uploadPending + convergencePending });
  }
  async pendingSummary() {
    // Older installations do not have this optional queue. A harmless schema
    // probe must precede requirements belonging only to the new protocol.
    if (!await this.capability()) return Object.freeze({ available: false, pending: 0 });
    const capture = this.capture();
    return this.atomic(capture, async (tx, scope) => {
      if (!await this.hasSchema(tx)) return Object.freeze({ available: false, pending: 0 });
      return this.summaryPending(tx, scope);
    });
  }
  async reviewMode(tx) {
    if (await this.hasSchema(tx)) return this.adopter && !await this.adoptionAvailable(tx) ? null : "full";
    // Untyped IDs detect name collisions with non-table objects. Only dbo
    // can prove absence when another user could have an object-level DENY.
    const result = await this.query(tx, `SELECT CASE WHEN USER_NAME()=N'dbo' THEN 1 ELSE 0 END metadata_visible,
      CASE WHEN OBJECT_ID(N'dbo.pos_shift_recovery_evidence') IS NULL
        AND OBJECT_ID(N'dbo.pos_sync_shift_legacy_recoveries') IS NULL
        AND OBJECT_ID(N'dbo.pos_sync_shift_legacy_recovery_receipts') IS NULL
        AND OBJECT_ID(N'dbo.pos_shift_recovery_adoptions') IS NULL THEN 1 ELSE 0 END recovery_absent;`);
    if (result.recordset?.length !== 1 || result.recordset[0].metadata_visible !== 1 ||
        ![0, 1].includes(result.recordset[0].recovery_absent)) fail("ELEGACY_RECOVERY_SCHEMA");
    return result.recordset[0].recovery_absent === 1 ? "read-only" : null;
  }
  async list({ afterId = null, limit = 25 } = {}) {
    this.invalidateCapability();
    const capture = this.capture(true); limitOf(limit); if (afterId !== null) id(afterId);
    return this.atomic(capture, async (tx, scope) => {
      const mode = await this.reviewMode(tx);
      if (!mode) return Object.freeze({ available: false, reason: "UPGRADE_REQUIRED", items: [] });
      const result = await this.query(tx, `SELECT TOP(@limit) CONVERT(varchar(36),id) id,status,state,
        CONVERT(nvarchar(40),opened_at,127) opened_at,CONVERT(nvarchar(40),closed_at,127) closed_at
        FROM dbo.shifts WITH(UPDLOCK,HOLDLOCK) WHERE store_id=@branch AND terminal_id=@terminal AND (@after IS NULL OR id>@after) ORDER BY id;`,
      { limit, branch: scope.branchId, terminal: scope.terminalId, after: afterId });
      const rows = Array.from(result.recordset ?? []); if (rows.length > limit) fail();
      const items = rows.map(row => Object.freeze({ shiftId: id(row.id), status: row.status, state: row.state, openedAt: row.opened_at, closedAt: row.closed_at }));
      return Object.freeze({ available: true, ...(mode === "read-only" ? { readOnly: true } : {}),
        items: Object.freeze(items), nextAfterId: rows.length === limit ? items.at(-1).shiftId : null });
    });
  }
  summary(parent) {
    const text = key => { const value = parent[key]; if (value === null) return null; if (typeof value === "string") return value; if (isExactNumber(value)) return stringifyExactJson(value); fail(); };
    return Object.freeze({ status: text("status"), openedAt: text("opened_at"), closedAt: text("closed_at"),
      countedCash: text("counted_cash"), countedCard: text("counted_card"), countedDigital: text("counted_digital"),
      expectedCash: text("expected_cash"), expectedCard: text("expected_card"), expectedDigital: text("expected_digital"),
      ...(Object.hasOwn(parent, "updated_at") ? { updatedAt: text("updated_at") } : {}),
      ...(Object.hasOwn(parent, "row_version") ? { rowVersion: text("row_version") } : {}) });
  }
  async preview(shiftId) {
    this.invalidateCapability();
    shiftId = id(shiftId); const capture = this.capture(true);
    // Check local identity and database before contacting the cloud, release
    // this transaction, then capture current SQL rows after the response.
    const mode = await this.atomic(capture, async (tx, scope) => {
      const current = await this.reviewMode(tx);
      if (!current) fail("ELEGACY_RECOVERY_UPGRADE_REQUIRED");
      const r = await this.query(tx, "SELECT store_id,terminal_id FROM dbo.shifts WITH(UPDLOCK,HOLDLOCK) WHERE id=@id;", { id: shiftId });
      if (r.recordset?.length !== 1 || recordId(r.recordset[0].store_id) !== scope.branchId || recordId(r.recordset[0].terminal_id) !== scope.terminalId) fail("SYNC_BRANCH_FORBIDDEN");
      return current;
    });
    this.assertCurrent(capture);
    const response = await this.cloud.shiftGraph({ branchId: capture.context.branchId, shiftId });
    this.assertCurrent(capture);
    const exact = exactGraph(response, capture.context.branchId, shiftId);
    if (!exact || !Array.isArray(exact.tables)) fail("ELEGACY_RECOVERY_EXACT_GRAPH_REQUIRED");
    const cloudGraphText = stringifyExactJson(exact.tables);
    return this.atomic(capture, async (tx, scope) => {
      if (mode === "read-only" && await this.reviewMode(tx) !== mode) fail("ELEGACY_RECOVERY_REVIEW_CHANGED");
      const localTables = await this.outbox.localGraph(tx, scope, shiftId), localGraphText = JSON.stringify(localTables);
      this.outbox.assertOwnedGraphs(scope, localGraphText, cloudGraphText);
      const local = localTables.find(part => part.table === "shifts")?.rows, remote = exact.tables.find(part => part.table === "shifts")?.rows;
      if (local?.length !== 1 || remote?.length !== 1) fail();
      const comparison = { shiftId, financialVerification: "UNVERIFIED_HISTORICAL",
        local: this.summary(local[0]), cloud: this.summary(remote[0]) };
      if (mode === "read-only") {
        const { kind } = classifyRetainedShiftGraph({ registry: this.registry, branchId: scope.branchId,
          shiftId, localTables, cloudTables: exact.tables });
        return Object.freeze({ ...comparison, readOnly: true, captureKey: null, classification: kind,
          canApprove: false, canAcceptCloud: false });
      }
      const evidence = await this.evidenceStore.capture(tx, { scope, shiftId, jobId: randomUUID(), localGraphText, cloudGraphText });
      const canAcceptCloud = this.adopter ? await this.adoptionAvailable(tx) && evidence.classification !== "legacy-local-closing-needs-review" && await this.convergence(tx, scope, { available: true, shiftId }) === 0 : false;
      return Object.freeze({ ...comparison, captureKey: evidence.captureKey, classification: evidence.classification,
        canApprove: evidence.classification === "legacy-local-closing-needs-review", canAcceptCloud });
    });
  }
  async approve({ captureKey, recoveryId, reason }) {
    this.invalidateCapability();
    const capture = this.capture(true); if (!HASH.test(captureKey)) fail(); recoveryId = id(recoveryId);
    const reviewer = await this.authority.prepare(capture.approval); this.assertCurrent(capture);
    return this.atomic(capture, async (tx, scope) => {
      if (!await this.hasSchema(tx)) fail("ELEGACY_RECOVERY_UPGRADE_REQUIRED");
      if (this.adopter && !await this.adoptionAvailable(tx)) fail("ELEGACY_RECOVERY_UPGRADE_REQUIRED");
      const event = await this.outbox.create(tx, { scope, captureKey, recoveryId, reason, reviewer });
      return Object.freeze({ recoveryId: event.recoveryId, state: "PENDING", financialVerification: "UNVERIFIED_HISTORICAL" });
    });
  }
  async acceptCloud({ captureKey, decisionId, reason }) {
    this.invalidateCapability();
    if (!this.adopter || !HASH.test(captureKey)) fail("ELEGACY_RECOVERY_UPGRADE_REQUIRED");
    decisionId = id(decisionId); const capture = this.capture(true);
    const saved = await this.atomic(capture, async (tx, scope) => {
      if (!await this.hasSchema(tx) || !await this.adoptionAvailable(tx)) fail("ELEGACY_RECOVERY_UPGRADE_REQUIRED");
      const evidence = await this.evidenceStore.load(tx, scope, captureKey);
      if (!evidence) fail("ELEGACY_RECOVERY_REVIEW_REQUIRED");
      if (await this.convergence(tx, scope, { available: true, shiftId: id(evidence.shiftId) })) fail("ELEGACY_RECOVERY_CONVERGENCE_PENDING");
      this.outbox.assertOwnedGraphs(scope, evidence.localGraphText, evidence.cloudGraphText);
      return { scope, evidence, shiftId: id(evidence.shiftId) };
    });
    this.assertCurrent(capture);
    const response = await this.cloud.shiftGraph({ branchId: saved.scope.branchId, shiftId: saved.shiftId }); this.assertCurrent(capture);
    const exact = exactGraph(response, saved.scope.branchId, saved.shiftId);
    if (!exact || stringifyExactJson(exact.tables) !== saved.evidence.cloudGraphText) fail("ELEGACY_RECOVERY_REVIEW_CHANGED");
    const reviewer = await this.authority.prepare(capture.approval); this.assertCurrent(capture);
    const plan = this.adopter.prepareAdmin({ scope: saved.scope, reviewer, graph: response, reason });
    const result = await this.atomic(capture, async (tx, scope) => {
      // An upload ACK may arrive during either await above. Keep this check
      // inside the same serializable transaction as the local adoption.
      if (await this.convergence(tx, scope, { available: true, shiftId: saved.shiftId })) fail("ELEGACY_RECOVERY_CONVERGENCE_PENDING");
      return this.adopter.apply(tx, { scope, plan, captureKey, decisionId });
    });
    // A new process/session must make a new explicit review. Never restore this
    // authority from a SQL decision row or renderer state.
    if (this.reviewedDecisions.size >= 2000) this.reviewedDecisions.delete(this.reviewedDecisions.keys().next().value);
    this.reviewedDecisions.set(saved.shiftId, { decisionId: result.decisionId, reviewer, capture });
    return Object.freeze({ state: "ADOPTED", decisionId: result.decisionId, checkpointAdvanced: false, downloadRecoveryComplete: false });
  }
  async normalizeAccepted(capture, event, witness, {priorDecisionId=null,graph=null}={}) {
    const response = graph??await this.cloud.shiftGraph({ branchId: capture.context.branchId, shiftId: event.shiftId }); this.assertCurrent(capture);
    const exact = exactGraph(response, capture.context.branchId, event.shiftId);
    if (!exact) fail("ELEGACY_RECOVERY_EXACT_GRAPH_REQUIRED");
    return this.atomic(capture, async (tx, scope) => {
      if (!await this.adoptionAvailable(tx)) fail("ELEGACY_RECOVERY_UPGRADE_REQUIRED");
      const localGraphText = JSON.stringify(await this.outbox.localGraph(tx, scope, event.shiftId)), cloudGraphText = stringifyExactJson(exact.tables);
      const evidence = await this.evidenceStore.capture(tx, { scope, shiftId: event.shiftId, jobId: randomUUID(), localGraphText, cloudGraphText });
      const plan = this.adopter.prepareReceipt({ scope, event, witness, graph: response,priorDecisionId });
      return this.adopter.apply(tx, { scope, plan, captureKey: evidence.captureKey, decisionId: randomUUID() });
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
        const pending = [...await this.outbox.pending(tx, scope, { limit })];
        if (this.adopter && pending.length < limit) {
          const available = await this.adoptionAvailable(tx);
          for (const recoveryId of await this.convergence(tx, scope, { limit: limit - pending.length, available })) {
            const event = await this.outbox.load(tx, scope, recoveryId); if (!event) fail("ELEGACY_RECOVERY_PENDING_STATE"); pending.push(event);
          }
        }
        return pending;
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
        if (this.adopter) await this.normalizeAccepted(capture, event, witness);
      }
      const summary = await this.atomic(capture, (tx, scope) => this.summaryPending(tx, scope));
      return Object.freeze({ skipped: false, acknowledged, pushed: acknowledged, ...(this.adopter ? summary : { pending: summary.pending }), downloadRecoveryComplete: false });
    };
    this.pushing = run;
    run.promise = work().finally(() => { if (this.pushing === run) this.pushing = null; });
    return run.promise;
  }
}
module.exports = { LegacyShiftRecoveryService };
