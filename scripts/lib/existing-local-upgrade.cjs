"use strict";
// Packaging only. Never opens a connection or executes an operator's SQL.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { SESSION_OPTIONS, TARGET_GUARD } = require("../../electron/db/installer-source.cjs");
const canonical = text => String(text).replaceAll("\r\n", "\n").trimEnd() + "\n";
const digest = text => createHash("sha256").update(text, "utf8").digest("hex").toUpperCase();
const literal = text => "N'" + text.replaceAll("'", "''") + "'";

function nestedModule(module) {
  assert(module && /^[0-9]{3}_[a-z0-9_]+$/.test(module.id), "Invalid upgrade module identity");
  assert(typeof module.sql === "string" && module.sql.length > 0, "Missing complete module source");
  const rawHash = digest(module.sql), source = canonical(module.sql);
  assert.equal(module.sha256, rawHash, "Reviewed module bytes changed: " + module.id);
  // Existing individually transactional modules reject unrelated caller work.
  // This assembler owns its outer transaction and removes only that reviewed
  // initial guard. The module's own transaction/catch and shape guards remain.
  const initialGuard = /IF @@TRANCOUNT\s*<>\s*0\s+BEGIN\s+RAISERROR\('(?:[^']|'')*',\s*16,\s*1\);\s+RETURN;\s+END;\n/;
  const found = initialGuard.exec(source);
  if (module.standaloneGuard) {
    assert(found && !source.slice(0, found.index).split("\n").some(line => line.trim() && !line.trimStart().startsWith("--")), "Unexpected standalone guard: " + module.id);
  } else assert(!found, "Declare the module's standalone guard: " + module.id);
  const body = found ? source.slice(0, found.index) + source.slice(found.index + found[0].length) : source;
  // Inspect executable tokens, excluding comments and quoted SQL literals.
  const tokens = body.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'/g, " ");
  assert(!/^\s*GO\s*$/im.test(tokens), "A module must be one SQL batch: " + module.id);
  assert(!/\b(?:USE|DBCC|KILL|TRUNCATE|GRANT|REVOKE|DENY)\b|\b(?:CREATE|ALTER|DROP)\s+DATABASE\b/i.test(tokens), "Module changes database or privileges: " + module.id);
  assert.equal([...tokens.matchAll(/\bBEGIN\s+TRAN(?:SACTION)?\b/gi)].length, 1, "Expected one owned module transaction");
  assert.equal([...tokens.matchAll(/\bCOMMIT(?:\s+TRAN(?:SACTION)?)?\s*;/gi)].length, 1, "Expected one owned module commit");
  assert(!/\bRETURN\b/i.test(tokens), "An early module return could hide incomplete work");
  return { ...module, body, rawHash, canonicalHash: digest(source) };
}

function renderExistingLocalUpgrade({ version, modules, coreValidation }) {
  assert(/^\d+\.\d+\.\d+$/.test(version), "Invalid reviewed application version");
  assert(Array.isArray(modules) && modules.length, "No reviewed upgrade modules");
  assert(typeof coreValidation === "string" && coreValidation.trim(), "Missing core-schema validation");
  assert(!/^\s*GO\s*$/im.test(coreValidation), "Core validation must be one batch");
  const prepared = modules.map(nestedModule);
  assert.equal(new Set(prepared.map(m => m.id)).size, prepared.length, "Duplicate module identity");
  assert(prepared.every((m, i) => i === 0 || m.id > prepared[i - 1].id), "Module dependency order changed");
  const sql = canonical([
    `-- Retail ${version}: ONE existing-database metadata upgrade; PREPARATION ONLY.`,
    "-- Do not apply until this exact file and the actual server/database are approved.",
    "-- Close Retail safely and obtain the required backup before operator application.",
    "-- Select the existing Retail database in SSMS. No USE/CREATE DATABASE is run.",
    "-- No business backfill, stock adjustment, queue/checkpoint reset or activation.",
    "IF @@TRANCOUNT<>0 BEGIN RAISERROR('Run this update outside an existing transaction.',16,1); RETURN; END;",
    SESSION_OPTIONS,
    "SET NOCOUNT ON;",
    "BEGIN TRY",
    " BEGIN TRANSACTION;",
    TARGET_GUARD,
    " IF OBJECT_ID(N'dbo.pos_schema_migrations',N'U') IS NULL THROW 51028,'An existing managed Retail database is required.',1;",
    " IF NOT EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version=24) THROW 51028,'Reviewed Retail core schema 24 is required; no update was applied.',1;",
    " DECLARE @metadataLock int;",
    " EXEC @metadataLock=sys.sp_getapplock @Resource=N'RetailExistingMetadataUpgrade',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=3000;",
    " IF @metadataLock<0 THROW 51028,'Another database update is running; no update was applied.',1;",
    " -- Validate the existing core before any new metadata is created.",
    " EXEC sys.sp_executesql " + literal(coreValidation) + ";",
    ...prepared.flatMap(module => [
      `-- Module ${module.id}; reviewed canonical LF source SHA256 ${module.canonicalHash}`,
      " IF @@TRANCOUNT<>1 OR XACT_STATE()<>1 THROW 51028,'Upgrade transaction ownership changed.',1;",
      " EXEC sys.sp_executesql " + literal(module.body) + ";",
      " IF @@TRANCOUNT<>1 OR XACT_STATE()<>1 THROW 51028,'A metadata module did not complete its transaction.',1;",
    ]),
    " EXEC sys.sp_executesql " + literal(coreValidation) + ";",
    " COMMIT TRANSACTION;",
    ` SELECT CONVERT(nvarchar(128),SERVERPROPERTY('ServerName')) server_name,DB_NAME() database_name,CONVERT(varchar(36),database_guid) database_guid,N'${version}' application_version,N'Completed; no activation performed' result FROM sys.database_recovery_status WHERE database_id=DB_ID();`,
    "END TRY",
    "BEGIN CATCH",
    " IF XACT_STATE()<>0 ROLLBACK TRANSACTION;",
    " THROW;",
    "END CATCH;",
  ].join("\n"));
  return { sql, sha256: digest(sql), sources: prepared.map(({ id, rawHash, canonicalHash }) => ({ id, rawHash, canonicalHash })) };
}
module.exports = { canonical, digest, nestedModule, renderExistingLocalUpgrade };
