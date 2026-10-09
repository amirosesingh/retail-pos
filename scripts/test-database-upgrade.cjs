const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {installerSections,migrationBundleSql,splitBatches,TARGET_GUARD}=require('../electron/db/installer-source.cjs');
const {applyMigrations}=require('../electron/db/migrations.cjs');
const {stripTypeScriptTypes}=require('node:module');
const gapSource=stripTypeScriptTypes(readFileSync('src/lib/schema-health.ts','utf8')).replace(/^import .*;\s*$/gm,'').replace(/\bexport /g,'');
const {buildLocalSql,buildCloudSql}=new Function(`${gapSource}\nreturn {buildLocalSql,buildCloudSql};`)();

test('legacy gap exports refuse unknown column types and incomplete table repairs',()=>{
  const gap={environment:'local',table:'members',columns:['is_verified'],missingTable:false};
  assert.throws(()=>buildLocalSql([gap],'local.sql'),/No verified local type/);
  assert.throws(()=>buildCloudSql([{...gap,environment:'cloud'}],'cloud.sql'),/No verified cloud type/);
  assert.throws(()=>buildLocalSql([{...gap,missingTable:true}],'local.sql'),/latest database update/);
  assert.throws(()=>buildCloudSql([{...gap,missingTable:true}],'cloud.sql'),/reviewed POS migrations/);
});

test('typed repairs are transactional and never guess verification columns as text',()=>{
  const sql=buildLocalSql([{environment:'local',table:'members',columns:['is_verified','verified_at'],types:{is_verified:'bit',verified_at:'datetimeoffset(7)'},missingTable:false}],'local.sql');
  assert.match(sql,/ADD \[is_verified\] bit NULL/);assert.match(sql,/ADD \[verified_at\] datetimeoffset\(7\) NULL/);
  assert.ok(sql.indexOf('BEGIN TRANSACTION')<sql.indexOf('ALTER TABLE'));
  assert.match(sql,/ROLLBACK TRANSACTION/);
  const cloud=buildCloudSql([{environment:'cloud',table:'members',columns:['is_verified'],types:{is_verified:'boolean'},missingTable:false}],'cloud.sql');
  assert.ok(cloud.indexOf('begin;')<cloud.indexOf('create table'));
  assert.match(cloud,/commit;/);
});

test('canonical installer matches the current generated schema and every migration',()=>{
  const sections=installerSections();
  assert.equal(sections.schema.replace(/^-- SECTION 1:[^\n]*\n/,'').replaceAll('\r\n','\n').trim(),readFileSync('database/sqlserver/schema.sql','utf8').replaceAll('\r\n','\n').trim());
  for(const migration of sections.migrations)
    assert.equal(migration.sql.replaceAll('\r\n','\n'),readFileSync(`database/sqlserver/migrations/${migration.name}`,'utf8').replaceAll('\r\n','\n').trim());
  assert.match(sections.validation,/required_columns/);
  assert.match(sections.schema,/\[is_verified\] bit/);
});

test('purchase order width repair guards data before rebuilding scoped indexes',()=>{
  const sections=installerSections();
  const repair=sections.migrations.find(m=>m.version===14);
  assert.ok(repair,'existing installations need a new migration version');
  const sql=repair.sql;
  const registry=JSON.parse(readFileSync('database/sqlserver/schema-registry.json','utf8'));
  const table=registry.tables.find(t=>t.sqlServerTable==='purchase_orders');
  for(const name of ['po_number','store_id']) {
    const column=table.columns.find(c=>c.sqlServerColumn===name);
    assert.equal(column.sqlServerType,'nvarchar(128)');
    assert.ok(sql.includes(`ALTER COLUMN ${name} ${column.sqlServerType}${column.nullable?' NULL':' NOT NULL'}`));
    assert.ok(sql.includes(`DATALENGTH(${name})>256`));
  }
  assert.match(sql,/WITH \(TABLOCKX, HOLDLOCK\)/);
  assert.ok(sql.indexOf('THROW 51014')<sql.indexOf('DROP INDEX'));
  assert.ok(sql.indexOf('BEGIN TRANSACTION')<sql.indexOf('DATALENGTH'));
  assert.ok(sql.indexOf('DROP INDEX [UQ_purchase_orders_0]')<sql.indexOf('ALTER COLUMN po_number'));
  assert.match(sql,/CREATE UNIQUE INDEX \[UQ_purchase_orders_0\].*\(\[store_id\],\[po_number\]\) WHERE \[store_id\] IS NOT NULL/);
  assert.match(sql,/CREATE INDEX \[IX_purchase_orders_store_id\]/);
  assert.match(sql,/BEGIN CATCH\s+IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;\s+THROW;/);
  assert.ok(sql.indexOf('INSERT INTO dbo.pos_schema_migrations')>sql.indexOf('CREATE UNIQUE INDEX'));
  assert.match(sections.validation,/WHERE version = 14/);
  assert.doesNotMatch(sql,/\b(?:UPDATE|DELETE|TRUNCATE)\s+dbo\./i);
});

