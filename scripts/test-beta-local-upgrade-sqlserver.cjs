"use strict";
// Only uniquely owned LocalDB fixtures. No configured POS connection arguments.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const { createOwnedUpgradeFixture } = require("./lib/owned-upgrade-fixture.cjs");
const { packageLocal, manifestPath } = require("./lib/beta-local-upgrade.cjs");
const { validationSql } = require("./lib/local-upgrade-catalogue.cjs");
let passed = 0;
async function check(name, work) { await work(); passed++; console.log("PASS " + name); }
function preserved(actual, expected) {
  const { digest } = require("./lib/existing-local-upgrade.cjs");
  assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort(),"Snapshot table set changed");
  for(const key of Object.keys(expected)) assert.equal(digest(actual[key]),digest(expected[key]),"Preservation changed: "+key);
}
async function snapshot(f) {
  const tables = ["products", "sales", "sale_items", "stores", "sync_checkpoints", "UpgradeTestSentinel",
    "pos_sync_sale_outbox_v1", "pos_store_settings_edit_commands"];
  const result = {};
  for (const table of tables) {
    const exists = (await f.pool.request().input("name", table).query("SELECT OBJECT_ID(N'dbo.'+@name,N'U') id;")).recordset[0].id;
    if (exists) result[table] = (await f.pool.request().query(`SELECT * FROM dbo.[${table}] FOR JSON PATH,INCLUDE_NULL_VALUES;`)).recordset.map(r => Object.values(r)[0]).join("");
  }
  result.permissions = (await f.pool.request().query("SELECT state,permission_name,USER_NAME(grantee_principal_id) grantee,OBJECT_SCHEMA_NAME(major_id) object_schema,OBJECT_NAME(major_id) object_name,minor_id FROM sys.database_permissions ORDER BY grantee,class,major_id,minor_id,permission_name FOR JSON PATH,INCLUDE_NULL_VALUES;")).recordset.map(r => Object.values(r)[0]).join("");
  return result;
}
async function seed(f) {
  const store = "BETA-UPGRADE-FIXTURE", product = randomUUID(), sale = randomUUID();
  await f.pool.request().input("store", store).input("product", f.sql.UniqueIdentifier, product).input("sale", f.sql.UniqueIdentifier, sale).batch(`
    INSERT dbo.stores(id,code,name) VALUES(@store,N'BUP',N'Synthetic beta upgrade');
    INSERT dbo.products(id,barcode,name,cost_price,selling_price,stock_quantity,stock_by_store,row_version)
      VALUES(@product,N'BUP-001',N'Synthetic pending product',12.345678901234,24.99,7,N'{"BETA-UPGRADE-FIXTURE":7}',17);
    INSERT dbo.sales(id,bill_number,total_amount,store_id,created_at,row_version) VALUES(@sale,N'BUP-SALE',24.99,@store,'2026-11-01T10:12:13.1234567+08:00',23);
    INSERT dbo.sale_items(id,sale_id,product_id,product_name,unit_price,quantity,unit_cost) VALUES(NEWID(),@sale,@product,N'Synthetic pending product',24.99,1,12.345678901234);
    CREATE TABLE dbo.UpgradeTestSentinel(id int PRIMARY KEY,payload nvarchar(100)); INSERT dbo.UpgradeTestSentinel VALUES(1,N'preserve');
    CREATE ROLE UpgradeTestReader; GRANT SELECT ON dbo.products TO UpgradeTestReader;`);
  const { CheckpointRepository } = require("../electron/sync/checkpoints.cjs");
  await new CheckpointRepository(f.manager).save(store, "products", "push", { change_tracking_version: 1 });
  return { store, product, sale };
}
async function seedPending(f, seed) {
  await f.pool.request().input("operation", f.sql.UniqueIdentifier, randomUUID()).input("sale", f.sql.UniqueIdentifier, seed.sale)
    .input("shift", f.sql.UniqueIdentifier, randomUUID()).input("terminal", f.sql.UniqueIdentifier, randomUUID()).batch(`
    INSERT dbo.pos_sync_sale_outbox_v1(operation_id,branch_id,terminal_id,shift_id,sale_id,payload_json,payload_hash)
      VALUES(@operation,N'BETA-UPGRADE-FIXTURE',CONVERT(nvarchar(128),@terminal),@shift,@sale,N'{"pending":true}',REPLICATE('a',64));
    INSERT dbo.pos_store_settings_edit_commands(operation_id,branch_id,terminal_id,command_json,command_sha256)
      VALUES(NEWID(),N'BETA-UPGRADE-FIXTURE',@terminal,N'{"pending":true}',REPLICATE('b',64));`);
}
async function main() {
  assert(["--run","--foreign-key","--fresh"].includes(process.argv[2])&&process.argv.length===3,"Use --run, --foreign-key or --fresh; no connection arguments");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if(process.argv[2]==="--fresh"){
    const {packageFreshLocal}=require("./lib/beta-local-fresh.cjs"),f=await createOwnedUpgradeFixture();
    try{
      await check("fresh beta package rejects the wrong database before creating core",async()=>{
        await assert.rejects(f.pool.request().batch(packageFreshLocal().sql),/exact empty isolated beta database/);
        assert.equal((await f.pool.request().query("SELECT COUNT(*) n FROM sys.tables WHERE is_ms_shipped=0")).recordset[0].n,0);
      });
      await check("fresh core gains every current sync metadata module",async()=>{
        await f.pool.request().batch(packageFreshLocal(f.database).sql);
        for(const module of manifest.modules) await f.pool.request().batch(validationSql(module.shape,module.id));
      });
      const seeded=await seed(f);await seedPending(f,seeded);const before=await snapshot(f);
      await check("fresh rerun refuses populated beta without changing saved data or pending work",async()=>{
        await assert.rejects(f.pool.request().batch(packageFreshLocal(f.database).sql),/Fresh setup requires an empty database/);
        preserved(await snapshot(f),before);
      });
    }finally{await f.close();}
    console.log(JSON.stringify({passed,productionConnections:0}));return;
  }
  if(process.argv[2]==="--foreign-key"){
    const f=await createOwnedUpgradeFixture();
    const quote=name=>"["+name.replaceAll("]","]]")+"]";
    try{
      await f.installCore();const seeded=await seed(f),artifact=packageLocal(manifest,f.database).sql;
      await f.pool.request().batch(artifact);await seedPending(f,seeded);const before=await snapshot(f);
      const foreignName=async()=>{
        const rows=(await f.pool.request().query("SELECT name FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.pos_store_settings_edit_receipts');")).recordset;
        assert.equal(rows.length,1);return quote(rows[0].name);
      };
      await f.pool.request().batch("CREATE TABLE dbo.UpgradeAlternateCommands(operation_id uniqueidentifier PRIMARY KEY);ALTER TABLE dbo.pos_store_settings_edit_receipts DROP CONSTRAINT "+await foreignName()+";ALTER TABLE dbo.pos_store_settings_edit_receipts ADD FOREIGN KEY(operation_id) REFERENCES dbo.UpgradeAlternateCommands(operation_id);");
      await check("generated-name normalization still rejects a different FK parent",async()=>{
        await assert.rejects(f.pool.request().batch(artifact),/Unrecognized/);preserved(await snapshot(f),before);
      });
      await f.pool.request().batch("ALTER TABLE dbo.pos_store_settings_edit_receipts DROP CONSTRAINT "+await foreignName()+";ALTER TABLE dbo.pos_store_settings_edit_receipts ADD FOREIGN KEY(operation_id) REFERENCES dbo.pos_store_settings_edit_commands(operation_id);DROP TABLE dbo.UpgradeAlternateCommands;");
      await check("correct auto-named FK with a new generated suffix remains recognized",async()=>{
        await f.pool.request().batch(artifact);preserved(await snapshot(f),before);
      });
    }finally{await f.close();}
    console.log(JSON.stringify({passed,productionConnections:0}));return;
  }
  for (const collation of ["SQL_Latin1_General_CP1_CI_AS", "Latin1_General_100_BIN2"]) {
    const f = await createOwnedUpgradeFixture({ collation });
    try {
      await f.installCore(); const seeded = await seed(f), before = await snapshot(f);
      const artifact = packageLocal(manifest, f.database).sql;
      await check("actual beta artifact rejects another database (" + collation + ")", async () => {
        await assert.rejects(f.pool.request().batch(packageLocal(manifest).sql), /exact isolated beta database/);
        preserved(await snapshot(f), before);
      });
      await check("caller transaction survives rejection before target checks (" + collation + ")", async () => {
        const tx=new f.sql.Transaction(f.pool);await tx.begin();
        try {
          await new f.sql.Request(tx).batch("SET XACT_ABORT ON;INSERT dbo.UpgradeTestSentinel VALUES(2,N'caller work');");
          await assert.rejects(new f.sql.Request(tx).batch(packageLocal(manifest).sql),/outside an existing transaction/);
          assert.deepEqual((await new f.sql.Request(tx).query("SELECT XACT_STATE() state,@@TRANCOUNT depth,(SELECT COUNT(*) FROM dbo.UpgradeTestSentinel WHERE id=2) retained;")).recordset[0],{state:1,depth:1,retained:1});
        } finally { await tx.rollback(); }
      });
      await check("late partial metadata refuses and rolls back all earlier modules (" + collation + ")", async () => {
        await f.pool.request().query("CREATE TABLE dbo.pos_store_settings_edit_commands(operation_id uniqueidentifier PRIMARY KEY);");
        const partial=await snapshot(f);
        await assert.rejects(f.pool.request().batch(artifact), /Unrecognized/);
        assert.equal((await f.pool.request().query("SELECT OBJECT_ID(N'dbo.pos_sync_sale_outbox_v1') id;")).recordset[0].id, null);
        preserved(await snapshot(f), partial);
        await f.pool.request().query("DROP TABLE dbo.pos_store_settings_edit_commands;");
      });
      await check("late failure rolls back complete composed update (" + collation + ")", async () => {
        const needle = "\n COMMIT TRANSACTION;\n SELECT";
        assert.equal(artifact.split(needle).length, 2);
        const faulty = artifact.replace(needle, "\n THROW 51099,'Synthetic late rollback',1;" + needle);
        await assert.rejects(f.pool.request().batch(faulty), /Synthetic late rollback/);
        assert.equal((await f.pool.request().query("SELECT OBJECT_ID(N'dbo.pos_sync_sale_outbox_v1') id;")).recordset[0].id, null);
        preserved(await snapshot(f), before);
      });
      await check("current core gains all event/stock/refund/settings/recovery storage (" + collation + ")", async () => {
        await f.pool.request().batch(artifact);
        for (const module of manifest.modules) await f.pool.request().batch(validationSql(module.shape, module.id));
        const after = await snapshot(f); delete after.pos_sync_sale_outbox_v1; delete after.pos_store_settings_edit_commands;
        preserved(after, before);
      });
      await seedPending(f, seeded); const pending = await snapshot(f);
      await check("rerun retains business data, grants, checkpoints and unsent event commands (" + collation + ")", async () => {
        await f.pool.request().batch(artifact); preserved(await snapshot(f), pending);
      });
      await check("changed stock proof shape is held without rewriting pending work (" + collation + ")", async () => {
        await f.pool.request().query("ALTER TABLE dbo.pos_sync_grouped_stock_v1 ADD unreviewed_column int NULL;");
        try { await assert.rejects(f.pool.request().batch(artifact), /Unrecognized/); preserved(await snapshot(f), pending); }
        finally { await f.pool.request().query("ALTER TABLE dbo.pos_sync_grouped_stock_v1 DROP COLUMN unreviewed_column;"); }
      });
    } finally { await f.close(); }
  }
  console.log(JSON.stringify({ passed, productionConnections: 0 }));
}
if (require.main === module) main().catch(error => { console.error(error.message); for (const e of error.precedingErrors ?? []) console.error(e.message); process.exitCode = 1; });
