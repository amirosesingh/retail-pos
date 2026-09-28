const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const registry = JSON.parse(fs.readFileSync(path.join(root, "database", "sqlserver", "schema-registry.json"), "utf8"));
const tables = [...registry.tables].sort((a, b) => a.dependencyOrder - b.dependencyOrder || a.cloudTable.localeCompare(b.cloudTable));
const localOnly = ["schema_migrations", "sync_checkpoints", "sync_change_journal", "sync_conflicts", "database_jobs", "local_operation_receipts"];
const cloudOnly = ["sync_change_feed", "sync_idempotency_receipts", "user_sessions"];
const escape = (value) => String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
const sensitive = /settings|security|staff|user_roles|terminal|authorization|cashiers|pin_attempts|public_flags/;
const owner = (table) => table.direction === "pull" ? "Supabase" : table.conflictRule === "immutable_reversal" || table.conflictRule === "movement_delta" ? "Originating transaction" : "Version policy";
const direction = (table) => table.direction === "pull" ? "Supabase -> SQL Server" : "Bidirectional";
const approval = (table) => sensitive.test(table.cloudTable) ? "Role/permission gate" : "Normal feature permission";
const offline = (table) => table.direction === "pull" ? "Read cached local copy; edit centrally" : "Read/write SQL Server; sync later";
const dependencies = (table) => [...new Set(table.columns.filter((column) => column.foreignKeyTarget).map((column) => column.foreignKeyTarget.table))].join(", ") || "None";

const coverage = [
  "# Synchronization coverage and ownership matrix",
  "",
  `Generated from \`database/sqlserver/schema-registry.json\` (${tables.length} synchronized tables). Do not edit by hand; run \`npm run audit:sync\`.`,
  "",
  "Electron operational reads and writes use local SQL Server. Supabase is the online synchronization peer. SQL Server Change Tracking detects ordinary row changes; `sync_change_journal` groups complete business transactions. No renderer/device outbox is used by Electron.",
  "",
  "| Table | Scope | Owner/conflict authority | Direction | Detection | Delete | Approval | Dependencies | Offline behavior |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...tables.map((table) => `| ${escape(table.cloudTable)} | ${escape(table.scope)} | ${escape(owner(table))} | ${escape(direction(table))} | SQL Change Tracking + cloud feed | ${escape(table.deleteRule)} | ${escape(approval(table))} | ${escape(dependencies(table))} | ${escape(offline(table))} |`),
  "",
  "## Local-only SQL Server infrastructure",
  "",
  ...localOnly.map((table) => `- \`${table}\`: local database operation/synchronization metadata; never uploaded as a business table.`),
  "",
  "## Cloud-only synchronization infrastructure",
  "",
  ...cloudOnly.map((table) => `- \`${table}\`: server-side feed/idempotency infrastructure; never treated as POS operational data.`),
  "",
  "## Verification meaning",
  "",
  "- `SYNCED`: incremental push/pull completed and branch-scoped counts match.",
  "- `VERIFIED`: a full branch-scoped data signature also matches. A count match alone is never labelled verified.",
  "- `DIFFERENT`: count or signature differs; targeted repair is required.",
  "",
].join("\n");

const conflicts = [
  "# Conflict and deletion rules",
  "",
  "Generated from the packaged synchronization registry. Financial records are corrected with reversal/correction records; they are not casually overwritten.",
  "",
  "| Table | Insert | Update | Delete | Conflict rule |",
  "| --- | --- | --- | --- | --- |",
  ...tables.map((table) => `| ${escape(table.cloudTable)} | ${escape(table.insertRule)} | ${escape(table.updateRule)} | ${escape(table.deleteRule)} | ${escape(table.conflictRule)} |`),
  "",
  "Cloud-applied SQL Server changes use `CHANGE_TRACKING_CONTEXT`, so the push worker recognizes them as remote changes and does not echo them back. Stable primary keys and server idempotency receipts make retries safe.",
  "",
].join("\n");

const columns = [
  "# Synchronization column matrix",
  "",
  `Generated from the packaged registry: ${tables.length} tables and ${tables.reduce((sum, table) => sum + table.columns.length, 0)} synchronized columns.`,
  "",
  "Columns listed here are synchronized unless the table is listed as local-only or cloud-only in the coverage matrix.",
  "",
  "| Table | Cloud column | SQL Server column | Cloud type | SQL Server type | Null | Default | PK | FK target | Unique |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...tables.flatMap((table) => table.columns.map((column) => `| ${escape(table.cloudTable)} | ${escape(column.cloudColumn)} | ${escape(column.sqlServerColumn)} | ${escape(column.cloudType)} | ${escape(column.sqlServerType)} | ${column.nullable ? "yes" : "no"} | ${escape(column.defaultRule)} | ${column.primaryKey ? "yes" : "no"} | ${escape(column.foreignKeyTarget ? `${column.foreignKeyTarget.table}.${column.foreignKeyTarget.column}` : "—")} | ${column.unique ? "yes" : "no"} |`)),
  "",
].join("\n");

fs.writeFileSync(path.join(root, "docs", "audit", "sync-coverage.md"), coverage);
fs.writeFileSync(path.join(root, "docs", "audit", "conflict-rules.md"), conflicts);
fs.writeFileSync(path.join(root, "docs", "audit", "sync-columns.md"), columns);
console.log(`Wrote sync audit for ${tables.length} tables and ${tables.reduce((sum, table) => sum + table.columns.length, 0)} columns.`);
