"use strict";
// Opt-in uniquely owned LocalDB fixture. Never connects to POS_Local or a POS profile.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const sql = require("mssql/msnodesqlv8");
const { loadRegistry } = require("../electron/db/schema-registry.cjs");
const { TABLES } = require("../electron/sync/shift-recovery-classification.cjs");
const { projection } = require("../electron/sync/shift-recovery-exact.cjs");
const { ShiftRecoveryEvidenceStore } = require("../electron/db/shift-recovery-evidence.cjs");
const { LegacyShiftRecoveryOutbox } = require("../electron/db/legacy-shift-recovery-outbox.cjs");
const { LegacyShiftRecoveryAuthority } = require("../electron/legacy-shift-recovery-authority.cjs");
const { LegacyShiftRecoveryService } = require("../electron/sync/legacy-shift-recovery-service.cjs");
const { rememberGraph } = require("../electron/sync/shift-recovery-exact.cjs");
const { parseExactJson, stringifyExactJson, isExactNumber, decimal, exactRows } = require("../electron/sync/shift-recovery-exact.cjs");
const { ReviewedShiftAdoption } = require("../electron/sync/reviewed-shift-adoption.cjs");
const { rememberLegacyRecoveryReceipt, assertLegacyRecoveryReceipt } = require("../electron/sync/legacy-shift-recovery-receipt.cjs");
const { createShiftAuthorKeys } = require("../electron/security/shift-author-key.cjs");
const { scopeHash } = require("../electron/shift-authority.cjs");
const hash = text => crypto.createHash("sha256").update(text).digest("hex");
async function main() {
  assert.deepEqual(process.argv.slice(2), ["--run"]); assert.equal(process.platform, "win32");
  const suffix = crypto.randomUUID().replaceAll("-", ""), instance = "CodexLegacy_" + suffix, database = "LegacyFixture_" + suffix;
  const control = (...args) => { const b = execFileSync("C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe", args, { windowsHide: true, timeout: 30000, stdio: "pipe" }); return b.toString(b.includes(0) ? "utf16le" : "utf8").replace(/^\uFEFF/, ""); };
  let owned = false, created = false, server, master, pool, other, passed = 0, directory;
  const connect = name => { assert(name === "master" || name === database); return new sql.ConnectionPool({ connectionString: `Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`, options: { trustedConnection: true }, pool: { min: 0, max: 4 }, requestTimeout: 10000, connectionTimeout: 10000 }).connect(); };
  const test = async (name, work) => { await work(); passed++; console.log("PASS " + name); };
  try {
    control("create", instance, "-s"); owned = true;
    for (let attempt = 0; attempt < 20 && !server; attempt++) {
      server = control("info", instance).match(/np:\\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query/)?.[0];
      if (!server) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(server, "Owned private pipe unavailable: " + control("info", instance));
    master = await connect("master"); await master.request().batch(`CREATE DATABASE [${database}]; ALTER DATABASE [${database}] SET CHANGE_TRACKING=ON(CHANGE_RETENTION=2 DAYS,AUTO_CLEANUP=ON);`); created = true;
    pool = await connect(database); other = await connect(database);
    const all = loadRegistry(), registry = { ...all, tables: all.tables.filter(t => TABLES.includes(t.cloudTable)) };
    assert.equal(registry.tables.length, 6);
    for (const name of TABLES) { const t = registry.tables.find(t => t.cloudTable === name); await pool.request().batch(`CREATE TABLE dbo.[${name}](${t.columns.map(c => `[${c.sqlServerColumn}] ${c.sqlServerType} ${c.sqlServerColumn === "id" ? "NOT NULL" : "NULL"}`).join(",")},PRIMARY KEY(id)); ALTER TABLE dbo.[${name}] ENABLE CHANGE_TRACKING;`); }
    await pool.request().batch(fs.readFileSync(path.join(__dirname, "../docs/database/retained-shift-recovery-evidence.sql"), "utf8"));
    await pool.request().batch(fs.readFileSync(path.join(__dirname, "../docs/database/legacy-shift-recovery-outbox.sql"), "utf8"));
    await pool.request().batch("CREATE TABLE dbo.pos_sync_shift_author_keys(scope_hash char(64) PRIMARY KEY,project_origin nvarchar(2048),terminal_id nvarchar(128),author_id uniqueidentifier,key_id uniqueidentifier,public_key nvarchar(256));");
    const branchId = crypto.randomUUID(), terminalId = crypto.randomUUID(), authorId = crypto.randomUUID(), projectOrigin = "https://fixture.supabase.co";
    const dbGuid = (await pool.request().query("SELECT CONVERT(varchar(36),database_guid) id FROM sys.database_recovery_status WHERE database_id=DB_ID();")).recordset[0].id.toLowerCase();
    const scope = { databaseGuid: dbGuid, branchId, terminalId, backendOriginHash: hash("https://fixture.invalid") };
    const cm = { pool, sql: () => sql }, active = new WeakSet();
    const assertScope = async (tx, input) => active.has(tx) && JSON.stringify(input) === JSON.stringify(scope) && cm.pool === pool;
    const atomic = async work => { const tx = new sql.Transaction(pool); await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE); active.add(tx); try { const value = await work(tx); await tx.commit(); return value; } catch (error) { await tx.rollback().catch(() => undefined); throw error; } finally { active.delete(tx); } };
    const tmp = path.resolve(__dirname, "../.tmp"); fs.mkdirSync(tmp, { recursive: true }); directory = fs.mkdtempSync(path.join(tmp, "legacy-vault-"));
    // A test-only sealed-storage adapter; no OS/POS credentials are consulted.
    const secret = crypto.randomBytes(32), safeStorage = { isEncryptionAvailable: () => true,
      encryptString(text) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", secret, iv); const data = Buffer.concat([c.update(text), c.final()]); return Buffer.concat([iv, c.getAuthTag(), data]); },
      decryptString(data) { const c = crypto.createDecipheriv("aes-256-gcm", secret, data.subarray(0, 12)); c.setAuthTag(data.subarray(12, 28)); return Buffer.concat([c.update(data.subarray(28)), c.final()]).toString("utf8"); } };
    const keys = createShiftAuthorKeys({ safeStorage, directory: () => directory }), binding = { projectOrigin, terminalId, authorId };
    const info = keys.prepare(binding); keys.markEnrolled(binding, { keyId: info.keyId, publicKey: info.publicKey });
    await pool.request().input("scope", scopeHash(binding)).input("project", projectOrigin).input("terminal", terminalId).input("author", authorId).input("key", info.keyId).input("public", info.publicKey).query("INSERT dbo.pos_sync_shift_author_keys VALUES(@scope,@project,@terminal,@author,@key,@public);");
    let epoch = 1;
    const authority = new LegacyShiftRecoveryAuthority({ keys, session: { identity: () => ({ source: "pos", level: "admin", authorId, canonicalSubject: "fixture.admin" }), epoch: () => epoch }, connectionManager: cm,
      terminal: () => ({ tokenId: terminalId, deviceType: "pc", deviceUse: "operations", locationId: branchId, deviceBindingProof: "a".repeat(64) }), project: () => projectOrigin, branch: () => branchId, backendUrl: () => "https://fixture.invalid" });
    const evidenceStore = new ShiftRecoveryEvidenceStore({ connectionManager: cm, registry, assertScope }), brands = new WeakMap();
    // Tests model only the private native witness boundary. Root's network
    // verifier separately tests server receipt + exact graph verification.
    const assertReceipt = (w, event) => { const record = brands.get(w); if (!record || record.hash !== event.payloadHash) throw Object.assign(Error("Unverified fixture receipt"), { code: "ELEGACY_RECOVERY_RECEIPT" }); return { receiptJson: record.json }; };
    const outbox = new LegacyShiftRecoveryOutbox({ connectionManager: cm, registry, evidenceStore, authority, assertScope, assertReceipt });
    const graph = async id => { const tables = []; for (const name of TABLES) { const t = registry.tables.find(t => t.cloudTable === name); tables.push({ table: name, rows: (await pool.request().input("id", id).query(`SELECT ${projection(t)} FROM dbo.[${name}] source WHERE ${name === "shifts" ? "id" : "shift_id"}=@id ORDER BY id;`)).recordset }); } return JSON.stringify(tables); };
    const seed = async ({ oversized = false, wireHeavy = false, terminalOverride = null } = {}) => {
      const id = crypto.randomUUID(), count = crypto.randomUUID(), recon = crypto.randomUUID();
      await pool.request().input("id", id).input("branch", branchId).input("terminal", terminalId).query("INSERT dbo.shifts(id,store_id,terminal_id,status,state,opened_at,row_version,opening_float) VALUES(@id,@branch,@terminal,'OPEN','ACTIVE','2026-01-01T00:00:00.1234567+00:00',1,100);");
      const cloudGraphText = await graph(id);
      await pool.request().input("id", id).input("branch", branchId).input("count", count).input("recon", recon).batch(`
        UPDATE dbo.shifts SET status='CLOSED',state='CLOSED',closed_at='2026-01-01T08:00:00.1234567+00:00',counted_cash=100,final_counted_cash=100,closing_float=100,
          counted_card=12,counted_digital=20,expected_cash=100,expected_card=12,expected_digital=20,variance_cash=0,variance_card=0,variance_digital=0,variance_total=0,variance_status='NO_VARIANCE' WHERE id=@id;
        INSERT dbo.shift_cash_counts(id,store_id,shift_id,kind,counted_cash,counted_card,counted_digital) VALUES(@count,@branch,@id,'ORIGINAL',100,12,20);
        INSERT dbo.shift_reconciliations(id,store_id,shift_id,count_id,counted_cash,counted_card,counted_digital,expected_cash,expected_card,expected_digital,variance_cash,variance_card,variance_digital,variance_total,variance_status)
          VALUES(@recon,@branch,@id,@count,100,12,20,100,12,20,0,0,0,0,'NO_VARIANCE');
        INSERT dbo.shift_close_events(id,store_id,shift_id) VALUES(NEWID(),@branch,@id);
        INSERT dbo.shift_notifications(id,store_id,shift_id) VALUES(NEWID(),@branch,@id);
        INSERT dbo.shift_variance_alerts(id,store_id,shift_id,reconciliation_id) VALUES(NEWID(),@branch,@id,@recon);`);
      for (const name of TABLES.slice(1)) if (registry.tables.find(t => t.cloudTable === name).columns.some(c => c.sqlServerColumn === "terminal_id"))
        await pool.request().input("id", id).input("terminal", terminalId).query(`UPDATE dbo.[${name}] SET terminal_id=@terminal WHERE shift_id=@id;`);
      if (terminalOverride) await pool.request().input("id", id).input("terminal", terminalOverride.value).query(`UPDATE dbo.[${terminalOverride.table}] SET terminal_id=@terminal WHERE ${terminalOverride.table === "shifts" ? "id" : "shift_id"}=@id;`);
      if (oversized) await pool.request().input("id", id).input("note", sql.NVarChar(sql.MAX), "x".repeat(280000)).query("UPDATE dbo.shifts SET note=@note WHERE id=@id;");
      if (wireHeavy) await pool.request().input("id", id).input("note", sql.NVarChar(sql.MAX), '"'.repeat(40000)).query("UPDATE dbo.shifts SET note=@note WHERE id=@id;");
      const localGraphText = await graph(id), capture = await atomic(tx => evidenceStore.capture(tx, { scope, shiftId: id, jobId: crypto.randomUUID(), localGraphText, cloudGraphText }));
      assert.equal(capture.classification, "legacy-local-closing-needs-review"); return { id, capture, localGraphText, cloudGraphText };
    };
    const approve = async candidate => { const reviewer = await authority.prepare(authority.capture()); return atomic(tx => outbox.create(tx, { scope, captureKey: candidate.capture.captureKey, recoveryId: crypto.randomUUID(), reason: "Administrator reviewed saved historical closing", reviewer })); };
    const witness = (event, overrides = {}) => { const w = Object.freeze({}); brands.set(w, { hash: event.payloadHash, json: JSON.stringify({ version: 1, recovery_id: event.recoveryId, payload_hash: event.payloadHash, evidence_hash: event.evidenceHash, cloud_witness_hash: event.cloudWitnessHash,
      financial_verification: "UNVERIFIED_HISTORICAL", accepted_token: "a".repeat(64), current_token: "a".repeat(64), superseded: false, provenance: "ADMIN_REVIEWED_LEGACY", ...overrides }) }); return w; };
    const candidate = await seed(), before = await graph(candidate.id); let event;
    await test("real serializable freeze signs the current admin and preserves all six business tables", async () => { event = await approve(candidate); assert.equal(event.proof.authorId, authorId); assert.equal(event.financialVerification, "UNVERIFIED_HISTORICAL"); assert.equal(await graph(candidate.id), before); assert.equal((await atomic(tx => outbox.pending(tx, scope))).length, 1); });
    await test("quoted graph evidence exceeding total wire budget is held before any pending event is inserted", async () => {
      const c = await seed({ wireHeavy: true });
      await assert.rejects(approve(c), error => error.code === "ELEGACY_RECOVERY_OVERSIZED");
      assert.equal((await atomic(tx => outbox.pending(tx, scope))).length, 1); assert.equal(await graph(c.id), c.localGraphText);
    });
    await test("failed coordinator transaction rolls back only its new event", async () => { const c = await seed(), reviewer = await authority.prepare(authority.capture()); await assert.rejects(atomic(async tx => { await outbox.create(tx, { scope, captureKey: c.capture.captureKey, recoveryId: crypto.randomUUID(), reason: "Reviewed evidence", reviewer }); throw Error("rollback fixture"); }), /rollback fixture/); assert.equal((await atomic(tx => outbox.pending(tx, scope))).length, 1); assert.equal(await graph(c.id), c.localGraphText); });
    await test("same exact recovery retries idempotently while changed reason conflicts", async () => { const reviewer = await authority.prepare(authority.capture()), params = { scope, captureKey: candidate.capture.captureKey, recoveryId: event.recoveryId, reason: "Administrator reviewed saved historical closing", reviewer }; assert.equal((await atomic(tx => outbox.create(tx, params))).payloadHash, event.payloadHash); await assert.rejects(atomic(tx => outbox.create(tx, { ...params, reason: "Different decision" })), e => e.code === "ELEGACY_RECOVERY_REPLAY_CONFLICT"); });
    await test("concurrent different recovery IDs/admins/reasons preserve exactly one approved event", async () => {
      const c = await seed(), secondAuthor = crypto.randomUUID(), secondBinding = { projectOrigin, terminalId, authorId: secondAuthor };
      const secondInfo = keys.prepare(secondBinding); keys.markEnrolled(secondBinding, { keyId: secondInfo.keyId, publicKey: secondInfo.publicKey });
      await pool.request().input("scope", scopeHash(secondBinding)).input("project", projectOrigin).input("terminal", terminalId).input("author", secondAuthor).input("key", secondInfo.keyId).input("public", secondInfo.publicKey).query("INSERT dbo.pos_sync_shift_author_keys VALUES(@scope,@project,@terminal,@author,@key,@public);");
      const secondAuthority = new LegacyShiftRecoveryAuthority({ keys, session: { identity: () => ({ source: "pos", level: "admin", authorId: secondAuthor, canonicalSubject: "fixture.second-admin" }), epoch: () => epoch }, connectionManager: cm,
        terminal: () => ({ tokenId: terminalId, deviceType: "pc", deviceUse: "operations", locationId: branchId, deviceBindingProof: "a".repeat(64) }), project: () => projectOrigin, branch: () => branchId, backendUrl: () => "https://fixture.invalid" });
      const otherOutbox = new LegacyShiftRecoveryOutbox({ connectionManager: cm, registry, evidenceStore, authority: secondAuthority, assertScope, assertReceipt });
      const reviewer = await authority.prepare(authority.capture()), secondReviewer = await secondAuthority.prepare(secondAuthority.capture());
      const results = await Promise.allSettled([
        atomic(tx => outbox.create(tx, { scope, captureKey: c.capture.captureKey, recoveryId: crypto.randomUUID(), reason: "First administrator review", reviewer })),
        atomic(tx => otherOutbox.create(tx, { scope, captureKey: c.capture.captureKey, recoveryId: crypto.randomUUID(), reason: "Second administrator review", reviewer: secondReviewer })),
      ]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(results.filter(r => r.status === "rejected" && r.reason.code === "ELEGACY_RECOVERY_ALREADY_QUEUED").length, 1);
      const winner = results.find(r => r.status === "fulfilled").value;
      const stored = await pool.request().input("shift", c.id).query("SELECT recovery_id,payload_json,proof_json FROM dbo.pos_sync_shift_legacy_recoveries WHERE shift_id=@shift;");
      assert.equal(stored.recordset.length, 1); assert.equal(stored.recordset[0].payload_json, winner.payloadJson); assert.equal(stored.recordset[0].proof_json, JSON.stringify(winner.proof));
      await assert.rejects(atomic(tx => outbox.create(tx, { scope, captureKey: c.capture.captureKey, recoveryId: crypto.randomUUID(), reason: "A reopened review must not duplicate this", reviewer })), e => e.code === "ELEGACY_RECOVERY_ALREADY_QUEUED");
      await atomic(tx => outbox.acknowledge(tx, { scope, recoveryId: winner.recoveryId, witness: witness(winner) }));
      assert.equal(await graph(c.id), c.localGraphText);
    });
    await test("local edit after evidence capture cannot be signed", async () => { const c = await seed(); await pool.request().input("id", c.id).query("UPDATE dbo.shifts SET note='later local edit' WHERE id=@id;"); await assert.rejects(approve(c), e => e.code === "ELEGACY_RECOVERY_LOCAL_CHANGED"); });
    await test("oversized graphs remain evidence with an explicit hold and no new event", async () => { const c = await seed({ oversized: true }); await assert.rejects(approve(c), e => e.code === "ELEGACY_RECOVERY_OVERSIZED"); assert.equal((await atomic(tx => evidenceStore.load(tx, scope, c.capture.captureKey))).localGraphText, c.localGraphText); });
    await test("null or another till's retained claims cannot be approved from this Operations terminal", async () => {
      for (const table of registry.tables.filter(t => t.columns.some(c => c.sqlServerColumn === "terminal_id"))) for (const value of [null, crypto.randomUUID()]) {
        const c = await seed({ terminalOverride: { table: table.cloudTable, value } });
        await assert.rejects(approve(c), e => e.code === "SYNC_BRANCH_FORBIDDEN");
      }
    });
    await test("wrong branch/profile and non-serializable scopes fail before reading pending", async () => { await assert.rejects(atomic(tx => outbox.pending(tx, { ...scope, branchId: crypto.randomUUID() })), e => e.code === "SYNC_BRANCH_FORBIDDEN"); await assert.rejects(outbox.pending({}, scope), e => e.code === "SYNC_BRANCH_FORBIDDEN"); });
    await test("a reviewer invalidated during capture cannot freeze an event", async () => { const reviewer = await authority.prepare(authority.capture()); epoch++; await assert.rejects(atomic(tx => outbox.create(tx, { scope, captureKey: candidate.capture.captureKey, recoveryId: crypto.randomUUID(), reason: "Reviewed evidence", reviewer }))); });
    await test("offline 90/365-day pending entries never expire or lose their immutable proof", async () => { for (const days of [90, 365]) { const now = Date.now, at = now() + days * 86400000; Date.now = () => at; try { assert.equal((await atomic(tx => outbox.pending(tx, scope)))[0].payloadJson, event.payloadJson); } finally { Date.now = now; } } });
    await test("unbranded renderer receipt cannot acknowledge anything", async () => { await assert.rejects(atomic(tx => outbox.acknowledge(tx, { scope, recoveryId: event.recoveryId, witness: { accepted: true } })), e => e.code === "ELEGACY_RECOVERY_RECEIPT"); assert.equal((await atomic(tx => outbox.pending(tx, scope))).length, 1); });
    await test("verified ACK preserves a later local edit and only removes exact event from pending", async () => { await pool.request().input("id", candidate.id).query("UPDATE dbo.shifts SET note='later pending administrator work' WHERE id=@id;"); const changed = await graph(candidate.id); await atomic(tx => outbox.acknowledge(tx, { scope, recoveryId: event.recoveryId, witness: witness(event) })); assert.equal((await atomic(tx => outbox.pending(tx, scope))).length, 0); assert.equal(await graph(candidate.id), changed); });
    await test("superseded replay retains first accepted receipt without reverting administrator changes", async () => { const before = (await pool.request().query("SELECT receipt_json FROM dbo.pos_sync_shift_legacy_recovery_receipts;")).recordset[0].receipt_json; await atomic(tx => outbox.acknowledge(tx, { scope, recoveryId: event.recoveryId, witness: witness(event, { current_token: "b".repeat(64), superseded: true }) })); assert.equal((await pool.request().query("SELECT receipt_json FROM dbo.pos_sync_shift_legacy_recovery_receipts;")).recordset[0].receipt_json, before); await assert.rejects(atomic(tx => outbox.acknowledge(tx, { scope, recoveryId: event.recoveryId, witness: witness(event, { accepted_token: "c".repeat(64) }) })), e => e.code === "ELEGACY_RECOVERY_RECEIPT_CONFLICT"); });
    await test("SQL append-only events and receipts reject updates and deletes", async () => { for (const table of ["pos_sync_shift_legacy_recoveries", "pos_sync_shift_legacy_recovery_receipts"]) for (const action of [`UPDATE dbo.${table} SET recovery_id=recovery_id;`, `DELETE dbo.${table};`]) await assert.rejects(pool.request().query(action), /append-only/); });
    await test("serializable event range lock excludes another SQL writer", async () => { const tx = new sql.Transaction(pool); await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE); active.add(tx); try { await outbox.load(tx, scope, event.recoveryId); const r = await other.request().input("id", event.recoveryId).query("SET LOCK_TIMEOUT 250; BEGIN TRY SELECT recovery_id FROM dbo.pos_sync_shift_legacy_recoveries WITH(UPDLOCK) WHERE recovery_id=@id; SELECT 0 error_number; END TRY BEGIN CATCH SELECT ERROR_NUMBER() error_number; END CATCH;"); assert.equal(r.recordsets.flat().find(row => Object.hasOwn(row, "error_number"))?.error_number, 1222); } finally { active.delete(tx); await tx.rollback(); } });
    const reviewed = await seed(); let service, preview;
    const scoped = (tx, supplied) => service.assertScope(tx, supplied);
    const serviceEvidence = new ShiftRecoveryEvidenceStore({ connectionManager: cm, registry, assertScope: scoped });
    const serviceOutbox = new LegacyShiftRecoveryOutbox({ connectionManager: cm, registry, evidenceStore: serviceEvidence, authority, assertScope: scoped, assertReceipt });
    const outsideSqlLocks = async () => { await other.request().input("id", reviewed.id).query("SET LOCK_TIMEOUT 500; SELECT id FROM dbo.shifts WITH(UPDLOCK) WHERE id=@id;"); };
    service = new LegacyShiftRecoveryService({ connectionManager: cm, registry, evidenceStore: serviceEvidence, outbox: serviceOutbox, authority,
      readContext: () => ({ branchId, terminalId, backendOriginHash: scope.backendOriginHash, profileKey: "isolated fixture/project/backend/proof" }),
      cloud: { shiftGraph: async () => { await outsideSqlLocks(); const raw = `{"ok":true,"shiftGraphVersion":1,"branchId":${JSON.stringify(branchId)},"shiftId":${JSON.stringify(reviewed.id)},"graphToken":null,"closedAtRaw":null,"tables":${reviewed.cloudGraphText}}`; return rememberGraph(JSON.parse(raw), raw, "1"); },
        pushLegacyRecovery: async supplied => { await outsideSqlLocks(); return witness(supplied); } } });
    await test("actual service derives the database GUID per transaction and previews without holding SQL across network", async () => {
      preview = await service.preview(reviewed.id); assert.equal(preview.canApprove, true); assert.equal(preview.local.countedCash, JSON.parse(reviewed.localGraphText)[0].rows[0].counted_cash); assert.equal(preview.cloud.status, "OPEN");
      assert(!JSON.stringify(preview).includes("GraphText")); assert.equal((await service.pendingSummary()).pending, 0);
    });
    await test("actual service freezes pending approval then acknowledges through the original coordinator only", async () => {
      const response = await service.approve({ captureKey: preview.captureKey, recoveryId: crypto.randomUUID(), reason: "Administrator reviewed saved historical evidence" });
      assert.equal(response.state, "PENDING"); assert.equal((await service.pendingSummary()).pending, 1);
      assert.deepEqual(await service.pushPending({ branchId }), { skipped: false, acknowledged: 1, pushed: 1, pending: 0, downloadRecoveryComplete: false });
      assert.equal(await graph(reviewed.id), reviewed.localGraphText);
    });
    await test("disabled shift-scope uniqueness cannot be mistaken for a reviewed queue schema", async () => {
      await pool.request().query("ALTER INDEX UX_legacy_recovery_shift_scope ON dbo.pos_sync_shift_legacy_recoveries DISABLE;");
      await assert.rejects(atomic(tx => outbox.load(tx, scope, event.recoveryId)), e => e.code === "ELEGACY_RECOVERY_SCHEMA");
      await pool.request().query("ALTER INDEX UX_legacy_recovery_shift_scope ON dbo.pos_sync_shift_legacy_recoveries REBUILD;");
    });
    await test("disabled evidence foreign key fails exact schema preflight", async () => { await pool.request().query("ALTER TABLE dbo.pos_sync_shift_legacy_recoveries NOCHECK CONSTRAINT FK_legacy_recovery_evidence;"); await assert.rejects(atomic(tx => outbox.load(tx, scope, event.recoveryId)), e => e.code === "ELEGACY_RECOVERY_SCHEMA"); });
    await pool.request().batch(`ALTER TABLE dbo.pos_sync_shift_legacy_recoveries WITH CHECK CHECK CONSTRAINT FK_legacy_recovery_evidence;
      CREATE TABLE dbo.sync_change_journal(entity_type nvarchar(128),entity_id nvarchar(400),branch_id nvarchar(128),acknowledged_at datetimeoffset NULL);
      CREATE TABLE dbo.pos_sync_shift_intents(intent_id uniqueidentifier PRIMARY KEY,branch_id nvarchar(128),shift_id uniqueidentifier,acknowledged_at datetimeoffset NULL);
      CREATE TABLE dbo.pos_sync_shift_baselines(branch_id nvarchar(128),shift_id uniqueidentifier,graph_token char(64),closed_at_raw nvarchar(80),graph_json nvarchar(max),observation_generation uniqueidentifier,PRIMARY KEY(branch_id,shift_id));
      CREATE TABLE dbo.sync_checkpoints(organization_id nvarchar(128),branch_id nvarchar(128),entity_type nvarchar(128),direction nvarchar(16),change_tracking_version bigint,committed_cursor nvarchar(400),updated_at datetimeoffset);
      CREATE TABLE dbo.sales(id uniqueidentifier PRIMARY KEY,store_id nvarchar(128),shift_id uniqueidentifier);
      ALTER TABLE dbo.shift_reconciliations ADD CONSTRAINT FK_fixture_recon_count FOREIGN KEY(count_id) REFERENCES dbo.shift_cash_counts(id);
      ALTER TABLE dbo.shift_variance_alerts ADD CONSTRAINT FK_fixture_alert_recon FOREIGN KEY(reconciliation_id) REFERENCES dbo.shift_reconciliations(id);`);
    await pool.request().batch(fs.readFileSync(path.join(__dirname, "../docs/database/reviewed-shift-adoption.sql"), "utf8"));
    const toCloud = text => parseExactJson(text).map(part => { const table = registry.tables.find(t => t.cloudTable === part.table); return { table: part.table, rows: part.rows.map(row => Object.fromEntries(table.columns.map(column => {
      let value = row[column.sqlServerColumn], type = column.cloudType;
      if (value !== null && typeof value === "string" && (/^(numeric|decimal|money|smallmoney|bigint|integer|smallint|real|double precision)/.test(type) || type === "jsonb" || type.endsWith("[]"))) value = parseExactJson(value);
      if (type === "boolean" && isExactNumber(value)) value = decimal(value) === "1e0";
      if (type === "uuid" && typeof value === "string") value = value.toLowerCase();
      return [column.cloudColumn, value];
    }))) }; });
    const transport = (shift, tables, token = "d".repeat(64)) => { const parent = tables.find(t => t.table === "shifts").rows[0]; const raw = stringifyExactJson({ ok: true, shiftGraphVersion: parseExactJson("1"), branchId, shiftId: shift, graphToken: token, closedAtRaw: parent.closed_at, tables }); return rememberGraph(JSON.parse(raw), raw, "1"); };
    const captureAdoption = async (c, target) => atomic(tx => evidenceStore.capture(tx, { scope, shiftId: c.id, jobId: crypto.randomUUID(), localGraphText: c.localGraphText, cloudGraphText: stringifyExactJson(target) }));
    const adopter = new ReviewedShiftAdoption({ connectionManager: cm, registry: all, evidenceStore, outbox, authority, assertScope, assertReceipt: assertLegacyRecoveryReceipt });
    let precisionShift;
    const adminPlan = async (c, target, reason = "Use the accepted cloud closing; preserve local claim in audit") => adopter.prepareAdmin({ scope, reviewer: await authority.prepare(authority.capture()), graph: transport(c.id, target), reason });
    await test("reviewed competing ORIGINAL adoption archives the old graph and keeps one effective original", async () => {
      const c = await seed(), target = toCloud(c.localGraphText), newCount = crypto.randomUUID(), newRecon = crypto.randomUUID();
      for (const table of target) for (const row of table.rows) {
        if (table.table === "shift_cash_counts") { row.id = newCount; row.counted_cash = parseExactJson("1234567890.123456789012"); }
        if (table.table === "shift_reconciliations") { row.id = newRecon; row.count_id = newCount; row.counted_cash = parseExactJson("1234567890.123456789012"); row.expected_cash = row.counted_cash; }
        if (table.table === "shift_variance_alerts") row.reconciliation_id = newRecon;
        if (table.table === "shifts") for (const key of ["counted_cash", "final_counted_cash", "closing_float", "expected_cash"]) row[key] = parseExactJson("1234567890.123456789012");
      }
      const archived = await captureAdoption(c, target), plan = await adminPlan(c, target), decisionId = crypto.randomUUID();
      await atomic(tx => adopter.apply(tx, { scope, plan, captureKey: archived.captureKey, decisionId }));
      precisionShift = c.id;
      const current = JSON.parse(await graph(c.id)); assert.equal(current[1].rows.length, 1); assert.equal(current[1].rows[0].id.toLowerCase(), newCount); assert.equal(current[1].rows[0].kind, "ORIGINAL");
      assert.equal(current[0].rows[0].counted_cash, "1234567890.123456789012"); assert.equal((await atomic(tx => evidenceStore.load(tx, scope, archived.captureKey))).localGraphText, c.localGraphText);
      const baseline = (await pool.request().input("id", c.id).query("SELECT graph_json FROM dbo.pos_sync_shift_baselines WHERE shift_id=@id;")).recordset[0].graph_json;
      assert(baseline.includes("1234567890.123456789012")); assert.equal((await pool.request().query("SELECT COUNT(*) n FROM dbo.sync_checkpoints;")).recordset[0].n, 0);
      assert.deepEqual(await atomic(tx => adopter.apply(tx, { scope, plan, captureKey: archived.captureKey, decisionId })), { decisionId, alreadyApplied: true, checkpointAdvanced: false });
    });
    await test("same-shift pending closing or sale work holds adoption, unrelated new sale does not", async () => {
      const c = await seed(), target = toCloud(c.localGraphText); target[0].rows[0].note = "Accepted cloud correction";
      const archived = await captureAdoption(c, target), plan = await adminPlan(c, target), values = { scope, plan, captureKey: archived.captureKey, decisionId: crypto.randomUUID() };
      const sale = crypto.randomUUID(), otherShift = crypto.randomUUID();
      await pool.request().input("id", sale).input("branch", branchId).input("shift", c.id).query("INSERT dbo.sales VALUES(@id,@branch,@shift); INSERT dbo.sync_change_journal VALUES('sales',CONCAT('{\"id\":\"',@id,'\"}'),@branch,NULL);");
      await assert.rejects(atomic(tx => adopter.apply(tx, values)), e => e.code === "ELOCAL_UPLOAD_PENDING"); assert.equal(await graph(c.id), c.localGraphText);
      await pool.request().input("id", sale).input("shift", otherShift).query("UPDATE dbo.sales SET shift_id=@shift WHERE id=@id;");
      await atomic(tx => adopter.apply(tx, values)); assert(JSON.parse(await graph(c.id))[0].rows[0].note.includes("cloud"));
      await pool.request().query("DELETE dbo.sync_change_journal;");
    });
    await test("local edit, forged decision and expired admin cannot authorize adoption", async () => {
      const c = await seed(), target = toCloud(c.localGraphText); target[0].rows[0].note = "Cloud";
      const archived = await captureAdoption(c, target), plan = await adminPlan(c, target), values = { scope, plan, captureKey: archived.captureKey, decisionId: crypto.randomUUID() };
      await assert.rejects(atomic(tx => adopter.apply(tx, { ...values, plan: { mode: "ADMIN_ACCEPTED_CLOUD", shiftId: c.id } })), e => e.code === "EREVIEWED_APPROVAL_REQUIRED");
      await pool.request().input("id", c.id).query("UPDATE dbo.shifts SET note='New unsaved local evolution' WHERE id=@id;");
      await assert.rejects(atomic(tx => adopter.apply(tx, values)), e => e.code === "EREVIEWED_SOURCE_CHANGED"); epoch++;
      await assert.rejects(atomic(tx => adopter.apply(tx, values))); assert(JSON.parse(await graph(c.id))[0].rows[0].note.includes("local"));
    });
    await test("failed transaction preserves all six tables and creates no decision/baseline", async () => {
      const c = await seed(), target = toCloud(c.localGraphText); target[0].rows[0].note = "Cloud";
      const archived = await captureAdoption(c, target), plan = await adminPlan(c, target), decisionId = crypto.randomUUID();
      await assert.rejects(atomic(async tx => { await adopter.apply(tx, { scope, plan, captureKey: archived.captureKey, decisionId }); throw Error("rollback adoption fixture"); }), /rollback adoption/);
      assert.equal(await graph(c.id), c.localGraphText); assert.equal((await pool.request().input("id", decisionId).query("SELECT decision_id FROM dbo.pos_shift_recovery_adoptions WHERE decision_id=@id;")).recordset.length, 0);
    });
    await test("unattributed closing journal and protected pending intent cannot be discarded", async () => {
      const c = await seed(), target = toCloud(c.localGraphText); target[0].rows[0].note = "Accepted cloud";
      const archived = await captureAdoption(c, target), plan = await adminPlan(c, target), values = { scope, plan, captureKey: archived.captureKey, decisionId: crypto.randomUUID() };
      await pool.request().input("branch", branchId).input("key", JSON.stringify({ id: crypto.randomUUID() })).query("INSERT dbo.sync_change_journal VALUES('shift_cash_counts',@key,@branch,NULL);");
      await assert.rejects(atomic(tx => adopter.apply(tx, values)), e => e.code === "ELOCAL_UPLOAD_PENDING");
      await pool.request().query("DELETE dbo.sync_change_journal;");
      await pool.request().input("branch", branchId).input("shift", c.id).query("INSERT dbo.pos_sync_shift_intents VALUES(NEWID(),@branch,@shift,NULL);");
      await assert.rejects(atomic(tx => adopter.apply(tx, values)), e => e.code === "ELOCAL_UPLOAD_PENDING");
      await pool.request().query("DELETE dbo.pos_sync_shift_intents;"); assert.equal(await graph(c.id), c.localGraphText);
    });
    await test("protected financial origin remains on its existing path without fabricated replacement", async () => {
      const c = await seed(), target = toCloud(c.localGraphText); target[0].rows[0].note = "Accepted cloud";
      const archived = await captureAdoption(c, target), plan = await adminPlan(c, target), values = { scope, plan, captureKey: archived.captureKey, decisionId: crypto.randomUUID() };
      await pool.request().input("branch", branchId).input("shift", c.id).batch("CREATE TABLE dbo.pos_sync_shift_financial_origins(branch_id nvarchar(128),shift_id uniqueidentifier); INSERT dbo.pos_sync_shift_financial_origins VALUES(@branch,@shift);");
      await assert.rejects(atomic(tx => adopter.apply(tx, values)), e => e.code === "EREVIEWED_FINANCIAL_PROTECTED"); assert.equal(await graph(c.id), c.localGraphText);
      await pool.request().query("DROP TABLE dbo.pos_sync_shift_financial_origins;");
    });
    await test("disabled adoption evidence FK or trigger fails before effective projection writes", async () => {
      const c = await seed(), target = toCloud(c.localGraphText); target[0].rows[0].note = "Accepted cloud";
      const archived = await captureAdoption(c, target), plan = await adminPlan(c, target), values = { scope, plan, captureKey: archived.captureKey, decisionId: crypto.randomUUID() };
      await pool.request().query("ALTER TABLE dbo.pos_shift_recovery_adoptions NOCHECK CONSTRAINT FK_reviewed_adoption_evidence;");
      await assert.rejects(atomic(tx => adopter.apply(tx, values)), e => e.code === "EREVIEWED_ADOPTION_SCHEMA");
      await pool.request().query("ALTER TABLE dbo.pos_shift_recovery_adoptions WITH CHECK CHECK CONSTRAINT FK_reviewed_adoption_evidence; DISABLE TRIGGER dbo.TR_reviewed_adoption_immutable ON dbo.pos_shift_recovery_adoptions;");
      await assert.rejects(atomic(tx => adopter.apply(tx, values)), e => e.code === "EREVIEWED_ADOPTION_SCHEMA");
      await pool.request().query("ENABLE TRIGGER dbo.TR_reviewed_adoption_immutable ON dbo.pos_shift_recovery_adoptions;"); assert.equal(await graph(c.id), c.localGraphText);
    });
    await test("same-name weakened CHECK constraints fail before projection writes", async () => {
      const definitions=(await pool.request().query("SELECT name,definition FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.pos_shift_recovery_adoptions')")).recordset;
      for(const item of definitions){
        const c=await seed(),target=toCloud(c.localGraphText), archived=await captureAdoption(c,target),plan=adopter.prepareAdmin({scope,reviewer:await authority.prepare(authority.capture()),graph:transport(c.id,target),reason:"Reject changed constraint definitions"});
        await pool.request().batch('ALTER TABLE dbo.pos_shift_recovery_adoptions DROP CONSTRAINT ['+item.name+']; ALTER TABLE dbo.pos_shift_recovery_adoptions ADD CONSTRAINT ['+item.name+'] CHECK(1=1);');
        await assert.rejects(atomic(tx=>adopter.apply(tx,{scope,plan,captureKey:archived.captureKey,decisionId:crypto.randomUUID()})),e=>e.code==='EREVIEWED_ADOPTION_SCHEMA');
        assert.equal(await graph(c.id),c.localGraphText);
        await pool.request().batch('ALTER TABLE dbo.pos_shift_recovery_adoptions DROP CONSTRAINT ['+item.name+']; ALTER TABLE dbo.pos_shift_recovery_adoptions WITH CHECK ADD CONSTRAINT ['+item.name+'] CHECK '+item.definition+';');
      }
    });
    await test("OPEN timestamp changes beyond microsecond quantization remain held", async () => {
      for(const field of ['opened_at','created_at']) for(const timestamp of ['2026-01-02T00:00:00.123457+00:00','2026-01-01T00:00:00.123458+00:00','2026-01-01T00:00:00.1234568+00:00']){
        const c=await seed();await pool.request().input('id',c.id).batch("DELETE dbo.shift_variance_alerts WHERE shift_id=@id;DELETE dbo.shift_reconciliations WHERE shift_id=@id;DELETE dbo.shift_cash_counts WHERE shift_id=@id;DELETE dbo.shift_close_events WHERE shift_id=@id;DELETE dbo.shift_notifications WHERE shift_id=@id;UPDATE dbo.shifts SET status='OPEN',state='ACTIVE',closed_at=NULL WHERE id=@id;");c.localGraphText=await graph(c.id);
        const target=toCloud(c.localGraphText);target[0].rows[0][field]=timestamp;
        const archived=await captureAdoption(c,target),plan=adopter.prepareAdmin({scope,reviewer:await authority.prepare(authority.capture()),graph:transport(c.id,target,null),reason:'Reject unproven opening timestamp drift'});
        await assert.rejects(atomic(tx=>adopter.apply(tx,{scope,plan,captureKey:archived.captureKey,decisionId:crypto.randomUUID()})),e=>e.code==='EREVIEWED_OPEN_PRECISION_ONLY');assert.equal(await graph(c.id),c.localGraphText);
      }
    });
    await test("OPEN precision adoption does not invent a closing baseline", async () => {
      const c = await seed(); await pool.request().input("id", c.id).batch(`DELETE dbo.shift_variance_alerts WHERE shift_id=@id;DELETE dbo.shift_reconciliations WHERE shift_id=@id;DELETE dbo.shift_cash_counts WHERE shift_id=@id;DELETE dbo.shift_close_events WHERE shift_id=@id;DELETE dbo.shift_notifications WHERE shift_id=@id;
        UPDATE dbo.shifts SET status='OPEN',state='ACTIVE',closed_at=NULL WHERE id=@id;`); c.localGraphText = await graph(c.id);
      const target = toCloud(c.localGraphText); target[0].rows[0].opened_at = "2026-01-01T00:00:00.123457+00:00";
      const archived = await captureAdoption(c, target), plan = adopter.prepareAdmin({ scope, reviewer: await authority.prepare(authority.capture()), graph: transport(c.id, target, null), reason: "Use verified cloud OPEN precision without closing it" });
      await atomic(tx => adopter.apply(tx, { scope, plan, captureKey: archived.captureKey, decisionId: crypto.randomUUID() }));
      assert.equal(JSON.parse(await graph(c.id))[0].rows[0].status, "OPEN"); assert.equal((await pool.request().input("id", c.id).query("SELECT shift_id FROM dbo.pos_sync_shift_baselines WHERE shift_id=@id;")).recordset.length, 0);
    });
    await test("accepted OPEN precision cannot reopen a retained CLOSED shift or replace business fields", async () => {
      const c = await seed(), target = toCloud(c.cloudGraphText), archived = await captureAdoption(c, target);
      const plan = adopter.prepareAdmin({ scope, reviewer: await authority.prepare(authority.capture()), graph: transport(c.id, target, null), reason: "An OPEN snapshot cannot reopen a closing" });
      await assert.rejects(atomic(tx => adopter.apply(tx, { scope, plan, captureKey: archived.captureKey, decisionId: crypto.randomUUID() })), e => e.code === "EREVIEWED_OPEN_PRECISION_ONLY");
      assert.equal(await graph(c.id), c.localGraphText);
    });
    await test("fresh private accepted receipt normalizes PG microseconds only after immutable ACK verification", async () => {
      const c = await seed(), acceptedEvent = await approve(c), target = toCloud(c.localGraphText);
      for (const part of target) for (const row of part.rows) for (const column of registry.tables.find(t => t.cloudTable === part.table).columns)
        if (String(column.cloudType).startsWith("timestamp") && typeof row[column.cloudColumn] === "string") row[column.cloudColumn] = row[column.cloudColumn].replace(".1234567", ".123457");
      const graphResponse = transport(c.id, target), acceptedText = stringifyExactJson(target), receiptRaw = stringifyExactJson({
        version: parseExactJson("1"), recovery_id: acceptedEvent.recoveryId, payload_hash: acceptedEvent.payloadHash, evidence_hash: acceptedEvent.evidenceHash, cloud_witness_hash: acceptedEvent.cloudWitnessHash,
        financial_verification: "UNVERIFIED_HISTORICAL", provenance: "ADMIN_REVIEWED_LEGACY", branch_id: branchId, terminal_id: terminalId, shift_id: c.id,
        reviewer_id: acceptedEvent.proof.authorId, key_id: acceptedEvent.proof.keyId, accepted_token: "d".repeat(64), current_token: "d".repeat(64), superseded: false,
        accepted_graph_text: acceptedText, accepted_graph_hash: hash(acceptedText), graph: { tables: target, graphToken: "d".repeat(64), closedAtRaw: target[0].rows[0].closed_at },
        coverage: { version: parseExactJson("1"), mode: "matched_request_rows", tables: target.map(part => {
          const fields = registry.tables.find(t => t.cloudTable === part.table).columns.map(c => c.cloudColumn), managed = fields.filter(f => ["row_version", "updated_at"].includes(f));
          return { table: part.table, fields: fields.filter(f => !managed.includes(f)), serverManagedFields: managed,
            rows: part.rows.map(row => ({ id: row.id, serverValues: Object.fromEntries(managed.map(f => [f, row[f]])) })) };
        }) },
      });
      const privateReceipt = rememberLegacyRecoveryReceipt({ event: acceptedEvent, raw: receiptRaw, registry, assertCurrent: () => { assert.equal(cm.pool, pool); } });
      const realOutbox = new LegacyShiftRecoveryOutbox({ connectionManager: cm, registry, evidenceStore, authority, assertScope, assertReceipt: assertLegacyRecoveryReceipt });
      const actual = new ReviewedShiftAdoption({ connectionManager: cm, registry: all, evidenceStore, outbox: realOutbox, authority, assertScope, assertReceipt: assertLegacyRecoveryReceipt });
      const plan = actual.prepareReceipt({ scope, event: acceptedEvent, witness: privateReceipt, graph: graphResponse });
      const archived = await captureAdoption(c, target), decisionId = crypto.randomUUID();
      await assert.rejects(atomic(tx => actual.apply(tx, { scope, plan, captureKey: archived.captureKey, decisionId })), e => e.code === "ELOCAL_UPLOAD_PENDING");
      await atomic(tx => realOutbox.acknowledge(tx, { scope, recoveryId: acceptedEvent.recoveryId, witness: privateReceipt }));
      await atomic(tx => actual.apply(tx, { scope, plan, captureKey: archived.captureKey, decisionId }));
      assert(JSON.parse(await graph(c.id))[0].rows[0].closed_at.includes(".1234570"));
      assert((await atomic(tx => evidenceStore.load(tx, scope, archived.captureKey))).localGraphText.includes(".1234567"));
      assert.throws(() => actual.prepareReceipt({ scope, event: acceptedEvent, witness: { accepted: true }, graph: graphResponse }));
    });
    const { ChangeReader } = require("../electron/sync/change-reader.cjs"), { CheckpointRepository } = require("../electron/sync/checkpoints.cjs"), { ShiftGapRecovery } = require("../electron/sync/shift-gap-recovery.cjs");
    const { prepareShiftGraphs, applyShiftGraphs } = require("../electron/sync/shift-graph.cjs");
    const reader = new ChangeReader(cm, registry), checkpoints = new CheckpointRepository(cm);
    const cloudCurrent = { terminalId: () => terminalId, backendUrl: () => "https://fixture.invalid", shiftGraph: async ({ shiftId }) => {
      const tables = toCloud(await graph(shiftId)), parent = tables[0].rows[0]; return transport(shiftId, tables, parent.status === "CLOSED" ? "d".repeat(64) : null);
    } };
    await test("unchanged whole-branch gap recovery proves every retained graph before advancing captured V0", async () => {
      for (const tableName of TABLES) {
        const recovery = await new ShiftGapRecovery({ connectionManager: cm, registry, reader, checkpoints, branchId, tableName, cloud: cloudCurrent }).begin();
        const captured = recovery.baseline; await recovery.proveMissing(cloudCurrent); const complete = await recovery.finish();
        assert.equal(String(complete.currentVersion), captured); assert.equal(String((await checkpoints.get(branchId, tableName, "push")).change_tracking_version), captured);
      }
      assert.equal((await pool.request().query("SELECT COUNT(*) n FROM dbo.sync_checkpoints;")).recordset[0].n, 6);
    });
    await test("future ordinary note delta must preserve exact adopted money", async () => {
      const before = JSON.parse(await graph(precisionShift))[0].rows[0], target = toCloud(await graph(precisionShift));
      target[0].rows[0].note = "A subsequent ordinary cloud note update"; target[0].rows[0].row_version = parseExactJson("2");
      const incoming = transport(precisionShift, target), parent = incoming.tables[0].rows[0];
      const prepared = await prepareShiftGraphs({ cloud: { shiftGraph: async () => incoming }, connectionManager: cm, branchId,
        changes: [{ table_name: "shifts", entity_id: JSON.stringify({ id: precisionShift }), row_data: parent, tombstone: false }] });
      await atomic(tx => applyShiftGraphs({ transaction: tx, connectionManager: cm, registry, reader, branchId, prepared }));
      const after = JSON.parse(await graph(precisionShift))[0].rows[0];
      for (const key of ["counted_cash", "opened_at", "closed_at"]) assert.equal(after[key], before[key]);
      const baseline = (await pool.request().input("id", precisionShift).query("SELECT graph_token,closed_at_raw,graph_json FROM dbo.pos_sync_shift_baselines WHERE shift_id=@id;")).recordset[0];
      assert(baseline.graph_json.includes("1234567890.123456789012")); assert(baseline.graph_json.includes(".1234567"));
      assert.equal(baseline.graph_token, incoming.graphToken); assert.equal(baseline.closed_at_raw, incoming.closedAtRaw);
    });
    const applyOrdinary = async incoming => {
      const prepared = await prepareShiftGraphs({ cloud: { shiftGraph: async () => incoming }, connectionManager: cm, branchId,
        changes: [{ table_name: "shifts", entity_id: JSON.stringify({ id: incoming.shiftId }), row_data: incoming.tables[0].rows[0], tombstone: false }] });
      return atomic(tx => applyShiftGraphs({ transaction: tx, connectionManager: cm, registry, reader, branchId, prepared }));
    };
    await test("ordinary exact graph updates a mutable 100ns timestamp without touching money", async () => {
      const before = JSON.parse(await graph(precisionShift))[0].rows[0], target = toCloud(await graph(precisionShift));
      target[0].rows[0].opened_at = before.opened_at.replace(".1234567", ".1234566");
      await applyOrdinary(transport(precisionShift, target));
      const after = JSON.parse(await graph(precisionShift))[0].rows[0];
      assert(after.opened_at.includes(".1234566")); assert.equal(after.counted_cash, before.counted_cash);
    });
    await test("immutable 100ns and sub-Number decimal changes roll back all ordinary graph writes", async () => {
      await pool.request().input("id", precisionShift).query("WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) UPDATE dbo.shift_cash_counts SET created_at='2026-01-01T00:00:00.1234567+00:00' WHERE shift_id=@id;");
      for (const change of [row => { row.created_at = "2026-01-01T00:00:00.1234566+00:00"; }, row => { row.counted_cash = parseExactJson("1234567890.123456789013"); }]) {
        const before = await graph(precisionShift), target = toCloud(before); target[0].rows[0].note = "Must roll back parent edit"; change(target[1].rows[0]);
        await assert.rejects(applyOrdinary(transport(precisionShift, target)), error => error.code === "ESYNC_APPLY_CONFLICT"); assert.equal(await graph(precisionShift), before);
      }
    });
    await test("ordinary exact graph inserts new immutable history and preserves exact JSON, null and decimals", async () => {
      const target = toCloud(await graph(precisionShift)), count = { ...target[1].rows[0], id: crypto.randomUUID(), kind: "RECOUNT", note: null };
      const countTable = registry.tables.find(table => table.cloudTable === "shift_cash_counts");
      const jsonColumn = countTable.columns.find(column => column.cloudType === "jsonb");
      if (jsonColumn) count[jsonColumn.cloudColumn] = { amount: parseExactJson("1234567890.123456789012"), nullable: null };
      target[1].rows.push(count); await applyOrdinary(transport(precisionShift, target));
      const stored = JSON.parse(await graph(precisionShift))[1].rows.find(row => row.id.toLowerCase() === count.id);
      assert.equal(stored.counted_cash, "1234567890.123456789012"); if (jsonColumn) assert(stored[jsonColumn.sqlServerColumn].includes("1234567890.123456789012"));
    });
    await test("exact download retains no-delete, branch, pending and decimal-overflow guards", async () => {
      const before = await graph(precisionShift), target = toCloud(before); target[1].rows = target[1].rows.filter(row => row.kind !== "RECOUNT");
      await assert.rejects(applyOrdinary(transport(precisionShift, target)), error => error.code === "ESYNC_APPLY_CONFLICT");
      const foreign = toCloud(before); foreign[0].rows[0].store_id = crypto.randomUUID();
      await assert.rejects(applyOrdinary(transport(precisionShift, foreign)), error => error.code === "SYNC_BRANCH_FORBIDDEN");
      await pool.request().input("branch", branchId).input("id", precisionShift).query("INSERT dbo.pos_sync_shift_intents VALUES(NEWID(),@branch,@id,NULL);");
      await assert.rejects(applyOrdinary(transport(precisionShift, toCloud(before))), error => error.code === "ELOCAL_UPLOAD_PENDING");
      await pool.request().query("DELETE dbo.pos_sync_shift_intents;");
      const overflow = toCloud(before); overflow[0].rows[0].opening_float = parseExactJson("123456789012345678901234567890.123456789012");
      await assert.rejects(applyOrdinary(transport(precisionShift, overflow))); assert.equal(await graph(precisionShift), before);
    });
    await test("tampered private witness cannot downgrade to ordinary rounded application", async () => {
      const before = await graph(precisionShift), incoming = transport(precisionShift, toCloud(before)); incoming.tables[0].rows[0].note = "Mutated after transport";
      await assert.rejects(applyOrdinary(incoming), error => error.code === "ESYNC_GRAPH"); assert.equal(await graph(precisionShift), before);
    });
    await test("genuine no-witness ordinary graph keeps its existing compatible application path", async () => {
      const c = await seed();
      for (const name of TABLES) await pool.request().input("id", c.id).query(`WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) UPDATE dbo.[${name}] SET id=id WHERE ${name === "shifts" ? "id" : "shift_id"}=@id;`);
      const incoming = JSON.parse(JSON.stringify(transport(c.id, toCloud(await graph(c.id))))); incoming.tables[0].rows[0].note = "Legacy no-witness note";
      await applyOrdinary(incoming); assert.equal(JSON.parse(await graph(c.id))[0].rows[0].note, incoming.tables[0].rows[0].note);
      const baseline = (await pool.request().input("id", c.id).query("SELECT graph_json FROM dbo.pos_sync_shift_baselines WHERE shift_id=@id;")).recordset[0].graph_json;
      assert.equal(baseline, JSON.stringify(incoming));
    });
    // Runtime composition uses a separate terminal scope in this owned database,
    // so older deliberately malformed receipt fixtures cannot mask its queue.
    await pool.request().batch("ALTER TABLE dbo.pos_sync_shift_intents ADD intent_sequence bigint IDENTITY(1,1),payload_json nvarchar(max) NULL,payload_hash char(64) NULL,ack_coverage_json nvarchar(max) NULL;");
    const runtimeTerminal = crypto.randomUUID(), runtimeBinding = { projectOrigin, terminalId: runtimeTerminal, authorId };
    const runtimeInfo = keys.prepare(runtimeBinding); keys.markEnrolled(runtimeBinding, { keyId: runtimeInfo.keyId, publicKey: runtimeInfo.publicKey });
    await pool.request().input("scope", scopeHash(runtimeBinding)).input("project", projectOrigin).input("terminal", runtimeTerminal).input("author", authorId).input("key", runtimeInfo.keyId).input("public", runtimeInfo.publicKey).query("INSERT dbo.pos_sync_shift_author_keys VALUES(@scope,@project,@terminal,@author,@key,@public);");
    const runtimeScope = { ...scope, terminalId: runtimeTerminal };
    const runtimeAuthority = new LegacyShiftRecoveryAuthority({ keys, session: { identity: () => ({ source: "pos", level: "admin", authorId, canonicalSubject: "fixture.admin" }), epoch: () => epoch }, connectionManager: cm,
      terminal: () => ({ tokenId: runtimeTerminal, deviceType: "pc", deviceUse: "operations", locationId: branchId, deviceBindingProof: "a".repeat(64) }), project: () => projectOrigin, branch: () => branchId, backendUrl: () => "https://fixture.invalid" });
    let runtimeService;
    const runtimeGuard = (tx, input) => runtimeService.assertScope(tx, input);
    const runtimeEvidence = new ShiftRecoveryEvidenceStore({ connectionManager: cm, registry, assertScope: runtimeGuard });
    const runtimeOutbox = new LegacyShiftRecoveryOutbox({ connectionManager: cm, registry, evidenceStore: runtimeEvidence, authority: runtimeAuthority, assertScope: runtimeGuard, assertReceipt: assertLegacyRecoveryReceipt });
    const runtimeAdopter = new ReviewedShiftAdoption({ connectionManager: cm, registry: all, evidenceStore: runtimeEvidence, outbox: runtimeOutbox, authority: runtimeAuthority, assertScope: runtimeGuard, assertReceipt: assertLegacyRecoveryReceipt });
    const runtimeGraphs = new Map(),runtimeAccepted=new Map(),runtimeTokens=new Map(); let crashAfterAck = false, recoveryNetworkCalls = 0;
    const runtimeReceipt = (event, target) => {
      if(!runtimeAccepted.has(event.recoveryId))runtimeAccepted.set(event.recoveryId,stringifyExactJson(target));
      const accepted = runtimeAccepted.get(event.recoveryId),acceptedTables=parseExactJson(accepted), token = "e".repeat(64),currentToken=runtimeTokens.get(event.shiftId)??token;
      const raw = stringifyExactJson({ version: parseExactJson("1"), recovery_id: event.recoveryId, payload_hash: event.payloadHash, evidence_hash: event.evidenceHash, cloud_witness_hash: event.cloudWitnessHash,
        financial_verification: "UNVERIFIED_HISTORICAL", provenance: "ADMIN_REVIEWED_LEGACY", branch_id: branchId, terminal_id: runtimeTerminal, shift_id: event.shiftId,
        reviewer_id: event.proof.authorId, key_id: event.proof.keyId, accepted_token: token, current_token: currentToken, superseded: token!==currentToken, accepted_graph_text: accepted, accepted_graph_hash: hash(accepted),
        graph: { tables: target, graphToken: currentToken, closedAtRaw: target[0].rows[0].closed_at },
        coverage: { version: parseExactJson("1"), mode: "matched_request_rows", tables: acceptedTables.map(part => {
          const fields = registry.tables.find(table => table.cloudTable === part.table).columns.map(column => column.cloudColumn), managed = fields.filter(field => ["row_version", "updated_at"].includes(field));
          return { table: part.table, fields: fields.filter(field => !managed.includes(field)), serverManagedFields: managed, rows: part.rows.map(row => ({ id: row.id, serverValues: Object.fromEntries(managed.map(field => [field, row[field]])) })) };
        }) } });
      return rememberLegacyRecoveryReceipt({ event, raw, registry, assertCurrent: () => { assert.equal(cm.pool, pool); } });
    };
    const runtimeCloud = {
      shiftGraph: async ({ shiftId }) => { const tables = runtimeGraphs.get(shiftId); return transport(shiftId, tables, tables[0].rows[0].status === "CLOSED" ? runtimeTokens.get(shiftId)??"e".repeat(64) : null); },
      pushLegacyRecovery: async event => {
        // A second connection can acquire both rows only after the caller's
        // preparation transaction released its SQL locks before HTTP replay.
        await other.request().input('id',event.recoveryId).input('shift',event.shiftId).query('SET LOCK_TIMEOUT 500;SELECT recovery_id FROM dbo.pos_sync_shift_legacy_recoveries WITH(UPDLOCK) WHERE recovery_id=@id;SELECT id FROM dbo.shifts WITH(UPDLOCK) WHERE id=@shift;SET LOCK_TIMEOUT -1;');
        recoveryNetworkCalls++; return runtimeReceipt(event, runtimeGraphs.get(event.shiftId));
      },
    };
    const ordinaryCurrentGraph=cloudCurrent.shiftGraph;
    cloudCurrent.shiftGraph=options=>runtimeGraphs.has(options.shiftId)?runtimeCloud.shiftGraph(options):ordinaryCurrentGraph(options);
    const runtimeApply = runtimeAdopter.apply.bind(runtimeAdopter);
    runtimeAdopter.apply = async (...args) => { if (crashAfterAck) { crashAfterAck = false; throw Object.assign(Error("Simulated power loss after durable ACK"), { code: "ELEGACY_RECOVERY_FIXTURE_CRASH" }); } return runtimeApply(...args); };
    const restartRuntime = () => { runtimeService = new LegacyShiftRecoveryService({ connectionManager: cm, registry: all, cloud: runtimeCloud, evidenceStore: runtimeEvidence, outbox: runtimeOutbox, authority: runtimeAuthority,
      adopter: runtimeAdopter, readContext: () => ({ branchId, terminalId: runtimeTerminal, backendOriginHash: scope.backendOriginHash, profileKey: "fixture-runtime-profile" }) }); };
    const runtimeSeed = async () => {
      const candidate = await seed();
      for (const name of TABLES) if (registry.tables.find(table => table.cloudTable === name).columns.some(column => column.sqlServerColumn === "terminal_id"))
        await pool.request().input("id", candidate.id).input("terminal", runtimeTerminal).query(`WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) UPDATE dbo.[${name}] SET terminal_id=@terminal WHERE ${name === "shifts" ? "id" : "shift_id"}=@id;`);
      candidate.localGraphText = await graph(candidate.id); return candidate;
    };
    restartRuntime(); let runtimeCandidate, runtimeEvent;
    reader.reviewedShiftRecovery={prepare:graph=>runtimeService.prepareCoverage(graph),verify:(tx,token,graph,branch)=>runtimeService.verifyCoverage(tx,token,graph,branch)};
    const checkReviewed=async(incoming,token,options={})=>atomic(tx=>reader.pendingShiftGraph(registry.tables.find(t=>t.cloudTable==='shifts'),[JSON.stringify({id:incoming.shiftId})],tx,
      {branchId,incomingGraph:incoming,requireExact:true,reviewedCoverage:token,...options}));
    await test("actual wired service freezes Admin review then retains durable ACK as pending local convergence after crash", async () => {
      runtimeCandidate = await runtimeSeed(); const open = toCloud(runtimeCandidate.localGraphText).map(part => ({ ...part, rows: part.table === "shifts" ? [{ ...part.rows[0], status: "OPEN", state: "ACTIVE", closed_at: null }] : [] }));
      runtimeGraphs.set(runtimeCandidate.id, open);
      const preview = await runtimeService.preview(runtimeCandidate.id); assert.equal(preview.canApprove, true);
      const approval = await runtimeService.approve({ captureKey: preview.captureKey, recoveryId: crypto.randomUUID(), reason: "Actual Administrator reviewed historical closing" });
      runtimeEvent = await runtimeService.atomic(runtimeService.capture(), (tx, input) => runtimeOutbox.load(tx, input, approval.recoveryId));
      const accepted = toCloud(runtimeCandidate.localGraphText);
      for (const part of accepted) for (const row of part.rows) for (const column of registry.tables.find(table => table.cloudTable === part.table).columns)
        if (String(column.cloudType).startsWith("timestamp") && typeof row[column.cloudColumn] === "string") row[column.cloudColumn] = row[column.cloudColumn].replace(".1234567", ".123457");
      runtimeGraphs.set(runtimeCandidate.id, accepted); crashAfterAck = true;
      await assert.rejects(runtimeService.pushPending({ branchId }), error => error.code === "ELEGACY_RECOVERY_FIXTURE_CRASH");
      assert.deepEqual(await runtimeService.pendingSummary(), { available: true, adoptionAvailable: true, uploadPending: 0, convergencePending: 1, pending: 1 });
      assert.equal(await graph(runtimeCandidate.id), runtimeCandidate.localGraphText);
      const held = await runtimeService.preview(runtimeCandidate.id); assert.equal(held.canAcceptCloud, false);
      await assert.rejects(runtimeService.acceptCloud({ captureKey: held.captureKey, decisionId: crypto.randomUUID(), reason: "Receipt normalization must finish first" }), error => error.code === "ELEGACY_RECOVERY_CONVERGENCE_PENDING");
    });
    await test("actual restart finds ACKed unadopted event and obtains fresh private receipt before exact normalization", async () => {
      restartRuntime(); const result = await runtimeService.pushPending({ branchId }); assert.equal(result.pending, 0); assert.equal(result.downloadRecoveryComplete, false); assert.equal(recoveryNetworkCalls, 2);
      assert(JSON.parse(await graph(runtimeCandidate.id))[0].rows[0].closed_at.includes(".1234570"));
      assert.equal((await pool.request().input("id", runtimeEvent.recoveryId).query("SELECT COUNT(*) n FROM dbo.pos_shift_recovery_adoptions WHERE receipt_recovery_id=@id;")).recordset[0].n, 1);
      const before = recoveryNetworkCalls; await runtimeService.pushPending({ branchId }); assert.equal(recoveryNetworkCalls, before);
    });
    await test("receipt-backed gap restart uses a fresh private replay only for its requested graph",async()=>{
      restartRuntime();const incoming=await runtimeCloud.shiftGraph({shiftId:runtimeCandidate.id}),before=await graph(runtimeCandidate.id),checkpointsBefore=await pool.request().query('SELECT * FROM dbo.sync_checkpoints;');
      await assert.rejects(checkReviewed(incoming,Object.freeze({accepted:true})),e=>e.code==='ELEGACY_RECOVERY_EXACT_GRAPH_REQUIRED');
      const calls=recoveryNetworkCalls,token=await reader.prepareReviewedShiftCoverage(incoming,branchId);assert(token);assert.equal(recoveryNetworkCalls,calls+1);
      assert.equal(await checkReviewed(incoming,token),false);assert.equal(await graph(runtimeCandidate.id),before);
      assert.deepEqual((await pool.request().query('SELECT * FROM dbo.sync_checkpoints;')).recordset,checkpointsBefore.recordset);
      await runtimeService.pushPending({branchId});assert.equal(recoveryNetworkCalls,calls+1);
      restartRuntime();await assert.rejects(checkReviewed(incoming,token),e=>e.code==='ELEGACY_RECOVERY_EXACT_GRAPH_REQUIRED');
      const replay=runtimeCloud.pushLegacyRecovery;runtimeCloud.pushLegacyRecovery=async()=>{throw Object.assign(Error('Synthetic current permission denial'),{code:'PERMISSION_DENIED'});};
      try{await assert.rejects(reader.prepareReviewedShiftCoverage(incoming,branchId),e=>e.code==='PERMISSION_DENIED');}finally{runtimeCloud.pushLegacyRecovery=replay;}
      assert.equal(await graph(runtimeCandidate.id),before);
    });
    await test("accepted original after-image adopts later web evolution with a fresh private receipt after restart",async()=>{
      const before=await graph(runtimeCandidate.id),evolved=toCloud(before);
      evolved[0].rows[0].note='Later accepted administrator web correction';evolved[0].rows[0].row_version=parseExactJson('2');
      runtimeGraphs.set(runtimeCandidate.id,evolved);runtimeTokens.set(runtimeCandidate.id,'f'.repeat(64));restartRuntime();
      const incoming=await runtimeCloud.shiftGraph({shiftId:runtimeCandidate.id}),token=await reader.prepareReviewedShiftCoverage(incoming,branchId);assert(token);
      assert.equal(await checkReviewed(incoming,token),false);assert.equal(JSON.parse(await graph(runtimeCandidate.id))[0].rows[0].note,evolved[0].rows[0].note);
      const decisions=(await pool.request().input('id',runtimeEvent.recoveryId).query('SELECT local_before_hash,local_after_hash,capture_key FROM dbo.pos_shift_recovery_adoptions WHERE receipt_recovery_id=@id;')).recordset;
      assert.equal(decisions.length,2);assert(decisions.some(row=>row.local_before_hash===hash(before)));
      assert.equal((await runtimeService.pendingSummary()).pending,0);restartRuntime();
      const retry=await runtimeCloud.shiftGraph({shiftId:runtimeCandidate.id}),fresh=await reader.prepareReviewedShiftCoverage(retry,branchId);assert(fresh);assert.equal(await checkReviewed(retry,fresh),false);
    });
    await test("a nonprovable intermediate web after-image stays held for explicit Admin review",async()=>{
      const current=runtimeGraphs.get(runtimeCandidate.id),before=await graph(runtimeCandidate.id),evolved=toCloud(before);
      evolved[0].rows[0].note='Another later administrator correction';evolved[0].rows[0].row_version=parseExactJson('3');
      runtimeGraphs.set(runtimeCandidate.id,evolved);runtimeTokens.set(runtimeCandidate.id,'1'.repeat(64));restartRuntime();
      try{await assert.rejects(reader.prepareReviewedShiftCoverage(await runtimeCloud.shiftGraph({shiftId:runtimeCandidate.id}),branchId),e=>e.code==='EREVIEWED_RECEIPT_REQUIRED');assert.equal(await graph(runtimeCandidate.id),before);}
      finally{runtimeGraphs.set(runtimeCandidate.id,current);runtimeTokens.set(runtimeCandidate.id,'f'.repeat(64));restartRuntime();}
    });
    await test("actual Admin cloud-choice service rechecks preview, archives local graph and never uploads a replacement", async () => {
      const candidate = await runtimeSeed(), target = toCloud(candidate.localGraphText); target[0].rows[0].note = "Accepted existing web correction"; runtimeGraphs.set(candidate.id, target);
      const preview = await runtimeService.preview(candidate.id); assert.equal(preview.canAcceptCloud, true); const calls = recoveryNetworkCalls;
      const result = await runtimeService.acceptCloud({ captureKey: preview.captureKey, decisionId: crypto.randomUUID(), reason: "Keep the accepted Administrator web correction" });
      assert.equal(result.state, "ADOPTED"); assert.equal(result.checkpointAdvanced, false); assert.equal(result.downloadRecoveryComplete, false); assert.equal(recoveryNetworkCalls, calls);
      const saved = await runtimeService.atomic(runtimeService.capture(), (tx, input) => runtimeEvidence.load(tx, input, preview.captureKey)); assert.equal(saved.localGraphText, candidate.localGraphText);
      assert.equal(JSON.parse(await graph(candidate.id))[0].rows[0].note, target[0].rows[0].note);
    });
    await test("actual cloud-choice service refuses changed cloud preview without replacing local data", async () => {
      const candidate = await runtimeSeed(), target = toCloud(candidate.localGraphText); target[0].rows[0].note = "First web correction"; runtimeGraphs.set(candidate.id, target);
      const preview = await runtimeService.preview(candidate.id); target[0].rows[0].note = "Newer web correction after preview";
      await assert.rejects(runtimeService.acceptCloud({ captureKey: preview.captureKey, decisionId: crypto.randomUUID(), reason: "Cannot use changed preview" }), error => error.code === "ELEGACY_RECOVERY_REVIEW_CHANGED");
      assert.equal(await graph(candidate.id), candidate.localGraphText);
      // Explicitly review the fresh cloud record before finishing this fixture.
      const next = await runtimeService.preview(candidate.id); await runtimeService.acceptCloud({ captureKey: next.captureKey, decisionId: crypto.randomUUID(), reason: "Choose the freshly reviewed correction" });
    });
    const queuedRuntimeClosing = async () => {
      const candidate = await runtimeSeed(), open = toCloud(candidate.localGraphText).map(part => ({ ...part, rows: part.table === "shifts" ? [{ ...part.rows[0], status: "OPEN", state: "ACTIVE", closed_at: null }] : [] }));
      runtimeGraphs.set(candidate.id, open);
      const first = await runtimeService.preview(candidate.id), approved = await runtimeService.approve({ captureKey: first.captureKey, recoveryId: crypto.randomUUID(), reason: "Synthetic historical closing review" });
      const event = await runtimeService.atomic(runtimeService.capture(), (tx, input) => runtimeOutbox.load(tx, input, approved.recoveryId)), target = toCloud(candidate.localGraphText);
      for (const part of target) for (const row of part.rows) for (const column of registry.tables.find(table => table.cloudTable === part.table).columns)
        if (String(column.cloudType).startsWith("timestamp") && typeof row[column.cloudColumn] === "string") row[column.cloudColumn] = row[column.cloudColumn].replace(".1234567", ".123457");
      runtimeGraphs.set(candidate.id, target);
      const preview = await runtimeService.preview(candidate.id); assert.equal(preview.canAcceptCloud, true);
      return { candidate, event, target, preview };
    };
    const checkpointState = async () => (await pool.request().query("SELECT branch_id,entity_type,direction,CONVERT(nvarchar(30),change_tracking_version) version FROM dbo.sync_checkpoints ORDER BY branch_id,entity_type,direction;")).recordset;
    for (const stage of ["cloud graph", "author preparation"]) await test("ACK during " + stage + " holds Admin adoption without losing accepted convergence", async () => {
      const value = await queuedRuntimeClosing(), before = await checkpointState();
      const originalRead = runtimeCloud.shiftGraph, originalPrepare = runtimeAuthority.prepare.bind(runtimeAuthority);
      let waiting = true;
      const acknowledge = async () => {
        if (!waiting) return; waiting = false;
        const witness = runtimeReceipt(value.event, value.target);
        await runtimeService.atomic(runtimeService.capture(), (tx, input) => runtimeOutbox.acknowledge(tx, { scope: input, recoveryId: value.event.recoveryId, witness }));
      };
      if (stage === "cloud graph") runtimeCloud.shiftGraph = async input => { await acknowledge(); return originalRead(input); };
      else runtimeAuthority.prepare = async capture => { const reviewer = await originalPrepare(capture); await acknowledge(); return reviewer; };
      try {
        await assert.rejects(runtimeService.acceptCloud({ captureKey: value.preview.captureKey, decisionId: crypto.randomUUID(), reason: "Admin choice racing a valid upload ACK" }), error => error.code === "ELEGACY_RECOVERY_CONVERGENCE_PENDING");
      } finally { runtimeCloud.shiftGraph = originalRead; runtimeAuthority.prepare = originalPrepare; }
      assert.equal(waiting, false); assert.equal(await graph(value.candidate.id), value.candidate.localGraphText);
      assert.equal((await pool.request().input("shift", value.candidate.id).query("SELECT COUNT(*) n FROM dbo.pos_shift_recovery_adoptions WHERE shift_id=@shift;")).recordset[0].n, 0);
      assert.equal((await pool.request().input("shift", value.candidate.id).query("SELECT COUNT(*) n FROM dbo.pos_sync_shift_baselines WHERE shift_id=@shift;")).recordset[0].n, 0);
      assert.deepEqual(await checkpointState(), before); assert.equal((await runtimeService.pendingSummary()).convergencePending, 1);
      assert.equal((await runtimeService.pushPending({ branchId })).pending, 0);
    });
    await test("final serializable convergence check blocks a concurrent ACK before adoption apply", async () => {
      const value = await queuedRuntimeClosing(), before = await checkpointState(), originalApply = runtimeAdopter.apply;
      const witness = runtimeReceipt(value.event, value.target); let tried = false;
      runtimeAdopter.apply = async (...args) => {
        tried = true;
        await assert.rejects(runtimeService.atomic(runtimeService.capture(), async (tx, input) => {
          await runtimeService.query(tx, "SET LOCK_TIMEOUT 250;");
          try { return await runtimeOutbox.acknowledge(tx, { scope: input, recoveryId: value.event.recoveryId, witness }); }
          finally { await runtimeService.query(tx, "SET LOCK_TIMEOUT -1;"); }
        }), error => error.number === 1222 || error.originalError?.info?.number === 1222);
        return originalApply(...args);
      };
      try { await assert.rejects(runtimeService.acceptCloud({ captureKey: value.preview.captureKey, decisionId: crypto.randomUUID(), reason: "Competing ACK must wait for this serializable check" }), error => error.code === "ELOCAL_UPLOAD_PENDING"); }
      finally { runtimeAdopter.apply = originalApply; }
      assert.equal(tried, true); assert.equal(await graph(value.candidate.id), value.candidate.localGraphText);
      assert.equal((await pool.request().input("id", value.event.recoveryId).query("SELECT COUNT(*) n FROM dbo.pos_sync_shift_legacy_recovery_receipts WHERE recovery_id=@id;")).recordset[0].n, 0);
      assert.deepEqual(await checkpointState(), before); assert.equal((await runtimeService.pushPending({ branchId })).pending, 0);
    });
    await test("a forged historical target and false CT ceiling cannot borrow a genuine original receipt",async()=>{
      const value=await queuedRuntimeClosing();assert.equal((await runtimeService.pushPending({branchId})).pending,0);
      const original=await graph(value.candidate.id),accepted=runtimeGraphs.get(value.candidate.id),legitimate=toCloud(original);
      legitimate[0].rows[0].note='Genuine later server correction';legitimate[0].rows[0].row_version=parseExactJson('2');
      await pool.request().input('shift',value.candidate.id).query("UPDATE dbo.shifts SET note='Counterfeit earlier target' WHERE id=@shift;");
      const forged=await graph(value.candidate.id),fake=runtimeAdopter.target(transport(value.candidate.id,toCloud(forged),'9'.repeat(64)),runtimeScope);
      await pool.request().input('recovery',value.event.recoveryId).input('target',fake.graphJson).input('targetHash',hash(fake.graphJson)).input('after',hash(forged)).query(`
        INSERT dbo.pos_shift_recovery_adoptions(decision_id,capture_key,database_guid,branch_id,terminal_id,backend_origin_hash,shift_id,decision_kind,reviewer_id,reviewer_subject,reason,local_before_hash,target_graph_hash,target_graph_token,target_graph_json,before_ct_version,local_after_hash,receipt_recovery_id,receipt_json,decided_at)
        SELECT TOP(1) NEWID(),capture_key,database_guid,branch_id,terminal_id,backend_origin_hash,shift_id,decision_kind,reviewer_id,reviewer_subject,reason,local_before_hash,@targetHash,REPLICATE('9',64),@target,CHANGE_TRACKING_CURRENT_VERSION(),@after,receipt_recovery_id,receipt_json,SYSDATETIMEOFFSET()
        FROM dbo.pos_shift_recovery_adoptions WHERE receipt_recovery_id=@recovery ORDER BY decided_at DESC;`);
      runtimeGraphs.set(value.candidate.id,legitimate);runtimeTokens.set(value.candidate.id,'8'.repeat(64));restartRuntime();
      try{await assert.rejects(reader.prepareReviewedShiftCoverage(await runtimeCloud.shiftGraph({shiftId:value.candidate.id}),branchId),e=>e.code==='EREVIEWED_RECEIPT_REQUIRED');assert.equal(await graph(value.candidate.id),forged);}
      finally{
        // Restore only this disposable fixture's deliberate counterfeit input;
        // the application under test made no restoration or acknowledgement.
        await pool.request().input('shift',value.candidate.id).input('note',JSON.parse(original)[0].rows[0].note).query('WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) UPDATE dbo.shifts SET note=@note WHERE id=@shift;');
        runtimeGraphs.set(value.candidate.id,accepted);runtimeTokens.delete(value.candidate.id);restartRuntime();
      }
    });
    await test("an identical local edit after a prior receipt decision still blocks automatic web evolution",async()=>{
      const value=await queuedRuntimeClosing();assert.equal((await runtimeService.pushPending({branchId})).pending,0);
      const before=await graph(value.candidate.id),accepted=runtimeGraphs.get(value.candidate.id),evolved=toCloud(before);
      evolved[0].rows[0].note='Server change after a later local CT edit';evolved[0].rows[0].row_version=parseExactJson('2');
      await pool.request().input('shift',value.candidate.id).query('UPDATE dbo.shift_reconciliations SET id=id WHERE shift_id=@shift;');
      runtimeGraphs.set(value.candidate.id,evolved);runtimeTokens.set(value.candidate.id,'7'.repeat(64));restartRuntime();
      try{await assert.rejects(reader.prepareReviewedShiftCoverage(await runtimeCloud.shiftGraph({shiftId:value.candidate.id}),branchId),e=>e.code==='ELOCAL_CT_PENDING');assert.equal(await graph(value.candidate.id),before);}
      finally{runtimeGraphs.set(value.candidate.id,accepted);runtimeTokens.delete(value.candidate.id);restartRuntime();}
    });
    let gapReview;
    const confirmMatching=async shiftId=>{const preview=await runtimeService.preview(shiftId);assert.equal(preview.classification,'exact');assert.equal(preview.canAcceptCloud,true);
      return runtimeService.acceptCloud({captureKey:preview.captureKey,decisionId:crypto.randomUUID(),reason:'Explicit matching-record re-verification by actual Administrator'});};
    await test("matching Admin re-review is append-only and preserves business rows and baseline generation",async()=>{
      gapReview=await runtimeSeed();runtimeGraphs.set(gapReview.id,toCloud(gapReview.localGraphText));const before=await graph(gapReview.id);
      await confirmMatching(gapReview.id);
      const baseline=async()=>(await pool.request().input('shift',gapReview.id).query('SELECT * FROM dbo.pos_sync_shift_baselines WHERE shift_id=@shift;')).recordset;
      const prior=await baseline();await confirmMatching(gapReview.id);assert.deepEqual(await baseline(),prior);assert.equal(await graph(gapReview.id),before);
      assert.equal((await pool.request().input('shift',gapReview.id).query('SELECT COUNT(*) n FROM dbo.pos_shift_recovery_adoptions WHERE shift_id=@shift;')).recordset[0].n,2);
      restartRuntime();const incoming=await runtimeCloud.shiftGraph({shiftId:gapReview.id});assert.equal(await reader.prepareReviewedShiftCoverage(incoming,branchId),null);
      await confirmMatching(gapReview.id);const token=await reader.prepareReviewedShiftCoverage(incoming,branchId);assert(token);assert.equal(await checkReviewed(incoming,token),false);
      assert.deepEqual(await baseline(),prior);assert.equal(await graph(gapReview.id),before);
    });
    await test("reviewed coverage rejects stale Admin epoch, source, branch and foreign transaction without writes",async()=>{
      let incoming=await runtimeCloud.shiftGraph({shiftId:gapReview.id}),token=await reader.prepareReviewedShiftCoverage(incoming,branchId),before=await graph(gapReview.id);assert(token);
      const source=runtimeService.readContext;runtimeService.readContext=()=>({...source(),profileKey:'changed-owned-profile'});
      await assert.rejects(checkReviewed(incoming,token),e=>e.code==='SYNC_BRANCH_FORBIDDEN');runtimeService.readContext=source;
      await assert.rejects(atomic(tx=>runtimeService.verifyCoverage(tx,token,incoming,crypto.randomUUID())),e=>e.code==='ELEGACY_RECOVERY_EXACT_GRAPH_REQUIRED');
      const foreign=new sql.Transaction(other);await foreign.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);try{await assert.rejects(runtimeService.verifyCoverage(foreign,token,incoming,branchId),e=>e.code==='ELEGACY_RECOVERY_SCOPE');}finally{await foreign.rollback();}
      epoch++;await assert.rejects(checkReviewed(incoming,token));assert.equal(await reader.prepareReviewedShiftCoverage(incoming,branchId),null);
      await confirmMatching(gapReview.id);incoming=await runtimeCloud.shiftGraph({shiftId:gapReview.id});token=await reader.prepareReviewedShiftCoverage(incoming,branchId);assert(token);
      assert.equal(await checkReviewed(incoming,token),false);assert.equal(await graph(gapReview.id),before);
    });
    await test("reviewed coverage rechecks schema, pending journal, intent and FIN62 under graph locks",async()=>{
      const incoming=await runtimeCloud.shiftGraph({shiftId:gapReview.id}),token=await reader.prepareReviewedShiftCoverage(incoming,branchId);assert(token);
      const verify=()=>atomic(tx=>runtimeService.verifyCoverage(tx,token,incoming,branchId)),before=await graph(gapReview.id);
      await pool.request().query('ALTER INDEX UX_reviewed_adoption_identity ON dbo.pos_shift_recovery_adoptions DISABLE;');
      try{await assert.rejects(verify(),e=>e.code==='EREVIEWED_ADOPTION_SCHEMA');}finally{await pool.request().query('ALTER INDEX UX_reviewed_adoption_identity ON dbo.pos_shift_recovery_adoptions REBUILD;');}
      await pool.request().input('branch',branchId).input('key',JSON.stringify({id:gapReview.id})).query("INSERT dbo.sync_change_journal VALUES('shifts',@key,@branch,NULL);");
      try{await assert.rejects(verify(),e=>e.code==='ELOCAL_UPLOAD_PENDING');}finally{await pool.request().query('DELETE dbo.sync_change_journal;');}
      await pool.request().input('branch',branchId).input('shift',gapReview.id).query('INSERT dbo.pos_sync_shift_intents(intent_id,branch_id,shift_id,acknowledged_at) VALUES(NEWID(),@branch,@shift,NULL);');
      try{await assert.rejects(verify(),e=>e.code==='ELOCAL_UPLOAD_PENDING');}finally{await pool.request().query('DELETE dbo.pos_sync_shift_intents;');}
      await pool.request().input('branch',branchId).input('shift',gapReview.id).batch('CREATE TABLE dbo.pos_sync_shift_financial_origins(branch_id nvarchar(128),shift_id uniqueidentifier);INSERT dbo.pos_sync_shift_financial_origins VALUES(@branch,@shift);');
      try{await assert.rejects(verify(),e=>e.code==='EREVIEWED_FINANCIAL_PROTECTED');}finally{await pool.request().query('DROP TABLE dbo.pos_sync_shift_financial_origins;');}
      assert.equal(await graph(gapReview.id),before);
    });
    await test("later identical CT edit needs a new explicit decision and ordinary uploads retain their guard",async()=>{
      const incoming=await runtimeCloud.shiftGraph({shiftId:gapReview.id}),token=await reader.prepareReviewedShiftCoverage(incoming,branchId),before=await graph(gapReview.id);assert(token);
      await pool.request().input('shift',gapReview.id).query('UPDATE dbo.shift_reconciliations SET id=id WHERE shift_id=@shift;');
      await assert.rejects(checkReviewed(incoming,token),e=>e.code==='ELOCAL_CT_PENDING');
      await confirmMatching(gapReview.id);const fresh=await reader.prepareReviewedShiftCoverage(incoming,branchId);assert(fresh);assert.equal(await checkReviewed(incoming,fresh),false);
      await assert.rejects(checkReviewed(incoming,fresh,{requireExact:false}),e=>e.code==='ELOCAL_CT_PENDING');assert.equal(await graph(gapReview.id),before);
    });
    await test("exact reviewed graph locks exclude a concurrent local edit before checkpoint admission",async()=>{
      const incoming=await runtimeCloud.shiftGraph({shiftId:gapReview.id}),token=await reader.prepareReviewedShiftCoverage(incoming,branchId);assert(token);
      await atomic(async tx=>{assert.equal(await reader.pendingShiftGraph(registry.tables.find(t=>t.cloudTable==='shifts'),[JSON.stringify({id:gapReview.id})],tx,{branchId,incomingGraph:incoming,requireExact:true,reviewedCoverage:token}),false);
        const result=await other.request().input('shift',gapReview.id).query('SET LOCK_TIMEOUT 250;BEGIN TRY UPDATE dbo.shift_reconciliations SET id=id WHERE shift_id=@shift;SELECT 0 error_number;END TRY BEGIN CATCH SELECT ERROR_NUMBER() error_number;END CATCH;');
        assert.equal(result.recordsets.flat().find(row=>Object.hasOwn(row,'error_number'))?.error_number,1222);});
      await other.request().query('SET LOCK_TIMEOUT -1;');
    });
    await test("runtime adoption completes only through fresh existing all-retained captured-V0 proofs", async () => {
      for(const saved of (await runtimeService.list({limit:100})).items){
        const preview=await runtimeService.preview(saved.shiftId);
        if(preview.canAcceptCloud)await runtimeService.acceptCloud({captureKey:preview.captureKey,decisionId:crypto.randomUUID(),reason:'Explicit actual Administrator matching-graph recovery review'});
      }
      for (const tableName of TABLES) {
        const recovery = await new ShiftGapRecovery({ connectionManager: cm, registry, reader, checkpoints, branchId, tableName, cloud: {...cloudCurrent,terminalId:()=>runtimeTerminal} }).begin();
        const captured = recovery.baseline; await recovery.proveMissing(cloudCurrent); await recovery.finish();
        assert.equal(String((await checkpoints.get(branchId, tableName, "push")).change_tracking_version), captured);
      }
    });
    await test("a later unattributed deletion stays held instead of inheriting reviewed coverage",async()=>{
      const unknown=crypto.randomUUID();await pool.request().input('id',unknown).input('branch',branchId).query("INSERT dbo.shifts(id,store_id,status,state,row_version) VALUES(@id,@branch,'OPEN','ACTIVE',1);DELETE dbo.shifts WHERE id=@id;");
      const incoming=await runtimeCloud.shiftGraph({shiftId:gapReview.id}),before=await checkpointState();
      assert.equal(await reader.prepareReviewedShiftCoverage(incoming,branchId),null);
      await assert.rejects(checkReviewed(incoming,null),e=>e.code==='ELOCAL_CT_PENDING');assert.deepEqual(await checkpointState(),before);
    });
    console.log(`PASS ${passed} isolated SQL Server legacy recovery groups`);
  } finally {
    if (other) await other.close(); if (pool) await pool.close();
    if (created) { assert(owned && /^LegacyFixture_[a-f0-9]{32}$/.test(database)); await master.request().query(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}];`); }
    if (master) await master.close();
    if (owned) { assert(/^CodexLegacy_[a-f0-9]{32}$/.test(instance)); control("stop", instance, "-k"); control("delete", instance); console.log("Cleaned uniquely owned LocalDB fixture"); }
    if (directory) { const root = path.resolve(__dirname, "../.tmp"); assert(directory.startsWith(root + path.sep + "legacy-vault-")); fs.rmSync(directory, { recursive: true, force: true }); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
