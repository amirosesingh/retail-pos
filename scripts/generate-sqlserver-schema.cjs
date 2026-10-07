const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const applicationVersion = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
).version;
const report = JSON.parse(
  fs.readFileSync(path.join(root, "reports", "supabase-schema-registry-report.json"), "utf8"),
);
const outputDir = path.join(root, "database", "sqlserver");
const PRIMARY_KEYS = Object.freeze({
  branch_telemetry: ["terminal_id"],
  pin_attempts: ["key"],
  public_flags: ["key"],
  secure_settings: ["key"],
  settings_locks: ["section"],
  settings_overrides: ["scope", "scope_id", "section"],
  staff_roles: ["slug"],
  stock_delta_applied: ["movement_id"],
  terminal_recovery_secrets: ["terminal_token_id"],
  pos_store_settings: ["store_id"],
  settings_scoped: ["scope", "scope_id", "key"],
});
const PULL_ONLY = new Set([
  "app_users",
  "cashiers",
  "staff_roles",
  "user_roles",
  "secure_settings",
  "settings_locks",
  "public_flags",
  "terminal_tokens",
  "terminal_recovery_secrets",
  "security_findings",
]);
const APPEND_ONLY = new Set([
  "shift_cash_counts",
  "shift_close_events",
  "shift_notifications",
  "shift_reconciliations",
  "authorization_action_history",
]);
const ORGANIZATION_SHARED = new Set([
  "stores",
  "store_groups",
  "coupon_campaigns",
  "payment_types",
  "staff_roles",
  "members",
  "membership_tiers",
]);

function sqlType(declaration) {
  const d = declaration.toLowerCase();
  const sized = (name, fallback) => new RegExp(`${name}\\s*\\(([^)]+)\\)`).exec(d)?.[1] ?? fallback;
  if (/^uuid\b/.test(d)) return "uniqueidentifier";
  if (/^bigint\b|^bigserial\b/.test(d)) return "bigint";
  if (/^integer\b|^serial\b/.test(d)) return "int";
  if (/^smallint\b/.test(d)) return "smallint";
  if (/^(?:numeric|decimal)\b/.test(d)) return `decimal(${sized("(?:numeric|decimal)", "38,12")})`;
  if (/^(?:double precision|real)\b/.test(d)) return "float";
  if (/^boolean\b/.test(d)) return "bit";
  if (/^(?:timestamp with time zone|timestamptz)\b/.test(d)) return "datetimeoffset(7)";
  if (/^timestamp without time zone\b|^timestamp\b/.test(d)) return "datetime2(7)";
  if (/^date\b/.test(d)) return "date";
  if (/^time\b/.test(d)) return "time(7)";
  if (/^bytea\b/.test(d)) return "varbinary(max)";
  if (/^character varying\b|^varchar\b/.test(d))
    return `nvarchar(${sized("(?:character varying|varchar)", "max")})`;
  if (/^character\b|^char\b/.test(d)) return `nchar(${sized("(?:character|char)", "1")})`;
  return "nvarchar(max)";
}

