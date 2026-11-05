"use strict";
// Bounded, isolated prototype. No Main/IPC/worker imports this module yet.
// Review decisions authorize only this exact local projection; never a cloud
// write, an old cashier signature, a journal ACK or a checkpoint reset.
const { createHash, randomUUID } = require("node:crypto");
const { recordId } = require("./uuid-fields.cjs");
const { exactGraph, parseExactJson, stringifyExactJson, exactRows, decimal, instant } = require("./shift-recovery-exact.cjs");
const { classifyRetainedShiftGraph, TABLES } = require("./shift-recovery-classification.cjs");
const OWNER = "retail.reviewed-adoption.v1";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const TRIGGER = "CREATE TRIGGER dbo.TR_reviewed_adoption_immutable ON dbo.pos_shift_recovery_adoptions\n INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 50000, 'Reviewed adoption decisions are append-only.', 1; END;";
const COLUMNS = { decision_id: ["uniqueidentifier", 16, false], capture_key: ["char", 64, false], database_guid: ["uniqueidentifier", 16, false], branch_id: ["nvarchar", 256, false], terminal_id: ["nvarchar", 256, false], backend_origin_hash: ["char", 64, false], shift_id: ["uniqueidentifier", 16, false],
  decision_kind: ["varchar", 32, false], reviewer_id: ["uniqueidentifier", 16, false], reviewer_subject: ["nvarchar", 400, false], reason: ["nvarchar", 800, false], local_before_hash: ["char", 64, false], target_graph_hash: ["char", 64, false], target_graph_token: ["char", 64, true], target_graph_json: ["nvarchar", -1, false], before_ct_version: ["bigint", 8, false], local_after_hash: ["char", 64, false], receipt_recovery_id: ["uniqueidentifier", 16, true], receipt_json: ["nvarchar", -1, true], decided_at: ["datetimeoffset", 10, false] };
const CHECKS = {
  CK_reviewed_adoption_json: "(isjson(target_graph_json)=(1) AND datalength(target_graph_json)<=(12582912) AND (receipt_json IS NULL OR isjson(receipt_json)=(1)))",
  CK_reviewed_adoption_mode: "((decision_kind='RECEIPT_NORMALIZATION' OR decision_kind='ADMIN_ACCEPTED_CLOUD') AND (decision_kind='ADMIN_ACCEPTED_CLOUD' AND receipt_recovery_id IS NULL AND receipt_json IS NULL OR decision_kind='RECEIPT_NORMALIZATION' AND receipt_recovery_id IS NOT NULL AND receipt_json IS NOT NULL))",
  CK_reviewed_adoption_hash: "(NOT local_before_hash like '%[^0-9a-f]%' AND NOT target_graph_hash like '%[^0-9a-f]%' AND NOT local_after_hash like '%[^0-9a-f]%')",
};
// Normalize only SQL Server's identifier brackets/whitespace/case outside strings;
// retain operator grouping and literal contents exactly.
const normalizeCheck = text => typeof text === "string"
  ? text.split(/('(?:''|[^'])*')/).map((part, i) => i % 2 ? part : part.replace(/[\[\]\s]/g, "").toLowerCase()).join("")
  : undefined;
