'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const sourceRevision = '918516e0f8528f23221f52c5958e34a3ce217d7d';
const project = 'irjkmhgrjgcaoixcixut';
const systemId = '7703759698107299042';
const migrationName = 'retail_pos_beta_stock_report_stocktake_v1';
const nativeDatabases = ['POS_Stock401_Beta_Till_A', 'POS_Stock401_Beta_Till_B'];
const manifestPath = 'database/beta/prepared/stock-report-stocktake-v1.manifest.json';
const outputDirectory = '.tmp/stock401-beta-approval';
const hostedMigrations = [
  '20261105113916_stock_history_effective_ledger',
  '20261105172030_stock_history_accepted_effect_capture',
  '20261105232647_stock_history_author_claim_admission',
  '20261106035442_stock_history_original_source_receipts',
  '20261106042742_stock_history_verified_source_membership',
  '20261106065813_stock_history_selected_time_period_reader',
  '20261106073851_stock_history_coverage_frontiers',
];
const hostedModules = [
  ['scripts/preparation/stock-history-recorded-openings.sql', false],
  ['scripts/preparation/stock-history-physical-stocktakes.sql', false],
  ['scripts/preparation/stock-history-stocktake-cutover.sql', false],
  ['scripts/preparation/stock-history-replica-export.sql', true],
];
const nativeModules = [
  'database/sqlserver/prepared/031_stock_history_effective_ledger.sql',
  'database/sqlserver/prepared/stock-history-stocktake-fence.sql',
];
const outputFiles = {
  preflight: 'stock-report-beta-preflight.readonly.sql',
  hosted: 'stock-report-beta-stocktake.supabase.sql',
  postflight: 'stock-report-beta-postflight.readonly.sql',
  native: 'stock-report-beta-stocktake.sqlserver.sql',
};

const sha256 = sql => createHash('sha256').update(sql, 'utf8').digest('hex');
const quote = text => `'${text.replaceAll("'", "''")}'`;
const ledgerVersions = hostedMigrations.map(name => quote(name.slice(0, 14))).join(', ');
const foldStockNames = scope => `${scope}.nspname IN ('public','private')`;
const knownLedger = `version IN (${ledgerVersions}) OR name = ${quote(migrationName)}`;
const existingObjects = `
 SELECT count(*) FROM pg_catalog.pg_class t JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
  WHERE ${foldStockNames('n')} AND t.relname ~ '^(pos_)?stock_history_'`;
const existingRoutines = `
 SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE ${foldStockNames('n')} AND p.proname ~ '^(pos_)?stock_history_'`;

function source(file, unwrap = false) {
  const raw = readFileSync(join(root, file));
  const sql = raw.toString('utf8').replaceAll('\r\n', '\n');
  assert(!sql.includes('\r') && !sql.startsWith('\uFEFF') && sql.endsWith('\n'), `Invalid SQL encoding: ${file}`);
  let body = sql;
  if (unwrap) {
    const wrapper = /^(?<header>(?:--[^\n]*\n)*)BEGIN;\n(?<content>[\s\S]+)\nCOMMIT;\n$/;
    const match = sql.match(wrapper);
    assert(match, `Unexpected outer transaction wrapper: ${file}`);
    body = `${match.groups.header}${match.groups.content}\n`;
  }
  return { body, evidence: { file, sourceSha256: sha256(sql), bodySha256: sha256(body), outerTransactionRemoved: unwrap } };
}

