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
    master = await connect("master"); await master.request().batch(`CREATE DATABASE [${database}];`); created = true;
    pool = await connect(database); other = await connect(database);
    const all = loadRegistry(), registry = { ...all, tables: all.tables.filter(t => TABLES.includes(t.cloudTable)) };
    assert.equal(registry.tables.length, 6);
    for (const name of TABLES) { const t = registry.tables.find(t => t.cloudTable === name); await pool.request().batch(`CREATE TABLE dbo.[${name}](${t.columns.map(c => `[${c.sqlServerColumn}] ${c.sqlServerType} ${c.sqlServerColumn === "id" ? "NOT NULL" : "NULL"}`).join(",")},PRIMARY KEY(id));`); }
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
