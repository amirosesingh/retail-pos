"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ShiftRecoveryEvidenceStore, COLUMNS, OWNER, FORMAT, CAP, TRIGGER_SQL } = require("../electron/db/shift-recovery-evidence.cjs");
const { loadRegistry } = require("../electron/db/schema-registry.cjs");
const { TABLES } = require("../electron/sync/shift-recovery-classification.cjs");
const ID = "11111111-1111-4111-8111-111111111111", BRANCH = "22222222-2222-4222-8222-222222222222", TERMINAL = "33333333-3333-4333-8333-333333333333";
const scope = { databaseGuid: "44444444-4444-4444-8444-444444444444", branchId: BRANCH, terminalId: TERMINAL, backendOriginHash: "a".repeat(64) };
function fixture() {
  const registry = loadRegistry(), table = registry.tables.find(t => t.cloudTable === "shifts");
  const parent = Object.fromEntries(table.columns.map(c => [c.cloudColumn, null]));
  Object.assign(parent, { id: ID, store_id: BRANCH, terminal_id: TERMINAL, status: "OPEN", state: "ACTIVE", opened_at: "2026-01-01T00:00:00.1234567Z",
    created_at: "2026-01-01T00:00:00.1234567Z", updated_at: "2026-01-01T00:00:00.1234567Z", row_version: "9007199254740993", opening_float: "123.4567890123456789", overdue: false });
  const text = JSON.stringify(TABLES.map(name => ({ table: name, rows: name === "shifts" ? [parent] : [] })));
  return { registry, input: { scope, shiftId: ID, jobId: "55555555-5555-4555-8555-555555555555", localGraphText: text, cloudGraphText: text } };
}
function harness() {
  const { registry, input } = fixture(), rows = new Map(), queries = [];
  let allowed = true, hook = null, owner = OWNER, missing = false, badTrigger = false;
  class Request {
    constructor(transaction) { assert.equal(transaction, tx); this.values = {}; }
    input(key, type, value) { this.values[key] = value; return this; }
    async query(query) {
      queries.push(query); const p = this.values; if (hook) hook(query);
      if (query.includes("FROM sys.columns")) return { recordsets: [Object.entries(COLUMNS).map(([name, [type_name, max_length]]) => ({ name, type_name, max_length, is_nullable: false,
        is_identity: false, is_computed: false, collation_name: "Latin1_General_100_BIN2" })),
        [{ owner_tag: owner }], missing ? [] : [{ name: "TR_pos_shift_recovery_evidence_immutable", is_disabled: false, is_instead_of_trigger: true,
          definition: badTrigger ? "CREATE TRIGGER dbo.TR_pos_shift_recovery_evidence_immutable ON dbo.pos_shift_recovery_evidence INSTEAD OF DELETE AS SELECT 1;" : TRIGGER_SQL }], [{ name: "capture_key" }]] };
      if (query.includes("INSERT dbo.pos_shift_recovery_evidence") && !rows.has(p.key)) rows.set(p.key, { capture_key: p.key, owner_tag: OWNER, format_tag: FORMAT, codec_version: 1,
        database_guid: p.database_guid, branch_id: p.branch, terminal_id: p.terminal, backend_origin_hash: p.backend,
        shift_id: p.shift, job_id: p.job, local_sha256: p.local_hash, cloud_sha256: p.cloud_hash, local_graph_json: p.local_json, cloud_graph_json: p.cloud_json,
        classification: p.classification, reason_code: p.reason });
      const matches = [...rows.values()].filter(r => r.database_guid === p.database_guid && r.branch_id === p.branch && r.terminal_id === p.terminal && r.backend_origin_hash === p.backend);
      return { recordset: p.key ? matches.filter(r => r.capture_key === p.key) : matches.filter(r => !p.after || r.capture_key > p.after).slice(0, p.limit) };
    }
  }
  const type = () => "type", sql = { Request, NVarChar: type, Char: type, VarChar: type, UniqueIdentifier: "uuid", Int: "int", MAX: "max" }, tx = {};
  const store = new ShiftRecoveryEvidenceStore({ connectionManager: { sql: () => sql }, registry, assertScope: async () => allowed });
  return { store, input, tx, rows, queries, deny: () => { allowed = false; }, hook: value => { hook = value; }, badOwner: () => { owner = "untrusted"; },
    missingTrigger: () => { missing = true; }, badTrigger: () => { badTrigger = true; } };
}
test("exact raw numbers/timestamps survive capture/load and same-payload retries are idempotent", async () => {
  const h = harness(), first = await h.store.capture(h.tx, h.input), second = await h.store.capture(h.tx, { ...h.input, jobId: ID });
  assert.equal(first.captureKey, second.captureKey); assert.equal(h.rows.size, 1); assert.equal(first.autoApply, false);
  const loaded = await h.store.load(h.tx, scope, first.captureKey);
  assert.equal(loaded.localGraphText, h.input.localGraphText); assert.equal(loaded.cloudGraphText, h.input.cloudGraphText);
  assert(loaded.localGraphText.includes("9007199254740993")); assert(loaded.localGraphText.includes(".1234567Z"));
  assert.equal((await h.store.list(h.tx, scope)).length, 1);
  assert(h.queries.every(q => !/UPDATE\s+dbo|DELETE\s+FROM|sync_checkpoints|shift_intents|receipt/i.test(q)));
});
test("90/365-day capture retries retain evidence without expiry, acceptance or upload writes", async () => {
  const h = harness(), saved = await h.store.capture(h.tx, h.input);
  for (const days of [90, 365]) {
    const repeat = await h.store.capture(h.tx, { ...h.input, offlineDays: days }); assert.equal(repeat.captureKey, saved.captureKey);
    assert.equal((await h.store.load(h.tx, scope, saved.captureKey)).autoApply, false);
  }
  assert.equal(h.rows.size, 1); assert(!Object.keys([...h.rows.values()][0]).some(k => /accepted|receipt|acknowledged/.test(k)));
});
test("scope denial happens before SQL and changed scope during IO fails after await", async () => {
  const h = harness(); h.deny(); await assert.rejects(h.store.capture(h.tx, h.input), { code: "SYNC_BRANCH_FORBIDDEN" }); assert.equal(h.queries.length, 0);
  const other = harness(); other.hook(() => other.deny()); await assert.rejects(other.store.capture(other.tx, other.input), { code: "SYNC_BRANCH_FORBIDDEN" });
  assert.equal(other.rows.size, 0);
});
test("caller owns transaction and wrong schema/owner/missing append-only trigger fail closed", async () => {
  const h = harness(); await assert.rejects(h.store.capture(null, h.input));
  for (const mutation of ["badOwner", "missingTrigger", "badTrigger"]) { const x = harness(); x[mutation](); await assert.rejects(x.store.capture(x.tx, x.input), { code: "ESHIFT_RECOVERY_SCHEMA" }); assert.equal(x.rows.size, 0); }
});
test("different profile/backend cannot read captured graphs", async () => {
  const h = harness(), saved = await h.store.capture(h.tx, h.input);
  for (const override of [{ backendOriginHash: "b".repeat(64) }, { databaseGuid: ID }, { branchId: ID }, { terminalId: ID }])
    assert.equal(await h.store.load(h.tx, { ...scope, ...override }, saved.captureKey), null);
});
test("tampered raw bytes, discriminator, codec or classification are rejected", async () => {
  for (const [key, value] of [["local_graph_json", "[]"], ["owner_tag", "other"], ["format_tag", "other"], ["codec_version", 2], ["classification", "accepted"]]) {
    const h = harness(), saved = await h.store.capture(h.tx, h.input); h.rows.get(saved.captureKey)[key] = value;
    await assert.rejects(h.store.load(h.tx, scope, saved.captureKey));
  }
});
test("malformed/lossy/missing graph and conservative UTF16 size bounds refuse before SQL", async () => {
  for (const text of ["[]", "{", "null", "[".repeat(70) + "null" + "]".repeat(70), JSON.stringify("a".repeat(CAP / 2))]) {
    const h = harness(); await assert.rejects(h.store.capture(h.tx, { ...h.input, localGraphText: text })); assert.equal(h.queries.length, 0);
  }
});
test("bounded list cursor rejects malformed keys and limits without SQL", async () => {
  for (const options of [{ limit: 0 }, { limit: 101 }, { afterKey: "secret-invalid" }]) { const h = harness(); await assert.rejects(h.store.list(h.tx, scope, options)); assert.equal(h.queries.length, 0); }
});
test("raw SQL/driver exceptions are normalized without leaking payloads", async () => {
  const h = harness(); h.hook(() => { throw Error("private-secret-text"); });
  await assert.rejects(h.store.capture(h.tx, h.input), error => !error.message.includes("private-secret-text") && !error.message.includes(ID));
});
test("capture freezes raw strings before awaited IO instead of trusting a changing caller object", async () => {
  const h = harness(), original = h.input.localGraphText;
  h.hook(() => { h.input.localGraphText = "[]"; h.input.scope = { ...scope, branchId: ID }; });
  const saved = await h.store.capture(h.tx, h.input);
  assert.equal((await h.store.load(h.tx, scope, saved.captureKey)).localGraphText, original);
});
test("losslessly parsed native SQL bit tokens remain boolean facts without rounding other numbers", async () => {
  const h = harness(), localGraphText = h.input.localGraphText.replace('"overdue":false', '"overdue":0');
  const saved = await h.store.capture(h.tx, { ...h.input, localGraphText });
  assert.equal(saved.classification, "exact"); assert.equal((await h.store.load(h.tx, scope, saved.captureKey)).localGraphText, localGraphText);
});

