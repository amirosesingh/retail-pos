"use strict";
// Exact fixed-name artifact, only inside a newly UUID-owned LocalDB instance.
const assert=require("node:assert/strict");
const {randomUUID}=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const {createOwnedUpgradeFixture}=require("./lib/owned-upgrade-fixture.cjs");
const {packageSetupLocal}=require("./lib/beta-local-setup.cjs");
const {manifestPath}=require("./lib/beta-local-upgrade.cjs");
const {validationSql}=require("./lib/local-upgrade-catalogue.cjs");
const {createCurrentLocalAdmission}=require("../electron/current-local-admission.cjs");
const {createTerminalOnlineRecovery}=require("../electron/terminal-online-recovery.cjs");
const activationBoundary=require("../electron/verified-activation.cjs");
const {validateDatabase}=require("../electron/db/health.cjs");
function admissionFixture(){
 const folder=path.resolve(__dirname,"../.tmp/owned-local-proof-"+randomUUID());fs.mkdirSync(folder,{recursive:true});
 const original={tokenId:randomUUID(),deviceType:"pc",deviceUse:"operations",locationId:"fixture-branch"};
 const replacement={...original,tokenId:randomUUID(),deviceBindingProof:"a".repeat(64),supabaseUrl:"https://fixture-project.invalid",backendUrl:"https://fixture-relay.invalid"};
 const profile={host:"localhost",instanceName:"",port:1433,database:"POS_Local_Beta",authMode:"windows",username:"",password:"",encrypt:false,trustServerCertificate:true,connectionTimeoutMs:5000,requestTimeoutMs:10000,retentionDays:90};
 let active=null;const values=new Map([["localDatabaseProfile",{...profile,database:"RetainedFixture"}],["localDatabaseEnabled",true],["backendUrl",replacement.backendUrl]]);
 const configStore={getStrict:key=>values.get(key)??null};
 const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from("fixture:"+value),decryptString:bytes=>{assert(bytes.toString().startsWith("fixture:"));return bytes.toString().slice(8);}};
 const terminalStore={read:()=>active,lastBinding:()=>original,wasProvisioned:()=>true};
 const onlineRecovery=createTerminalOnlineRecovery({app:{getPath:()=>folder},safeStorage,configStore,terminalStore,activationBoundary,cloudCredentials:{read:()=>({url:replacement.supabaseUrl,key:"fixture-public"})}});
 onlineRecovery.begin({evidence:{sealed:null,plain:null,key:null}});values.set("localDatabaseEnabled",false);onlineRecovery.bindReplacement(replacement);active=replacement;
 const create=()=>createCurrentLocalAdmission({app:{getPath:()=>folder},safeStorage,onlineRecovery,terminalStore,activationBoundary});
 return{profile,admission:create(),create,close:()=>{const parent=path.resolve(__dirname,"../.tmp");assert(path.dirname(folder)===parent&&/^owned-local-proof-[a-f0-9-]{36}$/.test(path.basename(folder)));fs.rmSync(folder,{recursive:true,force:true});}};
}
async function main(){
 assert.deepEqual(process.argv.slice(2),["--run"],"Only --run; no connection/target arguments");
 const f=await createOwnedUpgradeFixture(),owner=randomUUID(),artifact=packageSetupLocal().sql;
 const manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8"));
 let beta=null,betaGuid=null,passed=0;
 const proofs=[];
 const id=async()=> (await f.master.request().query("SELECT DB_ID(N'POS_Local_Beta') id")).recordset[0].id;
 const verifyInstance=async()=>{
  const row=(await f.pool.request().query("SELECT DB_NAME() name,CONVERT(varchar(36),database_guid) guid,(SELECT CONVERT(nvarchar(128),value) FROM sys.extended_properties WHERE class=0 AND name=N'CodexUpgradeFixtureOwner') owner FROM sys.database_recovery_status WHERE database_id=DB_ID();")).recordset[0];
  assert.deepEqual(row,{name:f.database,guid:f.guid,owner:f.fixtureOwner});
 };
 const claim=async()=>{
  await verifyInstance();assert(await id());
  beta=await new f.sql.ConnectionPool({connectionString:`Driver={ODBC Driver 18 for SQL Server};Server=${f.server};Database=POS_Local_Beta;Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`,pool:{min:0,max:1},requestTimeout:120000}).connect();
  const row=(await beta.request().query("SELECT CONVERT(varchar(36),database_guid) guid,(SELECT CONVERT(nvarchar(128),value) FROM sys.extended_properties WHERE class=0 AND name=N'CodexBetaSetupOwner') owner FROM sys.database_recovery_status WHERE database_id=DB_ID();")).recordset[0];
  assert(row.guid&&row.guid!==f.guid);assert.equal(row.owner,null);betaGuid=row.guid;
  await beta.request().input("owner",f.sql.NVarChar(128),owner).query("EXEC sys.sp_addextendedproperty @name=N'CodexBetaSetupOwner',@value=@owner");
 };
 const removeBeta=async()=>{
  if(!await id())return;
  if(!beta)await claim();
  await verifyInstance();
  const row=(await beta.request().query("SELECT DB_NAME() name,CONVERT(varchar(36),database_guid) guid,(SELECT CONVERT(nvarchar(128),value) FROM sys.extended_properties WHERE class=0 AND name=N'CodexBetaSetupOwner') owner FROM sys.database_recovery_status WHERE database_id=DB_ID();")).recordset[0];
  assert.deepEqual(row,{name:"POS_Local_Beta",guid:betaGuid,owner});
  await beta.close();beta=null;
  await f.master.request().batch("ALTER DATABASE [POS_Local_Beta] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE [POS_Local_Beta];");betaGuid=null;
 };
 const check=async(name,work)=>{await work();passed++;console.log("PASS "+name);};
 const shapes=async()=>{for(const module of manifest.modules)await beta.request().batch(validationSql(module.shape,module.id));};
 const sibling=async()=>assert.deepEqual((await f.pool.request().query("SELECT * FROM dbo.SetupSiblingSentinel ORDER BY id")).recordset,[{id:1,value:"kept"}]);
 try{
  assert.equal(await id(),null,"Beta must be absent in newly owned instance");
  await f.pool.request().batch("CREATE TABLE dbo.SetupSiblingSentinel(id int PRIMARY KEY,value nvarchar(32));INSERT dbo.SetupSiblingSentinel VALUES(1,N'kept');");
  await check("caller transaction survives refusal before beta database creation",async()=>{
   const tx=new f.sql.Transaction(f.pool);await tx.begin();
   try{
    await new f.sql.Request(tx).batch("INSERT dbo.SetupSiblingSentinel VALUES(2,N'caller');");
    await assert.rejects(new f.sql.Request(tx).batch(artifact),/outside an existing transaction/);
    assert.deepEqual((await new f.sql.Request(tx).query("SELECT XACT_STATE() state,@@TRANCOUNT depth,(SELECT COUNT(*) FROM dbo.SetupSiblingSentinel) n")).recordset[0],{state:1,depth:1,n:2});
    assert.equal(await id(),null);
   }finally{await tx.rollback();}
  });
  await check("implicit transaction mode refuses before creating beta",async()=>{
   const wrapped="SET IMPLICIT_TRANSACTIONS ON;BEGIN TRY EXEC sys.sp_executesql @payload;END TRY BEGIN CATCH SET IMPLICIT_TRANSACTIONS OFF;IF XACT_STATE()<>0 ROLLBACK;THROW;END CATCH;SET IMPLICIT_TRANSACTIONS OFF;";
   await assert.rejects(f.master.request().input("payload",f.sql.NVarChar(f.sql.MAX),artifact).batch(wrapped),/implicit transactions OFF/);
   assert.equal(await id(),null);
  });
  await check("exact one-file artifact creates beta from master and installs all13 modules",async()=>{
   await f.master.request().batch(artifact);await claim();await shapes();await sibling();
  });
  const firstProof=admissionFixture();proofs.push(firstProof);
  await check("actual SQL proof rejects modified or additional default catalogue seeds",async()=>{
   await beta.request().query("UPDATE dbo.store_groups SET name=N'Changed fixture group' WHERE id=N'default'");
   await assert.rejects(firstProof.admission.inspect(beta,firstProof.profile,{schemaReady:true}),error=>error.code==="ECURRENT_LOCAL_FRESH");
   await beta.request().query("UPDATE dbo.store_groups SET name=N'Default group' WHERE id=N'default';INSERT dbo.store_groups(id,code,name) VALUES(N'extra-fixture',N'EXTRA',N'Extra fixture');");
   await assert.rejects(firstProof.admission.inspect(beta,firstProof.profile,{schemaReady:true}),error=>error.code==="ECURRENT_LOCAL_FRESH");
   await beta.request().query("DELETE dbo.store_groups WHERE id=N'extra-fixture'");
  });
  await check("actual SQL fresh admission locks/inspects the full schema and pins database GUID",async()=>{
   const validation=await validateDatabase({temporary:async(_profile,_database,work)=>work(beta)},firstProof.profile);
   assert(validation.ok&&validation.ready,"Actual app schema readiness failed: "+JSON.stringify({code:validation.code,status:validation.status,differences:validation.differences}));
   const inspected=await firstProof.admission.inspect(beta,firstProof.profile,{schemaReady:true});
   await assert.rejects(firstProof.admission.admit(beta,firstProof.profile,{schemaReady:true,expectedDatabase:{...inspected.database,guid:randomUUID()}}),error=>error.code==="ECURRENT_LOCAL_TARGET");
   const result=await firstProof.admission.admit(beta,firstProof.profile,{schemaReady:true,expectedDatabase:inspected.database});
   assert.equal(result.database.guid,betaGuid.toLowerCase());assert(firstProof.admission.canUseCurrent());
  });
  await removeBeta();
  await f.master.request().batch(packageSetupLocal().createSql);await claim();
  await check("existing empty beta installs from sibling query context without changing sibling",async()=>{
   await f.pool.request().batch(artifact);await shapes();await sibling();
  });
  await check("admission refuses a recreated database with the same name and another GUID",async()=>{
   await assert.rejects(firstProof.create().assertPool(beta,firstProof.profile),error=>error.code==="ECURRENT_LOCAL_TARGET");
  });
  const secondProof=admissionFixture();proofs.push(secondProof);await secondProof.admission.admit(beta,secondProof.profile,{schemaReady:true});
  await beta.request().batch("CREATE TABLE dbo.SetupPendingSentinel(id int PRIMARY KEY,payload nvarchar(100));INSERT dbo.SetupPendingSentinel VALUES(1,N'pending business evidence');CREATE ROLE SetupReader;GRANT SELECT ON dbo.products TO SetupReader;INSERT dbo.pos_store_settings_edit_commands(operation_id,branch_id,terminal_id,command_json,command_sha256) VALUES(NEWID(),N'BETA-SETUP',NEWID(),N'{\"pending\":true}',REPLICATE('a',64));");
  const retained=async()=>({
   rows:(await beta.request().query("SELECT * FROM dbo.SetupPendingSentinel FOR JSON PATH")).recordset,
   pending:(await beta.request().query("SELECT * FROM dbo.pos_store_settings_edit_commands ORDER BY operation_id FOR JSON PATH")).recordset,
   grants:(await beta.request().query("SELECT state,permission_name,USER_NAME(grantee_principal_id) grantee,major_id FROM sys.database_permissions ORDER BY grantee_principal_id,major_id,permission_name FOR JSON PATH")).recordset,
  });
  const before=await retained();
  await check("populated rerun refuses and preserves pending rows/grants and sibling",async()=>{
   await assert.rejects(f.master.request().batch(artifact),/Fresh setup requires an empty database/);
   assert.deepEqual(await retained(),before);await sibling();
  });
  await check("same admitted GUID restarts populated while a new admission refuses saved work",async()=>{
   await secondProof.create().assertPool(beta,secondProof.profile);
   const unadmitted=admissionFixture();proofs.push(unadmitted);
   await assert.rejects(unadmitted.admission.inspect(beta,unadmitted.profile,{schemaReady:true}),error=>error.code==="ECURRENT_LOCAL_FRESH");
   assert.deepEqual(await retained(),before);
  });
 }catch(error){console.error("Setup test failed: "+error.message);for(const e of error.precedingErrors??[])console.error(e.message);throw error;}
 finally{try{await removeBeta();}finally{await beta?.close();try{await f.close();}finally{for(const proof of proofs)proof.close();}}}
 console.log(JSON.stringify({passed,productionConnections:0,ownedBetaCleaned:true}));
}
if(require.main===module)main().catch(error=>{console.error(error.message);for(const e of error.precedingErrors??[])console.error(e.message);process.exitCode=1;});
