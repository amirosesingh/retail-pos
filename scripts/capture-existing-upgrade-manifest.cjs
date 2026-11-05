"use strict";
// Maintainer fixture capture only. Operator upgrade is the generated plain SQL.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createOwnedUpgradeFixture}=require('./lib/owned-upgrade-fixture.cjs');
const {capture}=require('./lib/local-upgrade-catalogue.cjs');
const {sourceModules,manifestPath}=require('./package-existing-local-upgrade.cjs');
const {canonical,digest}=require('./lib/existing-local-upgrade.cjs');
const {installerSections}=require('../electron/db/installer-source.cjs');
async function runtimeParity(f,id){
 const tx=new f.sql.Transaction(f.pool);await tx.begin(f.sql.ISOLATION_LEVEL.SERIALIZABLE);
 const scope={databaseGuid:f.guid.toLowerCase(),branchId:'00000000-0000-4000-8000-000000000001',terminalId:'00000000-0000-4000-8000-000000000002',backendOriginHash:'a'.repeat(64)},assertScope=async(value,supplied)=>value===tx&&JSON.stringify(supplied)===JSON.stringify(scope);
 try{
  if(id.startsWith('025'))await new(require('../electron/db/shift-financial-bases.cjs').ShiftFinancialBases)(f.manager).schema(tx);
  if(id.startsWith('026'))await new(require('../electron/db/shift-financial-operations.cjs').ShiftFinancialOperations)(f.manager).schema(tx);
  if(id.startsWith('028'))await new(require('../electron/db/shift-recovery-evidence.cjs').ShiftRecoveryEvidenceStore)({connectionManager:f.manager,registry:{tables:[]},assertScope}).preflight(tx,scope);
  if(id.startsWith('029')){
   const evidenceStore=new(require('../electron/db/shift-recovery-evidence.cjs').ShiftRecoveryEvidenceStore)({connectionManager:f.manager,registry:{tables:[]},assertScope});
   // Only the metadata preflight is exercised; no authority/action is invoked.
   await new(require('../electron/db/legacy-shift-recovery-outbox.cjs').LegacyShiftRecoveryOutbox)({connectionManager:f.manager,registry:{tables:[]},assertScope,evidenceStore,authority:{}}).preflight(tx,scope);
  }
  if(id.startsWith('030'))await new(require('../electron/sync/reviewed-shift-adoption.cjs').ReviewedShiftAdoption)({connectionManager:f.manager,registry:{tables:[]}}).schema(tx);
  await tx.commit();
 }catch(error){await tx.rollback().catch(()=>{});throw error;}
}
async function main(){
 assert.deepEqual(process.argv.slice(2),['--run'],'Only --run is accepted; no connection arguments');
 const f=await createOwnedUpgradeFixture();
 try{
  await f.installCore();const registry=require('../electron/db/schema-registry.cjs').loadRegistry();assert.equal(registry.tables.length,70);
  const provenance=(await f.pool.request().query("SELECT CONVERT(nvarchar(128),SERVERPROPERTY('ProductVersion')) sql_version,CONVERT(nvarchar(128),SERVERPROPERTY('Edition')) edition,CONVERT(nvarchar(128),DATABASEPROPERTYEX(DB_NAME(),'Collation')) collation;")).recordset[0];
  const tables=(await f.pool.request().query("SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID('dbo') ORDER BY name;")).recordset.map(r=>r.name);
  assert(registry.tables.every(table=>tables.includes(table.sqlServerTable)));
  const sources=installerSections(),coreSources={schema:digest(canonical(sources.schema)),migrations:sources.migrations.map(m=>[m.name,digest(canonical(m.sql))])};
  const core=await capture(f.pool,{tables,ignoreColumns:[{table:'pos_store_settings',column:'allow_branch_shift_sharing'}]},f.collation),modules=[];
  for(const module of sourceModules()){
   await f.pool.request().batch(module.sql);await runtimeParity(f,module.id);
   modules.push({id:module.id,source:module.file,sourceHash:module.canonicalHash,inspectedRawHash:module.sha256,shape:await capture(f.pool,module.selectors,f.collation)});
  }
  const manifest={format:1,version:'1.4.82',registryTables:70,provenance,coreSources,core,modules};
  fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n','utf8');console.log(JSON.stringify({file:manifestPath,coreTables:tables.length,registryTables:70,modules:modules.map(m=>m.id),runtimeParity:'passed'}));
 }finally{await f.close();}
}
if(require.main===module)main().catch(error=>{console.error(error);for(const item of error.precedingErrors??[])console.error(item.message);process.exitCode=1;});
module.exports={runtimeParity};
