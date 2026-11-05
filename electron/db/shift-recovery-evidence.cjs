"use strict";

// PREPARATION ONLY: no installer, IPC, scheduler or upload path calls this store.
// Captured evidence is neither an accepted receipt nor an authenticated author action.
const { createHash } = require("node:crypto");
const { parseExactJson } = require("../sync/shift-recovery-exact.cjs");
const { classifyRetainedShiftGraph } = require("../sync/shift-recovery-classification.cjs");
const OWNER = "retail.shift-recovery";
const FORMAT = "retained-graph-v1";
const CAP = 6 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const TRIGGER_SQL = "CREATE TRIGGER dbo.TR_pos_shift_recovery_evidence_immutable ON dbo.pos_shift_recovery_evidence\n INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 50000, 'Recovery evidence is append-only.', 1; END;";
const BINARY_COLUMNS = new Set(["capture_key", "branch_id", "terminal_id", "backend_origin_hash", "local_sha256", "cloud_sha256"]);
const KINDS = new Set(["exact", "parent-summary-candidate", "metadata-only-candidate", "legacy-local-closing-needs-review", "competing-closings-needs-review", "unverified-difference-needs-review"]);
const COLUMNS = Object.freeze({ capture_key: ["char", 64], owner_tag: ["varchar", 32], format_tag: ["varchar", 32], codec_version: ["int", 4],
  database_guid: ["uniqueidentifier", 16], branch_id: ["nvarchar", 256], terminal_id: ["nvarchar", 256], backend_origin_hash: ["char", 64],
  shift_id: ["uniqueidentifier", 16], job_id: ["uniqueidentifier", 16], local_sha256: ["char", 64], cloud_sha256: ["char", 64],
  local_graph_json: ["nvarchar", -1], cloud_graph_json: ["nvarchar", -1], classification: ["varchar", 64], reason_code: ["varchar", 64], captured_at: ["datetimeoffset", 10] });
