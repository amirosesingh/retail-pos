"use strict";
// Full actual-core acceptance ONLY in uniquely owned disposable LocalDB.
const assert = require("node:assert/strict"), fs = require("node:fs"), { randomUUID } = require("node:crypto");
const { createOwnedUpgradeFixture } = require("./lib/owned-upgrade-fixture.cjs");
const { packageRecoveryMetadata } = require("./package-recovery-metadata.cjs");
const { packageUpgrade } = require("./package-existing-local-upgrade.cjs");
const { digest } = require("./lib/existing-local-upgrade.cjs");
assert.deepEqual(process.argv.slice(2), ["--run"], "Only --run; no operator connection argument is accepted");
const built = packageRecoveryMetadata(), tables = built.manifest.modules.flatMap(module => module.tables);
const q = name => { assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)); return "[" + name + "]"; };
let passed = 0;
async function test(name, run) { const at = Date.now(); await run(); passed++; console.log("PASS " + name + " (" + (Date.now() - at) + "ms)"); }
async function probe(f, parent = f.pool) { const result = await parent.request().batch(built.probe); assert.equal(result.recordsets.length, 1); assert.equal(result.recordset.length, 1); return result.recordset[0]; }
async function install(f, observed, sql = built.installer, parent = f.pool) {
  return parent.request().input("expectedDatabaseGuid", f.sql.UniqueIdentifier, observed.database_guid)
    .input("expectedSchemaFingerprint", f.sql.VarChar(64), observed.schema_fingerprint).batch(sql);
}
async function absent(f) { return (await f.pool.request().query("SELECT name FROM sys.tables WHERE name IN('" + tables.join("','") + "');")).recordset.length === 0; }
async function reset(f) { for (const table of [...tables].reverse()) await f.pool.request().batch(`IF OBJECT_ID(N'dbo.${table}',N'U') IS NOT NULL DROP TABLE dbo.${q(table)};`); }
async function snapshot(f, names) {
  const result = {};
  for (const name of names) {
    const columns = (await f.pool.request().input("name", name).query("SELECT name FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.'+@name) ORDER BY column_id;")).recordset.map(row => q(row.name)).join(",");
    const keys = (await f.pool.request().input("name", name).query("SELECT c.name FROM sys.indexes i JOIN sys.index_columns k ON k.object_id=i.object_id AND k.index_id=i.index_id JOIN sys.columns c ON c.object_id=k.object_id AND c.column_id=k.column_id WHERE i.object_id=OBJECT_ID(N'dbo.'+@name) AND i.is_primary_key=1 ORDER BY k.key_ordinal;")).recordset.map(row => q(row.name));
    result[name] = (await f.pool.request().query(`SELECT ${columns} FROM dbo.${q(name)}${keys.length ? " ORDER BY " + keys.join(",") : ""} FOR JSON PATH,INCLUDE_NULL_VALUES;`)).recordset.map(row => Object.values(row)[0]).join("");
  }
  result.permissions = (await f.pool.request().query("SELECT class,major_id,minor_id,state,permission_name,grantee_principal_id,grantor_principal_id FROM sys.database_permissions ORDER BY class,major_id,minor_id,state,permission_name,grantee_principal_id,grantor_principal_id FOR JSON PATH,INCLUDE_NULL_VALUES;")).recordset.map(row => Object.values(row)[0]).join("");
  result.ct = (await f.pool.request().query("SELECT CONVERT(varchar(40),CHANGE_TRACKING_CURRENT_VERSION()) version;")).recordset[0].version;
  return result;
}
async function memberStatusDefault(f) {
  return (await f.pool.request().query(
    "SELECT dc.name,dc.definition FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id WHERE dc.parent_object_id=OBJECT_ID(N'dbo.members') AND c.name=N'membership_status';",
  )).recordset[0];
}
async function setMemberStatusDefault(f, expression, name = "DF_members_membership_status") {
  const current = await memberStatusDefault(f);
  await f.pool.request().batch("ALTER TABLE dbo.members DROP CONSTRAINT " + q(current.name) +
    "; ALTER TABLE dbo.members ADD CONSTRAINT " + q(name) + " DEFAULT " + expression + " FOR membership_status;");
}
async function seed(f) {
  await f.pool.request().input("product", f.sql.UniqueIdentifier, randomUUID()).input("sale", f.sql.UniqueIdentifier, randomUUID()).batch(`
    INSERT dbo.stores(id,code,name) VALUES(N'RECOVERY-FIXTURE',N'RF',N'Owned recovery fixture');
    INSERT dbo.members(member_code,full_name,phone) VALUES(N'RF-SYNTHETIC-MEMBER',N'Owned fixture member',N'000000000');
    INSERT dbo.products(id,barcode,name,cost_price,selling_price,stock_quantity,stock_by_store,row_version) VALUES(@product,N'RF-PRODUCT',N'Synthetic existing stock',12.345678901234,24.99,7,N'{"RECOVERY-FIXTURE":7}',17);
    INSERT dbo.sales(id,bill_number,total_amount,store_id,created_at,row_version) VALUES(@sale,N'RF-SALE',24.99,N'RECOVERY-FIXTURE','2026-11-05T10:12:13.1234567+08:00',23);
    INSERT dbo.shifts(id,store_id,terminal_id,status,state,opened_at,closed_at,opening_float,counted_cash,expected_cash,row_version)
      VALUES(NEWID(),N'RECOVERY-FIXTURE',N'OWNED-TILL','CLOSED','CLOSED','2026-11-05T08:00:00.1234567+08:00','2026-11-05T18:00:00.7654321+08:00',100,124.99,124.99,2147483647);
    INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id,retry_count,last_error)
      VALUES(N'sales',N'{"id":"'+CONVERT(nvarchar(36),@sale)+N'"}',N'insert',N'RECOVERY-FIXTURE',23,NEWID(),3,N'Original pending sale; never acknowledged'),
      (N'products',N'{"id":"'+CONVERT(nvarchar(36),@product)+N'"}',N'update',N'RECOVERY-FIXTURE',17,NEWID(),0,NULL);
    INSERT dbo.pos_store_settings(store_id,allow_multiple_shifts_per_terminal) VALUES(N'RECOVERY-FIXTURE',0);
    CREATE TABLE dbo.RecoveryFixtureSentinel(id int PRIMARY KEY,payload nvarchar(200));INSERT dbo.RecoveryFixtureSentinel VALUES(1,N'Existing shift, sale, stock, settings, journal and grants stay intact');
    CREATE ROLE RecoveryFixtureReader;GRANT SELECT ON dbo.products TO RecoveryFixtureReader;`);
  // Two explicit unacknowledged fixture operations and a saved closing survive;
  // no fake ACKs, recovery signatures or reset are made by the artifact.
  const { CheckpointRepository } = require("../electron/sync/checkpoints.cjs");
  await new CheckpointRepository(f.manager).save("RECOVERY-FIXTURE", "products", "push", { change_tracking_version: 1 });
}
async function seedRecovery(f) {
  await f.pool.request().input("guid", f.sql.UniqueIdentifier, f.guid).input("recovery", f.sql.UniqueIdentifier, randomUUID()).input("decision", f.sql.UniqueIdentifier, randomUUID()).batch(`
    DECLARE @shift uniqueidentifier=NEWID();
    INSERT dbo.pos_shift_recovery_evidence VALUES(REPLICATE('a',64),'retail.shift-recovery','retained-graph-v1',1,@guid,N'RECOVERY-FIXTURE',N'OWNED-TILL',REPLICATE('b',64),@shift,NEWID(),REPLICATE('c',64),REPLICATE('d',64),N'{"synthetic":"local before-image 你好","value":"9007199254740993"}',N'{"synthetic":"cloud before-image","at":"2026-11-05T10:12:13.1234567+08:00"}','competing-closings-needs-review','OWNED_FIXTURE_ONLY','2026-11-05T10:12:13.1234567+08:00');
    INSERT dbo.pos_sync_shift_legacy_recoveries VALUES(@recovery,REPLICATE('a',64),@guid,N'RECOVERY-FIXTURE',N'OWNED-TILL',REPLICATE('b',64),@shift,NEWID(),NEWID(),REPLICATE('e',64),N'{"synthetic":"not a real approved recovery"}',N'{"synthetic":"not a signature"}','2026-11-05T10:12:13.1234567+08:00');
    INSERT dbo.pos_sync_shift_legacy_recovery_receipts VALUES(@recovery,N'{"synthetic":"not a real acceptance"}',REPLICATE('f',64),'2026-11-05T10:12:13.1234567+08:00');
    INSERT dbo.pos_shift_recovery_adoptions VALUES(@decision,REPLICATE('a',64),@guid,N'RECOVERY-FIXTURE',N'OWNED-TILL',REPLICATE('b',64),@shift,'ADMIN_ACCEPTED_CLOUD',NEWID(),N'owned synthetic Administrator',N'Fixture retention only',REPLICATE('c',64),REPLICATE('d',64),REPLICATE('e',64),N'{"synthetic":"no projection write"}',9007199254740993,REPLICATE('f',64),NULL,NULL,'2026-11-05T10:12:13.1234567+08:00');`);
}
async function main() {
  for (const collation of ["SQL_Latin1_General_CP1_CI_AS", "Latin1_General_100_BIN2"]) {
    const f = await createOwnedUpgradeFixture({ collation });
    try {
      await f.installCore(); await seed(f);
      const names = (await f.pool.request().query("SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID('dbo') ORDER BY name;")).recordset.map(row => row.name);
      const before = await snapshot(f, names), original = await probe(f);
      await test(collation + " read-only exact core classifies absent metadata without effects", async () => {
        assert.equal(original.contract, built.manifest.format); assert.equal(original.core_state, "supported"); assert.equal(original.metadata_state, "absent"); assert.equal(original.prefix, 0);
        assert.equal(original.database_guid, f.guid.toLowerCase()); assert.equal(original.schema_fingerprint, built.manifest.prefixes[0].schemaFingerprint);
        assert.equal(original.transaction_count, 0); assert([0, 1].includes(original.transaction_state)); assert.equal(original.implicit_transactions, 0);
        assert.deepEqual(await snapshot(f, names), before); assert(await absent(f));
      });
      await test("wrong GUID and changed observed fingerprint refuse before DDL", async () => {
        await assert.rejects(install(f, { ...original, database_guid: randomUUID() }), /target or schema changed/);
        await assert.rejects(install(f, { ...original, schema_fingerprint: "F".repeat(64) }), /target or schema changed/);
        assert(await absent(f)); assert.deepEqual(await snapshot(f, names), before);
      });
      await test("caller transaction stays owned and untouched on rejection", async () => {
        const tx = new f.sql.Transaction(f.pool); await tx.begin();
        try {
          await new f.sql.Request(tx).query("SET XACT_ABORT ON;INSERT dbo.RecoveryFixtureSentinel VALUES(2,N'Uncommitted caller work');");
          const parent = { request: () => new f.sql.Request(tx) };
          for (const value of [original, { ...original, database_guid: null }, { ...original, schema_fingerprint: null }, { ...original, schema_fingerprint: "bad" }]) {
            await assert.rejects(install(f, value, built.installer, parent), /outside an existing transaction/);
            assert.deepEqual((await new f.sql.Request(tx).query("SELECT @@TRANCOUNT depth,XACT_STATE() state,(SELECT COUNT(*) FROM dbo.RecoveryFixtureSentinel WHERE id=2) retained;")).recordset[0], { depth: 1, state: 1, retained: 1 });
          }
          await new f.sql.Request(tx).batch("SET IMPLICIT_TRANSACTIONS ON;");
          try {
            await assert.rejects(install(f, { ...original, database_guid: null }, built.installer, parent), /outside an existing transaction/);
            assert.deepEqual((await new f.sql.Request(tx).query("SELECT @@TRANCOUNT depth,XACT_STATE() state,(SELECT COUNT(*) FROM dbo.RecoveryFixtureSentinel WHERE id=2) retained;")).recordset[0], { depth: 1, state: 1, retained: 1 });
          } finally { await new f.sql.Request(tx).batch("SET IMPLICIT_TRANSACTIONS OFF;"); }
        } finally { await tx.rollback(); }
        assert(await absent(f)); assert.deepEqual(await snapshot(f, names), before);
      });
      await test("implicit-transaction session refuses before any metadata DDL", async () => {
        const connectionString = f.pool.config.connectionString;
        assert(typeof connectionString === "string" && connectionString.includes("Database=" + f.database + ";") && connectionString.includes("LOCALDB#"), "Refuse a non-fixture implicit-session connection");
        const dedicated = await new f.sql.ConnectionPool({ connectionString, pool: { min: 0, max: 1 }, requestTimeout: 60000 }).connect();
        try {
          await dedicated.request().batch("SET IMPLICIT_TRANSACTIONS ON;");
          await assert.rejects(install(f, original, built.installer, dedicated), /without implicit transactions/);
        } finally { await dedicated.request().batch("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;SET IMPLICIT_TRANSACTIONS OFF;"); await dedicated.close(); }
        assert(await absent(f)); assert.deepEqual(await snapshot(f, names), before);
      });
      await test("late module failure rolls back all four new tables", async () => {
        const failing = built.installer.replace(" COMMIT TRANSACTION;\n EXEC", " THROW 51028,'Owned late failure',1;\n COMMIT TRANSACTION;\n EXEC");
        assert.notEqual(failing, built.installer); await assert.rejects(install(f, original, failing), /Owned late failure/);
        assert(await absent(f)); assert.deepEqual(await snapshot(f, names), before);
      });
      await test("exact absent installation commits only four empty recovery tables", async () => {
        const result = await install(f, original); assert.equal(result.recordset[0].metadata_state, "matching");
        for (const name of tables) assert.equal((await f.pool.request().query(`SELECT COUNT(*) n FROM dbo.${q(name)};`)).recordset[0].n, 0);
        const afterNames = (await f.pool.request().query("SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID('dbo') ORDER BY name;")).recordset.map(row => row.name);
        assert.deepEqual(afterNames.filter(name => !names.includes(name)).sort(), [...tables].sort());
        assert.deepEqual(await snapshot(f, names), before); assert.equal((await probe(f)).prefix, 3);
      });
      await test("crash-after-commit exact retry is a schema and data no-op", async () => {
        await seedRecovery(f);
        const observed = await probe(f), all = [...names, ...tables], beforeRetry = await snapshot(f, all);
        await install(f, observed); assert.deepEqual(await snapshot(f, all), beforeRetry);
        await assert.rejects(install(f, original), /target or schema changed/); assert.deepEqual(await snapshot(f, all), beforeRetry);
        for (const table of tables) {
          await assert.rejects(f.pool.request().query(`DELETE FROM dbo.${q(table)};`), /append-only/);
          assert.deepEqual(await snapshot(f, all), beforeRetry);
        }
      });
      await test("altered append-only trigger and unknown owner both fail closed", async () => {
        await f.pool.request().batch("DISABLE TRIGGER dbo.TR_legacy_recovery_event_immutable ON dbo.pos_sync_shift_legacy_recoveries;");
        assert.equal((await probe(f)).metadata_state, "unknown"); await assert.rejects(install(f, original));
        await f.pool.request().batch("ENABLE TRIGGER dbo.TR_legacy_recovery_event_immutable ON dbo.pos_sync_shift_legacy_recoveries;EXEC sys.sp_updateextendedproperty @name=N'RetailRecoveryOwner',@value=N'unknown',@level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'TABLE',@level1name=N'pos_shift_recovery_adoptions';");
        assert.equal((await probe(f)).metadata_state, "unknown"); await assert.rejects(install(f, original));
        assert.deepEqual(await snapshot(f, names), before);
      });
      await reset(f);
      await test("bounded metadata lock refuses a concurrent upgrader without touching business work", async () => {
        const blocker = await f.connect(f.database), tx = new f.sql.Transaction(blocker); await tx.begin();
        try {
          await new f.sql.Request(tx).batch("DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=N'RetailExistingMetadataUpgrade',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=0;IF @r<0 THROW 51028,'Owned lock fixture failed',1;");
          const at = Date.now(); await assert.rejects(install(f, await probe(f)), /Another database update is running/);
          assert(Date.now() - at < 15000, "Application lock exceeded its bounded wait");
          assert(await absent(f)); assert.deepEqual(await snapshot(f, names), before);
        } finally { await tx.rollback(); await blocker.close(); }
      });
      for (const prefix of [1, 2]) {
        for (const module of built.modules.slice(0, prefix)) await f.pool.request().batch(module.sql);
        await test("known whole-module prefix" + prefix + " resumes without rewriting installed objects", async () => {
          const observed = await probe(f); assert.equal(observed.metadata_state, "prefix"); assert.equal(observed.prefix, prefix);
          const ids = (await f.pool.request().query("SELECT name,object_id FROM sys.tables WHERE name IN('" + built.modules.slice(0, prefix).flatMap(module => module.selectors.tables).join("','") + "') ORDER BY name;")).recordset;
          await install(f, observed); assert.equal((await probe(f)).metadata_state, "matching");
          assert.deepEqual((await f.pool.request().query("SELECT name,object_id FROM sys.tables WHERE name IN('" + ids.map(row => row.name).join("','") + "') ORDER BY name;")).recordset, ids);
          assert.deepEqual(await snapshot(f, names), before);
        });
        await reset(f);
      }
      await test("partial individual module and out-of-order complete module are unknown", async () => {
        await f.pool.request().batch("CREATE TABLE dbo.pos_sync_shift_legacy_recoveries(id int);");
        assert.equal((await probe(f)).metadata_state, "unknown"); await assert.rejects(install(f, original)); await reset(f);
        await f.pool.request().batch(built.modules[0].sql); await f.pool.request().batch(built.modules[2].sql);
        assert.equal((await probe(f)).metadata_state, "unknown"); await assert.rejects(install(f, original)); await reset(f);
        assert.deepEqual(await snapshot(f, names), before);
      });
      await test("changed core and future ledger version are unsupported without repair", async () => {
        await f.pool.request().batch("ALTER TABLE dbo.products ADD recovery_unknown int NULL;");
        assert.equal((await probe(f)).core_state, "unknown"); await assert.rejects(install(f, original));
        await f.pool.request().batch("ALTER TABLE dbo.products DROP COLUMN recovery_unknown;INSERT dbo.pos_schema_migrations(version,name) VALUES(25,N'Unknown future fixture migration');");
        assert.equal((await probe(f)).core_state, "unknown"); await assert.rejects(install(f, original));
        await f.pool.request().query("DELETE dbo.pos_schema_migrations WHERE version=25;");
        assert(await absent(f)); assert.deepEqual(await snapshot(f, names), before);
      });
      await test("unchanged manual025-030 installation followed by automatic exact no-op", async () => {
        await f.pool.request().batch(packageUpgrade().sql); const observed = await probe(f); assert.equal(observed.metadata_state, "matching");
        const all = (await f.pool.request().query("SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID('dbo') ORDER BY name;")).recordset.map(row => row.name), saved = await snapshot(f, all);
        await install(f, observed); assert.deepEqual(await snapshot(f, all), saved);
      });
      await reset(f);
      await test(collation + " exact legacy membership default admits recovery without altering it", async () => {
        await setMemberStatusDefault(f, "('active')");
        const exactDefault = { name: "DF_members_membership_status", definition: "('active')" };
        assert.deepEqual(await memberStatusDefault(f), exactDefault);
        const legacyBefore = await snapshot(f, names);
        await assert.rejects(f.pool.request().batch(packageUpgrade().sql), /Unrecognized Retail schema24 columns/);
        assert(await absent(f));
        const observed = await probe(f);
        assert.equal(observed.core_state, "supported");
        assert.equal(observed.schema_fingerprint, original.schema_fingerprint);
        await install(f, observed);
        const matching = await probe(f);
        assert.equal(matching.metadata_state, "matching");
        await install(f, matching);
        assert.deepEqual(await memberStatusDefault(f), exactDefault);
        assert.deepEqual(await snapshot(f, names), legacyBefore);
      });
      await reset(f);
      await test("other membership defaults and constraint names still reject all recovery DDL", async () => {
        for (const [expression, name] of [
          ["('ACTIVE')", "DF_members_membership_status"],
          ["(N'inactive')", "DF_members_membership_status"],
          ["('active ')", "DF_members_membership_status"],
          ["('active')", "DF_recovery_fixture_other_member_status"],
        ]) {
          await setMemberStatusDefault(f, expression, name);
          const changed = await snapshot(f, names);
          assert.equal((await probe(f)).core_state, "unknown");
          await assert.rejects(install(f, original), error => [51028, 3930].includes(error.number));
          assert(await absent(f)); assert.deepEqual(await snapshot(f, names), changed);
        }
      });
    } finally { await f.close(); }
  }
  assert.equal(digest(fs.readFileSync("database/sqlserver/retail-pos-existing-upgrade-1.4.82.sql")), built.manifest.manualUpgrade.sha256);
  console.log(`PASS ${passed} actual recovery-only upgrade groups; only owned fixture databases used.`);
}
main().catch(error => { console.error(error); for (const item of error.precedingErrors ?? []) console.error(item.message); process.exitCode = 1; });
