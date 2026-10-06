const fs=require("node:fs");
const path=require("node:path");
const { safeError }=require("./errors.cjs");

function migrationFiles(){const directory=path.join(__dirname,"..","..","database","sqlserver","migrations");return fs.readdirSync(directory).filter(name=>/^\d+_.+\.sql$/i.test(name)).sort().map(name=>({name,path:path.join(directory,name)}));}
const schemaFile=()=>path.join(__dirname,"..","..","database","sqlserver","schema.sql");
const splitBatches=(sql)=>String(sql).split(/^\s*GO\s*$/gim).map(value=>value.trim()).filter(Boolean);
async function runScript(connectionManager,pool,sql){
 const driver=connectionManager.sql();
 for(const batch of splitBatches(sql)){
  if(/ALTER\s+DATABASE/i.test(batch)){await pool.request().batch(batch);continue;}
  const transaction=new driver.Transaction(pool);await transaction.begin();
  try{await new driver.Request(transaction).batch(batch);await transaction.commit();}
  catch(error){await Promise.resolve(transaction.rollback()).catch(()=>undefined);throw error;}
 }
}
async function runOnPool(connectionManager,pool){
 try{
  const applied=[];
  for(const file of migrationFiles()){
   const version=Number(file.name.split("_",1)[0]);
   const exists=await pool.request().input("version",version).query("IF OBJECT_ID(N'dbo.pos_schema_migrations',N'U') IS NULL SELECT CAST(0 AS bit) applied ELSE SELECT CAST(CASE WHEN EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version=@version) THEN 1 ELSE 0 END AS bit) applied;");
   if(exists.recordset?.[0]?.applied)continue;
   await runScript(connectionManager,pool,fs.readFileSync(file.path,"utf8"));
   applied.push(file.name);
  }
  // Version 001 is regenerated for a new installation. Existing tills already
  // record it as applied, so an application update must also run the current
  // additive schema to install columns/indexes introduced after that baseline.
  const schemaRepair=!applied.includes("001_initial.sql");
  if(schemaRepair)await runScript(connectionManager,pool,fs.readFileSync(schemaFile(),"utf8"));
  return{ok:true,applied,schemaRepair};
 }catch(error){return safeError(error);}
}
async function applyMigrations(connectionManager,profile=null){
 if(profile)return connectionManager.temporary(profile,profile.database,(pool)=>runOnPool(connectionManager,pool));
 if(!(connectionManager.isConnected?.()??connectionManager.pool))return{ok:false,code:"EDATABASE",error:"SQL Server is not connected."};
 return runOnPool(connectionManager,connectionManager.pool);
}
function databaseIdentifier(value){
 const name=String(value??"");
 if(!name||name.length>128||/[;{}\\/\x00-\x1f]/.test(name))throw Object.assign(new Error("The database name is invalid."),{code:"EBADARG"});
 return`[${name.replaceAll("]","]]")}]`;
}
async function ensureDatabase(connectionManager,profile){
 try{
  const database=String(profile?.database??"");
  const identifier=databaseIdentifier(database);
  const ensured=await connectionManager.temporary(profile,"master",async(pool)=>{
   const found=await pool.request().input("database",database).query("SELECT DB_ID(@database) database_id;");
   if(found.recordset?.[0]?.database_id!=null)return{ok:true,created:false,database};
   try{await pool.request().batch(`CREATE DATABASE ${identifier};`);}
   catch(error){
    // Another terminal may have created the same database after our check.
    if(Number(error?.number)!==1801)throw error;
   }
   const confirmed=await pool.request().input("database",database).query("SELECT DB_ID(@database) database_id;");
   if(confirmed.recordset?.[0]?.database_id==null)throw Object.assign(new Error("SQL Server did not create the requested database."),{code:"EDATABASE"});
   return{ok:true,created:true,database};
  });
  const inspection=await connectionManager.temporary(profile,database,async(pool)=>{
   const result=await pool.request().query("SELECT COUNT(*) user_table_count, OBJECT_ID(N'dbo.pos_schema_migrations',N'U') migration_table_id FROM sys.tables WHERE is_ms_shipped=0;");
   const row=result.recordset?.[0]??{};
   return{userTableCount:Number(row.user_table_count??0),managed:row.migration_table_id!=null};
  });
  if(!ensured.created&&inspection.userTableCount>0&&!inspection.managed){
   throw Object.assign(new Error("The selected database contains tables but is not a managed Retail POS database. Choose an empty database or the existing POS database."),{code:"ESCHEMA"});
  }
  return{...ensured,...inspection};
 }catch(error){
  if(error?.code==="ESCHEMA")return{ok:false,code:"ESCHEMA",error:String(error.message),hint:"No existing tables were changed."};
  return safeError(error,"The local POS database could not be created.");
 }
}
function migrationBundleSql(appVersion="current"){
 const header=[
  "-- Retail POS local SQL Server migration bundle",
  `-- Application version: ${String(appVersion).replace(/[^0-9A-Za-z._-]/g,"")}`,
  "-- In SQL Server Management Studio, select the configured POS database before running this file.",
  "IF DB_NAME() IN (N'master',N'model',N'msdb',N'tempdb') THROW 51003, 'Select the configured Retail POS database before applying this migration.', 1;",
  "GO",
 ];
 const numbered=migrationFiles().flatMap(file=>[`-- ${file.name}`,fs.readFileSync(file.path,"utf8").trim(),"GO"]);
 return [...header,...numbered,"-- Current additive schema repair",fs.readFileSync(schemaFile(),"utf8").trim(),""].join("\n\n");
}
module.exports={applyMigrations,ensureDatabase,migrationFiles,migrationBundleSql,splitBatches,databaseIdentifier};