function fail(code = "ESHIFT_RECOVERY_EVIDENCE") {
  throw Object.assign(new Error("The retained shift evidence is unavailable or no longer matches its verified scope."), { code, table: "shifts" });
}
const hash = text => createHash("sha256").update(text, "utf8").digest("hex");
function scopeOf(input) {
  if (!input || typeof input !== "object") fail();
  const { databaseGuid, branchId, terminalId, backendOriginHash } = input;
  if (!UUID.test(databaseGuid) || !HASH.test(backendOriginHash)) fail();
  for (const value of [branchId, terminalId]) if (typeof value !== "string" || !value || value.length > 128 || value.trim() !== value || /[\u0000-\u001f]/.test(value)) fail();
  return Object.freeze({ databaseGuid: databaseGuid.toLowerCase(), branchId: UUID.test(branchId) ? branchId.toLowerCase() : branchId,
    terminalId: UUID.test(terminalId) ? terminalId.toLowerCase() : terminalId, backendOriginHash });
}
function graphText(text) {
  // Bound both transport UTF-8 and SQL Server UTF-16 storage conservatively.
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > CAP || Buffer.byteLength(text, "utf16le") > CAP) fail();
  return parseExactJson(text, { maxBytes: CAP, maxDepth: 64 });
}
function validateGraphs(registry, scope, shiftId, localText, cloudText) {
  if (!UUID.test(shiftId)) fail();
  return classifyRetainedShiftGraph({ registry, branchId: scope.branchId, shiftId,
    localTables: graphText(localText), cloudTables: graphText(cloudText) });
}
function captureKey(scope, shiftId, localHash, cloudHash) {
  return hash(JSON.stringify([OWNER, FORMAT, 1, scope.databaseGuid, scope.branchId, scope.terminalId, scope.backendOriginHash,
    shiftId.toLowerCase(), localHash, cloudHash]));
}
class ShiftRecoveryEvidenceStore {
  constructor({ connectionManager, registry, assertScope }) {
    if (!connectionManager || !registry || typeof assertScope !== "function") fail();
    this.connectionManager = connectionManager; this.registry = registry; this.assertScope = assertScope;
  }
  async checked(transaction, scope, work) {
    if (!transaction || typeof transaction !== "object") fail();
    // Integration must verify real DB GUID + Main-owned terminal/branch/backend,
    // and enforce a caller-owned serializable transaction, never renderer flags.
    if (await this.assertScope(transaction, scope) !== true) fail("SYNC_BRANCH_FORBIDDEN");
    const result = await work();
    if (await this.assertScope(transaction, scope) !== true) fail("SYNC_BRANCH_FORBIDDEN");
    return result;
  }
  request(transaction, scope) {
    const sql = this.connectionManager.sql();
    return new sql.Request(transaction).input("database_guid", sql.UniqueIdentifier, scope.databaseGuid)
      .input("branch", sql.NVarChar(128), scope.branchId).input("terminal", sql.NVarChar(128), scope.terminalId)
      .input("backend", sql.Char(64), scope.backendOriginHash);
  }
  async preflight(transaction, scope) {
    const result = await this.checked(transaction, scope, () => this.request(transaction, scope).query(`
      SELECT c.name,TYPE_NAME(c.user_type_id) type_name,c.max_length,c.is_nullable,c.is_identity,c.is_computed,c.collation_name
      FROM sys.columns c WHERE c.object_id=OBJECT_ID(N'dbo.pos_shift_recovery_evidence',N'U');
      SELECT CONVERT(nvarchar(64),ep.value) owner_tag FROM sys.extended_properties ep
      WHERE ep.major_id=OBJECT_ID(N'dbo.pos_shift_recovery_evidence',N'U') AND ep.minor_id=0 AND ep.name=N'RetailRecoveryOwner';
      SELECT name,is_disabled,is_instead_of_trigger,OBJECT_DEFINITION(object_id) definition FROM sys.triggers WHERE parent_id=OBJECT_ID(N'dbo.pos_shift_recovery_evidence',N'U');
      SELECT c.name FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
      JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
      WHERE i.object_id=OBJECT_ID(N'dbo.pos_shift_recovery_evidence',N'U') AND i.is_primary_key=1 AND i.is_unique=1 AND i.is_disabled=0;`));
    const [columns, properties, triggers, primary] = result.recordsets ?? [];
    if (!Array.isArray(columns) || columns.length !== Object.keys(COLUMNS).length || properties?.length !== 1 || properties[0].owner_tag !== OWNER ||
      triggers?.length !== 1 || !triggers.some(trigger => trigger.name === "TR_pos_shift_recovery_evidence_immutable" && !trigger.is_disabled && trigger.is_instead_of_trigger &&
        typeof trigger.definition === "string" && trigger.definition.replace(/\r\n/g, "\n") === TRIGGER_SQL) ||
      primary?.length !== 1 || primary[0].name !== "capture_key") fail("ESHIFT_RECOVERY_SCHEMA");
    for (const column of columns) {
      const expected = COLUMNS[column.name];
      if (!expected || column.type_name !== expected[0] || column.max_length !== expected[1] || column.is_nullable || column.is_identity || column.is_computed ||
        (BINARY_COLUMNS.has(column.name) && column.collation_name !== "Latin1_General_100_BIN2")) fail("ESHIFT_RECOVERY_SCHEMA");
    }
  }
  async capture(transaction, input) {
    try {
      const scope = scopeOf(input.scope), shiftId = input.shiftId?.toLowerCase(), jobId = input.jobId;
      const localText = input.localGraphText, cloudText = input.cloudGraphText;
      if (!UUID.test(jobId)) fail();
      const plan = validateGraphs(this.registry, scope, shiftId, localText, cloudText);
      const localHash = hash(localText), cloudHash = hash(cloudText);
      const key = captureKey(scope, shiftId, localHash, cloudHash);
      await this.preflight(transaction, scope);
      const sql = this.connectionManager.sql();
      const result = await this.checked(transaction, scope, () => this.request(transaction, scope)
        .input("key", sql.Char(64), key).input("shift", sql.UniqueIdentifier, shiftId).input("job", sql.UniqueIdentifier, jobId)
        .input("local_hash", sql.Char(64), localHash).input("cloud_hash", sql.Char(64), cloudHash)
        .input("local_json", sql.NVarChar(sql.MAX), localText).input("cloud_json", sql.NVarChar(sql.MAX), cloudText)
        .input("classification", sql.VarChar(64), plan.kind).input("reason", sql.VarChar(64), plan.reasonCode).query(`
          IF NOT EXISTS(SELECT 1 FROM dbo.pos_shift_recovery_evidence WITH(UPDLOCK,HOLDLOCK) WHERE capture_key=@key)
            INSERT dbo.pos_shift_recovery_evidence(capture_key,owner_tag,format_tag,codec_version,database_guid,branch_id,terminal_id,backend_origin_hash,
              shift_id,job_id,local_sha256,cloud_sha256,local_graph_json,cloud_graph_json,classification,reason_code,captured_at)
            VALUES(@key,'retail.shift-recovery','retained-graph-v1',1,@database_guid,@branch,@terminal,@backend,@shift,@job,@local_hash,@cloud_hash,
              @local_json,@cloud_json,@classification,@reason,SYSDATETIMEOFFSET());
          SELECT * FROM dbo.pos_shift_recovery_evidence WHERE capture_key=@key AND database_guid=@database_guid
            AND branch_id COLLATE Latin1_General_100_BIN2=@branch COLLATE Latin1_General_100_BIN2
            AND terminal_id COLLATE Latin1_General_100_BIN2=@terminal COLLATE Latin1_General_100_BIN2 AND backend_origin_hash=@backend;`));
      if (result.recordset?.length !== 1) fail();
      this.validateStored(result.recordset[0], scope, key);
      return Object.freeze({ captureKey: key, classification: plan.kind, needsReview: plan.needsReview, autoApply: false });
    } catch (error) { if (["SYNC_BRANCH_FORBIDDEN", "ESHIFT_RECOVERY_SCHEMA"].includes(error?.code)) fail(error.code); fail(); }
  }
  validateStored(row, scope, key) {
    if (!row || row.capture_key !== key || row.owner_tag !== OWNER || row.format_tag !== FORMAT || row.codec_version !== 1 ||
      String(row.database_guid).toLowerCase() !== scope.databaseGuid || row.branch_id !== scope.branchId || row.terminal_id !== scope.terminalId ||
      row.backend_origin_hash !== scope.backendOriginHash || !UUID.test(row.job_id) || !UUID.test(row.shift_id) ||
      hash(row.local_graph_json) !== row.local_sha256 || hash(row.cloud_graph_json) !== row.cloud_sha256 ||
      captureKey(scope, row.shift_id, row.local_sha256, row.cloud_sha256) !== key) fail();
    const plan = validateGraphs(this.registry, scope, row.shift_id, row.local_graph_json, row.cloud_graph_json);
    if (row.classification !== plan.kind || row.reason_code !== plan.reasonCode) fail();
    return plan;
  }
  async load(transaction, scopeInput, key) {
    try {
      const scope = scopeOf(scopeInput); if (!HASH.test(key)) fail();
      await this.preflight(transaction, scope);
      const result = await this.checked(transaction, scope, () => this.request(transaction, scope).input("key", this.connectionManager.sql().Char(64), key).query(`
        SELECT * FROM dbo.pos_shift_recovery_evidence WHERE capture_key=@key AND database_guid=@database_guid
          AND branch_id COLLATE Latin1_General_100_BIN2=@branch COLLATE Latin1_General_100_BIN2
          AND terminal_id COLLATE Latin1_General_100_BIN2=@terminal COLLATE Latin1_General_100_BIN2 AND backend_origin_hash=@backend;`));
      if (!result.recordset?.length) return null;
      if (result.recordset.length !== 1) fail();
      const row = result.recordset[0], plan = this.validateStored(row, scope, key);
      return Object.freeze({ captureKey: key, shiftId: row.shift_id, localGraphText: row.local_graph_json, cloudGraphText: row.cloud_graph_json,
        classification: plan.kind, needsReview: plan.needsReview, autoApply: false });
    } catch (error) { if (["SYNC_BRANCH_FORBIDDEN", "ESHIFT_RECOVERY_SCHEMA"].includes(error?.code)) fail(error.code); fail(); }
  }
  async list(transaction, scopeInput, { afterKey = null, limit = 25 } = {}) {
    try {
      const scope = scopeOf(scopeInput);
      if ((afterKey !== null && !HASH.test(afterKey)) || !Number.isInteger(limit) || limit < 1 || limit > 100) fail();
      await this.preflight(transaction, scope);
      const sql = this.connectionManager.sql();
      const result = await this.checked(transaction, scope, () => this.request(transaction, scope).input("after", sql.Char(64), afterKey).input("limit", sql.Int, limit).query(`
        SELECT TOP(@limit) capture_key,shift_id,classification,reason_code,owner_tag,format_tag,codec_version FROM dbo.pos_shift_recovery_evidence
        WHERE database_guid=@database_guid AND branch_id COLLATE Latin1_General_100_BIN2=@branch COLLATE Latin1_General_100_BIN2
          AND terminal_id COLLATE Latin1_General_100_BIN2=@terminal COLLATE Latin1_General_100_BIN2 AND backend_origin_hash=@backend
          AND (@after IS NULL OR capture_key>@after) ORDER BY capture_key;`));
      if (!Array.isArray(result.recordset) || result.recordset.length > limit) fail();
      return Object.freeze(result.recordset.map(row => {
        if (!HASH.test(row.capture_key) || !UUID.test(row.shift_id) || !KINDS.has(row.classification) || !/^[A-Z_]{1,64}$/.test(row.reason_code) ||
          row.owner_tag !== OWNER || row.format_tag !== FORMAT || row.codec_version !== 1) fail();
        return Object.freeze({ captureKey: row.capture_key, shiftId: row.shift_id, classification: row.classification, reasonCode: row.reason_code });
      }));
    } catch (error) { if (["SYNC_BRANCH_FORBIDDEN", "ESHIFT_RECOVERY_SCHEMA"].includes(error?.code)) fail(error.code); fail(); }
  }
}
module.exports = { ShiftRecoveryEvidenceStore, OWNER, FORMAT, COLUMNS, CAP, TRIGGER_SQL };
