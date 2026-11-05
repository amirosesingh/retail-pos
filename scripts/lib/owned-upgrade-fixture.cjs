"use strict";
// Test/capture only: uniquely owned LocalDB, never a configured POS connection.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {installerSections,splitBatches,SESSION_OPTIONS}=require('../../electron/db/installer-source.cjs');
async function createOwnedUpgradeFixture({collation='SQL_Latin1_General_CP1_CI_AS'}={}){
 assert(['SQL_Latin1_General_CP1_CI_AS','Latin1_General_100_CI_AS','Latin1_General_100_BIN2'].includes(collation));
 const sql=require('mssql/msnodesqlv8'),suffix=randomUUID().replaceAll('-',''),instance='CodexUpgrade_'+suffix,database='UpgradeFixture_'+suffix;
 let owned=false,created=false,ownerAssigned=false,master,pool,server,guid;
 const control=(...args)=>{const r=spawnSync('C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe',args,{windowsHide:true,timeout:30000});const decode=v=>(v??Buffer.alloc(0)).toString(v?.includes(0)?'utf16le':'utf8').replace(/^\uFEFF/,'');const text=decode(r.stdout),error=decode(r.stderr);assert(!r.error&&r.status===0&&!/failed|unexpected error/i.test(text+error),text+error);return text;};
 const connect=async name=>{assert(name==='master'||name===database);return new sql.ConnectionPool({connectionString:`Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`,pool:{min:0,max:2},requestTimeout:60000}).connect();};
 const close=async()=>{
  if(created&&pool){const row=(await pool.request().query("SELECT DB_NAME() name,CONVERT(varchar(36),database_guid) guid,(SELECT CONVERT(nvarchar(128),value) FROM sys.extended_properties WHERE class=0 AND name=N'CodexUpgradeFixtureOwner') owner FROM sys.database_recovery_status WHERE database_id=DB_ID();")).recordset[0];assert(owned&&row.name===database&&row.guid===guid&&(row.owner===suffix||!ownerAssigned&&row.owner===null),'Refuse cleanup of unverified fixture');}
  await pool?.close();if(created){assert(owned&&guid&&/^UpgradeFixture_[a-f0-9]{32}$/.test(database));await master.request().batch(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE [${database}];`);}await master?.close();if(owned){control('stop',instance,'-k');control('delete',instance);console.log('Cleaned uniquely owned upgrade fixture');}
 };
 try{
  control('create',instance,'-s');owned=true;server=control('info',instance).match(/np:\\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query/)?.[0];assert(server);
  master=await connect('master');await master.request().batch(`CREATE DATABASE [${database}] COLLATE ${collation};`);created=true;pool=await connect(database);
  guid=(await pool.request().query('SELECT CONVERT(varchar(36),database_guid) guid FROM sys.database_recovery_status WHERE database_id=DB_ID();')).recordset[0].guid;
  await pool.request().input('owner',sql.NVarChar(128),suffix).query("EXEC sys.sp_addextendedproperty @name=N'CodexUpgradeFixtureOwner',@value=@owner;");ownerAssigned=true;
  const manager={pool,sql:()=>sql};
  const installCore=async()=>{const parts=installerSections();for(const source of [parts.schema,...parts.migrations.map(m=>m.sql),parts.validation])for(const batch of splitBatches(source))await pool.request().batch(SESSION_OPTIONS+'\n'+batch);};
  return{sql,pool,manager,database,guid,connect,installCore,close,collation};
 }catch(error){await close().catch(()=>{});throw error;}
}
module.exports={createOwnedUpgradeFixture};
