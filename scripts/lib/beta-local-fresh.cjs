"use strict";
// Compose reviewed installers only. Never opens or creates an operator database.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { root, packageLocal } = require("./beta-local-upgrade.cjs");
const { digest } = require("./existing-local-upgrade.cjs");
const sourcePath = path.join(root, "database/beta/retail-pos-local-beta-fresh.sql");
const outputPath = path.join(root, "database/beta/retail-pos-local-beta-current-fresh.sql");
const literal = value => "N'" + value.replaceAll("'", "''") + "'";
function packageFreshLocal(targetName = "POS_Local_Beta") {
  assert(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(targetName));
  const source = fs.readFileSync(sourcePath, "utf8");
  assert.equal(digest(source), "89EE98CDAB9AAF4B19EE53EC6234F5A47EB201AB9B322BB0D996AFA63A728549", "Reviewed fresh installer changed");
  // Target substitution is internal to uniquely owned fixture tests only.
  // The distributed file always uses POS_Local_Beta. No CLI override exists.
  const fresh = source.replaceAll("N'POS_Local_Beta'", literal(targetName));
  const upgrade = packageLocal(undefined, targetName);
  const sql = [
    "-- Current Retail POS Beta FRESH local setup, not an existing-data upgrade.",
    "-- First create an EMPTY POS_Local_Beta on the intended isolated local instance.",
    "-- Select that database in SSMS, then run this entire file as one batch.",
    "-- Creates no database, changes no connection, refuses populated/wrong targets.",
    "-- Core setup and the metadata upgrade commit separately; stop on ANY error.",
    "-- Reviewed fresh source SHA256 " + digest(source),
    "-- Reviewed current metadata upgrade SHA256 " + upgrade.sha256,
    "IF @@TRANCOUNT<>0 BEGIN RAISERROR('Run fresh setup outside an existing transaction.',16,1); RETURN; END;",
    "IF DB_NAME() COLLATE Latin1_General_100_BIN2<>" + literal(targetName) + " OR DATALENGTH(DB_NAME())<>DATALENGTH(" + literal(targetName) + ")",
    " THROW 51031,'Select the exact empty isolated beta database for fresh setup; no change was applied.',1;",
    "IF COALESCE(HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'CONTROL'),0)<>1 THROW 51032,'Fresh setup requires database CONTROL.',1;",
    "DECLARE @currentFreshLock int;",
    "EXEC @currentFreshLock=sys.sp_getapplock @Resource=N'RetailPOS.LocalBetaFresh.v1',@LockOwner=N'Session',@LockMode=N'Exclusive',@LockTimeout=0,@DbPrincipal=N'public';",
    "IF @currentFreshLock IS NULL OR @currentFreshLock<0 THROW 51033,'Another session is preparing the beta database.',1;",
    "BEGIN TRY",
    " IF EXISTS(SELECT 1 FROM sys.objects WHERE is_ms_shipped=0) OR EXISTS(SELECT 1 FROM sys.change_tracking_databases WHERE database_id=DB_ID())",
    "  THROW 51034,'Fresh setup requires an empty database. For existing data use the reviewed upgrade file.',1;",
    " EXEC sys.sp_executesql " + literal(fresh) + ";",
    " IF @@TRANCOUNT<>0 THROW 51035,'Fresh core did not finish its transaction.',1;",
    " EXEC sys.sp_executesql " + literal(upgrade.sql) + ";",
    " EXEC sys.sp_releaseapplock @Resource=N'RetailPOS.LocalBetaFresh.v1',@LockOwner=N'Session',@DbPrincipal=N'public';",
    " SELECT DB_NAME() AS database_name,N'Fresh beta core and all 13 reviewed sync metadata modules are ready; no terminal enrolled' AS result;",
    "END TRY",
    "BEGIN CATCH",
    " IF XACT_STATE()<>0 ROLLBACK TRANSACTION;",
    " EXEC sys.sp_releaseapplock @Resource=N'RetailPOS.LocalBetaFresh.v1',@LockOwner=N'Session',@DbPrincipal=N'public';",
    " THROW;",
    "END CATCH;",
    "",
  ].join("\n");
  return { sql, sha256: digest(sql), sourceSha256: digest(source), upgradeSha256: upgrade.sha256 };
}
module.exports = { packageFreshLocal, sourcePath, outputPath };
