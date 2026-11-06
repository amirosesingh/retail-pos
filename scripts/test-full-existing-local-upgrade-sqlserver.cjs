"use strict";
// Full existing-Retail acceptance. Only uniquely owned disposable LocalDB.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createOwnedUpgradeFixture}=require('./lib/owned-upgrade-fixture.cjs');
const {sourceModules,packageUpgrade,manifestPath}=require('./package-existing-local-upgrade.cjs');
const {runtimeParity}=require('./capture-existing-upgrade-manifest.cjs');
const fs=require('node:fs');
const {capture,validationSql,structuralNewlines,literal}=require('./lib/local-upgrade-catalogue.cjs');
const {renderExistingLocalUpgrade,digest}=require('./lib/existing-local-upgrade.cjs');
let passed=0;
const test=async(name,run)=>{const started=Date.now();await run();passed++;console.log('PASS '+name+' ('+(Date.now()-started)+'ms)');};
const quote=name=>{assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(name));return '['+name+']';};
async function shapeRows(f){return(await f.pool.request().query("SELECT t.name table_name,c.name column_name FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id WHERE t.schema_id=SCHEMA_ID('dbo') ORDER BY t.name,c.column_id;")).recordset;}
async function snapshot(f,shape){
 const result={};
 for(const table of [...new Set(shape.map(c=>c.table_name))]){
  const columns=shape.filter(c=>c.table_name===table).map(c=>quote(c.column_name)).join(',');
  const keys=(await f.pool.request().input('table',table).query("SELECT c.name FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE i.object_id=OBJECT_ID(N'dbo.'+@table) AND i.is_primary_key=1 ORDER BY ic.key_ordinal;")).recordset.map(c=>quote(c.name));
  result[table]=(await f.pool.request().query(`SELECT ${columns} FROM dbo.${quote(table)}${keys.length?' ORDER BY '+keys.join(','):''} FOR JSON PATH,INCLUDE_NULL_VALUES;`)).recordset.map(row=>Object.values(row)[0]).join('');
 }
 result.permissions=(await f.pool.request().query("SELECT p.state,p.permission_name,USER_NAME(p.grantee_principal_id) grantee,OBJECT_SCHEMA_NAME(p.major_id) object_schema,OBJECT_NAME(p.major_id) object_name,p.minor_id FROM sys.database_permissions p ORDER BY grantee,p.class,p.major_id,p.minor_id,p.permission_name FOR JSON PATH,INCLUDE_NULL_VALUES;")).recordset.map(row=>Object.values(row)[0]).join('');
 return result;
}
async function seed(f){
 const store='SQL72-FIXTURE',product=randomUUID(),sale=randomUUID();
 await f.pool.request().input('store',f.sql.NVarChar(450),store).input('product',f.sql.UniqueIdentifier,product).input('sale',f.sql.UniqueIdentifier,sale).batch(`
  INSERT dbo.stores(id,code,name) VALUES(@store,N'SQL72',N'Isolated upgrade fixture');
  INSERT dbo.products(id,barcode,name,cost_price,selling_price,stock_quantity,stock_by_store,row_version) VALUES(@product,N'SQL72-001',N'Synthetic product',12.345678901234,24.99,7,N'{"SQL72-FIXTURE":7}',17);
  INSERT dbo.sales(id,bill_number,total_amount,store_id,created_at,row_version) VALUES(@sale,N'SQL72-SALE',24.99,@store,'2026-11-05T10:12:13.1234567+08:00',23);
  INSERT dbo.sale_items(id,sale_id,product_id,product_name,unit_price,quantity,unit_cost) VALUES(NEWID(),@sale,@product,N'Synthetic product',24.99,1,12.345678901234);
  INSERT dbo.pos_store_settings(store_id,allow_multiple_shifts_per_terminal) VALUES(@store,0);
  CREATE TABLE dbo.UpgradeTestSentinel(id int PRIMARY KEY,payload nvarchar(200));INSERT dbo.UpgradeTestSentinel VALUES(1,N'Synthetic business/queue/settings preservation');
  CREATE ROLE UpgradeTestReader;GRANT SELECT ON dbo.products TO UpgradeTestReader;`);
 const {CheckpointRepository}=require('../electron/sync/checkpoints.cjs');await new CheckpointRepository(f.manager).save(store,'products','push',{change_tracking_version:1});
 return{store,product,sale};
}
async function seedFinancial(f){
 const intent=randomUUID(),shift=randomUUID(),count=randomUUID(),operation=randomUUID(),sale=randomUUID();
 await f.pool.request().input('intent',f.sql.UniqueIdentifier,intent).input('shift',f.sql.UniqueIdentifier,shift).input('count',f.sql.UniqueIdentifier,count).input('op',f.sql.UniqueIdentifier,operation).input('sale',f.sql.UniqueIdentifier,sale).batch(`
 INSERT dbo.pos_sync_shift_financial_bases VALUES(@intent,N'SQL72-FIXTURE',@shift,@count,1,REPLICATE('a',64),N'{"synthetic":"preserve old basis"}',REPLICATE('b',64),'2026-01-01T00:00:00.1234567Z');
 INSERT dbo.pos_sync_shift_financial_proofs VALUES(@intent,N'{"synthetic":"preserve old proof"}');
 INSERT dbo.pos_sync_shift_financial_origins(branch_id,shift_id,terminal_id,origin_kind,local_aggregate_id,row_hash,opening_payload_json,opening_payload_hash,proof_json,origin_version,created_at)
 VALUES(N'SQL72-FIXTURE',@shift,N'TEST-TILL',N'OPEN',@op,REPLICATE('a',64),N'{}',REPLICATE('b',64),N'{}',1,'2026-01-01T00:00:00.1234567Z');
 INSERT dbo.pos_sync_shift_financial_heads VALUES(N'SQL72-FIXTURE',@shift,N'TEST-TILL',0,@op,REPLICATE('a',64));
 INSERT dbo.pos_sync_shift_financial_events VALUES(N'SQL72-FIXTURE',@shift,N'TEST-TILL',1,NEWID(),'MUTATION','SALE',REPLICATE('a',64),N'{}',REPLICATE('b',64),N'{}');
 INSERT dbo.pos_sync_shift_financial_sale_lineage VALUES(@sale,N'SQL72-FIXTURE',@shift,N'TEST-TILL');
 INSERT dbo.pos_sync_shift_financial_observations VALUES(N'SQL72-FIXTURE',@shift,N'TEST-TILL',@sale,NEWID(),N'{}',REPLICATE('a',64));
 INSERT dbo.pos_sync_shift_financial_versions VALUES(N'SQL72-FIXTURE',@shift,N'TEST-TILL',@sale,1,'AFTER',NEWID(),N'{}',REPLICATE('a',64));
 INSERT dbo.pos_sync_shift_financial_noops VALUES(N'SQL72-FIXTURE',@shift,N'TEST-TILL',NEWID(),N'{}',REPLICATE('a',64),N'{}');`);
}
async function main(){
 assert.deepEqual(process.argv.slice(2),['--run'],'Only --run is accepted; no operator connection arguments');
 const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')),modules=sourceModules(),artifact=packageUpgrade(manifest).sql;
 for(const collation of ['SQL_Latin1_General_CP1_CI_AS','Latin1_General_100_BIN2']){
  const f=await createOwnedUpgradeFixture({collation});let other;
  try{
   await f.installCore();assert.equal(require('../electron/db/schema-registry.cjs').loadRegistry().tables.length,70);
   await f.pool.request().query('ALTER TABLE dbo.pos_store_settings DROP COLUMN allow_branch_shift_sharing;');
   await seed(f);const shape=await shapeRows(f),before=await snapshot(f,shape);
   await test(`full schema24 rejects unreviewed core columns before metadata writes (${collation})`,async()=>{
    await f.pool.request().query('ALTER TABLE dbo.products ADD unreviewed_upgrade_column int NULL;');
    try{await assert.rejects(f.pool.request().batch(artifact),/Unrecognized Retail schema24 columns/);assert.equal((await f.pool.request().query("SELECT OBJECT_ID(N'dbo.pos_sync_shift_financial_bases') id;")).recordset[0].id,null);}
    finally{await f.pool.request().query('ALTER TABLE dbo.products DROP COLUMN unreviewed_upgrade_column;');}assert.deepEqual(await snapshot(f,shape),before);
   });
   await test(`caller work remains committable and unchanged (${collation})`,async()=>{
    const tx=new f.sql.Transaction(f.pool);await tx.begin();try{await new f.sql.Request(tx).batch("SET XACT_ABORT ON;INSERT dbo.UpgradeTestSentinel VALUES(2,N'caller work');");await assert.rejects(new f.sql.Request(tx).batch(artifact));assert.deepEqual((await new f.sql.Request(tx).query('SELECT XACT_STATE() state,@@TRANCOUNT depth,(SELECT COUNT(*) FROM dbo.UpgradeTestSentinel WHERE id=2) retained;')).recordset[0],{state:1,depth:1,retained:1});}finally{await tx.rollback();}assert.deepEqual(await snapshot(f,shape),before);
   });
   await test(`changed core default is held with every old value preserved (${collation})`,async()=>{
    const old=(await f.pool.request().query("SELECT d.name,d.definition FROM sys.default_constraints d JOIN sys.columns c ON c.default_object_id=d.object_id WHERE d.parent_object_id=OBJECT_ID(N'dbo.products') AND c.name=N'stock_quantity';")).recordset[0];assert(old);
    await f.pool.request().batch(`ALTER TABLE dbo.products DROP CONSTRAINT ${quote(old.name)};ALTER TABLE dbo.products ADD CONSTRAINT ${quote(old.name)} DEFAULT(999) FOR stock_quantity;`);
    try{await assert.rejects(f.pool.request().batch(artifact),/Unrecognized Retail schema24 columns/);}finally{await f.pool.request().batch(`ALTER TABLE dbo.products DROP CONSTRAINT ${quote(old.name)};ALTER TABLE dbo.products ADD CONSTRAINT ${quote(old.name)} DEFAULT ${old.definition} FOR stock_quantity;`);}assert.deepEqual(await snapshot(f,shape),before);
   });
   await test(`none installed: one batch adds025–030 preserving every old table/permission (${collation})`,async()=>{
    await f.pool.request().batch(artifact);assert.deepEqual(await snapshot(f,shape),before);for(const module of modules)await runtimeParity(f,module.id);
    for(const table of manifest.modules.flatMap(m=>m.shape.selectors.tables))assert.equal(String((await f.pool.request().query(`SELECT COUNT_BIG(*) n FROM dbo.${quote(table)};`)).recordset[0].n),'0');
   });
   await seedFinancial(f);const installedShape=await shapeRows(f),installed=await snapshot(f,installedShape);
   await test(`rerun preserves populated metadata, business, ledger, settings and grants (${collation})`,async()=>{await f.pool.request().batch(artifact);assert.deepEqual(await snapshot(f,installedShape),installed);});
   await test(`unknown index/trigger/owner shape aborts rather than repairing (${collation})`,async()=>{
    for(const pair of [
     ['ALTER INDEX IX_pos_sync_shift_financial_bases_scope ON dbo.pos_sync_shift_financial_bases DISABLE;','ALTER INDEX IX_pos_sync_shift_financial_bases_scope ON dbo.pos_sync_shift_financial_bases REBUILD;'],
     ['DISABLE TRIGGER dbo.TR_pos_shift_recovery_evidence_immutable ON dbo.pos_shift_recovery_evidence;','ENABLE TRIGGER dbo.TR_pos_shift_recovery_evidence_immutable ON dbo.pos_shift_recovery_evidence;'],
     ["EXEC sys.sp_updateextendedproperty @name=N'RetailRecoveryOwner',@value=N'wrong-owner',@level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'TABLE',@level1name=N'pos_shift_recovery_evidence';","EXEC sys.sp_updateextendedproperty @name=N'RetailRecoveryOwner',@value=N'retail.shift-recovery',@level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'TABLE',@level1name=N'pos_shift_recovery_evidence';"],
    ]){await f.pool.request().batch(pair[0]);try{await assert.rejects(f.pool.request().batch(artifact),/Unrecognized/);}finally{await f.pool.request().batch(pair[1]);}assert.deepEqual(await snapshot(f,installedShape),installed);}
   });
   await test(`old prototype030 index is held, not silently upgraded (${collation})`,async()=>{
    const columns='database_guid,branch_id,terminal_id,backend_origin_hash,shift_id,target_graph_hash,local_before_hash';await f.pool.request().batch(`DROP INDEX UX_reviewed_adoption_identity ON dbo.pos_shift_recovery_adoptions;CREATE UNIQUE INDEX UX_reviewed_adoption_identity ON dbo.pos_shift_recovery_adoptions(${columns});`);
    try{await assert.rejects(f.pool.request().batch(artifact),/Unrecognized 030_reviewed_shift_adoption/);}finally{await f.pool.request().batch(`DROP INDEX UX_reviewed_adoption_identity ON dbo.pos_shift_recovery_adoptions;CREATE UNIQUE INDEX UX_reviewed_adoption_identity ON dbo.pos_shift_recovery_adoptions(${columns},decision_id);`);}assert.deepEqual(await snapshot(f,installedShape),installed);
   });
   await test(`same-named weakened metadata CHECK cannot pass recognition (${collation})`,async()=>{
    const old=(await f.pool.request().query("SELECT name,definition FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.pos_sync_shift_financial_bases') AND name=N'CK_pos_sync_shift_financial_bases_hash';")).recordset[0];assert(old);
    await f.pool.request().batch(`ALTER TABLE dbo.pos_sync_shift_financial_bases DROP CONSTRAINT ${quote(old.name)};ALTER TABLE dbo.pos_sync_shift_financial_bases ADD CONSTRAINT ${quote(old.name)} CHECK(1=1);`);
    try{await assert.rejects(f.pool.request().batch(artifact),/Unrecognized 025_shift_financial_bases checks/);}finally{await f.pool.request().batch(`ALTER TABLE dbo.pos_sync_shift_financial_bases DROP CONSTRAINT ${quote(old.name)};ALTER TABLE dbo.pos_sync_shift_financial_bases WITH CHECK ADD CONSTRAINT ${quote(old.name)} CHECK ${old.definition};`);}assert.deepEqual(await snapshot(f,installedShape),installed);
   });
   await test(`index key order and filter changes are not coalesced (${collation})`,async()=>{
    for(const spec of ['(branch_id,count_id,shift_id)','(branch_id,shift_id,count_id) WHERE branch_id IS NOT NULL']){
     await f.pool.request().batch('DROP INDEX IX_pos_sync_shift_financial_bases_scope ON dbo.pos_sync_shift_financial_bases;CREATE INDEX IX_pos_sync_shift_financial_bases_scope ON dbo.pos_sync_shift_financial_bases'+spec+';');
     try{await assert.rejects(f.pool.request().batch(artifact),/Unrecognized 025_shift_financial_bases index/);}finally{await f.pool.request().batch('DROP INDEX IX_pos_sync_shift_financial_bases_scope ON dbo.pos_sync_shift_financial_bases;CREATE INDEX IX_pos_sync_shift_financial_bases_scope ON dbo.pos_sync_shift_financial_bases(branch_id,shift_id,count_id);');}
    }
   });
   await test(`literal CRLF, case, Unicode, escapes, missing and NULL remain distinct (${collation})`,async()=>{
    const value="Alpha é中 / \\ \" it''s\r\naudit";
    await f.pool.request().batch(`CREATE TABLE dbo.sql72_literal_fixture(id int PRIMARY KEY,value nvarchar(200) NULL CONSTRAINT DF_SQL72_literal DEFAULT(${literal(value)}));`);
    const trigger="CREATE TRIGGER dbo.sql72_literal_guard ON dbo.sql72_literal_fixture AFTER UPDATE AS BEGIN\n DECLARE @literal nvarchar(100)=N'line1\r\nline2';\n IF 1=0 THROW 50000,'Fixture only',1;\nEND;";
    await f.pool.request().batch(trigger);
    const expected=await capture(f.pool,{tables:['sql72_literal_fixture']},f.collation),guard=validationSql(expected,'literal fixture');await f.pool.request().batch(guard);
    for(const changed of [value.replace('\r\n','\n'),value.replace('Alpha','alpha'),value.replace('é','e'),value.replace('\\',''),null]){
     await f.pool.request().batch(`ALTER TABLE dbo.sql72_literal_fixture DROP CONSTRAINT DF_SQL72_literal;ALTER TABLE dbo.sql72_literal_fixture ADD CONSTRAINT DF_SQL72_literal DEFAULT(${changed===null?'NULL':literal(changed)}) FOR value;`);
     try{await assert.rejects(f.pool.request().batch(guard),/Unrecognized literal fixture columns/);}finally{await f.pool.request().batch(`ALTER TABLE dbo.sql72_literal_fixture DROP CONSTRAINT DF_SQL72_literal;ALTER TABLE dbo.sql72_literal_fixture ADD CONSTRAINT DF_SQL72_literal DEFAULT(${literal(value)}) FOR value;`);}
    }
    await f.pool.request().batch('ALTER TABLE dbo.sql72_literal_fixture DROP CONSTRAINT DF_SQL72_literal;');await assert.rejects(f.pool.request().batch(guard),/Unrecognized literal fixture columns/);
    await f.pool.request().batch(`ALTER TABLE dbo.sql72_literal_fixture ADD CONSTRAINT DF_SQL72_literal DEFAULT(${literal(value)}) FOR value;DROP TRIGGER dbo.sql72_literal_guard;`);
    const windows=structuralNewlines(trigger,'\r\n');await f.pool.request().batch(windows);await f.pool.request().batch(guard);
    await f.pool.request().batch('DROP TRIGGER dbo.sql72_literal_guard;');await f.pool.request().batch(windows.replace("N'line1\r\nline2'","N'line1\nline2'"));await assert.rejects(f.pool.request().batch(guard),/Unrecognized literal fixture triggers/);
    await f.pool.request().batch('DROP TRIGGER dbo.sql72_literal_guard;');await f.pool.request().batch(trigger);
    await f.pool.request().batch("EXEC sys.sp_addextendedproperty @name=N'SQL72Null',@value=NULL,@level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'TABLE',@level1name=N'sql72_literal_fixture';");await assert.rejects(f.pool.request().batch(guard),/Unrecognized literal fixture properties/);
    await f.pool.request().batch("EXEC sys.sp_dropextendedproperty @name=N'SQL72Null',@level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'TABLE',@level1name=N'sql72_literal_fixture';");await f.pool.request().batch(guard);
   });
   await test(`upgrade lock excludes concurrent maintenance without partial work (${collation})`,async()=>{
    other=await f.connect(f.database);const tx=new f.sql.Transaction(other);await tx.begin();try{await new f.sql.Request(tx).query("DECLARE @lock int;EXEC @lock=sys.sp_getapplock @Resource=N'RetailExistingMetadataUpgrade',@LockMode='Exclusive',@LockOwner='Transaction';IF @lock<0 THROW 50000,'Fixture lock failed',1;");await assert.rejects(f.pool.request().batch(artifact),/Another database update/);}finally{await tx.rollback();}assert.deepEqual(await snapshot(f,installedShape),installed);
   });
  }finally{await other?.close();await f.close();}
 }
 const old=await createOwnedUpgradeFixture();
 try{
  await old.installCore();await seed(old);for(const module of modules.slice(0,3))await old.pool.request().batch(module.sql);await seedFinancial(old);
  const shape=await shapeRows(old),before=await snapshot(old,shape);
  await test('already-installed025–027 with saved financial rows survive recovery metadata addition',async()=>{await old.pool.request().batch(artifact);assert.deepEqual(await snapshot(old,shape),before);for(const module of modules)await runtimeParity(old,module.id);});
 }finally{await old.close();}
 const partial=await createOwnedUpgradeFixture();
 try{
  await partial.installCore();await seed(partial);await partial.pool.request().batch("CREATE TABLE dbo.pos_sync_shift_financial_origins(id int PRIMARY KEY,note nvarchar(100));INSERT dbo.pos_sync_shift_financial_origins VALUES(1,N'Unknown retained metadata');");
  const shape=await shapeRows(partial),before=await snapshot(partial,shape);
  await test('partial026 namespace aborts all new metadata and preserves its unknown rows',async()=>{
   await assert.rejects(partial.pool.request().batch(artifact),/Unrecognized 026_shift_financial_operations/);
   assert.equal((await partial.pool.request().query("SELECT OBJECT_ID(N'dbo.pos_sync_shift_financial_bases') id;")).recordset[0].id,null);assert.deepEqual(await snapshot(partial,shape),before);
  });
 }finally{await partial.close();}
 const f=await createOwnedUpgradeFixture();
 try{
  await test('system/unrelated/forged-version targets abort with no user tables added',async()=>{
   const master=await f.connect('master');try{await assert.rejects(master.request().batch(artifact),/Select the configured Retail POS database/);}finally{await master.close();}
   await assert.rejects(f.pool.request().batch(artifact),/existing managed Retail database/);
   await f.pool.request().batch('CREATE TABLE dbo.pos_schema_migrations(version int PRIMARY KEY);INSERT dbo.pos_schema_migrations VALUES(24);CREATE TABLE dbo.products(id int);INSERT dbo.products VALUES(7);');
   await assert.rejects(f.pool.request().batch(artifact),/Unrecognized Retail schema24/);assert.equal((await f.pool.request().query('SELECT COUNT(*) n FROM dbo.products;')).recordset[0].n,1);
  });
  await test('LF-only distribution reconstructs a6002-character quoted value without truncation',async()=>{
   const value='x'.repeat(3000)+'\r\n'+'y'.repeat(3000),source=`BEGIN TRANSACTION;\nCREATE TABLE dbo.sql72_width(value nvarchar(max));\nINSERT dbo.sql72_width VALUES(${literal(value)});\nCOMMIT;\n`;
   const built=renderExistingLocalUpgrade({version:'1.4.82',modules:[{id:'028_width_fixture',sql:source,sha256:digest(source)}],coreValidation:"IF OBJECT_ID(N'dbo.products') IS NULL THROW 51028,'Owned fixture only',1;"});
   assert.equal(built.sql.includes('\r'),false);await f.pool.request().batch(built.sql);
   assert.equal((await f.pool.request().query('SELECT value FROM dbo.sql72_width;')).recordset[0].value,value);
  });
 }finally{await f.close();}
 const late=await createOwnedUpgradeFixture();
 try{
  await late.installCore();await seed(late);await late.pool.request().batch(modules[0].sql);await late.pool.request().batch(modules[3].sql);
  await late.pool.request().batch("ALTER TABLE dbo.pos_store_settings DROP COLUMN allow_branch_shift_sharing;EXEC sys.sp_updateextendedproperty @name=N'RetailRecoveryOwner',@value=N'wrong-owner',@level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'TABLE',@level1name=N'pos_shift_recovery_evidence';");
  const shape=await shapeRows(late),before=await snapshot(late,shape);
  await test('late028 mismatch rolls back newly created026/027 and preserves installed025',async()=>{
   await assert.rejects(late.pool.request().batch(artifact),/Unrecognized 028_retained_shift_evidence/);
   assert.deepEqual((await late.pool.request().query("SELECT OBJECT_ID(N'dbo.pos_sync_shift_financial_origins') operations,COL_LENGTH(N'dbo.pos_store_settings',N'allow_branch_shift_sharing') sharing;")).recordset[0],{operations:null,sharing:null});assert.deepEqual(await snapshot(late,shape),before);
  });
  await test('late injected failure rolls back every newly created metadata module',async()=>{
   const failing=artifact.replace(' COMMIT TRANSACTION;\n SELECT CONVERT'," THROW 51028,'Synthetic late failure',1;\n COMMIT TRANSACTION;\n SELECT CONVERT");assert.notEqual(failing,artifact);
   await late.pool.request().batch("EXEC sys.sp_updateextendedproperty @name=N'RetailRecoveryOwner',@value=N'retail.shift-recovery',@level0type=N'SCHEMA',@level0name=N'dbo',@level1type=N'TABLE',@level1name=N'pos_shift_recovery_evidence';");
   await assert.rejects(late.pool.request().batch(failing),/Synthetic late failure/);
   for(const module of modules.filter(m=>!m.id.startsWith('025')&&!m.id.startsWith('028')))for(const table of module.selectors.tables)assert.equal((await late.pool.request().input('name','dbo.'+table).query('SELECT OBJECT_ID(@name) id;')).recordset[0].id,null);
   assert.equal((await late.pool.request().query("SELECT COL_LENGTH(N'dbo.pos_store_settings',N'allow_branch_shift_sharing') value;")).recordset[0].value,null);assert.deepEqual(await snapshot(late,shape),before);
  });
 }finally{await late.close();}
 console.log(`PASS ${passed} full-Retail SQL72 groups; no operator database was accessed.`);
}
main().catch(error=>{console.error(error);for(const item of error.precedingErrors??[])console.error(item.message);process.exitCode=1;});