const hostHeader = `-- Exact candidate for Retail POS Beta (${project}).
-- Supabase apply_migration owns the transaction and migration ledger insert.
-- Installing this schema does not enroll tills, count stock or start a pause.
SET LOCAL lock_timeout='3s';
DO $stock401_target$
BEGIN
 IF current_database() <> 'postgres' OR current_user <> 'postgres'
  OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) IS DISTINCT FROM ${quote(systemId)}
 THEN RAISE EXCEPTION 'STOCK401_BETA_TARGET_UNVERIFIED'; END IF;
 IF to_regclass('supabase_migrations.schema_migrations') IS NULL
 THEN RAISE EXCEPTION 'STOCK401_MIGRATION_LEDGER_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE ${knownLedger})
  OR (${existingObjects}) <> 0 OR (${existingRoutines}) <> 0
 THEN RAISE EXCEPTION 'STOCK401_EXISTING_SCHEMA_REVIEW_REQUIRED'; END IF;
END $stock401_target$;
`;

const hostVerification = `DO $stock401_verify$
BEGIN
 IF private.stock_history_opening_capture_ready() IS NOT TRUE
  OR EXISTS(SELECT 1 FROM private.stock_history_cutover_scope)
  OR EXISTS(SELECT 1 FROM private.stock_history_cutover_leases)
  OR EXISTS(SELECT 1 FROM public.stock_history_baselines)
  OR EXISTS(SELECT 1 FROM public.stock_history_movements)
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname IN('stock_history_cutover_rows','stock_history_cutover_truncate'))
 THEN RAISE EXCEPTION 'STOCK401_INSTALL_VERIFICATION_FAILED'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname LIKE 'pos_stock_history_%'
    AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
      OR NOT has_function_privilege('service_role',p.oid,'EXECUTE')))
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE ${foldStockNames('n')} AND c.relkind='r' AND c.relname LIKE 'stock_history_%'
    AND (NOT c.relrowsecurity OR has_table_privilege('anon',c.oid,'SELECT') OR has_table_privilege('authenticated',c.oid,'SELECT')))
 THEN RAISE EXCEPTION 'STOCK401_INSTALL_GRANTS_UNVERIFIED'; END IF;
END $stock401_verify$;
`;

const nativeHeader = `-- Exact Retail POS Beta synthetic two-till SQL Server stocktake schema.
-- The reviewed caller sets SESSION_CONTEXT(N'pos_stock401_database_guid')
-- as the expected uniqueidentifier in this connection before this batch.
SET XACT_ABORT ON;
IF @@TRANCOUNT<>0 THROW 51031,'STOCK401_OUTER_TRANSACTION_NOT_ALLOWED',1;
DECLARE @stock401Target sql_variant=SESSION_CONTEXT(N'pos_stock401_database_guid');
DECLARE @stock401Guid uniqueidentifier=TRY_CONVERT(uniqueidentifier,CONVERT(nvarchar(128),@stock401Target));
IF @stock401Guid IS NULL OR SQL_VARIANT_PROPERTY(@stock401Target,N'BaseType')<>N'uniqueidentifier'
 OR DB_NAME() COLLATE Latin1_General_100_BIN2 NOT IN(${nativeDatabases.map(quote).map(name => `N${name}`).join(',')})
 OR NOT EXISTS (SELECT 1 FROM sys.database_recovery_status WHERE database_id=DB_ID() AND database_guid=@stock401Guid)
 THROW 51031,'STOCK401_BETA_NATIVE_TARGET_UNVERIFIED',1;
BEGIN TRANSACTION;
BEGIN TRY
`;
const nativeVerification = ` IF (SELECT COUNT(1) FROM sys.triggers WHERE object_id=OBJECT_ID(N'dbo.TR_stock_history_stocktake_products',N'TR')
  AND parent_id=OBJECT_ID(N'dbo.products',N'U') AND is_disabled=0 AND is_not_for_replication=0)<>1
  OR OBJECT_ID(N'dbo.pos_stock_history_arm_stocktake',N'P') IS NULL
  OR OBJECT_ID(N'dbo.pos_stock_history_release_stocktake',N'P') IS NULL
  OR EXISTS(SELECT 1 FROM dbo.stock_history_stocktake_fences)
  OR NOT EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version=31 AND name=N'stock_history_effective_ledger')
  THROW 51031,'STOCK401_BETA_NATIVE_INSTALL_UNVERIFIED',1;
 COMMIT;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
`;

