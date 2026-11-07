"use strict";
// Actual provider acceptance in a uniquely owned LocalDB only. No connection,
// profile, backup path or database argument can be supplied by an operator.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{randomUUID}=require("node:crypto");
const {createOwnedUpgradeFixture}=require("./lib/owned-upgrade-fixture.cjs");
const {ShiftRecoveryMetadataInstaller,packageFiles}=require("../electron/db/shift-recovery-metadata.cjs");
const {DatabaseService}=require("../electron/db/service.cjs");
const {LegacyShiftRecoveryService}=require("../electron/sync/legacy-shift-recovery-service.cjs");
assert.deepEqual(process.argv.slice(2),["--run"],"Only --run is supported; no POS profile is accepted");
const packaged=packageFiles();let count=0;
async function test(name,work){await work();count++;console.log("PASS "+name);}
const q=value=>{assert(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value));return"["+value+"]";};
async function main(){
 const f=await createOwnedUpgradeFixture();
 let ownedBackupDirectory=null;
 try{
  await f.installCore();
  await f.pool.request().input("product",f.sql.UniqueIdentifier,randomUUID()).input("sale",f.sql.UniqueIdentifier,randomUUID()).batch(`
   INSERT dbo.stores(id,code,name) VALUES(N'RUNTIME-FIXTURE',N'RTF',N'Owned runtime fixture');
   INSERT dbo.products(id,barcode,name,cost_price,selling_price,stock_quantity,stock_by_store,row_version) VALUES(@product,N'RTF-PRODUCT',N'Existing stock',12.345678901234,24.99,7,N'{"RUNTIME-FIXTURE":7}',17);
   INSERT dbo.sales(id,bill_number,total_amount,store_id,created_at,row_version) VALUES(@sale,N'RTF-SALE',24.99,N'RUNTIME-FIXTURE','2026-11-05T10:12:13.1234567+08:00',23);
   INSERT dbo.pos_store_settings(store_id,allow_multiple_shifts_per_terminal) VALUES(N'RUNTIME-FIXTURE',0);`);
  const names=(await f.pool.request().query("SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID('dbo') ORDER BY name;")).recordset.map(row=>row.name);
  const snapshot=async()=>{
   const rows={};
   for(const name of names){
    const keys=(await f.pool.request().input("table",name).query("SELECT c.name FROM sys.indexes i JOIN sys.index_columns k ON k.object_id=i.object_id AND k.index_id=i.index_id JOIN sys.columns c ON c.object_id=k.object_id AND c.column_id=k.column_id WHERE i.object_id=OBJECT_ID(N'dbo.'+@table) AND i.is_primary_key=1 ORDER BY k.key_ordinal;")).recordset.map(row=>q(row.name));
    rows[name]=(await f.pool.request().query(`SELECT * FROM dbo.${q(name)}${keys.length?" ORDER BY "+keys.join(","):""} FOR JSON PATH,INCLUDE_NULL_VALUES;`)).recordset.map(row=>Object.values(row)[0]).join("");
   }
   rows.ct=(await f.pool.request().query("SELECT CONVERT(varchar(40),CHANGE_TRACKING_CURRENT_VERSION()) version;")).recordset[0].version;
   rows.grants=(await f.pool.request().query("SELECT class,major_id,minor_id,state,permission_name,grantee_principal_id,grantor_principal_id FROM sys.database_permissions ORDER BY class,major_id,minor_id,state,permission_name,grantee_principal_id,grantor_principal_id FOR JSON PATH,INCLUDE_NULL_VALUES;")).recordset.map(row=>Object.values(row)[0]).join("");
   return rows;
  };
  const initial=await snapshot(),profile={host:"OWNED-FIXTURE-ONLY",database:f.database,authMode:"windows",requestTimeoutMs:60000};
  const manager={...f.manager,profile,open:async value=>{assert.equal(value.database.toLowerCase(),f.database.toLowerCase());return f.pool;},isConnected:()=>true,
   close:async()=>{throw Error("The optional upgrade must not close the core fixture pool");},
   temporary:async(value,database,work)=>{
    assert.equal(database.toLowerCase(),f.database.toLowerCase());assert.equal(value.host,profile.host);
    assert.equal(typeof f.pool.config.connectionString,"string");assert(f.pool.config.connectionString.includes(`Database=${f.database};`)&&f.pool.config.connectionString.includes("LOCALDB#"),"Refuse a non-owned fixture connection");
    const pool=await new f.sql.ConnectionPool({connectionString:f.pool.config.connectionString,pool:{min:0,max:1},requestTimeout:value.requestTimeoutMs}).connect();
    try{return await work(pool);}finally{await pool.close();}
   }};
  // Only the existing capability method runs; no fake Administrator or receipt
  // is supplied and no review/upload/adoption method is invoked by this test.
  const legacy=new LegacyShiftRecoveryService({connectionManager:manager,registry:{},cloud:{},evidenceStore:{},outbox:{},authority:{},readContext:()=>{throw Error("Unexpected author scope use");}});
  const installer=new ShiftRecoveryMetadataInstaller({manager,verified:()=>legacy.invalidateCapability()});
  const config={enabled:()=>true,profile:()=>profile,credentials:()=>profile};
  const activeIdentity=async()=>{
   const row=(await manager.pool.request().query("SELECT LOWER(CONVERT(varchar(36),database_guid)) guid,DB_NAME() name FROM sys.database_recovery_status WHERE database_id=DB_ID();")).recordset[0];
   assert.equal(row.guid,f.guid.toLowerCase());assert.equal(row.name,f.database);
   return {expectedDatabaseGuid:row.guid,expectedDatabaseName:row.name};
  };
  const service=new DatabaseService({secureConfig:config,manager,prepareRecoveryMetadata:async input=>installer.prepare({...input,...await activeIdentity()})});
  await test("actual core startup keeps rollout OFF, preserves all business/journal/checkpoint/grants and reports optional hold",async()=>{
   assert.equal(await legacy.capability(),false);
   const state=await service.restore();assert.equal(state.state,"enabled_bootstrapping");assert.equal(state.tradingReady,true);
   assert.equal(state.recoveryMetadata.code,"ERECOVERY_METADATA_APPROVAL_REQUIRED");assert.equal(await legacy.capability(),false);
   assert.deepEqual(await snapshot(),initial);
  });
  let installed=false;
  await test("unmodified NULL server backup directory refuses safely without writing outside the fixture",async()=>{
   const actual=(await f.pool.request().query("SELECT CONVERT(nvarchar(2048),SERVERPROPERTY('InstanceDefaultBackupPath')) backup_directory;")).recordset;
   assert.equal(actual.length,1);
   if(actual[0].backup_directory!==null){
    assert.equal(typeof actual[0].backup_directory,"string");
    console.log("LIMIT non-NULL server default directory not exercised: all test backups use only the owned fixture adapter");
    assert.deepEqual(await snapshot(),initial);return;
   }
   const approved=new ShiftRecoveryMetadataInstaller({manager,approvedArtifactHash:packaged.installer.sha256,verified:()=>legacy.invalidateCapability()});
   const result=await approved.prepare({profile,...await activeIdentity(),assertCurrent:()=>{assert.equal(manager.pool,f.pool);}});
   assert.equal(result.available,false);assert.equal(await legacy.capability(),false);assert.equal(result.code,"ERECOVERY_METADATA_BACKUP_PATH");
   console.log("LIMIT unmodified LocalDB has no configured server backup directory; runtime DDL correctly refused");
   assert.deepEqual(await snapshot(),initial);
  });
  if(!installed)await test("fixture-only configured-directory reply enables REAL backup verification and unchanged runtime DDL",async()=>{
   const root=path.resolve(__dirname,"../.tmp");fs.mkdirSync(root,{recursive:true});
   ownedBackupDirectory=fs.mkdtempSync(path.join(root,"owned-recovery-backup-"));
   assert.equal(path.dirname(ownedBackupDirectory),root);
   class FixtureBackupRequest extends f.sql.Request{
    query(statement,...args){
     // SOLE substituted reply: LocalDB has no configured backup directory.
     // All BACKUP/VERIFYONLY/HEADERONLY, target/probe/DDL are actual SQL Server.
     if(statement==="SELECT CONVERT(nvarchar(2048),SERVERPROPERTY('InstanceDefaultBackupPath')) backup_directory;")return Promise.resolve({recordset:[{backup_directory:ownedBackupDirectory}]});
     return super.query(statement,...args);
    }
   }
   const adapted={...manager,sql:()=>({...f.sql,Request:FixtureBackupRequest})};
   const approved=new ShiftRecoveryMetadataInstaller({manager:adapted,approvedArtifactHash:packaged.installer.sha256,verified:()=>legacy.invalidateCapability()});
   const result=await approved.prepare({profile,...await activeIdentity(),assertCurrent:()=>{assert.equal(adapted.pool,f.pool);}});
   assert.deepEqual(result,{available:true,state:"matching",installed:true,backupVerified:true});installed=true;
   const files=fs.readdirSync(ownedBackupDirectory);assert.equal(files.length,1);assert(files[0].startsWith("Retail_Recovery_"+f.guid.toLowerCase()+"_"));
   assert.equal(await legacy.capability(),true);assert.deepEqual(await snapshot(),initial);
  });
  await test("real matching schema invalidates unavailable cache and reaches existing recovery capability without activation or data acknowledgement",async()=>{
   legacy.invalidateCapability();assert.equal(await legacy.capability(),true);
   const state=await service.restore();assert.equal(state.tradingReady,true);assert.equal(state.state,"enabled_bootstrapping");
   assert.deepEqual(state.recoveryMetadata,{available:true,state:"matching",installed:false});assert.equal(await legacy.capability(),true);
   for(const table of packaged.modules.flatMap(module=>module.tables))assert.equal(BigInt((await f.pool.request().query(`SELECT COUNT_BIG(*) n FROM dbo.${q(table)};`)).recordset[0].n),0n);
   assert.deepEqual(await snapshot(),initial);
  });
  await test("SQL-native case alias resolves to original exact GUID while wrong target remains unavailable",async()=>{
   const alias={...profile,database:profile.database.toLowerCase()};
   assert.equal((await installer.prepare({profile:alias,...await activeIdentity(),assertCurrent:()=>{}})).available,true);
   assert.equal(profile.database,f.database);assert.deepEqual(await snapshot(),initial);
  });
  await test("actual temporary target refuses a mismatching actual database GUID even when its metadata already matches",async()=>{
   const foreign=(await f.pool.request().query("SELECT LOWER(CONVERT(varchar(36),database_guid)) guid FROM sys.database_recovery_status WHERE database_id=DB_ID(N'master');")).recordset[0].guid;
   assert.notEqual(foreign,f.guid.toLowerCase());
   const result=await installer.prepare({profile,expectedDatabaseGuid:foreign,expectedDatabaseName:f.database,assertCurrent:()=>{assert.equal(manager.pool,f.pool);}});
   assert.equal(result.available,false);assert.equal(result.code,"ERECOVERY_METADATA_CONTEXT");assert.deepEqual(await snapshot(),initial);
  });
  await test("unknown recovery shape is refused without disabling the validated core connection",async()=>{
   await f.pool.request().batch("ALTER TABLE dbo.pos_shift_recovery_adoptions ADD fixture_unreviewed int NULL;");
   const state=await service.restore();assert.equal(state.tradingReady,true);assert.equal(state.state,"enabled_bootstrapping");assert.equal(state.recoveryMetadata.available,false);assert.equal(state.recoveryMetadata.code,"ERECOVERY_METADATA_SCHEMA");
   assert.deepEqual(await snapshot(),initial);
  });
  console.log(`PASS ${count} actual runtime/core/capability groups; no real profile, key or cloud used`);
 }finally{
  await f.close();
  if(ownedBackupDirectory){
   assert.equal(path.dirname(ownedBackupDirectory),path.resolve(__dirname,"../.tmp"));assert(path.basename(ownedBackupDirectory).startsWith("owned-recovery-backup-"));
   assert(fs.lstatSync(ownedBackupDirectory).isDirectory()&&!fs.lstatSync(ownedBackupDirectory).isSymbolicLink());
   const real=fs.realpathSync(ownedBackupDirectory);assert.equal(path.dirname(real),fs.realpathSync(path.resolve(__dirname,"../.tmp")));assert.equal(path.basename(real),path.basename(ownedBackupDirectory));
   for(const file of fs.readdirSync(ownedBackupDirectory)){
    assert(file.startsWith("Retail_Recovery_"+f.guid.toLowerCase()+"_")&&file.endsWith(".bak")&&path.basename(file)===file);
    const target=path.join(ownedBackupDirectory,file),stat=fs.lstatSync(target);assert(stat.isFile()&&!stat.isSymbolicLink());assert.equal(path.dirname(fs.realpathSync(target)),real);fs.unlinkSync(target);
   }
   fs.rmdirSync(ownedBackupDirectory);
  }
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