function defaultRule(declaration, type) {
  const found = /\bDEFAULT\s+(.+?)(?=\s+NOT NULL\b|\s+NULL\b|$)/i.exec(declaration)?.[1]?.trim();
  if (!found) return null;
  const json = /^'((?:''|[^'])*)'::jsonb$/i.exec(found.replace(/^\((.*)\)$/s, "$1"));
  if (json) return `N'${json[1]}'`;
  const clean = found.replace(/::[a-z ]+(?:\[\])?/gi, "").replace(/^\((.*)\)$/s, "$1");
  if (/^gen_random_uuid\(\)$/i.test(clean)) return "NEWID()";
  if (/^(?:now\(\)|CURRENT_TIMESTAMP)$/i.test(clean))
    return type.startsWith("datetimeoffset") ? "SYSDATETIMEOFFSET()" : "SYSUTCDATETIME()";
  if (/^true$/i.test(clean)) return "1";
  if (/^false$/i.test(clean)) return "0";
  if (/^nextval\(/i.test(clean)) return null;
  if (/^ARRAY\[/i.test(clean) || /^'\{/.test(clean)) return "N'[]'";
  if (/^-?\d+(?:\.\d+)?$/.test(clean) || /^N?'[^']*'$/.test(clean)) return clean;
  return null;
}

function unicodeSqlLiteral(statement) {
  return `N'${statement.replaceAll("'", "''")}'`;
}

const tables = report.tables.map((table, tableIndex) => ({
  cloudTable: table.name,
  sqlServerTable: table.name,
  scope: ORGANIZATION_SHARED.has(table.name) ? "organization" : "branch",
  direction: PULL_ONLY.has(table.name) ? "pull" : "bidirectional",
  retentionClass:
    /^(?:sales|sale_items|payment_transactions|refunds|audit_logs|item_activity_logs|shift_notifications)/.test(
      table.name,
    )
      ? "historical"
      : "current",
  insertRule: "idempotent_upsert",
  updateRule: APPEND_ONLY.has(table.name) ? "append_only" : "versioned",
  deleteRule: APPEND_ONLY.has(table.name) ? "none" : "tombstone",
  conflictRule: /^(?:sales|sale_items|payment_transactions|refunds)/.test(table.name)
    ? "immutable_reversal"
    : APPEND_ONLY.has(table.name)
      ? "immutable_reversal"
      : /^(?:item_activity_logs|stock_adjustments|stock_delta_applied)$/.test(table.name)
        ? "movement_delta"
        : "highest_version",
  dependencyOrder: tableIndex,
  testName: `registry_${table.name}`,
  columns: table.columns.map((column) => {
    let type = sqlType(column.declaration);
    const primaryNames = table.primaryKey?.length
      ? table.primaryKey
      : (PRIMARY_KEYS[table.name] ?? ["id"]);
    const primary = primaryNames.includes(column.name);
    const uniqueGroup = (table.uniqueKeys ?? []).findIndex((key) => key.includes(column.name));
    const unique =
      /\bUNIQUE\b/i.test(column.declaration) ||
      (uniqueGroup >= 0 && table.uniqueKeys[uniqueGroup]?.length === 1);
    const keyGroups = [primaryNames, ...(table.uniqueKeys ?? [])];
    const compositeKey = keyGroups.some((key) => key.length > 1 && key.includes(column.name));
    const indexed =
      primary ||
      uniqueGroup >= 0 ||
      ["store_id", "branch_id", "organization_id", "updated_at"].includes(column.name);
    if (indexed && type === "nvarchar(max)")
      type = compositeKey ? "nvarchar(128)" : "nvarchar(450)";
    const reference = /\bREFERENCES\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([^)]+)\)/i.exec(
      column.declaration,
    );
    const tableReference = table.foreignKeys?.find((item) => item.column === column.name);
    return {
      cloudColumn: column.name,
      sqlServerColumn: column.name,
      cloudType: column.declaration
        .split(/\s+(?:DEFAULT|NOT|NULL|CONSTRAINT|PRIMARY|REFERENCES|CHECK)\b/i)[0]
        .trim(),
      sqlServerType: type,
      // SQL Server forbids nullable columns in a PRIMARY KEY. Some legacy
      // cloud declarations are nullable even though the registry supplies a
      // canonical primary key for local storage, so the key wins here.
      nullable: primary ? false : column.nullable,
      defaultRule: defaultRule(column.declaration, type),
      primaryKey: primary,
      foreignKey: Boolean(reference || tableReference),
      foreignKeyTarget: reference
        ? { table: reference[1], column: reference[2].replace(/['"\s]/g, "") }
        : tableReference
          ? { table: tableReference.table, column: tableReference.targetColumn }
          : null,
      unique,
      uniqueGroup: uniqueGroup >= 0 ? `UQ_${table.name}_${uniqueGroup}` : null,
    };
  }),
}));

const tableByName = new Map(tables.map((table) => [table.cloudTable, table]));
// SQL Server requires both sides of a foreign key to have the same type,
// length, precision and scale. Cloud schemas can declare an identifier as
// unconstrained text on the child while the referenced key is bounded.
for (const table of tables) {
  for (const column of table.columns.filter((item) => item.foreignKeyTarget)) {
    const targetTable = tableByName.get(column.foreignKeyTarget.table);
    const targetColumn = targetTable?.columns.find(
      (item) => item.sqlServerColumn === column.foreignKeyTarget.column,
    );
    if (targetColumn) column.sqlServerType = targetColumn.sqlServerType;
  }
}
function dependencyDepth(table, visiting = new Set()) {
  if (visiting.has(table.cloudTable)) return 0;
  const next = new Set(visiting).add(table.cloudTable);
  const parents = table.columns
    .map((column) => column.foreignKeyTarget?.table)
    .filter((name) => name && name !== table.cloudTable && tableByName.has(name));
  return parents.length
    ? 1 + Math.max(...parents.map((name) => dependencyDepth(tableByName.get(name), next)))
    : 0;
}
for (const table of tables) table.dependencyOrder = dependencyDepth(table);

const registry = {
  version: 1,
  source: "supabase/schema.sql",
  generatedAt: report.generatedAt,
  tables,
};
const lines = [
  "-- Generated from supabase/schema.sql. Re-runnable and additive.",
  "SET ANSI_NULLS ON;",
  "SET QUOTED_IDENTIFIER ON;",
  "SET ANSI_PADDING ON;",
  "SET ANSI_WARNINGS ON;",
  "SET ARITHABORT ON;",
  "SET CONCAT_NULL_YIELDS_NULL ON;",
  "SET NUMERIC_ROUNDABORT OFF;",
  "SET XACT_ABORT ON;",
  "IF NOT EXISTS (SELECT 1 FROM sys.change_tracking_databases WHERE database_id=DB_ID()) ALTER DATABASE CURRENT SET CHANGE_TRACKING = ON (CHANGE_RETENTION = 7 DAYS, AUTO_CLEANUP = ON);",
  "GO",
];
for (const table of tables) {
  lines.push(
    `IF OBJECT_ID(N'dbo.${table.sqlServerTable}', N'U') IS NULL BEGIN CREATE TABLE dbo.[${table.sqlServerTable}] (`,
  );
  const columns = table.columns.map((column) => {
    const fallbackDefault = column.defaultRule
      ? ` CONSTRAINT [DF_${table.sqlServerTable}_${column.sqlServerColumn}] DEFAULT (${column.defaultRule})`
      : "";
    return `  [${column.sqlServerColumn}] ${column.sqlServerType}${column.nullable ? " NULL" : " NOT NULL"}${fallbackDefault}`;
  });
  const primary = table.columns
    .filter((column) => column.primaryKey)
    .map((column) => `[${column.sqlServerColumn}]`);
  if (primary.length)
    columns.push(`  CONSTRAINT [PK_${table.sqlServerTable}] PRIMARY KEY (${primary.join(", ")})`);
  lines.push(
    columns.join(",\n"),
    "); END;",
    `IF OBJECT_ID(N'dbo.${table.sqlServerTable}', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.${table.sqlServerTable}')) ALTER TABLE dbo.[${table.sqlServerTable}] ENABLE CHANGE_TRACKING;`,
  );
  for (const column of table.columns) {
    lines.push(
      `IF COL_LENGTH(N'dbo.${table.sqlServerTable}', N'${column.sqlServerColumn}') IS NULL ALTER TABLE dbo.[${table.sqlServerTable}] ADD [${column.sqlServerColumn}] ${column.sqlServerType} NULL;`,
    );
    if (column.defaultRule) {
      lines.push(`IF OBJECT_ID(N'dbo.${table.sqlServerTable}', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.${table.sqlServerTable}', N'${column.sqlServerColumn}') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.${table.sqlServerTable}') AND c.name=N'${column.sqlServerColumn}'
) ALTER TABLE dbo.[${table.sqlServerTable}] ADD CONSTRAINT [DF_${table.sqlServerTable}_${column.sqlServerColumn}] DEFAULT (${column.defaultRule}) FOR [${column.sqlServerColumn}];`);
    }
    if (!column.nullable && column.defaultRule) {
      const backfillStatement = `UPDATE dbo.[${table.sqlServerTable}] SET [${column.sqlServerColumn}]=${column.defaultRule} WHERE [${column.sqlServerColumn}] IS NULL;`;
      lines.push(`IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.${table.sqlServerTable}') AND name=N'${column.sqlServerColumn}' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql ${unicodeSqlLiteral(backfillStatement)};
  ALTER TABLE dbo.[${table.sqlServerTable}] ALTER COLUMN [${column.sqlServerColumn}] ${column.sqlServerType} NOT NULL;
END;`);
    }
    if (
      column.sqlServerType !== "nvarchar(max)" &&
      (["store_id", "branch_id", "organization_id", "updated_at"].includes(
        column.sqlServerColumn,
      ) ||
        column.primaryKey ||
        column.unique ||
        column.uniqueGroup ||
        column.foreignKey)
    ) {
      lines.push(
        `IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.${table.sqlServerTable}') AND c.name=N'${column.sqlServerColumn}' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[${table.sqlServerTable}] ALTER COLUMN [${column.sqlServerColumn}] ${column.sqlServerType}${column.nullable ? " NULL" : " NOT NULL"};`,
      );
    }
  }
  for (const column of table.columns.filter((item) => item.unique)) {
    const filter = column.nullable ? ` WHERE [${column.sqlServerColumn}] IS NOT NULL` : "";
    lines.push(
      `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.${table.sqlServerTable}') AND name=N'UX_${table.sqlServerTable}_${column.sqlServerColumn}') CREATE UNIQUE INDEX [UX_${table.sqlServerTable}_${column.sqlServerColumn}] ON dbo.[${table.sqlServerTable}]([${column.sqlServerColumn}])${filter};`,
    );
  }
  for (const [index, key] of (
    report.tables.find((item) => item.name === table.cloudTable)?.uniqueKeys ?? []
  ).entries()) {
    if (key.length < 2) continue;
    const nullableColumns = key.filter(
      (name) => table.columns.find((column) => column.sqlServerColumn === name)?.nullable,
    );
    const filter = nullableColumns.length
      ? ` WHERE ${nullableColumns.map((name) => `[${name}] IS NOT NULL`).join(" AND ")}`
      : "";
    lines.push(
      `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.${table.sqlServerTable}') AND name=N'UQ_${table.sqlServerTable}_${index}') CREATE UNIQUE INDEX [UQ_${table.sqlServerTable}_${index}] ON dbo.[${table.sqlServerTable}](${key.map((name) => `[${name}]`).join(",")})${filter};`,
    );
  }
  for (const column of table.columns.filter((item) =>
    ["store_id", "branch_id", "organization_id", "updated_at"].includes(item.sqlServerColumn),
  )) {
    lines.push(
      `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.${table.sqlServerTable}') AND name=N'IX_${table.sqlServerTable}_${column.sqlServerColumn}') CREATE INDEX [IX_${table.sqlServerTable}_${column.sqlServerColumn}] ON dbo.[${table.sqlServerTable}]([${column.sqlServerColumn}]);`,
    );
  }
}
for (const table of tables) {
  for (const column of table.columns.filter((item) => item.foreignKey && item.foreignKeyTarget)) {
    const target = column.foreignKeyTarget;
    lines.push(
      `IF OBJECT_ID(N'dbo.${target.table}',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.${table.sqlServerTable}') AND name=N'FK_${table.sqlServerTable}_${column.sqlServerColumn}') ALTER TABLE dbo.[${table.sqlServerTable}] ADD CONSTRAINT [FK_${table.sqlServerTable}_${column.sqlServerColumn}] FOREIGN KEY ([${column.sqlServerColumn}]) REFERENCES dbo.[${target.table}]([${target.column}]);`,
    );
  }
}

// Older generators interpreted a JSON object default (`{}'::jsonb`) as a
// PostgreSQL array and installed N'[]'. Correct only that known legacy value;
// user-defined defaults are left untouched. Each variable name is unique
// because the generated schema is one SQL Server batch.
let legacyJsonDefaultIndex = 0;
for (const table of tables) {
  for (const column of table.columns) {
    if (column.defaultRule !== "N'{}'") continue;
    const variable = `@legacy_json_default_${legacyJsonDefaultIndex++}`;
    const commandVariable = `${variable}_sql`;
    lines.push(`IF OBJECT_ID(N'dbo.${table.sqlServerTable}', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.${table.sqlServerTable}', N'${column.sqlServerColumn}') IS NOT NULL BEGIN
  DECLARE ${variable} sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.${table.sqlServerTable}')
      AND c.name=N'${column.sqlServerColumn}'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF ${variable} IS NOT NULL BEGIN
    DECLARE ${commandVariable} nvarchar(max) = N'ALTER TABLE dbo.[${table.sqlServerTable}] DROP CONSTRAINT ' + QUOTENAME(${variable});
    EXEC sys.sp_executesql ${commandVariable};
    ALTER TABLE dbo.[${table.sqlServerTable}] ADD CONSTRAINT [DF_${table.sqlServerTable}_${column.sqlServerColumn}] DEFAULT (N'{}') FOR [${column.sqlServerColumn}];
  END;
END;`);
  }
}

// A malformed multi-column ALTER used to turn this nullable number into a
// required JSON-valued column. Remove that generated default and restore the
// cloud-compatible nullable shape without changing any stored value.
lines.push(`IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_requests', N'requested_amount') IS NOT NULL BEGIN
  DECLARE @legacy_requested_amount_default sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_requests') AND c.name=N'requested_amount'
  );
  IF @legacy_requested_amount_default IS NOT NULL BEGIN
    DECLARE @legacy_requested_amount_default_sql nvarchar(max) = N'ALTER TABLE dbo.[authorization_requests] DROP CONSTRAINT ' + QUOTENAME(@legacy_requested_amount_default);
    EXEC sys.sp_executesql @legacy_requested_amount_default_sql;
  END;
  ALTER TABLE dbo.[authorization_requests] ALTER COLUMN [requested_amount] decimal(38,12) NULL;
END;`);

lines.push(`IF OBJECT_ID(N'dbo.pos_jobs', N'U') IS NULL CREATE TABLE dbo.pos_jobs (
 job_id uniqueidentifier NOT NULL PRIMARY KEY, job_type nvarchar(40) NOT NULL, status nvarchar(20) NOT NULL,
 organization_id nvarchar(128) NULL, organization_name nvarchar(256) NULL, branch_id nvarchar(128) NULL,
 branch_name nvarchar(256) NULL, branch_code nvarchar(64) NULL, terminal_id nvarchar(128) NULL,
 terminal_name nvarchar(256) NULL, phase nvarchar(40) NULL, current_table nvarchar(128) NULL,
 dependency_index int NOT NULL DEFAULT 0, last_committed_cursor nvarchar(512) NULL,
 completed_rows bigint NOT NULL DEFAULT 0, estimated_total_rows bigint NULL, completed_bytes bigint NOT NULL DEFAULT 0,
 batch_number int NOT NULL DEFAULT 0, batch_size int NOT NULL DEFAULT 500, retry_count int NOT NULL DEFAULT 0,
 next_retry_at datetimeoffset(7) NULL, started_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
 updated_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(), finished_at datetimeoffset(7) NULL,
 error_code nvarchar(64) NULL, error_message nvarchar(1000) NULL);`);
lines.push(`IF OBJECT_ID(N'dbo.sync_checkpoints', N'U') IS NULL CREATE TABLE dbo.sync_checkpoints (
 organization_id nvarchar(128) NOT NULL, branch_id nvarchar(128) NOT NULL, entity_type nvarchar(128) NOT NULL,
 direction nvarchar(8) NOT NULL, committed_cursor nvarchar(512) NULL, change_tracking_version bigint NULL,
 acknowledged_at datetimeoffset(7) NULL, updated_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
 CONSTRAINT PK_sync_checkpoints PRIMARY KEY (organization_id,branch_id,entity_type,direction));`);
lines.push(`IF OBJECT_ID(N'dbo.sync_change_journal', N'U') IS NULL CREATE TABLE dbo.sync_change_journal (
 change_id bigint IDENTITY(1,1) NOT NULL PRIMARY KEY, entity_type nvarchar(128) NOT NULL,
 entity_id nvarchar(128) NOT NULL, operation nvarchar(10) NOT NULL, branch_id nvarchar(128) NOT NULL,
 entity_version bigint NOT NULL, aggregate_id uniqueidentifier NULL, acknowledged_at datetimeoffset(7) NULL,
 retry_count int NOT NULL DEFAULT 0, last_error nvarchar(1000) NULL,
 created_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
 CONSTRAINT CK_sync_change_journal_metadata_only CHECK (operation IN ('insert','update','delete')));`);
lines.push(`IF COL_LENGTH(N'dbo.sync_change_journal',N'aggregate_id') IS NULL ALTER TABLE dbo.sync_change_journal ADD aggregate_id uniqueidentifier NULL;
IF COL_LENGTH(N'dbo.sync_change_journal',N'acknowledged_at') IS NULL ALTER TABLE dbo.sync_change_journal ADD acknowledged_at datetimeoffset(7) NULL;
IF COL_LENGTH(N'dbo.sync_change_journal',N'retry_count') IS NULL ALTER TABLE dbo.sync_change_journal ADD retry_count int NOT NULL CONSTRAINT DF_sync_change_journal_retry_count DEFAULT 0;
IF COL_LENGTH(N'dbo.sync_change_journal',N'last_error') IS NULL ALTER TABLE dbo.sync_change_journal ADD last_error nvarchar(1000) NULL;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.sync_change_journal') AND name=N'IX_sync_change_journal_pending') EXEC(N'CREATE INDEX IX_sync_change_journal_pending ON dbo.sync_change_journal(branch_id,acknowledged_at,aggregate_id,change_id)');`);
lines.push(`IF OBJECT_ID(N'dbo.sync_conflicts', N'U') IS NULL CREATE TABLE dbo.sync_conflicts (
 conflict_id uniqueidentifier NOT NULL PRIMARY KEY, entity_type nvarchar(128) NOT NULL, entity_id nvarchar(128) NOT NULL,
 branch_id nvarchar(128) NOT NULL, local_version bigint NULL, remote_version bigint NULL, reason nvarchar(1000) NOT NULL,
 status nvarchar(20) NOT NULL DEFAULT 'unresolved', created_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(), resolved_at datetimeoffset(7) NULL);`);
lines.push(`IF OBJECT_ID(N'dbo.local_operation_receipts', N'U') IS NULL CREATE TABLE dbo.local_operation_receipts (
 operation_id uniqueidentifier NOT NULL PRIMARY KEY, operation_type nvarchar(40) NOT NULL, entity_id nvarchar(128) NOT NULL,
 note nvarchar(400) NULL, committed_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET());`);
lines.push(`IF OBJECT_ID(N'dbo.pos_schema_migrations', N'U') IS NULL CREATE TABLE dbo.pos_schema_migrations (
 version int NOT NULL PRIMARY KEY, name nvarchar(200) NOT NULL, applied_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET());
IF NOT EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version=1) INSERT dbo.pos_schema_migrations(version,name) VALUES(1,N'initial_sqlserver_parity');`);

fs.mkdirSync(path.join(outputDir, "migrations"), { recursive: true });
fs.writeFileSync(
  path.join(outputDir, "schema-registry.json"),
  `${JSON.stringify(registry, null, 2)}\n`,
);
fs.writeFileSync(path.join(outputDir, "schema.sql"), `${lines.join("\n\n")}\n`);
fs.writeFileSync(path.join(outputDir, "migrations", "001_initial.sql"), `${lines.join("\n\n")}\n`);

const supplementalMigrationFiles = fs
  .readdirSync(path.join(outputDir, "migrations"))
  .filter((name) => /^\d+_.+\.sql$/i.test(name) && !name.startsWith("001_"))
  .sort();
const supplementalMigrations = supplementalMigrationFiles.map((name) =>
  fs.readFileSync(path.join(outputDir, "migrations", name), "utf8").trim(),
);
const requiredMigrationVersions = [
  1,
  ...supplementalMigrationFiles.map((name) => Number(name.split("_", 1)[0])),
];
const missingMigrationPredicate = requiredMigrationVersions
  .map(
    (version) => `NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = ${version})`,
  )
  .join(" OR ");

const installerHeader = `/*
  Retail POS local Microsoft SQL Server schema
  Generated from the migrations loaded by the POS application.

  Application version: ${applicationVersion}
  Target database: POS_Local

  Run this file while connected to the local Microsoft SQL Server instance.
  It creates POS_Local when needed, selects it, and installs or updates the
  complete schema. The script is additive and re-runnable. It does not delete
  tables or business data.
*/

USE [master];
GO

IF DB_ID(N'POS_Local') IS NULL
  EXEC(N'CREATE DATABASE [POS_Local]');
GO

USE [POS_Local];
GO`;
const tableValues = tables.map((table) => `  (N'${table.sqlServerTable}')`).join(",\n");
const requiredColumns = tables.flatMap((table) =>
  table.columns.map((column) => [table.sqlServerTable, column.sqlServerColumn]),
);
const columnInserts = [];
for (let index = 0; index < requiredColumns.length; index += 1_000) {
  const values = requiredColumns
    .slice(index, index + 1_000)
    .map(([table, column]) => `  (N'${table}', N'${column}')`)
    .join(",\n");
  columnInserts.push(`INSERT INTO @RequiredColumns (table_name, column_name) VALUES\n${values};`);
}
const validation = `DECLARE @RequiredTables TABLE ([name] sysname NOT NULL PRIMARY KEY);
INSERT INTO @RequiredTables ([name]) VALUES
${tableValues};

DECLARE @Required int = (SELECT COUNT(*) FROM @RequiredTables);
DECLARE @Present int = (
  SELECT COUNT(*)
  FROM @RequiredTables AS required_table
  WHERE OBJECT_ID(N'dbo.' + required_table.[name], N'U') IS NOT NULL
);
DECLARE @Missing int = @Required - @Present;

SELECT
  DB_NAME() AS database_name,
  N'${applicationVersion}' AS application_version,
  @Required AS required_tables,
  @Present AS present_tables,
  @Missing AS missing_tables,
  CASE WHEN @Missing = 0 THEN N'VALID' ELSE N'INCOMPLETE' END AS schema_status;

SELECT required_table.[name] AS missing_table
FROM @RequiredTables AS required_table
WHERE OBJECT_ID(N'dbo.' + required_table.[name], N'U') IS NULL
ORDER BY required_table.[name];

IF @Missing > 0
  THROW 51001, 'Retail POS local database schema validation failed.', 1;

DECLARE @RequiredColumns TABLE (
  table_name sysname NOT NULL,
  column_name sysname NOT NULL,
  PRIMARY KEY (table_name, column_name)
);
${columnInserts.join("\n")}

DECLARE @RequiredColumnCount int = (SELECT COUNT(*) FROM @RequiredColumns);
DECLARE @PresentColumnCount int = (
  SELECT COUNT(*)
  FROM @RequiredColumns AS required_column
  WHERE COL_LENGTH(N'dbo.' + required_column.table_name, required_column.column_name) IS NOT NULL
);
DECLARE @MissingColumnCount int = @RequiredColumnCount - @PresentColumnCount;

SELECT
  @RequiredColumnCount AS required_columns,
  @PresentColumnCount AS present_columns,
  @MissingColumnCount AS missing_columns,
  CASE WHEN @MissingColumnCount = 0 THEN N'VALID' ELSE N'INCOMPLETE' END AS column_status;

SELECT required_column.table_name AS table_name, required_column.column_name AS missing_column
FROM @RequiredColumns AS required_column
WHERE COL_LENGTH(N'dbo.' + required_column.table_name, required_column.column_name) IS NULL
ORDER BY required_column.table_name, required_column.column_name;

IF @MissingColumnCount > 0
  THROW 51003, 'Retail POS local database column validation failed.', 1;

IF OBJECT_ID(N'dbo.pos_schema_migrations', N'U') IS NULL
  THROW 51002, 'Retail POS local database migration history table is missing.', 1;

EXEC(N'IF ${missingMigrationPredicate}
  THROW 51002, ''Retail POS local database migration history is incomplete.'', 1;');

EXEC(N'SELECT version, name, applied_at
FROM dbo.pos_schema_migrations
ORDER BY version;');

PRINT N'Retail POS ${applicationVersion}: POS_Local installation and validation completed successfully.';
GO`;
const installer = [
  installerHeader,
  lines.join("\n\n").trim(),
  // Each migration is its own T-SQL batch. BEGIN/END does not scope DECLARE,
  // so migrations 006 and 008 otherwise redeclare the same variables.
  ...supplementalMigrations.map((sql) => `GO\n${sql}`),
  "GO",
  validation,
].join("\n\n");
fs.writeFileSync(path.join(outputDir, "retail-pos-local-database.sql"), `${installer}\n`);
console.log(
  `SQL Server schema: ${tables.length} domain tables, ${tables.reduce((n, t) => n + t.columns.length, 0)} columns`,
);