function compose(modules) {
  return modules.map(({ body, evidence }) => `\n-- Source: ${evidence.file}\n${body}`).join('');
}

function buildPackage() {
  const hosted = [...hostedMigrations.map(name => [`supabase/migrations/${name}.sql`, true]), ...hostedModules]
    .map(([file, unwrap]) => source(file, unwrap));
  const local = nativeModules.map(file => source(file));
  const hostedPayload = hostHeader + compose(hosted) + '\n' + hostVerification;
  assert(!/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;\s*$/im.test(hostedPayload), 'Unexpected hosted transaction statement');
  const payloads = {
    preflight: `-- Read-only. Select the Retail POS Beta project in the connector.\nSELECT current_database() database_name,current_user sql_role,\n (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) system_id,\n current_setting('server_version') server_version,\n (${existingObjects}) stock_relations,(${existingRoutines}) stock_routines,\n (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE ${knownLedger}) stock_migrations,\n (SELECT count(*) FROM public.stores WHERE code LIKE 'CODEX-STOCK401-%') prepared_pilot_branches;\n`,
    hosted: hostedPayload,
    postflight: `-- Read-only. Run immediately after the named migration and before guard provisioning.\nSELECT (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) system_id,\n (SELECT jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',cardinality(statements)))\n   FROM supabase_migrations.schema_migrations WHERE name=${quote(migrationName)}) tool_migration,\n private.stock_history_opening_capture_ready() capture_fingerprints_match,\n (SELECT count(*) FROM private.stock_history_cutover_scope) enrolled_branches,\n (SELECT count(*) FROM private.stock_history_cutover_leases) pause_leases,\n (SELECT count(*) FROM public.stock_history_baselines) opened_baselines,\n has_function_privilege('service_role','public.pos_stock_history_replica_manifest(text,text)','EXECUTE') replica_service_access,\n has_function_privilege('authenticated','public.pos_stock_history_replica_manifest(text,text)','EXECUTE') replica_user_access;\n`,
    native: nativeHeader + compose(local) + '\n' + nativeVerification,
  };
  const artifacts = Object.fromEntries(Object.entries(payloads).map(([kind, sql]) => [kind, {
    file: `${outputDirectory}/${outputFiles[kind]}`, sha256: sha256(sql), bytes: Buffer.byteLength(sql, 'utf8'),
  }]));
  return { manifest: {
    format: 1, sourceRevision, purpose: 'Retail POS Beta first stocktake schema preparation only',
    supabase: { project, systemId, migrationName, transactionOwner: 'Supabase Management API migration transaction',
      preparedSourceVersions: hostedMigrations.map(name => name.slice(0, 14)), sources: hosted.map(item => item.evidence) },
    sqlServer: { databaseNames: nativeDatabases, sessionGuidKey: 'pos_stock401_database_guid', transactionOwner: 'prepared batch',
      sources: local.map(item => item.evidence) }, artifacts,
  }, payloads };
}

function verifyPackage() {
  const prepared = buildPackage();
  assert.deepEqual(prepared.manifest, JSON.parse(readFileSync(join(root, manifestPath), 'utf8')), 'Reviewed STOCK401 package differs');
  return prepared;
}

if (require.main === module) {
  assert.deepEqual(process.argv.slice(2), ['--prepare']);
  const { manifest, payloads } = verifyPackage();
  mkdirSync(join(root, outputDirectory), { recursive: true });
  for (const [kind, artifact] of Object.entries(manifest.artifacts)) {
    const file = join(root, artifact.file);
    writeFileSync(file, payloads[kind], 'utf8');
    assert.equal(sha256(readFileSync(file, 'utf8')), artifact.sha256);
    console.log(`${artifact.sha256}  ${file}`);
  }
}

module.exports = { buildPackage, verifyPackage };
