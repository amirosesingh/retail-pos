"use strict";
// Offline packaging only. Execution is an explicit operator action on local SQL.
const path = require("node:path");
const { root } = require("./beta-local-upgrade.cjs");
const { packageFreshLocal } = require("./beta-local-fresh.cjs");
const { digest } = require("./existing-local-upgrade.cjs");
const outputPath = path.join(root, "database/beta/retail-pos-local-beta-setup.sql");
const literal = value => "N'" + value.replaceAll("'", "''") + "'";
function packageSetupLocal() {
  const fresh = packageFreshLocal();
  const install = "USE [POS_Local_Beta];\n" + fresh.sql;
  // New physical filenames avoid colliding with retained/unattached files.
  // Keep the SQL instance's operator-configured data/log directories.
  const createSql = [
    "IF DB_ID(N'POS_Local_Beta') IS NULL BEGIN",
    " DECLARE @data nvarchar(4000)=CONVERT(nvarchar(4000),SERVERPROPERTY('InstanceDefaultDataPath')),@log nvarchar(4000)=CONVERT(nvarchar(4000),SERVERPROPERTY('InstanceDefaultLogPath')),@suffix nvarchar(32)=REPLACE(CONVERT(nvarchar(36),NEWID()),N'-',N''),@create nvarchar(max);",
    " IF NULLIF(@data,N'') IS NULL OR NULLIF(@log,N'') IS NULL THROW 51036,'SQL Server default data/log directories could not be verified; no database was created.',1;",
    " SET @data=@data+CASE WHEN RIGHT(@data,1) IN(N'\\',N'/') THEN N'' ELSE N'\\' END+N'POS_Local_Beta_'+@suffix+N'_data.mdf';",
    " SET @log=@log+CASE WHEN RIGHT(@log,1) IN(N'\\',N'/') THEN N'' ELSE N'\\' END+N'POS_Local_Beta_'+@suffix+N'_log.ldf';",
    " SET @create=N'CREATE DATABASE [POS_Local_Beta] ON PRIMARY (NAME=N''POS_Local_Beta_data'',FILENAME=N'''+REPLACE(@data,N'''',N'''''')+N''') LOG ON (NAME=N''POS_Local_Beta_log'',FILENAME=N'''+REPLACE(@log,N'''',N'''''')+N''');';",
    " EXEC sys.sp_executesql @create;",
    "END;",
  ].join("\n");
  const master = [
    "USE [master];",
    "DECLARE @betaSetupLock int;",
    "EXEC @betaSetupLock=sys.sp_getapplock @Resource=N'RetailPOS.CreateLocalBeta.v1',@LockOwner=N'Session',@LockMode=N'Exclusive',@LockTimeout=0,@DbPrincipal=N'public';",
    "IF @betaSetupLock IS NULL OR @betaSetupLock<0 THROW 51033,'Another session is creating or preparing POS_Local_Beta.',1;",
    "BEGIN TRY",
    createSql,
    " EXEC sys.sp_executesql " + literal(install) + ";",
    " EXEC sys.sp_releaseapplock @Resource=N'RetailPOS.CreateLocalBeta.v1',@LockOwner=N'Session',@DbPrincipal=N'public';",
    "END TRY",
    "BEGIN CATCH",
    " IF XACT_STATE()<>0 ROLLBACK TRANSACTION;",
    " EXEC sys.sp_releaseapplock @Resource=N'RetailPOS.CreateLocalBeta.v1',@LockOwner=N'Session',@DbPrincipal=N'public';",
    " THROW;",
    "END CATCH;",
  ].join("\n");
  const sql = [
    "-- ONE-FILE LOCAL BETA SETUP: run this entire file once in SSMS.",
    "-- Connect to the intended LOCAL SQL Server instance. Any query database is OK.",
    "-- Creates only POS_Local_Beta if missing, selects it internally and installs",
    "-- the full reviewed Retail core plus all 13 implemented sync metadata modules.",
    "-- Requires permission to create a database if missing and CONTROL on the target.",
    "-- Existing empty target is allowed; populated/partial targets are refused unchanged.",
    "-- No production database, app connection setting, terminal or credential is changed.",
    "-- Creation/core/metadata commit separately. On failure retain the database/error;",
    "-- this file never drops a database or deletes pending work to recover an error.",
    "-- New files use unique names in the instance's configured data/log directories.",
    "-- Dynamic USE selects the install target; SSMS's original query context is restored.",
    "-- Strict fresh payload SHA256 " + fresh.sha256,
    "IF @@TRANCOUNT<>0 BEGIN RAISERROR('Run beta setup outside an existing transaction.',16,1); RETURN; END;",
    "IF (@@OPTIONS & 2)=2 BEGIN RAISERROR('Beta setup requires implicit transactions OFF; no database was created.',16,1); RETURN; END;",
    "EXEC sys.sp_executesql " + literal(master) + ";",
    "",
  ].join("\n");
  return { sql, sha256: digest(sql), freshSha256: fresh.sha256, createSql };
}
module.exports = { packageSetupLocal, outputPath };
