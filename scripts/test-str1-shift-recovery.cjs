#!/usr/bin/env node
/** Isolated real SQL Server regression. No POS_Local/profile/cloud connection. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, randomUUID, createHash } = require("node:crypto");
const sql = require("mssql/msnodesqlv8");
const { ChangeReader } = require("../electron/sync/change-reader.cjs");
const { PushWorker } = require("../electron/sync/push-worker.cjs");
const { loadRegistry } = require("../electron/db/schema-registry.cjs");

if (process.argv.length !== 2) throw new Error("This isolated harness accepts no connection or other arguments.");
for (const name of Object.keys(process.env)) {
  if (process.env[name] && /^(?:DATABASE_URL|SUPABASE_DB_URL|PG(?:PASSWORD|HOST|USER|DATABASE|PORT)|MSSQL_.*|SQLSERVER_.*|SQL_SERVER|SQL_DATABASE|SQL_CONNECTION_STRING|ODBC_CONNECTION_STRING)$/i.test(name))
    throw new Error("Remove inherited database overrides before running the isolated harness.");
}
const root = path.resolve(__dirname, "..");
const artifact = fs.readFileSync(path.join(__dirname, "maintenance/requeue-str1-20261031-shift-closing.sql"), "utf8");
assert.equal(artifact.match(/DECLARE @ExpectedServer nvarchar\(128\)=N'([^']+)';/)?.[1], "DESKTOP-VIB2MIL\\LCRPOS");
assert.equal(artifact.match(/DECLARE @ExpectedDatabase sysname=N'([^']+)';/)?.[1], "POS_Local");
for (const name of ["ExpectedDatabaseGuid", "ReviewedManifest", "ReviewedSha256", "ApprovalReference", "TransportReference"])
  assert(new RegExp(`DECLARE @${name} [^=;]+=NULL;`).test(artifact), `${name} must remain unset in the shipped preparation template`);
const schema = fs.readFileSync(path.join(root, "database/sqlserver/schema.sql"), "utf8");
const registry = loadRegistry();
const tables = ["shifts", "shift_cash_counts", "shift_reconciliations", "shift_close_events", "shift_notifications", "shift_variance_alerts"];
const metadata = ["sync_checkpoints", "sync_change_journal", "local_operation_receipts"];
const shift = "1a349429-cea1-4f45-8d2b-36678d37ad27", branch = "a611a328-2217-4d77-944a-5f6a637d123b";
const terminal = "2a9be656-3830-4f1c-9ede-3e9c379f3d13", count = "dd2b330a-bcfc-44f6-9949-8d912cdbca80";
const reconciliation = "7a49fc63-da14-41c6-b7d7-c1ddda5871fa", recovery = "f69ae907-b21f-4d7e-8369-17ec6f707212";
const current = "acbc1ed1-2fc1-44c7-9c71-c338da7fda2f", openingAggregate = "00000000-0000-4000-8000-000000000101";
const opened = "2026-10-31T02:22:18.108+00:00", closed = "2026-10-31T13:08:56.837+00:00";
const database = "POS_Shift28Regression_" + randomBytes(12).toString("hex");
const nonce = randomUUID();
const literal = value => value == null ? "NULL" : `N'${String(value).replaceAll("'", "''")}'`;
const isRecovery = value => String(value ?? "").toLowerCase() === recovery;
let passed = 0;
function pass(name) { passed++; console.log(`PASS ${name}`); }
function createDefinition(name) {
  const head = tables.includes(name)
    ? `IF OBJECT_ID(N'dbo.${name}', N'U') IS NULL BEGIN CREATE TABLE dbo.[${name}] (`
    : `IF OBJECT_ID(N'dbo.${name}', N'U') IS NULL CREATE TABLE dbo.${name} (`;
  const start = schema.indexOf(head);
  assert(start >= 0, `Canonical CREATE TABLE missing: ${name}`);
  const end = schema.indexOf(tables.includes(name) ? "); END;" : ");", start);
  assert(end > start);
  return schema.slice(start, end + (tables.includes(name) ? 7 : 2));
}
function readOnlyCapture(source) {
  const stageStart = source.indexOf("-- STAGE_ONLY_BEGIN:");
  const catchStart = source.indexOf("-- OWNED_TRANSACTION_CATCH_BEGIN:");
  assert(stageStart > 0 && catchStart > stageStart);
  const trailer = source.match(/-- CAPTURE_ONLY_TRAILER_BEGIN\r?\n([\s\S]*?)-- CAPTURE_ONLY_TRAILER_END/);
  assert(trailer);
  const excerpt = source.slice(0, stageStart) + trailer[1].replace(/^-- /gm, "") + source.slice(catchStart);
  assert(!/\b(?:INSERT(?:\s+INTO)?|UPDATE|DELETE(?:\s+FROM)?|MERGE|ALTER|CREATE|DROP)\s+(?:dbo\.|\[dbo\]\.)/i.test(excerpt));
  assert(!/\b(?:EXEC(?:UTE)?|SESSION_CONTEXT)\s*\(/i.test(excerpt));
  return excerpt;
}
const captureArtifact = readOnlyCapture(artifact);
function fixtureInputs(server, guid, mode = "CAPTURE", approved = null, changes = {}, source = artifact) {
  const values = {
    Mode: literal(mode), ExpectedServer: literal(server), ExpectedDatabase: literal(database),
    ExpectedDatabaseGuid: literal(guid), ReviewedManifest: literal(approved?.exact_manifest),
    ReviewedSha256: literal(approved?.sha256_utf16le), ApprovalReference: literal(approved ? "SYNTHETIC-TEST-ONLY" : null),
    TransportReference: literal(approved ? "SYNTHETIC-NO-CLOUD-ADAPTER" : null), ...changes,
  };
  let instantiated = source;
  for (const [name, value] of Object.entries(values)) {
    const expression = new RegExp(`(DECLARE @${name} [^=;]+)=([^;]+);`);
    assert.equal((instantiated.match(new RegExp(expression.source, "g")) || []).length, 1);
    instantiated = instantiated.replace(expression, (_match, declaration) => `${declaration}=${value};`);
  }
  const body = source => source.slice(source.indexOf("-- REVIEWED INPUTS END"));
  assert.equal(body(instantiated), body(source), "Only fixed reviewed input literals may be instantiated in a fixture.");
  return instantiated;
}
function connect(name) {
  assert(name === "master" || name === database, "Only master and this exact owned fixture may connect.");
  assert(/^POS_Shift28Regression_[a-f0-9]{24}$/.test(database));
  return new sql.ConnectionPool({
    connectionString: `Driver={ODBC Driver 18 for SQL Server};Server=localhost\\LCRPOS;Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`,
    options: { trustedConnection: true }, pool: { max: 1 }, connectionTimeout: 5000, requestTimeout: 15000,
  }).connect();
}
async function seed(pool, sameBranchPending = false) {
  await pool.request().batch(`
    DELETE dbo.shift_variance_alerts; DELETE dbo.shift_notifications; DELETE dbo.shift_close_events;
    DELETE dbo.shift_reconciliations; DELETE dbo.shift_cash_counts; DELETE dbo.shifts;
    DELETE dbo.sync_change_journal; DELETE dbo.local_operation_receipts; DELETE dbo.sync_checkpoints;
    INSERT dbo.shifts(id,store_id,terminal_id,terminal_name,opened_by_name,opened_by_staff_id,opened_by_role,
      closed_by_name,closed_by_staff_id,closed_by_role,opened_at,closed_at,opening_float,
      counted_cash,final_counted_cash,closing_float,expected_cash,counted_card,counted_digital,
      expected_card,expected_digital,variance_cash,variance_card,variance_digital,variance_total,
      variance_status,status,state,row_version,created_at,updated_at,closing_started_at,closing_started_by,note)
    VALUES('${shift}',N'${branch}',N'${terminal}',N'Fixture terminal',N'Fixture cashier',N'fixture-staff',N'cashier',
      N'Fixture O''Neil 中文',N'fixture-staff',N'cashier','${opened}','${closed}',10,90,90,90,100,NULL,20,30,20,-10,NULL,0,-10,
      N'SHORT',N'CLOSED',N'CLOSED',3,'${opened}','${closed}','2026-10-31T13:00:00+00:00',N'fixture-staff',N'fixture original');
    INSERT dbo.shifts(id,store_id,terminal_id,opened_by_name,opened_at,status,state,row_version)
      VALUES('${current}',N'${branch}',N'${terminal}',N'Current fixture cashier','2026-11-01T02:29:21+00:00',N'OPEN',N'ACTIVE',1);
    INSERT dbo.shift_cash_counts(id,shift_id,store_id,terminal_id,kind,counted_cash,counted_card,counted_digital,
      counted_by_name,counted_by_staff_id,client_key,created_at)
      VALUES('${count}','${shift}',N'${branch}',N'${terminal}',N'ORIGINAL',90,NULL,20,N'Fixture cashier',N'fixture-staff',N'fixture-original','${closed}');
    INSERT dbo.shift_reconciliations(id,shift_id,store_id,count_id,expected_cash,expected_card,expected_digital,
      counted_cash,counted_card,counted_digital,variance_cash,variance_card,variance_digital,variance_total,variance_status,created_at)
      VALUES('${reconciliation}','${shift}',N'${branch}','${count}',100,30,20,90,NULL,20,-10,NULL,0,-10,N'SHORT','${closed}');
    INSERT dbo.shift_close_events(id,shift_id,store_id,terminal_id,event,from_state,to_state,detail,actor_name,actor_staff_id,created_at)
      VALUES('00000000-0000-4000-8000-000000000201','${shift}',N'${branch}',N'${terminal}',N'closing_started',N'ACTIVE',N'CASH_COUNT_REQUIRED',N'{}',N'Fixture cashier',N'fixture-staff','2026-10-31T13:00:00+00:00'),
      ('00000000-0000-4000-8000-000000000202','${shift}',N'${branch}',N'${terminal}',N'cash_count_submitted',N'CASH_COUNT_REQUIRED',N'CASH_COUNT_SUBMITTED',N'{"count_id":"${count}"}',N'Fixture cashier',N'fixture-staff','${closed}'),
      ('00000000-0000-4000-8000-000000000203','${shift}',N'${branch}',N'${terminal}',N'reconciled',N'CASH_COUNT_SUBMITTED',N'CLOSED',N'{"variance_status":"SHORT","variance_total":-10}',N'Fixture cashier',N'fixture-staff','${closed}');
    INSERT dbo.shift_notifications(id,shift_id,store_id,store_name,terminal_name,closed_by,opened_at,closed_at,
      total_sales,transactions,discounts,refunds,expected_cash,counted_cash,payment_breakdown,summary,channels,created_at)
      VALUES('00000000-0000-4000-8000-000000000204','${shift}',N'${branch}',N'Fixture STR1',N'Fixture terminal',N'Fixture cashier',
      '${opened}','${closed}',140,4,1,0,100,90,N'{"cash":90,"card":30,"digital":20}',N'Original O''Neil 中文'+NCHAR(10)+N'"quoted" summary',N'["in_app"]','${closed}');
    INSERT dbo.shift_variance_alerts(id,shift_id,store_id,reconciliation_id,variance_total,variance_status,message,created_at,updated_at)
      VALUES('00000000-0000-4000-8000-000000000205','${shift}',N'${branch}','${reconciliation}',-10,N'SHORT',N'Original fixture alert','${closed}','${closed}');
    INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id,acknowledged_at,created_at)
      VALUES(N'shifts',N'{"id":"${shift}"}',N'insert',N'${branch}',1,'${openingAggregate}','2026-10-31T03:27:00+00:00','${opened}');
    INSERT dbo.local_operation_receipts(operation_id,operation_type,entity_id,note,committed_at)
      VALUES('${openingAggregate}',N'shift',N'${openingAggregate}',N'fixture-original-opening-hash','${opened}'),
      ('00000000-0000-4000-8000-000000000102',N'sale',N'unrelated',N'preserve unrelated receipt','${opened}');
    INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id,last_error,retry_count,created_at)
      VALUES(N'sales',N'{"id":"00000000-0000-4000-8000-000000000103"}',N'insert',N'${sameBranchPending ? branch : "fixture-other-branch"}',5,
        '00000000-0000-4000-8000-000000000102',N'preserve unrelated failure',7,'${closed}');
    INSERT dbo.sync_checkpoints(organization_id,branch_id,entity_type,direction,change_tracking_version,updated_at)
      VALUES(N'default',N'${branch}',N'change_history',N'push',22619,'${closed}'),
      (N'default',N'${branch}',N'shifts',N'push',29281,'${closed}');
  `);
}
async function snapshot(pool) {
  const arrays = [...tables, ...metadata, "fixture_sales", "fixture_stock"].map(name =>
    `JSON_QUERY((SELECT * FROM dbo.[${name}] ORDER BY ${name === "sync_change_journal" ? "change_id" : name === "local_operation_receipts" ? "operation_id" : name === "sync_checkpoints" ? "organization_id,branch_id,entity_type,direction" : "id"} FOR JSON PATH,INCLUDE_NULL_VALUES)) AS [${name}]`);
  return (await pool.request().query(`SELECT (SELECT ${arrays.join(",")} FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS snapshot;`)).recordset[0].snapshot;
}
function invariant(before, after) {
  const previous = JSON.parse(before), next = JSON.parse(after);
  for (const name of [...tables, "sync_checkpoints", "fixture_sales", "fixture_stock"])
    assert.deepEqual(next[name], previous[name], `${name} must not change`);
  assert.deepEqual(next.sync_change_journal.filter(row => !isRecovery(row.aggregate_id)), previous.sync_change_journal);
  assert.deepEqual(next.local_operation_receipts.filter(row => !isRecovery(row.operation_id)), previous.local_operation_receipts);
}
async function main() {
  const master = await connect("master");
  let pool, second, created = false;
  try {
    const server = (await master.request().query("SELECT CONVERT(nvarchar(128),SERVERPROPERTY(N'ServerName')) AS server_name;")).recordset[0].server_name;
    await master.request().query(`CREATE DATABASE [${database}];`); created = true;
    pool = await connect(database);
    await pool.request().batch(`CREATE TABLE dbo.__shift28_fixture_owner(nonce uniqueidentifier NOT NULL PRIMARY KEY); INSERT dbo.__shift28_fixture_owner VALUES('${nonce}');`);
    for (const name of [...tables, ...metadata]) await pool.request().batch(createDefinition(name));
    const constraints = schema.split(/\r?\n/).filter(line => tables.some(name =>
      line.includes(`OBJECT_ID(N'dbo.${name}')`) && (line.includes(" CREATE INDEX ") || line.includes(" CREATE UNIQUE INDEX ") || line.includes(" FOREIGN KEY "))));
    for (const statement of constraints) await pool.request().batch(statement);
    // Minimal unrelated sentinels only; the actual six graph tables above use
    // canonical columns/defaults/PKs/FKs/unique indexes without disabling them.
    await pool.request().batch("CREATE TABLE dbo.fixture_sales(id int PRIMARY KEY,total decimal(38,12)); INSERT dbo.fixture_sales VALUES(1,123.456); CREATE TABLE dbo.fixture_stock(id int PRIMARY KEY,quantity decimal(38,12),sku nvarchar(30),price decimal(38,12)); INSERT dbo.fixture_stock VALUES(1,-2.5,N'fixture-global-sku',49.99);");
    for (const name of tables) {
      const countColumns = (await pool.request().input("table", `dbo.${name}`).query("SELECT COUNT(*) AS n FROM sys.columns WHERE object_id=OBJECT_ID(@table);")).recordset[0].n;
      assert.equal(countColumns, registry.tables.find(table => table.sqlServerTable === name).columns.length, `Actual ${name} column parity`);
    }
    const guid = (await pool.request().query("SELECT database_guid FROM sys.database_recovery_status WHERE database_id=DB_ID();")).recordset[0].database_guid;
    const capture = async () => {
      const before = await snapshot(pool);
      const sessionBefore = (await pool.request().query("SELECT @@OPTIONS AS options,@@TRANCOUNT AS n,transaction_isolation_level AS isolation_level FROM sys.dm_exec_sessions WHERE session_id=@@SPID;")).recordset[0];
      const result = (await pool.request().batch(fixtureInputs(server, guid, "CAPTURE", null, {}, captureArtifact))).recordset[0];
      assert.match(result.result, /CAPTURE ONLY/);
      assert.equal(createHash("sha256").update(Buffer.from(result.exact_manifest, "utf16le")).digest("hex").toUpperCase(), result.sha256_utf16le);
      assert.equal(await snapshot(pool), before, "Every read-only capture must preserve all relevant persisted rows.");
      assert.deepEqual((await pool.request().query("SELECT @@OPTIONS AS options,@@TRANCOUNT AS n,transaction_isolation_level AS isolation_level FROM sys.dm_exec_sessions WHERE session_id=@@SPID;")).recordset[0], sessionBefore);
      return result;
    };
    const stage = (approved, changes = {}, target = pool) => target.request().batch(fixtureInputs(server, guid, "STAGE", approved, changes));
    await seed(pool, true);
    const untouched = await snapshot(pool);
    await assert.rejects(pool.request().batch(artifact), /exact server\/database identity mismatch/);
    assert.equal(await snapshot(pool), untouched); pass("exact shipped remote identity guard blocks local fixture unchanged");
    await assert.rejects(stage(null), /separately reviewed manifest/); pass("unset manifest and audit gates block staging");
    const approved = await capture();
    assert.equal((await pool.request().batch(fixtureInputs(server, guid))).recordset[0].exact_manifest, approved.exact_manifest);
    const captured = JSON.parse(approved.exact_manifest);
    assert.equal(captured.shifts[0].closed_by_name, "Fixture O'Neil 中文");
    assert.equal(captured.shift_notifications[0].summary, "Original O'Neil 中文\n\"quoted\" summary");
    assert.equal(captured.shifts[0].counted_card, null);
    assert.equal(await snapshot(pool), untouched); pass("full null-aware CAPTURE is read-only and UTF16LE digest reproducible");
    pass("derived capture-only batch matches full-template capture and safely round-trips apostrophe/Unicode/JSON/newline/null fields");
    await assert.rejects(pool.request().batch(fixtureInputs(server, guid, "STAGE", approved, {}, captureArtifact)), /derived capture refuses non-CAPTURE/);
    assert.equal((await pool.request().query("SELECT @@TRANCOUNT AS n;")).recordset[0].n, 0);
    assert.equal(await snapshot(pool), untouched); pass("derived capture rejects fully bound STAGE and releases all locks/transaction without changes");
    await assert.rejects(stage(approved, { ExpectedServer: literal("not-this-server") }), /identity mismatch/);
    await assert.rejects(stage(approved, { ExpectedDatabase: literal("not-this-database") }), /identity mismatch/);
    await assert.rejects(stage(approved, { ExpectedServer: "NULL" }), /identity mismatch/);
    await assert.rejects(stage(approved, { ExpectedDatabase: "NULL" }), /identity mismatch/);
    await assert.rejects(stage(approved, { ExpectedServer: literal(" ") }), /identity mismatch/);
    await assert.rejects(stage(approved, { ExpectedDatabase: literal("") }), /identity mismatch/);
    await assert.rejects(stage(approved, { ExpectedDatabaseGuid: literal(randomUUID()) }), /database GUID/);
    assert.equal(await snapshot(pool), untouched); pass("server, database and database GUID mismatches leave every record intact");
    await assert.rejects(stage(approved, { ReviewedSha256: literal("0".repeat(64)) }), /manifest\/digest differs/);
    await assert.rejects(stage(approved, { ReviewedManifest: literal(approved.exact_manifest + " ") }), /manifest\/digest differs/);
    assert.equal(await snapshot(pool), untouched); pass("digest and exact-manifest drift rejected before any inserts");
    const staged = await stage(approved);
    assert.match(staged.recordset[0].result, /^STAGED ONLY \/ NOT RECOVERED/);
    const afterStage = await snapshot(pool); invariant(untouched, afterStage);
    const saved = JSON.parse(afterStage);
    assert.equal(saved.sync_change_journal.filter(row => isRecovery(row.aggregate_id)).length, 8);
    assert.equal(saved.local_operation_receipts.filter(row => isRecovery(row.operation_id)).length, 1);
    assert(saved.sync_change_journal.filter(row => isRecovery(row.aggregate_id)).every(row => tables.includes(row.entity_type)));
    pass("exact eight existing graph keys staged; business/current drawer/checkpoints/other pending and ACK work preserved");
    await stage(approved); assert.equal(await snapshot(pool), afterStage); pass("identical replay adds no metadata or delivery activity");
    await pool.request().query(`UPDATE dbo.sync_change_journal SET retry_count=2,last_error=N'fixture transient' WHERE aggregate_id='${recovery}';`);
    const retried = await snapshot(pool); await stage(approved); assert.equal(await snapshot(pool), retried); pass("replay preserves legitimate retry/error evolution");
    await pool.request().query(`UPDATE dbo.sync_change_journal SET acknowledged_at='2026-11-01T06:00:00+00:00',last_error=NULL WHERE aggregate_id='${recovery}';`);
    const acknowledged = await snapshot(pool); await stage(approved); assert.equal(await snapshot(pool), acknowledged); pass("replay after acknowledgement cannot duplicate a closing or notification");

    const mutations = [
      ["parent revision", `UPDATE dbo.shifts SET row_version=4 WHERE id='${shift}'`, /parent\/identity\/timing\/revision differs/],
      ["branch", `UPDATE dbo.shifts SET store_id=N'foreign' WHERE id='${shift}'`, /parent\/identity\/timing\/revision differs/],
      ["terminal", `UPDATE dbo.shifts SET terminal_id=N'foreign' WHERE id='${shift}'`, /parent\/identity\/timing\/revision differs/],
      ["closing time", `UPDATE dbo.shifts SET closed_at=DATEADD(second,1,closed_at) WHERE id='${shift}'`, /parent\/identity\/timing\/revision differs/],
      ["count amount", `UPDATE dbo.shift_cash_counts SET counted_cash=91 WHERE id='${count}'`, /financial links differ/],
      ["nullable amount", `UPDATE dbo.shift_reconciliations SET counted_card=0 WHERE id='${reconciliation}'`, /financial links differ/],
      ["foreign child", `UPDATE dbo.shift_close_events SET store_id=N'foreign' WHERE event=N'reconciled'`, /ownership or timing differs/],
      ["JSON details", "UPDATE dbo.shift_close_events SET detail=N'not-json' WHERE event=N'closing_started'", /ownership or timing differs/],
      ["missing event", "DELETE dbo.shift_close_events WHERE event=N'closing_started'", /cardinality differs/],
      ["extra event", `INSERT dbo.shift_close_events(shift_id,store_id,terminal_id,event,created_at) VALUES('${shift}',N'${branch}',N'${terminal}',N'extra','${closed}')`, /cardinality differs/],
      ["pending existing opening", "UPDATE dbo.sync_change_journal SET acknowledged_at=NULL WHERE entity_type=N'shifts'", /pending, foreign, partial or shared/],
      ["raw UUID baseline drift", `UPDATE dbo.sync_change_journal SET entity_id=N'${shift}' WHERE entity_type=N'shifts'`, /manifest\/digest differs/],
      ["checkpoint drift", "UPDATE dbo.sync_checkpoints SET change_tracking_version=29282 WHERE entity_type=N'shifts'", /manifest\/digest differs/],
      ["full JSON content drift", "UPDATE dbo.shift_notifications SET summary=N'new content'", /manifest\/digest differs/],
      ["associated receipt drift", `UPDATE dbo.local_operation_receipts SET note=N'changed' WHERE operation_id='${openingAggregate}'`, /manifest\/digest differs/],
      ["shared aggregate", `INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id,acknowledged_at) VALUES(N'sales',N'{"id":"00000000-0000-4000-8000-000000000333"}',N'insert',N'${branch}',1,'${openingAggregate}','${closed}')`, /pending, foreign, partial or shared/],
      ["malformed key", `UPDATE dbo.sync_change_journal SET entity_id=N'broken-${shift}' WHERE entity_type=N'shifts'`, /ambiguous graph journal identity/],
      ["truncated UUID ambiguity", `UPDATE dbo.sync_change_journal SET entity_id=N'${shift}junk' WHERE entity_type=N'shifts'`, /ambiguous graph journal identity/],
      ["extra JSON-key ambiguity", `UPDATE dbo.sync_change_journal SET entity_id=N'{"id":"${shift}","other":1}' WHERE entity_type=N'shifts'`, /ambiguous graph journal identity/],
      ["escaped JSON-ID plus extra key", `UPDATE dbo.sync_change_journal SET entity_id=N'{"id":"1\\u0061349429-cea1-4f45-8d2b-36678d37ad27","extra":1}' WHERE entity_type=N'shifts'`, /ambiguous graph journal identity/],
      ["escaped JSON-ID under foreign table", `UPDATE dbo.sync_change_journal SET entity_type=N'sales',entity_id=N'{"id":"1\\u0061349429-cea1-4f45-8d2b-36678d37ad27"}' WHERE entity_type=N'shifts'`, /ambiguous graph journal identity/],
    ];
    for (const [name, mutation, error] of mutations) {
      await seed(pool); const review = await capture(); await pool.request().batch(mutation);
      const changed = await snapshot(pool);
      try { await pool.request().batch(fixtureInputs(server, guid, "CAPTURE", null, {}, captureArtifact)); }
      catch (captureError) { assert.equal(captureError.number, 51028, "Capture integrity failure must be fail-closed"); }
      assert.equal(await snapshot(pool), changed, "Failed or successful capture cannot amend drifted evidence");
      await assert.rejects(stage(review), error);
      assert.equal(await snapshot(pool), changed); pass(`fail-closed ${name}; no repair or metadata changes`);
    }
    await seed(pool); await pool.request().query(`UPDATE dbo.sync_change_journal SET entity_id=N'${shift}' WHERE entity_type=N'shifts'`);
    const raw = await capture(); await stage(raw); pass("reviewed legacy raw-UUID journal encoding remains accounted for");
    await seed(pool); const triggerReview = await capture();
    await pool.request().batch("CREATE TRIGGER dbo.fixture_unreviewed_trigger ON dbo.sync_change_journal AFTER INSERT AS UPDATE dbo.fixture_stock SET quantity=999;");
    const triggerBefore = await snapshot(pool);
    await assert.rejects(stage(triggerReview), /unreviewed metadata trigger/);
    await assert.rejects(pool.request().batch(fixtureInputs(server, guid, "CAPTURE", null, {}, captureArtifact)), /unreviewed metadata trigger/);
    assert.equal(await snapshot(pool), triggerBefore); pass("unreviewed metadata trigger blocks stage/capture before it can affect sentinels");
    await pool.request().query("DROP TRIGGER dbo.fixture_unreviewed_trigger;");
    const stagedDrift = [
      ["missing staged child", `DELETE dbo.sync_change_journal WHERE aggregate_id='${recovery}' AND entity_type=N'shift_notifications'`],
      ["duplicate staged child", `INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id) SELECT entity_type,entity_id,operation,branch_id,entity_version,aggregate_id FROM dbo.sync_change_journal WHERE aggregate_id='${recovery}' AND entity_type=N'shift_notifications'`],
      ["changed staged version", `UPDATE dbo.sync_change_journal SET entity_version=4 WHERE aggregate_id='${recovery}' AND entity_type=N'shifts'`],
      ["changed staged creation time", `UPDATE dbo.sync_change_journal SET created_at=DATEADD(second,1,created_at) WHERE aggregate_id='${recovery}'`],
      ["changed receipt creation time", `UPDATE dbo.local_operation_receipts SET committed_at=DATEADD(second,1,committed_at) WHERE operation_id='${recovery}'`],
      ["changed receipt note", `UPDATE dbo.local_operation_receipts SET note=N'conflicting' WHERE operation_id='${recovery}'`],
      ["NULL receipt note", `UPDATE dbo.local_operation_receipts SET note=NULL WHERE operation_id='${recovery}'`],
      ["receipt note trailing padding", `UPDATE dbo.local_operation_receipts SET note=note+N' ' WHERE operation_id='${recovery}'`],
      ["receipt type case", `UPDATE dbo.local_operation_receipts SET operation_type=UPPER(operation_type) WHERE operation_id='${recovery}'`],
      ["receipt type padding", `UPDATE dbo.local_operation_receipts SET operation_type=operation_type+N' ' WHERE operation_id='${recovery}'`],
      ["receipt entity case", `UPDATE dbo.local_operation_receipts SET entity_id=LOWER(entity_id) WHERE operation_id='${recovery}'`],
      ["receipt entity padding", `UPDATE dbo.local_operation_receipts SET entity_id=entity_id+N' ' WHERE operation_id='${recovery}'`],
    ];
    for (const [name, mutation] of stagedDrift) {
      await seed(pool); const review = await capture(); await stage(review); await pool.request().batch(mutation);
      const changed = await snapshot(pool); await assert.rejects(stage(review), /maintenance (journal|receipt)/);
      assert.equal(await snapshot(pool), changed); pass(`replay rejects ${name} without changing any records`);
    }
    await seed(pool); const rollbackReview = await capture();
    await pool.request().query("ALTER TABLE dbo.local_operation_receipts ADD CONSTRAINT CK_fixture_reject_stage CHECK(operation_type<>N'maintenance_shift_close_requeue');");
    const rollbackBefore = await snapshot(pool);
    await assert.rejects(stage(rollbackReview), /CK_fixture_reject_stage/);
    assert.equal(await snapshot(pool), rollbackBefore); pass("receipt failure rolls back all eight preceding journal inserts");
    await pool.request().query("ALTER TABLE dbo.local_operation_receipts DROP CONSTRAINT CK_fixture_reject_stage;");

    await seed(pool); const contentionReview = await capture(); second = await connect(database);
    const holder = new sql.Transaction(second); await holder.begin();
    try {
      await new sql.Request(holder).query(`SELECT id FROM dbo.shifts WITH(UPDLOCK,HOLDLOCK) WHERE id='${shift}';`);
      const start = Date.now(); await assert.rejects(stage(contentionReview), error => error.number === 1222);
      assert(Date.now() - start < 5000, "NOWAIT must not wait/retry behind an old writer");
    } finally { await holder.rollback(); }
    pass("real two-session parent contention aborts promptly without partial staging");
    const parallelBefore = await snapshot(pool);
    const parallel = await Promise.allSettled([stage(contentionReview), stage(contentionReview, {}, second)]);
    assert(parallel.some(item => item.status === "fulfilled"));
    for (const item of parallel) if (item.status === "rejected") assert.equal(item.reason.number, 1222);
    await stage(contentionReview);
    invariant(parallelBefore, await snapshot(pool));
    assert.equal(JSON.parse(await snapshot(pool)).sync_change_journal.filter(row => isRecovery(row.aggregate_id)).length, 8);
    pass("concurrent staging has one exact metadata set; a busy attempt may be retried only as a whole batch");
    const outer = new sql.Transaction(second); await outer.begin();
    try { await assert.rejects(new sql.Request(outer).batch(fixtureInputs(server, guid)), /refuses an existing transaction/);
      assert.equal((await new sql.Request(outer).query("SELECT @@TRANCOUNT AS n;")).recordset[0].n, 1);
    } finally { await outer.rollback(); }
    pass("refuses and preserves an outer operator transaction");
    await pool.request().query("SET IMPLICIT_TRANSACTIONS ON;");
    try {
      const implicitBefore = (await pool.request().query("SELECT @@OPTIONS AS options,@@TRANCOUNT AS n;")).recordset[0];
      await assert.rejects(pool.request().batch(fixtureInputs(server, guid)), /refuses IMPLICIT_TRANSACTIONS ON/);
      assert.deepEqual((await pool.request().query("SELECT @@OPTIONS AS options,@@TRANCOUNT AS n;")).recordset[0], implicitBefore);
      assert.equal(implicitBefore.n, 0);
    } finally { await pool.request().query("SET IMPLICIT_TRANSACTIONS OFF;"); }
    pass("implicit-transaction mode is rejected before reads; operator options and transaction count remain unchanged");
    for (const implicit of [false, true]) {
      await pool.request().query(`SET XACT_ABORT ON; SET IMPLICIT_TRANSACTIONS ${implicit ? "ON" : "OFF"};`);
      try {
        await pool.request().query(implicit ? "SELECT TOP(1) id FROM dbo.fixture_sales;" : "BEGIN TRANSACTION;");
        await pool.request().query("INSERT dbo.fixture_sales VALUES(2,777);");
        const before = (await pool.request().query("SELECT @@OPTIONS AS options,@@TRANCOUNT AS n,XACT_STATE() AS transaction_state;")).recordset[0];
        await assert.rejects(pool.request().batch(fixtureInputs(server, guid)), /refuses (IMPLICIT_TRANSACTIONS ON|an existing transaction)/);
        assert.deepEqual((await pool.request().query("SELECT @@OPTIONS AS options,@@TRANCOUNT AS n,XACT_STATE() AS transaction_state;")).recordset[0], before,
          "Refusal must not doom or roll back operator work under inherited XACT_ABORT ON");
        assert.equal((await pool.request().query("SELECT COUNT(*) AS n FROM dbo.fixture_sales WHERE id=2;")).recordset[0].n, 1);
      } finally { await pool.request().query("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION; SET IMPLICIT_TRANSACTIONS OFF; SET XACT_ABORT OFF;"); }
      pass(`XACT_ABORT ON preserves ${implicit ? "active implicit" : "explicit outer"} operator transaction and unsaved work on refusal`);
    }

    await seed(pool); const transportReview = await capture(); await stage(transportReview);
    const reader = new ChangeReader({ pool, sql: () => sql }, registry);
    const pending = await reader.pendingAggregates(branch, 100);
    assert.equal(pending.length, 1); assert(isRecovery(pending[0].aggregateId)); assert.equal(pending[0].changes.length, 8);
    const graph = await reader.closedShiftGraphs(branch, [shift]);
    assert.deepEqual(graph.map(item => item.table).sort(), [...tables].sort());
    assert.equal(graph.flatMap(item => item.rows).length, 8); pass("actual ChangeReader consumes staged SQL metadata and captures all exact saved rows");
    const calls = []; let response = "missing";
    const cloud = { terminalId: () => terminal, pushAggregate: async payload => {
      calls.push(JSON.parse(JSON.stringify(payload)));
      assert.deepEqual(payload.operations.map(operation => operation.table).sort(), [...tables].sort());
      assert(!payload.operations.some(operation => operation.table === "activity_events"));
      if (response === "timeout") throw Object.assign(new Error("synthetic ambiguous timeout; no network"), { code: "ETIMEDOUT" });
      if (response === "missing") return { ok: true };
      return { ok: true, shift_closure_ack_version: 2, shift_closures: [{ id: shift, store_id: response === "wrong" ? "foreign" : branch, row_version: 2, requested_row_version: 3 }] };
    } };
    const worker = new PushWorker({ reader, cloud, checkpoints: {}, registry });
    const expectedBeforeTransport = await snapshot(pool);
    for (const mode of ["missing", "wrong", "timeout"]) {
      response = mode; await worker.pushAggregates(branch, 100, true);
      assert.equal((await reader.pendingAggregates(branch, 100)).length, 1); pass(`actual PushWorker ${mode} proof/response retains original aggregate`);
    }
    assert.equal(new Set(calls.map(call => call.batchId)).size, 1);
    assert(calls.every(call => JSON.stringify(call.operations) === JSON.stringify(calls[0].operations)));
    response = "valid"; await worker.pushAggregates(branch, 100, true);
    assert.equal((await reader.pendingAggregates(branch, 100)).length, 0);
    const callsAfterAck = calls.length; await worker.pushAggregates(branch, 100, true); assert.equal(calls.length, callsAfterAck);
    const transportBaseline = JSON.parse(expectedBeforeTransport);
    transportBaseline.sync_change_journal = transportBaseline.sync_change_journal.filter(row => !isRecovery(row.aggregate_id));
    transportBaseline.local_operation_receipts = transportBaseline.local_operation_receipts.filter(row => !isRecovery(row.operation_id));
    invariant(JSON.stringify(transportBaseline), await snapshot(pool));
    await stage(transportReview);
    pass("valid synthetic v2 acknowledgement clears once; ambiguous retries keep identical payload identity and never dispatch notifications");
    console.log(`${passed} real SQL Server/actual-reader-worker scenarios passed. Synthetic cloud only; NOT installed-device or live recovery proof.`);
  } finally {
    if (second) await second.close();
    if (pool) await pool.close();
    if (created) {
      assert(/^POS_Shift28Regression_[a-f0-9]{24}$/.test(database));
      const owner = await master.request().query(`SELECT nonce FROM [${database}].dbo.__shift28_fixture_owner;`);
      assert.equal(owner.recordset.length, 1); assert.equal(String(owner.recordset[0].nonce).toLowerCase(), nonce);
      await master.request().query(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}];`);
    }
    await master.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