const precisionEquivalent = (source, target) => {
  if (source === null || target === null) return source === target;
  const a = instant(source), b = instant(target);
  if (a === undefined || b === undefined) return false;
  const delta = BigInt(b) - BigInt(a);
  return delta === 0n || BigInt(b) % 10n === 0n && delta >= -5n && delta <= 5n;
};
const hash = text => createHash("sha256").update(text, "utf8").digest("hex");
const fail = (code = "EREVIEWED_ADOPTION") => { throw Object.assign(new Error("The retained closing cannot be adopted safely. Both saved histories remain available for review."), { code, table: "shifts" }); };
class ReviewedShiftAdoption {
  constructor({ connectionManager, registry, evidenceStore, outbox, authority, assertScope, assertReceipt }) {
    Object.assign(this, { connectionManager, registry, evidenceStore, outbox, authority, assertScope, assertReceipt }); this.plans = new WeakMap();
  }
  request(tx) { return new (this.connectionManager.sql().Request)(tx); }
  query(tx, text, values = {}) { const r = this.request(tx); for (const [name, value] of Object.entries(values)) r.input(name, value); return r.query(text); }
  async check(tx, scope) {
    if (await this.assertScope(tx, scope) !== true) fail("SYNC_BRANCH_FORBIDDEN");
    const ready = await this.query(tx, "SELECT CASE WHEN @@TRANCOUNT>0 AND EXISTS(SELECT 1 FROM sys.dm_exec_sessions WHERE session_id=@@SPID AND transaction_isolation_level=4) THEN 1 ELSE 0 END ready;");
    if (ready.recordset?.[0]?.ready !== 1) fail("EREVIEWED_TRANSACTION_REQUIRED");
  }
  target(graph, scope) {
    const shift = recordId(graph?.shiftId), exact = exactGraph(graph, scope.branchId, shift);
    if (!UUID.test(shift) || !exact || classifyRetainedShiftGraph({ registry: this.registry, branchId: scope.branchId, shiftId: shift, localTables: exact.tables, cloudTables: exact.tables }).kind !== "exact") fail("EREVIEWED_EXACT_GRAPH_REQUIRED");
    return { shiftId: shift, exact, graphJson: stringifyExactJson(exact), tablesText: stringifyExactJson(exact.tables) };
  }
  prepareAdmin({ scope, reviewer, graph, reason }) {
    this.authority.assertPrepared(reviewer);
    if (reviewer.branchId !== scope.branchId || reviewer.binding.terminalId !== scope.terminalId || typeof reason !== "string" || reason.trim().length < 3 || reason.length > 400 || /[\u0000-\u001f\u007f]/.test(reason)) fail("PERMISSION_DENIED");
    const target = this.target(graph, scope), plan = Object.freeze({ mode: "ADMIN_ACCEPTED_CLOUD", shiftId: target.shiftId });
    this.plans.set(plan, { ...target, scope: JSON.stringify(scope), reviewerId: reviewer.binding.authorId, subject: reviewer.subject, reason,
      assertCurrent: () => { this.authority.assertPrepared(reviewer); if (this.target(graph, scope).graphJson !== target.graphJson) fail(); } });
    return plan;
  }
  // A fresh native accepted receipt is required even if the event has a local
  // ACK already. Caller provides its fresh private exact current-graph witness.
  prepareReceipt({ scope, event, witness, graph }) {
    const verify = () => this.assertReceipt(witness, event), receipt = verify();
    if (!receipt || typeof receipt.receiptJson !== "string") fail("EREVIEWED_RECEIPT_REQUIRED");
    const raw = parseExactJson(receipt.receiptJson), target = this.target(graph, scope);
    if (target.shiftId !== event.shiftId || raw.current_token !== target.exact.graphToken || stringifyExactJson(raw.graph.tables) !== target.tablesText) fail("EREVIEWED_RECEIPT_REQUIRED");
    const accepted = parseExactJson(raw.accepted_graph_text), current = new Map(target.exact.tables.map(t => [t.table, t.rows]));
    for (const name of ["shift_cash_counts", "shift_reconciliations", "shift_close_events"]) {
      const table = this.registry.tables.find(t => t.cloudTable === name), prior = accepted.find(t => t.table === name)?.rows;
      if (!prior || prior.some(row => !exactRows(table, [row], current.get(name).filter(next => recordId(next.id) === recordId(row.id))))) fail("EREVIEWED_RECEIPT_REQUIRED");
    }
    const plan = Object.freeze({ mode: "RECEIPT_NORMALIZATION", shiftId: target.shiftId });
    this.plans.set(plan, { ...target, scope: JSON.stringify(scope), reviewerId: event.proof.authorId, subject: event.proof.subject,
      reason: "Adopt the verified accepted historical closing and preserved cloud evolution", receiptJson: receipt.receiptJson, event,
      verifyReceipt: verify,
      assertCurrent: () => { verify(); if (this.target(graph, scope).graphJson !== target.graphJson) fail(); } });
    return plan;
  }
  async schema(tx) {
    const result = await this.query(tx, `SELECT CONVERT(nvarchar(64),value) owner_tag FROM sys.extended_properties WHERE major_id=OBJECT_ID(N'dbo.pos_shift_recovery_adoptions',N'U') AND minor_id=0 AND name=N'RetailRecoveryOwner';
      SELECT is_disabled,is_instead_of_trigger,OBJECT_DEFINITION(object_id) definition FROM sys.triggers WHERE parent_id=OBJECT_ID(N'dbo.pos_shift_recovery_adoptions',N'U');
      SELECT name,TYPE_NAME(user_type_id) type_name,max_length,scale,is_nullable,is_identity,is_computed,default_object_id,collation_name FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_shift_recovery_adoptions',N'U');
      SELECT i.name,i.is_primary_key,i.is_unique,i.is_disabled,i.ignore_dup_key,i.has_filter,c.name column_name,ic.key_ordinal,ic.is_included_column FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE i.object_id=OBJECT_ID(N'dbo.pos_shift_recovery_adoptions',N'U') AND i.index_id>0;
      SELECT f.is_disabled,f.is_not_trusted,f.delete_referential_action,f.update_referential_action,rt.name target_table,c.name source_column,rc.name target_column FROM sys.foreign_keys f JOIN sys.foreign_key_columns fc ON fc.constraint_object_id=f.object_id JOIN sys.tables rt ON rt.object_id=f.referenced_object_id JOIN sys.columns c ON c.object_id=fc.parent_object_id AND c.column_id=fc.parent_column_id JOIN sys.columns rc ON rc.object_id=fc.referenced_object_id AND rc.column_id=fc.referenced_column_id WHERE f.parent_object_id=OBJECT_ID(N'dbo.pos_shift_recovery_adoptions',N'U');
      SELECT name,is_disabled,is_not_trusted,definition FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.pos_shift_recovery_adoptions',N'U');`);
    if (result.recordsets?.[0]?.length !== 1 || result.recordsets[0][0].owner_tag !== OWNER || result.recordsets[1]?.length !== 1 || result.recordsets[1][0].is_disabled || !result.recordsets[1][0].is_instead_of_trigger || result.recordsets[1][0].definition?.replace(/\r\n/g, "\n") !== TRIGGER) fail("EREVIEWED_ADOPTION_SCHEMA");
    const [, , columns = [], indexes = [], foreign = [], checks = []] = result.recordsets;
    if (columns.length !== Object.keys(COLUMNS).length || columns.some(c => { const expected = COLUMNS[c.name]; return !expected || c.type_name !== expected[0] || c.max_length !== expected[1] || Boolean(c.is_nullable) !== expected[2] || c.is_identity || c.is_computed || c.default_object_id || c.type_name === "datetimeoffset" && c.scale !== 7 || ["capture_key", "branch_id", "terminal_id", "backend_origin_hash", "local_before_hash", "target_graph_hash", "target_graph_token", "local_after_hash"].includes(c.name) && c.collation_name !== "Latin1_General_100_BIN2"; })) fail("EREVIEWED_ADOPTION_SCHEMA");
    const unique = indexes.filter(i => i.name === "UX_reviewed_adoption_identity"), primary = indexes.filter(i => i.is_primary_key);
    const identity = ["database_guid", "branch_id", "terminal_id", "backend_origin_hash", "shift_id", "target_graph_hash", "local_before_hash"];
    if (indexes.length !== identity.length + 1 || unique.length !== identity.length || unique.some(i => !i.is_unique || i.is_disabled || i.ignore_dup_key || i.has_filter || i.is_included_column || identity[i.key_ordinal - 1] !== i.column_name) || primary.length !== 1 || primary[0].column_name !== "decision_id" || !primary[0].is_unique || primary[0].is_disabled || primary[0].ignore_dup_key || primary[0].has_filter || primary[0].is_included_column) fail("EREVIEWED_ADOPTION_SCHEMA");
    if (foreign.length !== 1 || foreign[0].is_disabled || foreign[0].is_not_trusted || foreign[0].delete_referential_action || foreign[0].update_referential_action || foreign[0].target_table !== "pos_shift_recovery_evidence" || foreign[0].source_column !== "capture_key" || foreign[0].target_column !== "capture_key" || checks.length !== 3 || checks.some(c => c.is_disabled || c.is_not_trusted || !Object.hasOwn(CHECKS,c.name) || normalizeCheck(c.definition) !== normalizeCheck(CHECKS[c.name]))) fail("EREVIEWED_ADOPTION_SCHEMA");
  }
  async pending(tx, scope, shift) {
    const journal = await this.query(tx, "SELECT TOP(2001) entity_type,entity_id FROM dbo.sync_change_journal WITH(UPDLOCK,HOLDLOCK) WHERE branch_id IN(@branch,'global') AND acknowledged_at IS NULL;", { branch: scope.branchId });
    if ((journal.recordset?.length ?? 0) > 2000) fail("ELOCAL_UPLOAD_PENDING");
    for (const entry of journal.recordset ?? []) {
      const table = this.registry.tables.find(t => t.cloudTable === entry.entity_type);
      const closing = TABLES.includes(entry.entity_type), direct = table?.columns.find(c => c.cloudColumn === "shift_id"), sale = table?.columns.find(c => c.cloudColumn === "sale_id");
      if (!closing && !direct && !sale) continue;
      let rowId; try { rowId = recordId(JSON.parse(entry.entity_id).id); } catch { fail("ELOCAL_UPLOAD_PENDING"); }
      if (!UUID.test(rowId) || !table) fail("ELOCAL_UPLOAD_PENDING");
      const target = closing && entry.entity_type === "shifts" ? "source.id" : direct ? `source.[${direct.sqlServerColumn}]` : "sale.shift_id";
      const result = await this.query(tx, `SELECT ${target} shift_id FROM dbo.[${table.sqlServerTable}] source WITH(UPDLOCK,HOLDLOCK)
        ${!direct && sale ? `LEFT JOIN dbo.sales sale WITH(UPDLOCK,HOLDLOCK) ON sale.id=source.[${sale.sqlServerColumn}]` : ""} WHERE source.id=@id;`, { id: rowId });
      if (result.recordset?.length !== 1 || !result.recordset[0].shift_id || recordId(result.recordset[0].shift_id) === shift) fail("ELOCAL_UPLOAD_PENDING");
    }
    const pending = await this.query(tx, `SELECT intent_id FROM dbo.pos_sync_shift_intents WITH(UPDLOCK,HOLDLOCK) WHERE branch_id=@branch AND shift_id=@shift AND acknowledged_at IS NULL;
      SELECT e.recovery_id FROM dbo.pos_sync_shift_legacy_recoveries e WITH(UPDLOCK,HOLDLOCK) WHERE e.database_guid=@database AND e.branch_id=@branch AND e.terminal_id=@terminal AND e.backend_origin_hash=@backend AND e.shift_id=@shift
        AND NOT EXISTS(SELECT 1 FROM dbo.pos_sync_shift_legacy_recovery_receipts r WHERE r.recovery_id=e.recovery_id);`,
    { branch: scope.branchId, shift, database: scope.databaseGuid, terminal: scope.terminalId, backend: scope.backendOriginHash });
    if (pending.recordsets?.some(rows => rows.length)) fail("ELOCAL_UPLOAD_PENDING");
    // Protected financial histories use their existing convergence protocol.
    // Do not fabricate their origins/bases or erase even accepted evidence.
    for (const name of ["pos_sync_shift_financial_origins", "pos_sync_shift_financial_bases", "pos_sync_shift_financial_events"]) {
      const exists = await this.query(tx, "SELECT OBJECT_ID(@name,N'U') present;", { name: "dbo." + name });
      if (exists.recordset?.[0]?.present) {
        const rows = await this.query(tx, `SELECT TOP(1) shift_id FROM dbo.[${name}] WITH(UPDLOCK,HOLDLOCK) WHERE branch_id=@branch AND shift_id=@shift;`, { branch: scope.branchId, shift });
        if (rows.recordset?.length) fail("EREVIEWED_FINANCIAL_PROTECTED");
      }
    }
  }
  async writeRow(tx, table, row, { immutable = false } = {}) {
    const sql = this.connectionManager.sql(), request = new sql.Request(tx), columns = [], expressions = [];
    table.columns.forEach((column, i) => {
      const value = row[column.cloudColumn], name = "v" + i, type = String(column.cloudType).toLowerCase(), storage = String(column.sqlServerType).toLowerCase();
      if (!/^[a-z_][a-z0-9_]*$/i.test(column.sqlServerColumn) || !/^(?:uniqueidentifier|bit|date|datetime2\(\d\)|datetimeoffset\(\d\)|nvarchar\((?:max|\d+)\)|varchar\((?:max|\d+)\)|(?:decimal|numeric)\(\d+,\s*\d+\)|bigint|int|smallint|tinyint|float|real|money|smallmoney)$/.test(storage)) fail("EREVIEWED_REGISTRY_TYPE");
      let text = value;
      if (value !== null) {
        if (/^(numeric|decimal|money|smallmoney|bigint|integer|smallint|real|double precision)/.test(type)) { if (decimal(value) === undefined) fail(); text = typeof value === "string" ? value : stringifyExactJson(value); }
        else if (type === "jsonb" || type.endsWith("[]")) text = stringifyExactJson(value);
        else if (type === "boolean") { if (typeof value !== "boolean") fail(); text = value ? "1" : "0"; }
        else if (typeof value !== "string") fail();
      }
      request.input(name, sql.NVarChar(sql.MAX), text); columns.push(column.sqlServerColumn);
      // Text assignment rejects overflow; explicit text casts would truncate.
      expressions.push(/^(?:n?varchar)/.test(storage) ? "@" + name : `CONVERT(${storage},@${name})`);
    });
    const updates = columns.map((name, i) => name === "id" ? null : `target.[${name}]=source.[${name}]`).filter(Boolean).join(",");
    await request.query(`WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) MERGE dbo.[${table.sqlServerTable}] WITH(HOLDLOCK) target USING(SELECT ${columns.map((name, i) => `${expressions[i]} AS [${name}]`).join(",")}) source ON target.id=source.id
      ${immutable ? "" : `WHEN MATCHED THEN UPDATE SET ${updates}`} WHEN NOT MATCHED THEN INSERT(${columns.map(n => `[${n}]`).join(",")}) VALUES(${columns.map(n => `source.[${n}]`).join(",")});`);
  }
  async apply(tx, { scope, plan, captureKey, decisionId }) {
    const prepared = this.plans.get(plan);
    if (!prepared || prepared.scope !== JSON.stringify(scope) || !HASH.test(captureKey) || !UUID.test(recordId(decisionId))) fail("EREVIEWED_APPROVAL_REQUIRED");
    prepared.assertCurrent(); await this.check(tx, scope); await this.schema(tx); await this.outbox.preflight(tx, scope);
    const evidence = await this.evidenceStore.load(tx, scope, captureKey);
    if (!evidence || recordId(evidence.shiftId) !== prepared.shiftId || evidence.cloudGraphText !== prepared.tablesText) fail("EREVIEWED_SOURCE_CHANGED");
    this.outbox.assertOwnedGraphs(scope, evidence.localGraphText, evidence.cloudGraphText);
    const prior = await this.query(tx, "SELECT * FROM dbo.pos_shift_recovery_adoptions WITH(UPDLOCK,HOLDLOCK) WHERE decision_id=@id;", { id: decisionId });
    if (prior.recordset?.length) {
      const row = prior.recordset[0];
      if (prior.recordset.length !== 1 || row.capture_key !== captureKey || row.local_before_hash !== hash(evidence.localGraphText) || row.target_graph_hash !== hash(prepared.graphJson) || row.target_graph_json !== prepared.graphJson || row.decision_kind !== plan.mode || recordId(row.database_guid) !== scope.databaseGuid || row.branch_id !== scope.branchId || row.terminal_id !== scope.terminalId || row.backend_origin_hash !== scope.backendOriginHash || recordId(row.shift_id) !== prepared.shiftId || recordId(row.reviewer_id) !== prepared.reviewerId || row.reviewer_subject !== prepared.subject || row.reason !== prepared.reason) fail("EREVIEWED_REPLAY_CONFLICT");
      return Object.freeze({ decisionId, alreadyApplied: true, checkpointAdvanced: false });
    }
    const before = await this.outbox.localGraph(tx, scope, prepared.shiftId);
    if (!this.outbox.sameLocalGraph(before, evidence.localGraphText, scope, prepared.shiftId)) fail("EREVIEWED_SOURCE_CHANGED");
    const targetParent = prepared.exact.tables.find(t => t.table === "shifts").rows[0];
    if (targetParent.status === "OPEN") {
      const parent = before.find(t => t.table === "shifts").rows[0], table = this.registry.tables.find(t => t.cloudTable === "shifts");
      const stable = { ...table, columns: table.columns.filter(c => !["row_version", "updated_at", "created_at", "opened_at"].includes(c.cloudColumn)) };
      if (parent.status !== "OPEN" || parent.state !== "ACTIVE" || parent.closed_at !== null || !["opened_at", "created_at"].every(key => precisionEquivalent(parent[key], targetParent[key])) || !exactRows(stable, [parent], [targetParent]) ||
          TABLES.slice(1).some(name => !exactRows(this.registry.tables.find(t => t.cloudTable === name), before.find(t => t.table === name).rows, prepared.exact.tables.find(t => t.table === name).rows))) fail("EREVIEWED_OPEN_PRECISION_ONLY");
      const baseline = await this.query(tx, "SELECT TOP(1) graph_token FROM dbo.pos_sync_shift_baselines WITH(UPDLOCK,HOLDLOCK) WHERE branch_id=@branch AND shift_id=@shift;", { branch: scope.branchId, shift: prepared.shiftId });
      if (baseline.recordset?.length) fail("EREVIEWED_OPEN_BASELINE_CONFLICT");
    }
    await this.pending(tx, scope, prepared.shiftId);
    if (plan.mode === "RECEIPT_NORMALIZATION") {
      const verified = prepared.verifyReceipt(), event = await this.outbox.load(tx, scope, prepared.event.recoveryId);
      const payload = event && JSON.parse(event.payloadJson), incoming = parseExactJson(verified.receiptJson);
      const saved = await this.query(tx, "SELECT receipt_json,receipt_sha256 FROM dbo.pos_sync_shift_legacy_recovery_receipts WITH(UPDLOCK,HOLDLOCK) WHERE recovery_id=@id;", { id: prepared.event.recoveryId });
      if (!event || event.payloadHash !== prepared.event.payloadHash || payload.localGraphText !== evidence.localGraphText || saved.recordset?.length !== 1 || hash(saved.recordset[0].receipt_json) !== saved.recordset[0].receipt_sha256) fail("EREVIEWED_RECEIPT_REQUIRED");
      const original = parseExactJson(saved.recordset[0].receipt_json);
      if (["recovery_id", "payload_hash", "evidence_hash", "cloud_witness_hash", "accepted_token"].some(key => original[key] !== incoming[key])) fail("EREVIEWED_RECEIPT_REQUIRED");
    }
    const position = (await this.query(tx, "SELECT CONVERT(nvarchar(30),CHANGE_TRACKING_CURRENT_VERSION()) current_version;")).recordset?.[0]?.current_version;
    if (typeof position !== "string" || !/^\d+$/.test(position)) fail("EREVIEWED_CT_REQUIRED");
    const ordered = this.registry.tables.filter(t => TABLES.includes(t.cloudTable)).sort((a, b) => a.dependencyOrder - b.dependencyOrder);
    const remote = new Map(prepared.exact.tables.map(t => [t.table, t.rows]));
    const retained = new Map(before.map(t => [t.table, t.rows])), removals = new Map(TABLES.map(name => [name, new Set()]));
    for (const table of ordered.filter(t => t.cloudTable !== "shifts")) for (const old of retained.get(table.cloudTable)) {
      const target = remote.get(table.cloudTable).filter(row => recordId(row.id) === recordId(old.id));
      if (!exactRows(table, [old], target)) removals.get(table.cloudTable).add(recordId(old.id));
    }
    // Replace only changed/absent history and its FK dependants. Unchanged
    // originals/recounts stay untouched, including during parent-only repair.
    for (const row of retained.get("shift_reconciliations")) if (removals.get("shift_cash_counts").has(recordId(row.count_id))) removals.get("shift_reconciliations").add(recordId(row.id));
    for (const row of retained.get("shift_variance_alerts")) if (removals.get("shift_reconciliations").has(recordId(row.reconciliation_id))) removals.get("shift_variance_alerts").add(recordId(row.id));
    for (const table of [...ordered].reverse().filter(t => t.cloudTable !== "shifts")) {
      // Effective conflicting originals are archived in immutable evidence,
      // never unioned or relabelled as a recount in the active projection.
      const ids = [...removals.get(table.cloudTable)];
      if (ids.length) await this.query(tx, `WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) DELETE FROM dbo.[${table.sqlServerTable}] WHERE shift_id=@shift AND store_id=@branch
        AND id IN(SELECT CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@ids));`, { shift: prepared.shiftId, branch: scope.branchId, ids: JSON.stringify(ids) });
    }
    for (const table of ordered) for (const row of remote.get(table.cloudTable)) {
      const old = retained.get(table.cloudTable).filter(value => recordId(value.id) === recordId(row.id));
      if (!removals.get(table.cloudTable).has(recordId(row.id)) && exactRows(table, old, [row])) continue;
      await this.writeRow(tx, table, row);
    }
    const after = await this.outbox.localGraph(tx, scope, prepared.shiftId);
    if (TABLES.some(name => !exactRows(this.registry.tables.find(t => t.cloudTable === name), after.find(t => t.table === name).rows, remote.get(name)))) fail("EREVIEWED_READBACK_MISMATCH");
    // The baseline uses the exact transport JSON, not JSON.stringify of the
    // ordinary parsed response (which may have rounded decimals/timestamps).
    if (prepared.exact.graphToken !== null) await this.query(tx, `MERGE dbo.pos_sync_shift_baselines WITH(HOLDLOCK) target USING(SELECT @branch branch_id,@shift shift_id) source ON target.branch_id=source.branch_id AND target.shift_id=source.shift_id
      WHEN MATCHED THEN UPDATE SET graph_token=@token,closed_at_raw=@closed,graph_json=@graph,observation_generation=@generation
      WHEN NOT MATCHED THEN INSERT(branch_id,shift_id,graph_token,closed_at_raw,graph_json,observation_generation) VALUES(@branch,@shift,@token,@closed,@graph,@generation);`,
    { branch: scope.branchId, shift: prepared.shiftId, token: prepared.exact.graphToken, closed: prepared.exact.closedAtRaw, graph: prepared.graphJson, generation: randomUUID() });
    prepared.assertCurrent(); await this.check(tx, scope);
    const request = this.request(tx), sql = this.connectionManager.sql();
    for (const [name, value] of Object.entries({ id: decisionId, capture: captureKey, database: scope.databaseGuid, branch: scope.branchId, terminal: scope.terminalId, backend: scope.backendOriginHash,
      shift: prepared.shiftId, mode: plan.mode, reviewer: prepared.reviewerId, subject: prepared.subject, reason: prepared.reason, before: hash(evidence.localGraphText), target: hash(prepared.graphJson), token: prepared.exact.graphToken,
      version: position, after: hash(JSON.stringify(after)), recovery: prepared.event?.recoveryId ?? null })) request.input(name, value);
    request.input("graph", sql.NVarChar(sql.MAX), prepared.graphJson).input("receipt", sql.NVarChar(sql.MAX), prepared.receiptJson ?? null);
    await request.query(`INSERT dbo.pos_shift_recovery_adoptions(decision_id,capture_key,database_guid,branch_id,terminal_id,backend_origin_hash,shift_id,decision_kind,reviewer_id,reviewer_subject,reason,local_before_hash,target_graph_hash,target_graph_token,target_graph_json,before_ct_version,local_after_hash,receipt_recovery_id,receipt_json,decided_at)
      VALUES(@id,@capture,@database,@branch,@terminal,@backend,@shift,@mode,@reviewer,@subject,@reason,@before,@target,@token,@graph,@version,@after,@recovery,@receipt,SYSDATETIMEOFFSET());`);
    prepared.assertCurrent(); return Object.freeze({ decisionId, alreadyApplied: false, checkpointAdvanced: false });
  }
}
module.exports = { ReviewedShiftAdoption, OWNER, TRIGGER, precisionEquivalent };
