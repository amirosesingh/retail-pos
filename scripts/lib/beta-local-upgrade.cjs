"use strict";
// Offline artifact assembly only. No configured/operator connection is opened.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { sourceModules: reviewedModules, SELECTORS } = require("../package-existing-local-upgrade.cjs");
const { canonical, digest, renderExistingLocalUpgrade } = require("./existing-local-upgrade.cjs");
const { validationSql, literal } = require("./local-upgrade-catalogue.cjs");
const { installerSections } = require("../../electron/db/installer-source.cjs");
const root = path.resolve(__dirname, "../..");
const manifestPath = path.join(root, "database/beta/prepared/current-local-upgrade-baseline.json");
const outputPath = path.join(root, "database/beta/retail-pos-local-beta-upgrade.sql");
const extras = [
  ["040_sale_event_outbox", "pos-sale-outbox-v1.sql", ["pos_sync_sale_outbox_v1"], "standalone-sale-guard"],
  ["041_sale_acceptance", "pos-sale-acceptance-v1.sql", ["pos_sync_sale_acceptance_v1"], "standalone-sale-guard"],
  ["042_grouped_stock", "pos-sync-live-stock-native-v1.sql", ["pos_sync_grouped_stock_v1"], "add-owned-transaction"],
  ["043_refund_receipt", "pos-sync-refund-native-receipt-v1.sql", ["local_operation_receipts"], "unchanged"],
  ["044_recovery_pages", "pos-sync-cash-settings-recovery-stage-v1.sql", ["pos_sync_cash_settings_recovery_pages_v1"], "add-owned-transaction"],
  ["045_settings_commands", "pos-store-settings-edit-outbox-v1.sql", ["pos_store_settings_edit_commands", "pos_store_settings_edit_receipts"], "unchanged"],
  ["046_settings_reviews", "pos-store-settings-edit-review-v1.sql", ["pos_store_settings_edit_reviews"], "unchanged"],
];
const refundColumns = ["refund_branch_id", "refund_evidence_json", "refund_acceptance_json"];

function adaptSource(sql, adapter) {
  if (adapter === "unchanged") return sql;
  if (adapter === "standalone-sale-guard") {
    const guard = /^IF @@TRANCOUNT <> 0 THROW 51041, 'Sale (?:event|acceptance) preparation requires no caller transaction\.', 1;\r?\n/gm;
    assert.equal([...sql.matchAll(guard)].length, 1, "Unexpected reviewed sale guard");
    return sql.replace(guard, "-- The generated bundle owns the transaction; the module transaction remains.\n");
  }
  assert.equal(adapter, "add-owned-transaction");
  assert(!/\b(?:BEGIN\s+TRAN|COMMIT|ROLLBACK)\b/i.test(sql), "Unexpected transaction in raw metadata source");
  return "SET XACT_ABORT ON;\nBEGIN TRANSACTION;\n" + sql + "\nCOMMIT;\n";
}

function sourceModules() {
  const old = reviewedModules().map(module => ({
    ...module,
    originalSha256: module.sha256,
    adapter: "reviewed-existing-module",
    selectors: { ...SELECTORS[module.id], normalizeSystemNames: true },
  }));
  return [...old, ...extras.map(([id, name, tables, adapter]) => {
    const file = "scripts/preparation/" + name;
    const original = fs.readFileSync(path.join(root, file), "utf8");
    const sql = adaptSource(original, adapter);
    return { id, file, sql, standaloneGuard: false, adapter,
      originalSha256: digest(original), sha256: digest(sql),
      canonicalHash: digest(canonical(sql)),
      selectors: { tables, normalizeSystemNames: true },
      probeColumns: id === "043_refund_receipt" ? refundColumns.map(column => ({ table: "local_operation_receipts", column })) : null };
  })];
}

function coreSources() {
  const parts = installerSections();
  return { schema: digest(canonical(parts.schema)), migrations: parts.migrations.map(m => [m.name, digest(canonical(m.sql))]) };
}

function packageLocal(manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")), targetName = manifest.targetDatabase) {
  assert.equal(manifest.format, 1);
  assert.equal(manifest.coreVersion, 24);
  assert.equal(manifest.targetDatabase, "POS_Local_Beta");
  assert(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(targetName), "Invalid target database");
  assert.deepEqual(coreSources(), manifest.coreSources, "Reviewed core source changed");
  const sources = sourceModules();
  assert.deepEqual(sources.map(m => m.id), manifest.modules.map(m => m.id), "Metadata module order changed");
  const modules = sources.map(source => {
    const saved = manifest.modules.find(m => m.id === source.id);
    assert.equal(source.originalSha256, saved.originalSha256, "Reviewed source changed: " + source.id);
    assert.equal(digest(canonical(source.sql)), saved.adaptedCanonicalSha256, "Reviewed adapter changed: " + source.id);
    assert.deepEqual(source.selectors, saved.shape.selectors);
    const probes = source.probeColumns
      ? source.probeColumns.map(c => `COL_LENGTH(${literal("dbo." + c.table)},${literal(c.column)}) IS NOT NULL`)
      : [...source.selectors.tables.map(t => `OBJECT_ID(${literal("dbo." + t)}) IS NOT NULL`),
        ...(source.selectors.columns ?? []).map(c => `COL_LENGTH(${literal("dbo." + c.table)},${literal(c.column)}) IS NOT NULL`)];
    return { ...source, existsSql: probes.join(" OR "), existingValidation: validationSql(saved.shape, source.id) };
  });
  const built = renderExistingLocalUpgrade({ version: manifest.applicationVersion, modules,
    coreValidation: validationSql(manifest.core, "Beta core schema24") });
  const target = `-- Beta-only target. Production needs its separately reviewed package.\nIF DB_NAME() COLLATE Latin1_General_100_BIN2<>${literal(targetName)} OR DATALENGTH(DB_NAME())<>DATALENGTH(${literal(targetName)})\n  THROW 51031,'Select the exact isolated beta database; no update was applied.',1;\nIF OBJECT_ID(N'dbo.pos_schema_migrations',N'U') IS NOT NULL\n  EXEC sys.sp_executesql N'IF EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version>24) THROW 51031,''A newer core schema requires a new reviewed package.'',1;';\n`;
  const callerGuard = "IF @@TRANCOUNT<>0 BEGIN RAISERROR('Run this update outside an existing transaction.',16,1); RETURN; END;";
  assert.equal(built.sql.split(callerGuard).length, 2, "Caller transaction guard changed");
  const sql = canonical(built.sql.replace(callerGuard, callerGuard + "\n" + target));
  return { sql, sha256: digest(sql), sources };
}

module.exports = { root, manifestPath, outputPath, extras, sourceModules, coreSources, packageLocal, adaptSource };
