"use strict";
const { createHash } = require("node:crypto");
const protocol = require("../security/legacy-shift-recovery-protocol.cjs");
const { parseExactJson, projection, isExactNumber, decimal } = require("../sync/shift-recovery-exact.cjs");
const { classifyRetainedShiftGraph, TABLES } = require("../sync/shift-recovery-classification.cjs");
const OWNER = "retail.legacy-recovery.v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const ACCEPTANCE_FIELDS = ["version", "recovery_id", "payload_hash", "evidence_hash", "cloud_witness_hash", "financial_verification", "accepted_token", "provenance"];
const EVENT = "pos_sync_shift_legacy_recoveries", RECEIPT = "pos_sync_shift_legacy_recovery_receipts";
const TRIGGERS = {
  [EVENT]: "CREATE TRIGGER dbo.TR_legacy_recovery_event_immutable ON dbo.pos_sync_shift_legacy_recoveries\n INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 50000, 'Legacy recovery events are append-only.', 1; END;",
  [RECEIPT]: "CREATE TRIGGER dbo.TR_legacy_recovery_receipt_immutable ON dbo.pos_sync_shift_legacy_recovery_receipts\n INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 50000, 'Legacy recovery receipts are append-only.', 1; END;",
};
const COLUMNS = {
  [EVENT]: { recovery_id: ["uniqueidentifier", 16], capture_key: ["char", 64], database_guid: ["uniqueidentifier", 16], branch_id: ["nvarchar", 256],
    terminal_id: ["nvarchar", 256], backend_origin_hash: ["char", 64], shift_id: ["uniqueidentifier", 16], reviewer_id: ["uniqueidentifier", 16],
    key_id: ["uniqueidentifier", 16], payload_hash: ["char", 64], payload_json: ["nvarchar", -1], proof_json: ["nvarchar", -1], created_at: ["datetimeoffset", 10] },
  [RECEIPT]: { recovery_id: ["uniqueidentifier", 16], receipt_json: ["nvarchar", -1], receipt_sha256: ["char", 64], accepted_at: ["datetimeoffset", 10] },
};
const fail = (code = "ELEGACY_RECOVERY_LOCAL") => { throw Object.assign(new Error("The recovery approval remains pending or requires review. Saved shift evidence has not been replaced."), { code, table: "shifts" }); };
const hash = text => createHash("sha256").update(text, "utf8").digest("hex");
function scopeOf(input) {
  if (!input || !UUID.test(input.databaseGuid) || !HASH.test(input.backendOriginHash)) fail();
  for (const key of ["branchId", "terminalId"]) if (typeof input[key] !== "string" || !input[key] || input[key].length > 128 || input[key] !== input[key].trim()) fail();
  return { databaseGuid: input.databaseGuid.toLowerCase(), branchId: input.branchId, terminalId: input.terminalId, backendOriginHash: input.backendOriginHash };
}
class LegacyShiftRecoveryOutbox {
  constructor({ connectionManager, registry, evidenceStore, authority, assertScope, assertReceipt = () => fail("ELEGACY_RECOVERY_RECEIPT") }) {
    if (!connectionManager || !registry || !evidenceStore || !authority || typeof assertScope !== "function" || typeof assertReceipt !== "function") fail();
    Object.assign(this, { connectionManager, registry, evidenceStore, authority, assertScope, assertReceipt });
  }
  request(tx, scope) {
    if (!tx || typeof tx !== "object") fail();
    return new (this.connectionManager.sql().Request)(tx).input("database", scope.databaseGuid).input("branch", scope.branchId)
      .input("terminal", scope.terminalId).input("backend", scope.backendOriginHash);
  }
  async checked(tx, scope, work) {
    if (await this.assertScope(tx, scope) !== true) fail("SYNC_BRANCH_FORBIDDEN");
    const result = await work();
    if (await this.assertScope(tx, scope) !== true) fail("SYNC_BRANCH_FORBIDDEN");
    return result;
  }
  async preflight(tx, scope) {
    const result = await this.checked(tx, scope, () => this.request(tx, scope).query(`
      SELECT t.name,CONVERT(nvarchar(64),ep.value) owner_tag,COUNT(tr.object_id) immutable_triggers
      FROM sys.tables t LEFT JOIN sys.extended_properties ep ON ep.major_id=t.object_id AND ep.minor_id=0 AND ep.name=N'RetailRecoveryOwner'
      LEFT JOIN sys.triggers tr ON tr.parent_id=t.object_id AND tr.is_disabled=0 AND tr.is_instead_of_trigger=1
      WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN(N'pos_sync_shift_legacy_recoveries',N'pos_sync_shift_legacy_recovery_receipts')
      GROUP BY t.name,CONVERT(nvarchar(64),ep.value);
      SELECT t.name table_name,c.name,TYPE_NAME(c.user_type_id) type_name,c.max_length,c.scale,c.is_nullable,c.is_identity,c.is_computed,c.default_object_id,c.collation_name
      FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN(N'${EVENT}',N'${RECEIPT}');
      SELECT t.name table_name,tr.name,OBJECT_DEFINITION(tr.object_id) definition FROM sys.tables t JOIN sys.triggers tr ON tr.parent_id=t.object_id
      WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN(N'${EVENT}',N'${RECEIPT}');
      SELECT t.name table_name,c.name FROM sys.tables t JOIN sys.indexes i ON i.object_id=t.object_id JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
      JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN(N'${EVENT}',N'${RECEIPT}')
        AND i.is_primary_key=1 AND i.is_unique=1 AND i.is_disabled=0 AND i.ignore_dup_key=0 AND i.has_filter=0 AND ic.key_ordinal=1
        AND NOT EXISTS(SELECT 1 FROM sys.index_columns extra WHERE extra.object_id=i.object_id AND extra.index_id=i.index_id AND extra.key_ordinal>1);
      SELECT t.name table_name,c.name column_name,rt.name target_table,rc.name target_column,f.is_disabled,f.is_not_trusted,
        f.delete_referential_action,f.update_referential_action FROM sys.foreign_keys f
      JOIN sys.tables t ON t.object_id=f.parent_object_id JOIN sys.foreign_key_columns fc ON fc.constraint_object_id=f.object_id
      JOIN sys.columns c ON c.object_id=fc.parent_object_id AND c.column_id=fc.parent_column_id
      JOIN sys.tables rt ON rt.object_id=f.referenced_object_id JOIN sys.columns rc ON rc.object_id=fc.referenced_object_id AND rc.column_id=fc.referenced_column_id
      WHERE t.schema_id=SCHEMA_ID(N'dbo') AND t.name IN(N'${EVENT}',N'${RECEIPT}');
      SELECT c.name,ic.key_ordinal FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
      JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
      WHERE i.object_id=OBJECT_ID(N'dbo.${EVENT}',N'U') AND i.name=N'UX_legacy_recovery_shift_scope'
        AND i.is_unique=1 AND i.is_disabled=0 AND i.ignore_dup_key=0 AND i.has_filter=0 AND ic.is_included_column=0;`));
    const [rows = [], columns = [], triggers = [], primary = [], foreign = [], unique = []] = result.recordsets ?? [];
    if (rows.length !== 2 || rows.some(row => row.owner_tag !== OWNER || Number(row.immutable_triggers) !== 1)) fail("ELEGACY_RECOVERY_SCHEMA");
    for (const table of [EVENT, RECEIPT]) {
      const actual = columns.filter(column => column.table_name === table);
      if (actual.length !== Object.keys(COLUMNS[table]).length || actual.some(column => {
        const expected = COLUMNS[table][column.name];
        return !expected || column.type_name !== expected[0] || column.max_length !== expected[1] || column.is_nullable || column.is_identity || column.is_computed || column.default_object_id || column.type_name === "datetimeoffset" && column.scale !== 7 ||
          ["capture_key", "branch_id", "terminal_id", "backend_origin_hash", "payload_hash", "receipt_sha256"].includes(column.name) && column.collation_name !== "Latin1_General_100_BIN2";
      }) || triggers.filter(trigger => trigger.table_name === table).length !== 1 ||
          triggers.find(trigger => trigger.table_name === table)?.definition?.replace(/\r\n/g, "\n") !== TRIGGERS[table] ||
          primary.filter(key => key.table_name === table && key.name === "recovery_id").length !== 1) fail("ELEGACY_RECOVERY_SCHEMA");
      const links = foreign.filter(key => key.table_name === table), column = table === EVENT ? "capture_key" : "recovery_id";
      if (links.length !== 1 || links[0].column_name !== column || links[0].target_column !== column ||
          links[0].target_table !== (table === EVENT ? "pos_shift_recovery_evidence" : EVENT) || links[0].is_disabled || links[0].is_not_trusted ||
          links[0].delete_referential_action !== 0 || links[0].update_referential_action !== 0) fail("ELEGACY_RECOVERY_SCHEMA");
    }
    const scopeColumns = ["database_guid", "branch_id", "terminal_id", "backend_origin_hash", "shift_id"];
    if (unique.length !== scopeColumns.length || unique.some(key => scopeColumns[key.key_ordinal - 1] !== key.name)) fail("ELEGACY_RECOVERY_SCHEMA");
  }
  validateRow(row, scope) {
    if (!row || typeof row.database_guid !== "string" || typeof row.payload_json !== "string" || typeof row.proof_json !== "string" ||
        Buffer.byteLength(row.payload_json, "utf8") > protocol.MAX_UPLOAD_BYTES || !UUID.test(String(row.recovery_id)) || row.database_guid.toLowerCase() !== scope.databaseGuid || row.branch_id !== scope.branchId ||
        row.terminal_id !== scope.terminalId || row.backend_origin_hash !== scope.backendOriginHash || !HASH.test(row.capture_key) ||
        hash(row.payload_json) !== row.payload_hash) fail();
    let payload, proof;
    try { payload = protocol.normalizeLegacyPayload(JSON.parse(row.payload_json)); proof = this.authority.validatePending(JSON.parse(row.proof_json)); }
    catch { fail("ELEGACY_RECOVERY_PROOF"); }
    if (payload.recoveryId !== String(row.recovery_id).toLowerCase() || payload.branchId !== scope.branchId || payload.terminalId !== scope.terminalId ||
        payload.shiftId !== String(row.shift_id).toLowerCase() || hash(payload.localGraphText) !== payload.evidenceHash ||
        hash(payload.cloudGraphText) !== payload.cloudWitnessHash || proof.payloadHash !== row.payload_hash || proof.recoveryId !== payload.recoveryId ||
        proof.branchId !== payload.branchId || proof.terminalId !== payload.terminalId || proof.shiftId !== payload.shiftId ||
        proof.authorId !== String(row.reviewer_id).toLowerCase() || proof.keyId !== String(row.key_id).toLowerCase()) fail();
    this.assertOwnedGraphs(scope, payload.localGraphText, payload.cloudGraphText);
    return Object.freeze({ recoveryId: payload.recoveryId, captureKey: row.capture_key, branchId: payload.branchId, terminalId: payload.terminalId,
      shiftId: payload.shiftId, payloadHash: row.payload_hash, evidenceHash: payload.evidenceHash, cloudWitnessHash: payload.cloudWitnessHash,
      payloadJson: row.payload_json, proof: Object.freeze(proof), financialVerification: "UNVERIFIED_HISTORICAL" });
  }
  assertOwnedGraphs(scope, ...texts) {
    const identity = value => typeof value === "string" && UUID.test(value) ? value.toLowerCase() : value;
    for (const text of texts) {
      const tables = parseExactJson(text);
      if (!Array.isArray(tables) || tables.length !== TABLES.length) fail();
      for (const part of tables) {
        const table = this.registry.tables.find(t => t.cloudTable === part.table);
        if (!table || !TABLES.includes(part.table) || !Array.isArray(part.rows)) fail();
        const branch = table.columns.find(c => c.cloudColumn === "store_id"), terminal = table.columns.find(c => c.cloudColumn === "terminal_id");
        for (const row of part.rows) if (!branch || identity(row[branch.sqlServerColumn]) !== identity(scope.branchId) ||
          terminal && identity(row[terminal.sqlServerColumn]) !== identity(scope.terminalId)) fail("SYNC_BRANCH_FORBIDDEN");
      }
    }
  }
  async localGraph(tx, scope, shiftId) {
    const tables = [];
    for (const name of TABLES) {
      const table = this.registry.tables.find(t => t.cloudTable === name && t.sqlServerTable === name);
      if (!table) fail();
      const rows = await this.checked(tx, scope, () => this.request(tx, scope).input("shift", shiftId).query(
        `SELECT TOP(2001) ${projection(table)} FROM dbo.[${name}] source WITH(UPDLOCK,HOLDLOCK) WHERE ${name === "shifts" ? "id" : "shift_id"}=@shift ORDER BY id;`,
      ));
      // mssql decorates its recordset array with driver metadata; that is not
      // part of the saved graph and must not enter the strict graph codec.
      tables.push({ table: name, rows: Array.from(rows.recordset ?? []) });
    }
    return tables;
  }
  sameLocalGraph(actual, savedText, scope, shiftId) {
    try {
      // The saved before-image is SQL-shaped: numeric and JSON columns are
      // exact text. Convert only the comparison side into the classifier's
      // cloud-shaped representation; never rewrite the frozen source bytes.
      const saved = parseExactJson(savedText).map(entry => {
        const table = this.registry.tables.find(t => t.cloudTable === entry.table);
        if (!table) fail();
        return { table: entry.table, rows: entry.rows.map(row => Object.fromEntries(table.columns.map(column => {
          let value = row[column.sqlServerColumn];
          const type = String(column.cloudType).toLowerCase();
          if (value !== null && typeof value === "string" && (/^(numeric|decimal|money|smallmoney|bigint|integer|smallint|real|double precision)/.test(type) || type === "jsonb" || type.endsWith("[]"))) value = parseExactJson(value);
          if (type === "boolean" && isExactNumber(value) && ["0", "1e0"].includes(decimal(value))) value = decimal(value) === "1e0";
          return [column.cloudColumn, value];
        }))) };
      });
      return classifyRetainedShiftGraph({ registry: this.registry, branchId: scope.branchId, shiftId, localTables: actual, cloudTables: saved }).kind === "exact";
    } catch { return false; }
  }
  async create(tx, { scope: inputScope, captureKey, recoveryId, reason, reviewer }) {
    const scope = scopeOf(inputScope);
    if (!UUID.test(recoveryId) || !HASH.test(captureKey)) fail();
    this.authority.assertPrepared(reviewer);
    if (reviewer.branchId !== scope.branchId || reviewer.binding.terminalId !== scope.terminalId) fail("SYNC_BRANCH_FORBIDDEN");
    await this.preflight(tx, scope);
    const evidence = await this.evidenceStore.load(tx, scope, captureKey);
    if (!evidence || evidence.classification !== "legacy-local-closing-needs-review") fail("ELEGACY_RECOVERY_REVIEW_REQUIRED");
    this.assertOwnedGraphs(scope, evidence.localGraphText, evidence.cloudGraphText);
    const shiftId = String(evidence.shiftId).toLowerCase();
    const prior = await this.checked(tx, scope, () => this.request(tx, scope).input("shift", shiftId).query(`
      SELECT recovery_id FROM dbo.pos_sync_shift_legacy_recoveries WITH(UPDLOCK,HOLDLOCK,INDEX(UX_legacy_recovery_shift_scope))
      WHERE database_guid=@database AND branch_id=@branch AND terminal_id=@terminal AND backend_origin_hash=@backend AND shift_id=@shift;`));
    if (!Array.isArray(prior.recordset) || prior.recordset.length > 1) fail();
    if (prior.recordset.length && String(prior.recordset[0].recovery_id).toLowerCase() !== recoveryId.toLowerCase()) fail("ELEGACY_RECOVERY_ALREADY_QUEUED");
    const actual = await this.localGraph(tx, scope, shiftId);
    if (!this.sameLocalGraph(actual, evidence.localGraphText, scope, shiftId)) fail("ELEGACY_RECOVERY_LOCAL_CHANGED");
    const raw = { version: 1, recoveryId: recoveryId.toLowerCase(), branchId: scope.branchId, terminalId: scope.terminalId, shiftId,
      evidenceHash: hash(evidence.localGraphText), cloudWitnessHash: hash(evidence.cloudGraphText), reason,
      localGraphText: evidence.localGraphText, cloudGraphText: evidence.cloudGraphText, financialVerification: "UNVERIFIED_HISTORICAL" };
    // An oversized candidate remains in immutable evidence; do not sign/drop it.
    if (Buffer.byteLength(JSON.stringify(raw), "utf8") > protocol.MAX_UPLOAD_BYTES) fail("ELEGACY_RECOVERY_OVERSIZED");
    const payload = protocol.normalizeLegacyPayload(raw), payloadJson = JSON.stringify(payload), payloadHash = hash(payloadJson);
    this.authority.assertPrepared(reviewer);
    const proof = reviewer.signRecovery({ branchId: scope.branchId, shiftId, recoveryId: payload.recoveryId, payloadHash });
    if (Buffer.byteLength(protocol.legacyRecoveryWire(payloadJson, proof), "utf8") > protocol.MAX_UPLOAD_BYTES) fail("ELEGACY_RECOVERY_OVERSIZED");
    this.authority.assertPrepared(reviewer);
    const sql = this.connectionManager.sql();
    const result = await this.checked(tx, scope, () => this.request(tx, scope).input("id", payload.recoveryId).input("capture", captureKey)
      .input("shift", shiftId).input("author", proof.authorId).input("key", proof.keyId).input("hash", payloadHash)
      .input("payload", sql.NVarChar(sql.MAX), payloadJson).input("proof", sql.NVarChar(sql.MAX), JSON.stringify(proof)).query(`
        IF NOT EXISTS(SELECT 1 FROM dbo.pos_sync_shift_legacy_recoveries WITH(UPDLOCK,HOLDLOCK) WHERE recovery_id=@id)
         INSERT dbo.pos_sync_shift_legacy_recoveries(recovery_id,capture_key,database_guid,branch_id,terminal_id,backend_origin_hash,shift_id,reviewer_id,key_id,payload_hash,payload_json,proof_json,created_at)
         VALUES(@id,@capture,@database,@branch,@terminal,@backend,@shift,@author,@key,@hash,@payload,@proof,SYSDATETIMEOFFSET());
        SELECT * FROM dbo.pos_sync_shift_legacy_recoveries WHERE recovery_id=@id;`));
    this.authority.assertPrepared(reviewer);
    if (result.recordset?.length !== 1) fail();
    const event = this.validateRow(result.recordset[0], scope);
    if (event.payloadHash !== payloadHash || event.captureKey !== captureKey || JSON.stringify(event.proof) !== JSON.stringify(proof)) fail("ELEGACY_RECOVERY_REPLAY_CONFLICT");
    return event;
  }
  async load(tx, inputScope, recoveryId) {
    const scope = scopeOf(inputScope); if (!UUID.test(recoveryId)) fail();
    await this.preflight(tx, scope);
    const result = await this.checked(tx, scope, () => this.request(tx, scope).input("id", recoveryId).query(`
      SELECT * FROM dbo.pos_sync_shift_legacy_recoveries WITH(UPDLOCK,HOLDLOCK) WHERE recovery_id=@id AND database_guid=@database
        AND branch_id=@branch AND terminal_id=@terminal AND backend_origin_hash=@backend;`));
    if (!result.recordset?.length) return null;
    if (result.recordset.length !== 1) fail();
    return this.validateRow(result.recordset[0], scope);
  }
  async pending(tx, inputScope, { limit = 25 } = {}) {
    const scope = scopeOf(inputScope); if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail();
    await this.preflight(tx, scope);
    const result = await this.checked(tx, scope, () => this.request(tx, scope).input("limit", limit).query(`
      SELECT TOP(@limit) e.* FROM dbo.pos_sync_shift_legacy_recoveries e WITH(UPDLOCK,HOLDLOCK)
      WHERE e.database_guid=@database AND e.branch_id=@branch AND e.terminal_id=@terminal AND e.backend_origin_hash=@backend
        AND NOT EXISTS(SELECT 1 FROM dbo.pos_sync_shift_legacy_recovery_receipts r WHERE r.recovery_id=e.recovery_id)
      ORDER BY e.created_at,e.recovery_id;`));
    if (!Array.isArray(result.recordset) || result.recordset.length > limit) fail();
    return Object.freeze(result.recordset.map(row => this.validateRow(row, scope)));
  }
  async acknowledge(tx, { scope: inputScope, recoveryId, witness }) {
    const scope = scopeOf(inputScope), event = await this.load(tx, scope, recoveryId);
    if (!event) fail();
    const evidence = await this.evidenceStore.load(tx, scope, event.captureKey);
    const payload = JSON.parse(event.payloadJson);
    if (!evidence || evidence.shiftId.toLowerCase() !== event.shiftId || evidence.localGraphText !== payload.localGraphText ||
        evidence.cloudGraphText !== payload.cloudGraphText) fail("ELEGACY_RECOVERY_LOCAL_CHANGED");
    const verified = this.assertReceipt(witness, event);
    if (!verified || typeof verified.receiptJson !== "string" || Buffer.byteLength(verified.receiptJson, "utf8") > 6 * 1024 * 1024) fail("ELEGACY_RECOVERY_RECEIPT");
    const receipt = verified.receiptJson, receiptHash = hash(receipt);
    // ACK is metadata only. Root's adoption coordinator must separately protect
    // any later local recount before applying an authoritative cloud graph.
    const result = await this.checked(tx, scope, () => this.request(tx, scope).input("id", event.recoveryId).input("receipt", this.connectionManager.sql().NVarChar(this.connectionManager.sql().MAX), receipt).input("hash", receiptHash).query(`
      IF NOT EXISTS(SELECT 1 FROM dbo.pos_sync_shift_legacy_recovery_receipts WITH(UPDLOCK,HOLDLOCK) WHERE recovery_id=@id)
       INSERT dbo.pos_sync_shift_legacy_recovery_receipts(recovery_id,receipt_json,receipt_sha256,accepted_at) VALUES(@id,@receipt,@hash,SYSDATETIMEOFFSET());
      SELECT receipt_json,receipt_sha256 FROM dbo.pos_sync_shift_legacy_recovery_receipts WHERE recovery_id=@id;`));
    if (result.recordset?.length !== 1 || typeof result.recordset[0].receipt_json !== "string" ||
        hash(result.recordset[0].receipt_json) !== result.recordset[0].receipt_sha256) fail("ELEGACY_RECOVERY_RECEIPT_CONFLICT");
    // The accepted event is immutable; a replay may truthfully report a later
    // administrator correction in current_token/graph without rewriting ACK.
    let original, incoming;
    try { original = JSON.parse(result.recordset[0].receipt_json); incoming = JSON.parse(receipt); } catch { fail("ELEGACY_RECOVERY_RECEIPT_CONFLICT"); }
    if (ACCEPTANCE_FIELDS.some(key => original[key] === undefined || JSON.stringify(original[key]) !== JSON.stringify(incoming[key]))) fail("ELEGACY_RECOVERY_RECEIPT_CONFLICT");
    this.assertReceipt(witness, event); return Object.freeze({ recoveryId: event.recoveryId, acknowledged: true });
  }
}
module.exports = { LegacyShiftRecoveryOutbox, OWNER, COLUMNS, TRIGGERS };