test('local stock lifecycle repairs stale archive flags and responds to stock and setting changes',()=>{
  const migration=installerSections().migrations.find(m=>m.version===15);
  assert.ok(migration);
  assert.match(migration.sql,/CREATE OR ALTER TRIGGER dbo.products_zero_stock_catalog_lifecycle/);
  assert.match(migration.sql,/JOIN inserted i ON i.id=p.id/);
  assert.match(migration.sql,/TRIGGER_NESTLEVEL/);
  assert.match(migration.sql,/CREATE OR ALTER TRIGGER dbo.pos_settings_zero_stock_catalog_backfill/);
  assert.match(migration.sql,/CASE WHEN s.quantity>0 THEN 0 ELSE 1 END/);
  assert.match(migration.sql,/p.deleted_at IS NULL/);
  assert.match(migration.sql,/SUM\(TRY_CONVERT\(decimal\(38,12\),j\.\[value\]\)\)/);
  assert.match(migration.sql,/BEGIN CATCH\s+IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;\s+THROW;/);
});

function connection({applied=true,fail=false,deny=false}={}) {
  const calls=[];let commits=0;let rollbacks=0;
  const pool={request:()=>({input(){return this;},async query(){return {recordset:[{applied}]};},async batch(sql){calls.push(sql);if(deny)throw new Error('Wrong database');}})};
  class Transaction {async begin(){}async commit(){commits++;}async rollback(){rollbacks++;}}
  class Request {async batch(sql){calls.push(sql);if(fail)throw new Error('Existing data incompatible');}}
  return {manager:{pool,isConnected:()=>true,sql:()=>({Transaction,Request})},calls,counts:()=>({commits,rollbacks})};
}

test('existing databases receive current schema but skip already recorded upgrades',async()=>{
  const c=connection();const result=await applyMigrations(c.manager);
  assert.equal(result.ok,true);assert.equal(result.source,'retail-pos-local-database.sql');
  assert.deepEqual(result.applied,[]);assert.equal(c.calls[0],TARGET_GUARD);
  assert.ok(c.calls.some(sql=>sql.includes('[verified_channel]')));
  assert.ok(c.calls.some(sql=>sql.includes('required_columns')));
  assert.ok(!c.calls.some(sql=>sql.includes("N'__draft__:'")));
  assert.ok(!c.calls.some(sql=>/^\s*USE\s+/im.test(sql)));
});

test('fresh databases apply all upgrades from the consolidated installer',async()=>{
  const c=connection({applied:false});const result=await applyMigrations(c.manager);
  assert.equal(result.ok,true);
  assert.deepEqual(result.applied,installerSections().migrations.map(m=>m.name));
});

test('wrong database stops before any schema or migration executes',async()=>{
  const c=connection({deny:true});const result=await applyMigrations(c.manager);
  assert.equal(result.ok,false);assert.equal(c.calls.length,1);assert.equal(c.counts().commits,0);
});

test('failed upgrade rolls back its batch and never validates or reports success',async()=>{
  const c=connection({fail:true});const result=await applyMigrations(c.manager);
  assert.equal(result.ok,false);assert.equal(c.counts().rollbacks,1);assert.equal(c.counts().commits,0);
  assert.ok(!c.calls.some(sql=>sql.includes('required_columns')));
});

test('downloaded update is one fail-fast batch with guarded migrations and no database switch',()=>{
  const sql=migrationBundleSql('test');
  assert.equal(splitBatches(sql).length,1);
  assert.ok(sql.indexOf(TARGET_GUARD)<sql.indexOf('EXEC sys.sp_executesql'));
  assert.match(sql,/BEGIN CATCH\nIF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;\nTHROW;/);
  for(const migration of installerSections().migrations)assert.ok(sql.includes(`WHERE version=${migration.version}`));
  assert.ok(!/^\s*USE\s+/im.test(sql));
  assert.ok(!/\b(?:DELETE FROM|TRUNCATE TABLE|DROP TABLE|DROP COLUMN)\b/i.test(sql));
});
