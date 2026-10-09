const fs = require("node:fs");
const path = require("node:path");
const INSTALLER_PATH = path.join(__dirname, "..", "..", "database", "sqlserver", "retail-pos-local-database.sql");
const splitBatches = sql => String(sql).split(/^\s*GO\s*$/gim).map(value=>value.trim()).filter(Boolean);
const SESSION_OPTIONS = "SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET ARITHABORT ON; SET CONCAT_NULL_YIELDS_NULL ON; SET NUMERIC_ROUNDABORT OFF; SET XACT_ABORT ON;";
const TARGET_GUARD = `IF DB_NAME() IN (N'master',N'model',N'msdb',N'tempdb')
  THROW 51003, 'Select the configured Retail POS database before applying this update.', 1;
IF EXISTS (SELECT 1 FROM sys.tables WHERE is_ms_shipped=0)
   AND OBJECT_ID(N'dbo.pos_schema_migrations',N'U') IS NULL
  THROW 51003, 'This is not an empty or managed Retail POS database. No tables were changed.', 1;`;

function installerSections() {
  const source=fs.readFileSync(INSTALLER_PATH,"utf8");
  const start=source.indexOf("-- SECTION 1:");
  const end=source.indexOf("-- SECTION 3:");
  if(start<0||end<start)throw new Error("The packaged local database installer is incomplete. Rebuild the application.");
  const body=source.slice(start,end);
  const marker=/-- SECTION 2: Local upgrade (\d+_[\w-]+\.sql)\s*\r?\n/g;
  const matches=[...body.matchAll(marker)];
  const trimGo=text=>text.replace(/\s*GO\s*$/i,"").trim();
  const schema=trimGo(body.slice(0,matches[0]?.index??body.length));
  const migrations=matches.map((match,index)=>({name:match[1],version:Number(match[1].split('_')[0]),sql:trimGo(body.slice(match.index+match[0].length,matches[index+1]?.index??body.length))}));
  if(!migrations.length)throw new Error("The packaged installer contains no local upgrades.");
  return {schema,migrations,validation:source.slice(end)};
}

function migrationBundleSql(appVersion="current") {
  const {schema,migrations,validation}=installerSections();
  const literal=sql=>`N'${sql.replaceAll("'","''")}'`;
  const execute=sql=>splitBatches(sql).map(batch=>/ALTER\s+DATABASE/i.test(batch)
    ? `EXEC sys.sp_executesql ${literal(batch)};`
    : `BEGIN TRANSACTION;\nEXEC sys.sp_executesql ${literal(batch)};\nCOMMIT TRANSACTION;`).join('\n');
  // One outer batch prevents SSMS from continuing after a failed GO batch.
  return [`-- Retail POS local database update — ${String(appVersion).replace(/[^0-9A-Za-z._-]/g,"")}`,
    "-- Source: retail-pos-local-database.sql bundled with this application.",
    "-- Select your configured POS database. This file never switches databases.",
    "-- Back up the existing database before upgrading. No business rows are deleted.",
    SESSION_OPTIONS, "BEGIN TRY",TARGET_GUARD,execute(schema),
    ...migrations.map(file=>`-- ${file.name}\nEXEC sys.sp_executesql ${literal(`IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version=${file.version})\nBEGIN\n${execute(file.sql)}\nEND;`)};`),
    execute(validation),"END TRY", "BEGIN CATCH", "IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;", "THROW;", "END CATCH;", ""].join('\n');
}
module.exports={installerSections,migrationBundleSql,splitBatches,TARGET_GUARD,INSTALLER_PATH,SESSION_OPTIONS};
