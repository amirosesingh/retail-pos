// Explicit opt-in: only a newly created, uniquely owned private LocalDB instance.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const sql = require("mssql/msnodesqlv8");
const bcrypt = require("bcryptjs");
const { loadRegistry } = require("../electron/db/schema-registry.cjs");
const { OperationsRepository } = require("../electron/db/repositories/operations.cjs");
const { OfflineApprovalService, OfflineApprovalStore } = require("../electron/offline-approval-service.cjs");
const { verifySyncedApprovalPin } = require("../electron/synced-staff-login.cjs");
const { ChangeReader } = require("../electron/sync/change-reader.cjs");
const { PullWorker } = require("../electron/sync/pull-worker.cjs");
const { PushWorker } = require("../electron/sync/push-worker.cjs");
const binary = process.argv[2] === "--run-bin2";
assert.deepEqual(process.argv.slice(2), [binary ? "--run-bin2" : "--run"]);
const branchId = "abcdefab-1234-4234-8234-abcdefabcdef";
const suffix = randomUUID().replaceAll("-", ""), owner = randomUUID();
const instance = `CodexApproval_${suffix}`, database = `ApprovalFixture_${suffix}`;
const control = (...args) => { const data = execFileSync("C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe", args, { windowsHide: true, timeout: 30000 }); return data.toString(data.includes(0) ? "utf16le" : "utf8").replace(/^\uFEFF/, ""); };
let master, pool, server, guid, created = false, owned = false, count = 0;
const connect = name => { assert(["master", database].includes(name)); return new sql.ConnectionPool({ connectionString: `Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`, pool: { min: 0, max: 4 }, requestTimeout: 10000 }).connect(); };
const guardTarget = async () => {
  const row = (await pool.request().query("SELECT DB_NAME() db,CONVERT(varchar(36),database_guid) guid,(SELECT CONVERT(nvarchar(128),value) FROM sys.extended_properties WHERE class=0 AND name=N'ApprovalFixtureOwner') owner FROM sys.database_recovery_status WHERE database_id=DB_ID();")).recordset[0];
  assert.equal(row.db, database); assert.equal(row.guid, guid); assert.equal(row.owner, owner);
};
const pass = text => { count++; console.log(`PASS ${text}`); };
(async () => { try {
  control("create", instance, "-s"); owned = true;
  server = control("info", instance).match(/np:\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query/)?.[0]; assert(server);
  master = await connect("master"); assert.equal((await master.request().input("name", database).query("SELECT DB_ID(@name) id;")).recordset[0].id, null);
  await master.request().batch(`CREATE DATABASE [${database}]${binary ? " COLLATE Latin1_General_100_BIN2" : ""};`); created = true; pool = await connect(database);
  guid = (await pool.request().query("SELECT CONVERT(varchar(36),database_guid) guid FROM sys.database_recovery_status WHERE database_id=DB_ID();")).recordset[0].guid;
  await pool.request().input("owner", sql.NVarChar(128), owner).query("EXEC sys.sp_addextendedproperty @name=N'ApprovalFixtureOwner',@value=@owner;"); await guardTarget();
  fs.mkdirSync(".tmp", { recursive: true }); fs.writeFileSync(`.tmp/offline-approval-target-${suffix}.json`, JSON.stringify({ instance, database, guid, owner }));
  console.log(`Owned isolated target ${instance} / ${database} / ${guid}`);
  const registry = loadRegistry();
  for (const name of ["authorization_log", "authorization_actions", "pos_store_settings", "app_users", "cashiers", "pin_attempts"]) {
    const table = registry.tables.find(t => t.cloudTable === name); assert(table);
    await pool.request().batch(`CREATE TABLE dbo.[${name}](${table.columns.map(c => `[${c.sqlServerColumn}] ${c.sqlServerType} ${(name === "authorization_log" && c.sqlServerColumn === "id") || (name === "pos_store_settings" && c.sqlServerColumn === "store_id") ? "NOT NULL PRIMARY KEY" : "NULL"}`).join(",")});`);
  }
  await pool.request().batch("CREATE TABLE dbo.local_operation_receipts(operation_id uniqueidentifier PRIMARY KEY,operation_type nvarchar(32),entity_id nvarchar(128),note nvarchar(max));CREATE TABLE dbo.sync_change_journal(change_id bigint IDENTITY PRIMARY KEY,entity_type nvarchar(128),entity_id nvarchar(128),operation nvarchar(32),branch_id nvarchar(128),entity_version bigint,aggregate_id uniqueidentifier,acknowledged_at datetimeoffset(7),last_error nvarchar(1000),retry_count int NOT NULL DEFAULT 0);CREATE TABLE dbo.pos_sync_shift_intents(intent_id uniqueidentifier,branch_id nvarchar(128));");
  console.log("Owned fixture schema ready");
  const author = randomUUID(), requesterId = randomUUID(), rule = randomUUID(), credential = randomUUID().replaceAll("-", ""), requester = "fixture-cashier";
  await pool.request().input("branch", branchId.toUpperCase()).input("actorBranch", sql.NVarChar(450), binary ? null : branchId.toUpperCase()).input("author", author).input("requester", requesterId).input("rule", rule).input("hash", await bcrypt.hash(credential, 4)).batch(`
    INSERT dbo.app_users(id,user_id,full_name,role,role_slug,permissions,is_active,store_id,pin_hash) VALUES(TRY_CONVERT(uniqueidentifier,@author),N'fixture-manager',N'Fixture Manager',N'manager',N'manager',N'{"can_give_discount":true}',1,@actorBranch,@hash);
    INSERT dbo.app_users(id,user_id,full_name,role,role_slug,permissions,is_active,store_id) VALUES(TRY_CONVERT(uniqueidentifier,@requester),N'fixture-cashier',N'Fixture Cashier',N'cashier',N'cashier',N'{"can_process_sale":true}',1,@branch);
    INSERT dbo.authorization_actions(id,action_key,scope_type,scope_id,mode,allowed_roles,allowed_user_ids,authority_limits,extra_authority,absolute_ceilings,is_enabled,require_reason,row_version)
      VALUES(TRY_CONVERT(uniqueidentifier,@rule),N'discount_over_limit',N'global',N'',N'pin',N'["manager","admin"]',N'[]',N'{}',N'{}',N'{}',1,1,1);
    INSERT dbo.pos_store_settings(store_id,max_cashier_discount_percent,allow_offline_approvals,online_only_manual_discount) VALUES(N'',10,1,0),(@branch,NULL,NULL,NULL);`);
  const manager = { pool, sql: () => sql }, operations = new OperationsRepository(manager, registry), store = new OfflineApprovalStore(manager, operations);
  let epoch = 1;
  const captureScope = () => { const expected = epoch; return { branchId, terminalId: "terminal-a", requester, requesterId, epoch, assertCurrent: () => { assert.equal(epoch, expected, "Native fixture scope changed"); } }; };
  let verifications = 0;
  const service = () => new OfflineApprovalService({ captureScope, store, verify: async (username, pin, scope) => { verifications++; return verifySyncedApprovalPin(pool, username, pin, scope.branchId); } });
  const make = () => { const bill = `F-${randomUUID().replaceAll("-", "")}`; return { requestId: randomUUID(), actionKey: "discount_over_limit", registeredTerminalId: "terminal-a", branchId, username: "fixture-manager", credential, reason: "Synthetic manager review", requestedAmount: 20,
    snapshot: { ticketId: bill, billNo: bill, storeId: branchId, terminalId: "display-only", lines: [{ sku: "S1", qty: 1, unitPrice: 20, discount: 0, discountType: "amount", couponDiscount: 0, lineTotal: 20 }], subtotal: 20, discount: 4, tax: 0, serviceCharge: 0, total: 16, cartDiscount: 20, cartDiscountType: "percent", promoDiscount: 0 },
    payload: { bill_no: bill, discount_scope: "ticket", requested_discounts: JSON.stringify([{ index: -1, productId: "", name: "Bill", qty: 1, price: 0, type: "percent", value: 20, base: 20, requiresApproval: true }]) } }; };
  const totals = async id => (await pool.request().input("id", id).query("SELECT (SELECT COUNT(*) FROM dbo.authorization_log WHERE id=TRY_CONVERT(uniqueidentifier,@id)) audits,(SELECT COUNT(*) FROM dbo.sync_change_journal WHERE aggregate_id=TRY_CONVERT(uniqueidentifier,@id)) journal,(SELECT COUNT(*) FROM dbo.local_operation_receipts WHERE operation_id=TRY_CONVERT(uniqueidentifier,@id)) receipts;")).recordset[0];
  await guardTarget(); const s = service(), first = make(); assert.equal((await s.authorize(first)).ok, true); assert.deepEqual(await totals(first.requestId), { audits: 1, journal: 1, receipts: 1 }); pass("real SQL approval PIN plus nullable global/branch policy commits audit journal receipt once");
  const selectedPolicy = await store.readPolicy(captureScope(), author); assert.equal(String(selectedPolicy.requester.id).toLowerCase(), requesterId); pass("SQL policy reader admits the exact requester even with uppercase stored UUID branch");
  await pool.request().input("branch", branchId.toUpperCase()).query("UPDATE dbo.pos_store_settings SET allow_offline_approvals=0 WHERE store_id=@branch;"); await assert.rejects(service().authorize(make()), { code: "EAPPROVAL_POLICY" }); await pool.request().input("branch", branchId.toUpperCase()).query("UPDATE dbo.pos_store_settings SET allow_offline_approvals=NULL WHERE store_id=@branch;"); pass("uppercase UUID branch disable cannot fall back to permissive global settings");
  if (binary) {
    await pool.request().input("branch", branchId).query("INSERT dbo.pos_store_settings(store_id,allow_offline_approvals)VALUES(@branch,0);"); await assert.rejects(service().authorize(make()), { code: "EAPPROVAL_POLICY" });
    await pool.request().input("branch", branchId).query("DELETE dbo.pos_store_settings WHERE store_id COLLATE Latin1_General_100_BIN2=@branch COLLATE Latin1_General_100_BIN2;"); pass("valid BIN2 distinct textual UUID keys with conflicting settings are held as ambiguous");
  }
  const branchRule = randomUUID(); await pool.request().input("id", branchRule).input("branch", branchId.toUpperCase()).query("INSERT dbo.authorization_actions(id,action_key,scope_type,scope_id,mode,is_enabled)VALUES(TRY_CONVERT(uniqueidentifier,@id),N'discount_over_limit',N'branch',@branch,N'pin',0);"); await assert.rejects(service().authorize(make()), { code: "EAPPROVAL_POLICY" }); await pool.request().input("id", branchRule).query("DELETE dbo.authorization_actions WHERE id=TRY_CONVERT(uniqueidentifier,@id);"); pass("uppercase UUID branch-specific rule wins over global on the SQL seam");
  const foreignRule = randomUUID(); await pool.request().input("id", foreignRule).query("INSERT dbo.authorization_actions(id,action_key,scope_type,scope_id,mode,is_enabled)VALUES(TRY_CONVERT(uniqueidentifier,@id),N'discount_over_limit',N'global',N'foreign',N'pin',0);"); assert((await store.readPolicy(captureScope(), author)).rules.every(row => row.scope_id !== "foreign")); await pool.request().input("id", foreignRule).query("DELETE dbo.authorization_actions WHERE id=TRY_CONVERT(uniqueidentifier,@id);"); pass("foreign nonempty global-typed row cannot become this branch's baseline");
  const reader = new ChangeReader(manager, registry), table = registry.tables.find(t => t.cloudTable === "authorization_log"), entity = JSON.stringify({ id: first.requestId });
  assert((await reader.unacknowledged(table, [entity])).has(entity)); pass("actual ChangeReader finds canonical producer journal identity as pending");
  let applied = 0;
  const pull = new PullWorker({ connectionManager: manager, reader, registry, cloud: { applyLocalBatch: async () => { applied++; return { applied: 1 }; } } });
  await assert.rejects(pull.applyTable(null, table, [{ entity_id: entity, row_data: { id: first.requestId, outcome: "conflicting cloud row" } }], branchId), { code: "ELOCAL_UPLOAD_PENDING" }); assert.equal(applied, 0); pass("actual pull barrier cannot overwrite the unacknowledged approval audit");
  const batches = [], accepted = new Set(); let loseAck = true;
  const push = new PushWorker({ reader, registry, cloud: { terminalId: () => "terminal-a", pushAggregate: async body => {
    batches.push(body); accepted.add(body.batchId); if (loseAck) { loseAck = false; throw Object.assign(Error("Synthetic lost acknowledgement"), { code: "ETIMEDOUT" }); } return { ok: true };
  } }, checkpoints: {} });
  await assert.rejects(push.pushAggregates(branchId, 100), { code: "ETIMEDOUT" }); assert((await reader.unacknowledged(table, [entity])).has(entity));
  assert.equal(await push.pushAggregates(branchId, 100), 1); assert.equal(accepted.size, 1); assert.equal(batches.length, 2); assert.equal(batches[0].batchId, batches[1].batchId); assert.equal((await reader.unacknowledged(table, [entity])).size, 0);
  assert.equal(batches[0].operations[0].table, "authorization_log"); assert.equal(batches[0].operations[0].rows[0].requested_by, requester); pass("actual PushWorker retries identical audit snapshot and only acknowledged journal advances");
  const before = verifications; assert.equal((await s.authorize(first)).replayed, true); assert.equal(verifications, before); assert.deepEqual(await totals(first.requestId), { audits: 1, journal: 1, receipts: 1 }); pass("lost acknowledgement reuses frozen row without verifying credential twice");
  assert.equal((await service().authorize(first)).replayed, true); assert.equal(verifications, before + 1); pass("new Main instance re-verifies then matches actual SQL datetimeoffset audit receipt");
  await pool.request().batch("ALTER TABLE dbo.authorization_log ADD future_metadata bigint NULL;"); assert.equal((await service().authorize(first)).replayed, true); pass("unrelated future metadata is not mistaken for a changed fixed audit payload");
  await assert.rejects(s.authorize({ ...first, reason: "changed" }), { code: "EIDEMPOTENCY" }); pass("changed approval context cannot reuse accepted receipt");
  const bad = make(); await assert.rejects(service().authorize({ ...bad, credential: "invalid-fixture-pin" })); assert.deepEqual(await totals(bad.requestId), { audits: 0, journal: 0, receipts: 0 }); pass("wrong approval PIN leaves no approved audit or receipt");
  const foreign = make(); assert.throws(() => service().authorize({ ...foreign, branchId: "b" })); assert.deepEqual(await totals(foreign.requestId), { audits: 0, journal: 0, receipts: 0 }); pass("foreign registered branch cannot request this capability");
  const race = make(); await Promise.all([s.authorize(race), s.authorize(race)]); assert.deepEqual(await totals(race.requestId), { audits: 1, journal: 1, receipts: 1 }); pass("concurrent identical requests commit one durable graph");
  await pool.request().input("author", author).query("UPDATE dbo.app_users SET is_active=0 WHERE id=TRY_CONVERT(uniqueidentifier,@author);"); await assert.rejects(s.authorize(first)); pass("cached retry cannot ignore current approver deactivation"); await pool.request().input("author", author).query("UPDATE dbo.app_users SET is_active=1 WHERE id=TRY_CONVERT(uniqueidentifier,@author);");
  await pool.request().input("requester", requesterId).query("UPDATE dbo.app_users SET permissions=N'{}' WHERE id=TRY_CONVERT(uniqueidentifier,@requester);"); await assert.rejects(s.authorize(first), { code: "EPRIVILEGE" }); pass("cached Main session cannot ignore requester permission revocation synced to SQL"); await pool.request().input("requester", requesterId).query("UPDATE dbo.app_users SET permissions=N'{\"can_process_sale\":true}' WHERE id=TRY_CONVERT(uniqueidentifier,@requester);");
  const rollback = make(); await pool.request().batch("CREATE TRIGGER dbo.fixture_reject_approval ON dbo.local_operation_receipts AFTER INSERT AS THROW 51000,'Fixture receipt failure',1;"); await assert.rejects(service().authorize(rollback)); assert.deepEqual(await totals(rollback.requestId), { audits: 0, journal: 0, receipts: 0 }); await pool.request().batch("DROP TRIGGER dbo.fixture_reject_approval;"); pass("receipt failure rolls back audit and pending journal together");
  await pool.request().input("id", first.requestId).query("UPDATE dbo.authorization_log SET outcome=N'tampered' WHERE id=TRY_CONVERT(uniqueidentifier,@id);"); await assert.rejects(s.authorize(first), { code: "EIDEMPOTENCY" }); await assert.rejects(service().authorize(first), { code: "EIDEMPOTENCY" }); pass("cached and restarted replay reject audit receipt mismatch");
  console.log(`PASS ${count} actual offline approval SQL groups`);
} finally {
  if (pool) { if (created && guid) await guardTarget(); await pool.close(); }
  if (created && guid) { const current = (await master.request().input("name", database).query("SELECT CONVERT(varchar(36),database_guid) guid FROM sys.database_recovery_status WHERE database_id=DB_ID(@name);")).recordset[0]; assert.equal(current?.guid, guid);
    // ODBC may retain our own idle physical connections after pool.close(). This
    // is only the private instance/new database already checked by GUID+owner.
    await master.request().batch(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE [${database}];`); }
  await master?.close(); if (owned) { control("stop", instance, "-k"); control("delete", instance); } console.log("Cleaned only the uniquely owned offline approval fixture");
} })().catch(error => { console.error(error.message); process.exitCode = 1; });
