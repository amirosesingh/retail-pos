"use strict";
// Build-only. No connections, backup, target selection or operator data reads.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { sourceModules, manifestPath } = require("./package-existing-local-upgrade.cjs");
const { canonical, digest, renderExistingLocalUpgrade } = require("./lib/existing-local-upgrade.cjs");
const { validationSql, literal } = require("./lib/local-upgrade-catalogue.cjs");
const { installerSections } = require("../electron/db/installer-source.cjs");
const ROOT = path.resolve(__dirname, ".."), DIRECTORY = "database/sqlserver/recovery";
const FORMAT = "retail.shift-recovery-metadata.v1";
const IDS = ["028_retained_shift_evidence", "029_legacy_shift_recovery", "030_reviewed_shift_adoption"];
const MANUAL_SHA = "090F24031A07660C2D36512D2B38197A06491BB28408CCAAFDBB66FC400A4730";
const exec = sql => "EXEC sys.sp_executesql " + literal(sql) + ";";

function packageRecoveryMetadata(saved = JSON.parse(fs.readFileSync(manifestPath, "utf8"))) {
  assert.equal(saved.format, 1); assert.equal(saved.version, "1.4.82"); assert.equal(saved.registryTables, 70);
  const manual = fs.readFileSync(path.join(ROOT, "database/sqlserver/retail-pos-existing-upgrade-1.4.82.sql"));
  assert.equal(manual.length, 559560, "The published manual upgrade changed"); assert.equal(digest(manual), MANUAL_SHA);
  const core = installerSections();
  assert.equal(digest(canonical(core.schema)), saved.coreSources.schema, "Reviewed core source changed");
  assert.deepEqual(core.migrations.map(m => [m.name, digest(canonical(m.sql))]), saved.coreSources.migrations, "Reviewed core migrations changed");
  const sources = sourceModules().filter(module => IDS.includes(module.id));
  assert.deepEqual(sources.map(module => module.id), IDS);
  const modules = sources.map(module => {
    const reviewed = saved.modules.find(item => item.id === module.id);
    assert(reviewed && reviewed.sourceHash === module.canonicalHash, "Reviewed recovery module changed: " + module.id);
    assert.deepEqual(reviewed.shape.selectors, module.selectors);
    return { ...module, existingValidation: validationSql(reviewed.shape, module.id),
      existsSql: module.selectors.tables.map(name => `OBJECT_ID(${literal("dbo." + name)}) IS NOT NULL`).join(" OR ") };
  });
  const membershipStatus = saved.core.columns.find(column =>
    column.table_name === "members" && column.name === "membership_status");
  const canonicalDefault = "(N'active')";
  assert.deepEqual(
    [membershipStatus?.type_schema, membershipStatus?.type_name, membershipStatus?.max_length,
      membershipStatus?.nullable, membershipStatus?.default_name, membershipStatus?.default_definition],
    ["sys", "nvarchar", -1, 0, "DF_members_membership_status", canonicalDefault],
    "Reviewed membership status column changed",
  );
  // The old core installer used the same ASCII value without the Unicode
  // prefix. Recognize those exact catalogue bytes for recovery checks only.
  const definitionHashes = [canonicalDefault, "('active')"]
    .map(definition => "0x" + digest(Buffer.from(definition, "utf16le")));
  const fingerprintMarker = "DECLARE @fingerprint varchar(64);";
  const reviewedCore = validationSql(saved.core, "Retail schema24");
  assert.equal(reviewedCore.split(fingerprintMarker).length, 2, "Reviewed core validation layout changed");
  const coreValidation = reviewedCore.replace(fingerprintMarker,
    "INSERT @definitionVariants(category,table_name,name,field,canonical,lf_hash,windows_hash)\n" +
    " VALUES(N'columns',N'members',N'membership_status',N'default_definition'," +
    [literal(canonicalDefault), ...definitionHashes].join(",") + ");\n" + fingerprintMarker);
  const coreIdentity = digest(JSON.stringify(saved.core.fingerprints));
  const prefixes = Array.from({ length: 4 }, (_, prefix) => ({ prefix, state: prefix === 0 ? "absent" : prefix === 3 ? "matching" : "prefix",
    schemaFingerprint: digest(JSON.stringify({ format: FORMAT, coreSchemaVersion: 24, coreIdentity,
      modules: modules.slice(0, prefix).map(module => ({ id: module.id, fingerprints: saved.modules.find(item => item.id === module.id).shape.fingerprints })) })) }));
  // The probe reads only system catalogues and the migration ledger. It creates
  // no table/session state and never emits a private graph or business row.
  const probe = canonical([
    "-- READ ONLY: exact core24 and whole-module028-030 classification. No DDL or business data.",
    "DECLARE @coreState varchar(16)='unknown',@metadataState varchar(16)='unknown',@prefix int=NULL,@fingerprint varchar(64)=NULL,@reason varchar(64)='CORE_SCHEMA_UNRECOGNIZED';",
    "BEGIN TRY",
    " IF DB_NAME() IN(N'master',N'model',N'msdb',N'tempdb') OR OBJECT_ID(N'dbo.pos_schema_migrations',N'U') IS NULL THROW 51028,'Unsupported core',1;",
    " EXEC sys.sp_executesql N'IF NOT EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version=24) OR EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version>24) THROW 51028,''Unsupported core ledger'',1;';",
    " " + exec(coreValidation),
    " SET @coreState='supported';",
    "END TRY BEGIN CATCH SET @coreState='unknown'; END CATCH;",
    "IF @coreState='supported' BEGIN",
    " BEGIN TRY",
    ...modules.map((module, index) => `  DECLARE @exists${index} bit=CASE WHEN ${module.existsSql} THEN 1 ELSE 0 END;`),
    "  IF (@exists0=0 AND (@exists1=1 OR @exists2=1)) OR (@exists1=0 AND @exists2=1) THROW 51028,'Unrecognized recovery prefix',1;",
    "  SET @prefix=0;",
    ...modules.map((module, index) => `  IF @exists${index}=1 BEGIN ${exec(module.existingValidation)} SET @prefix=${index + 1}; END;`),
    "  SET @metadataState=CASE @prefix WHEN 0 THEN 'absent' WHEN 3 THEN 'matching' ELSE 'prefix' END;",
    "  SET @reason=CASE @prefix WHEN 0 THEN 'MISSING' WHEN 3 THEN 'COMPLETE' ELSE 'KNOWN_PREFIX' END;",
    `  SET @fingerprint=CASE @prefix ${prefixes.map(item => `WHEN ${item.prefix} THEN '${item.schemaFingerprint}'`).join(" ")} END;`,
    " END TRY BEGIN CATCH SET @metadataState='unknown';SET @prefix=NULL;SET @fingerprint=NULL;SET @reason='RECOVERY_SCHEMA_UNRECOGNIZED';END CATCH;",
    "END;",
    `SELECT N'${FORMAT}' contract,LOWER(CONVERT(varchar(36),database_guid)) database_guid,DB_NAME() database_name,@coreState core_state,@metadataState metadata_state,@prefix prefix,@fingerprint schema_fingerprint,@reason reason,@@TRANCOUNT transaction_count,XACT_STATE() transaction_state,CASE WHEN (@@OPTIONS&2)=2 THEN 1 ELSE 0 END implicit_transactions FROM sys.database_recovery_status WHERE database_id=DB_ID();`,
  ].join("\n"));
  const built = renderExistingLocalUpgrade({ version: "1.4.82", modules, coreValidation });
  const marker = " -- Validate the existing core before any new metadata is created.";
  assert.equal(built.sql.split(marker).length, 2);
  const fence = [
    " DECLARE @recoveryProbe TABLE(contract nvarchar(64),database_guid varchar(36),database_name nvarchar(128),core_state varchar(16),metadata_state varchar(16),prefix int,schema_fingerprint varchar(64),reason varchar(64),transaction_count int,transaction_state int,implicit_transactions int);",
    " INSERT @recoveryProbe " + exec(probe),
    " IF (SELECT COUNT(*) FROM @recoveryProbe)<>1 OR NOT EXISTS(SELECT 1 FROM @recoveryProbe WHERE database_guid=LOWER(CONVERT(varchar(36),@expectedDatabaseGuid)) AND core_state='supported' AND metadata_state IN('absent','prefix','matching') AND CONVERT(varbinary(64),schema_fingerprint)=CONVERT(varbinary(64),@expectedSchemaFingerprint) AND transaction_count=1 AND transaction_state=1 AND implicit_transactions=0) THROW 51028,'Recovery metadata target or schema changed; no update was applied.',1;",
  ].join("\n");
  let installer = built.sql.replace(marker, fence + "\n" + marker);
  const final = " SELECT CONVERT(nvarchar(128),SERVERPROPERTY('ServerName')) server_name,DB_NAME() database_name,CONVERT(varchar(36),database_guid) database_guid,N'1.4.82' application_version,N'Completed; no activation performed' result FROM sys.database_recovery_status WHERE database_id=DB_ID();";
  assert.equal(installer.split(final).length, 2);
  installer = installer.replace(final, " " + exec(probe));
  const callerGuard = "IF @@TRANCOUNT<>0 BEGIN RAISERROR('Run this update outside an existing transaction.',16,1); RETURN; END;";
  assert.equal(installer.split(callerGuard).length, 2);
  // RAISERROR+RETURN must be first, before any THROW or SET: THROW honors an
  // existing caller's XACT_ABORT and could otherwise roll back unrelated work.
  installer = installer.replace(callerGuard, callerGuard + "\n" +
    "IF @expectedDatabaseGuid IS NULL OR @expectedSchemaFingerprint IS NULL OR DATALENGTH(@expectedSchemaFingerprint)<>64 OR @expectedSchemaFingerprint COLLATE Latin1_General_100_BIN2 LIKE '%[^0-9A-F]%' THROW 51028,'Exact recovery metadata target parameters are required.',1;\n" +
    "IF (@@OPTIONS&2)=2 THROW 51028,'Recovery metadata requires a dedicated connection without implicit transactions.',1;");
  installer = canonical("-- RECOVERY-ONLY028-030: requires Main's verified backup, dedicated connection and exact target parameters.\n" + installer);
  const manifest = { format: FORMAT, coreSchemaVersion: 24,
    installer: { file: "shift-recovery-metadata.sql", sha256: digest(installer) },
    probe: { file: "shift-recovery-metadata-probe.sql", sha256: digest(probe) },
    modules: modules.map(module => ({ id: module.id, sourceHash: module.canonicalHash, tables: module.selectors.tables })),
    prefixes, manualUpgrade: { sha256: MANUAL_SHA, bytes: manual.length } };
  return { installer, probe, manifest, modules };
}
if (require.main === module) {
  assert.deepEqual(process.argv.slice(2), process.argv[2] === "--write" ? ["--write"] : ["--check"], "Use only --write or --check; no connection arguments");
  const result = packageRecoveryMetadata(), dir = path.join(ROOT, DIRECTORY);
  const outputs = { "shift-recovery-metadata.sql": result.installer, "shift-recovery-metadata-probe.sql": result.probe,
    "shift-recovery-metadata.manifest.json": JSON.stringify(result.manifest, null, 2) + "\n" };
  if (process.argv[2] === "--write") fs.mkdirSync(dir, { recursive: true });
  for (const [file, text] of Object.entries(outputs)) {
    if (process.argv[2] === "--write") fs.writeFileSync(path.join(dir, file), text, "utf8");
    else assert.equal(fs.readFileSync(path.join(dir, file), "utf8"), text, "Recovery artifact differs: " + file);
  }
  console.log(JSON.stringify(result.manifest));
}
module.exports = { packageRecoveryMetadata, FORMAT, IDS, DIRECTORY };