// Opt-in actual SQL Server test creates ONLY its own private LocalDB instance and
// generated fixture database. Never reads a POS profile, POS_Local or credentials.
test("isolated LocalDB append-only schema, transaction rollback and restart/readback", { skip: !process.argv.includes("--sql") }, async () => {
  const fs = require("node:fs"), path = require("node:path"), { execFileSync } = require("node:child_process"), { randomUUID } = require("node:crypto");
  assert.equal(process.platform, "win32");
  const sql = require(require.resolve("mssql/msnodesqlv8", { paths: [path.resolve(__dirname, "../../.."), __dirname] }));
  const suffix = randomUUID().replaceAll("-", ""), instance = "CodexEvidence65_" + suffix, database = "Evidence65Fixture_" + suffix;
  assert(/^CodexEvidence65_[a-f0-9]{32}$/.test(instance) && /^Evidence65Fixture_[a-f0-9]{32}$/.test(database));
  const control = (...args) => { const b = execFileSync("C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe", args, { windowsHide: true, timeout: 30000, stdio: "pipe" }); return b.toString(b.includes(0) ? "utf16le" : "utf8").replace(/^\uFEFF/, ""); };
  let owned = false, master, pool;
  try {
    control("create", instance, "-s"); owned = true;
    const server = control("info", instance).match(/np:\\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query/)?.[0]; assert(server);
    const connect = name => { assert(name === "master" || name === database); return new sql.ConnectionPool({ connectionString: `Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`, pool: { min: 0, max: 2 }, requestTimeout: 10000 }).connect(); };
    master = await connect("master"); await master.request().batch(`CREATE DATABASE [${database}];`); pool = await connect(database);
    await pool.request().batch(fs.readFileSync(path.join(__dirname, "../docs/database/retained-shift-recovery-evidence.sql"), "utf8"));
    const { registry, input } = fixture();
    const actualGuid = (await pool.request().query("SELECT CONVERT(varchar(36),database_guid) guid FROM sys.database_recovery_status WHERE database_id=DB_ID();")).recordset[0].guid.toLowerCase();
    const actualScope = { ...scope, databaseGuid: actualGuid };
    const store = new ShiftRecoveryEvidenceStore({ connectionManager: { sql: () => sql }, registry, assertScope: async (_transaction, s) => s.databaseGuid === actualGuid });
    const transaction = new sql.Transaction(pool); await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const saved = await store.capture(transaction, { ...input, scope: actualScope }); await transaction.commit();
    const retry = new sql.Transaction(pool); await retry.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    assert.equal((await store.capture(retry, { ...input, scope: actualScope })).captureKey, saved.captureKey); await retry.rollback();
    assert.equal((await pool.request().query("SELECT COUNT(*) n FROM dbo.pos_shift_recovery_evidence;")).recordset[0].n, 1);
    for (const command of ["UPDATE dbo.pos_shift_recovery_evidence SET classification='exact';", "DELETE FROM dbo.pos_shift_recovery_evidence;"])
      await assert.rejects(pool.request().query(command), /append-only/);
    const read = new sql.Transaction(pool); await read.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    assert.equal((await store.load(read, actualScope, saved.captureKey)).localGraphText, input.localGraphText); await read.commit();
    const rollback = new sql.Transaction(pool); await rollback.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const different = input.localGraphText.replace("123.4567890123456789", "123.4567890123456788");
    await store.capture(rollback, { ...input, scope: actualScope, localGraphText: different }); await rollback.rollback();
    assert.equal((await pool.request().query("SELECT COUNT(*) n FROM dbo.pos_shift_recovery_evidence;")).recordset[0].n, 1);
    // Simultaneous lost-ack retries serialize on the deterministic capture key.
    const again = async () => { const tx = new sql.Transaction(pool); await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE); try {
      const found = await store.capture(tx, { ...input, scope: actualScope }); await tx.commit(); return found.captureKey;
    } catch (error) { await tx.rollback().catch(() => {}); throw error; } };
    assert.deepEqual(await Promise.all([again(), again()]), [saved.captureKey, saved.captureKey]);
    assert.equal((await pool.request().query("SELECT COUNT(*) n FROM dbo.pos_shift_recovery_evidence;")).recordset[0].n, 1);
    // A genuinely new process/store instance reads the same persisted bytes.
    const restarted = new ShiftRecoveryEvidenceStore({ connectionManager: { sql: () => sql }, registry, assertScope: async (_tx, s) => s.databaseGuid === actualGuid });
    const resumed = new sql.Transaction(pool); await resumed.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    assert.equal((await restarted.load(resumed, actualScope, saved.captureKey)).cloudGraphText, input.cloudGraphText); await resumed.commit();
  } finally {
    await pool?.close(); if (master) { await master.request().batch(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}];`).catch(() => {}); await master.close(); }
    if (owned) { control("stop", instance, "-k"); control("delete", instance); }
  }
});
