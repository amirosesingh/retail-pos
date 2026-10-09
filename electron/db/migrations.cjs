const fs=require("node:fs");
const path=require("node:path");
const { safeError }=require("./errors.cjs");
const { installerSections, migrationBundleSql, splitBatches, TARGET_GUARD, SESSION_OPTIONS }=require("./installer-source.cjs");

// Installing the initial schema executes a generated batch of roughly 800 KB.
// It is setup work, not a normal till query, so the operator's short runtime
// request timeout must not abort a healthy fresh installation.
const MIGRATION_REQUEST_TIMEOUT_MS=300_000;

function migrationFiles(){const directory=path.join(__dirname,"..","..","database","sqlserver","migrations");return fs.readdirSync(directory).filter(name=>/^\d+_.+\.sql$/i.test(name)).sort().map(name=>({name,path:path.join(directory,name)}));}
async function runScript(connectionManager,pool,sql){
 const driver=connectionManager.sql();
 for(const batch of splitBatches(sql)){
  if(/ALTER\s+DATABASE/i.test(batch)){await pool.request().batch(`${SESSION_OPTIONS}\n${batch}`);continue;}
  const transaction=new driver.Transaction(pool);await transaction.begin();
  try{await new driver.Request(transaction).batch(`${SESSION_OPTIONS}\n${batch}`);await transaction.commit();}
  catch(error){await Promise.resolve(transaction.rollback()).catch(()=>undefined);throw error;}
 }
}
async function runOnPool(connectionManager,pool){
 try{
  const installer=installerSections();
  await pool.request().batch(TARGET_GUARD);
  // Always install the current additive definitions, even on databases whose
  // version 001 was applied by an older application. The selected pool owns
  // the target; never execute the installer's master/USE bootstrap header.
  await runScript(connectionManager,pool,installer.schema);
  const applied=[];
  for(const file of installer.migrations){
   const version=file.version;
   const exists=await pool.request().input("version",version).query("IF OBJECT_ID(N'dbo.pos_schema_migrations',N'U') IS NULL SELECT CAST(0 AS bit) applied ELSE SELECT CAST(CASE WHEN EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version=@version) THEN 1 ELSE 0 END AS bit) applied;");
   if(exists.recordset?.[0]?.applied)continue;
   await runScript(connectionManager,pool,file.sql);
   applied.push(file.name);
  }
  // Validation is part of the same packaged source, not a separate stale list.
  await runScript(connectionManager,pool,installer.validation);
  return{ok:true,applied,schemaRepair:true,source:"retail-pos-local-database.sql"};
 }catch(error){return safeError(error);}
}
async function applyMigrations(connectionManager,profile=null){
 if(profile){
  const migrationProfile={
   ...profile,
   requestTimeoutMs:Math.max(Number(profile.requestTimeoutMs)||0,MIGRATION_REQUEST_TIMEOUT_MS),
  };
  return connectionManager.temporary(migrationProfile,profile.database,(pool)=>runOnPool(connectionManager,pool));
 }
 if(!(connectionManager.isConnected?.()??connectionManager.pool))return{ok:false,code:"EDATABASE",error:"SQL Server is not connected."};
 return runOnPool(connectionManager,connectionManager.pool);
}
function databaseIdentifier(value){
 const name=String(value??"");
 if(!name||name.length>128||/[;{}\\/\x00-\x1f]/.test(name))throw Object.assign(new Error("The database name is invalid."),{code:"EBADARG"});
 if(new Set(["master","model","msdb","tempdb"]).has(name.trim().toLowerCase()))throw Object.assign(new Error("A SQL Server system database cannot be used as the Retail POS database."),{code:"EBADARG"});
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
module.exports={applyMigrations,ensureDatabase,migrationFiles,migrationBundleSql,splitBatches,databaseIdentifier,MIGRATION_REQUEST_TIMEOUT_MS};
