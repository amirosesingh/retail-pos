const { SERVER_ONLY_TABLES } = require("../sqlserver-sync-policy.cjs");

// Support relations remain with their owning protocol. Listing one here
// never registers it for row replication.
const localSupport = new Set([
  "local_operation_receipts", "pos_document_counters", "pos_jobs", "pos_schema_migrations",
  "sync_change_journal", "sync_checkpoints", "sync_conflicts",
  "pos_sync_shift_author_keys", "pos_sync_shift_authors", "pos_sync_shift_baselines",
  "pos_sync_shift_closing_starts", "pos_sync_shift_intent_starts", "pos_sync_shift_intents", "pos_sync_shift_openings",
  "pos_sync_shift_financial_bases", "pos_sync_shift_financial_events", "pos_sync_shift_financial_heads",
  "pos_sync_shift_financial_noops", "pos_sync_shift_financial_observations", "pos_sync_shift_financial_origins",
  "pos_sync_shift_financial_proofs", "pos_sync_shift_financial_refreshes",
  "pos_sync_shift_financial_sale_lineage", "pos_sync_shift_financial_versions",
  "pos_sync_sale_outbox_v1", "pos_sync_sale_acceptance_v1", "pos_store_settings_edit_commands", "pos_store_settings_edit_receipts",
  "pos_store_settings_edit_reviews",
]);
const cloudViews = new Set(["v_daily_item_sales", "v_daily_store_sales", "v_sale_line_facts"]);
const cloudSupport = new Map(Object.entries({
  admin_portal: ["activation_events", "activations"],
  pos_private: ["approval_tokens", "approval_verifiers"],
  pos_sync_private: ["legacy_shift_recovery_receipts", "shift_author_keys", "shift_author_receipts",
    "shift_closing_start_receipts", "shift_intent_receipts"],
  private: ["completed_hold_tombstones", "global_permission_audit", "global_permission_policy",
    "requested_staff_permissions", "stock_document_counters", "transfer_dispatch_receipts"],
  shift_sharing_private: ["contracts"],
  pos_sync_feed_v1: ["feed_groups", "feed_heads", "settings_edit_enrollments", "settings_pilots", "snapshot_pins",
    "cash_settings_pilots", "cash_publications"],
  pos_sync_cash_v1: ["checkout_route_owners", "installation_enrollments"],
  pos_sync_inbox_v1: ["operation_receipts"],
  fin62_action_preparation: ["receipts"],
  fin62_admin_preparation: ["context", "receipts"],
  fin62_cloud_preparation: ["bases"],
  fin62_history_preparation: ["business_context", "business_receipts", "graph_context", "live_context",
    "nodes", "open_author_receipts", "protected_shifts", "publications", "sale_birth_claims",
    "sale_steps", "stream_facts", "streams"],
  fin62_live_preparation: ["contract_pins", "receipts"],
  fin62_origin_preparation: ["active_context", "births", "origins"],
  fin62_rollout_preparation: ["approvals"],
  fin62_version_preparation: ["sales_versions"],
  fin62_web_preparation: ["actions", "active_actions"],
}));
// Supabase-owned identity, platform and extension schemas.
const managedCloud = new Set([
  "auth", "extensions", "graphql", "graphql_public", "net", "pgbouncer",
  "realtime", "storage", "supabase_functions", "supabase_migrations", "vault",
]);
const key = (schema, relation) => JSON.stringify([schema, relation]);

function checkInventory(label, inventory, mappedSchema, mappedTables, kindField, isTable, isExcluded) {
  const { relations, columns } = inventory ?? {};
  if (!Array.isArray(relations) || !relations.length || !Array.isArray(columns) || !columns.length)
    throw new Error(`${label} relation and column metadata are required.`);

  const installed = new Map();
  for (const { schema_name: schema, relation_name: relation, [kindField]: kind } of relations) {
    if (typeof schema !== "string" || !schema || typeof relation !== "string" || !relation || typeof kind !== "string")
      throw new Error(`${label} relation metadata is malformed.`);
    const id = key(schema, relation);
    if (installed.has(id)) throw new Error(`${label} inventory repeats ${schema}.${relation}.`);
    installed.set(id, { schema, relation, kind, fields: new Set() });
  }

  for (const { schema_name: schema, relation_name: relation, column_name: column } of columns) {
    const entry = installed.get(key(schema, relation));
    if (!entry || typeof column !== "string" || !column || entry.fields.has(column))
      throw new Error(`${label} column metadata is malformed or repeated.`);
    entry.fields.add(column);
  }

  const differences = [];
  for (const [table, fields] of mappedTables) {
    const entry = installed.get(key(mappedSchema, table));
    if (!entry || !isTable(entry.kind)) {
      differences.push(`${label} mapped table unavailable: ${mappedSchema}.${table}`);
      continue;
    }
    for (const field of fields) {
      if (!entry.fields.has(field)) differences.push(`${label} mapped column unavailable: ${mappedSchema}.${table}.${field}`);
    }
  }
  for (const { schema, relation, kind } of installed.values()) {
    if (schema === mappedSchema && mappedTables.has(relation)) continue;
    if (!isExcluded(schema, relation, kind))
      differences.push(`${label} unclassified relation: ${schema}.${relation} (${kind})`);
  }
  return differences.sort();
}

function compareInstalledRegistry(registry, sql, pg) {
  if (sql?.can_view_database_definition !== 1)
    throw new Error("SQL Server inventory needs database VIEW DEFINITION.");
  const local = new Map(registry.tables.map(table =>
    [table.sqlServerTable, table.columns.map(column => column.sqlServerColumn)]));
  const cloud = new Map(registry.tables.map(table =>
    [table.cloudTable, table.columns.map(column => column.cloudColumn)]));
  return [
    ...checkInventory("SQL Server", sql, "dbo", local, "relation_type", kind => kind === "U",
      (schema, name, kind) => schema === "dbo" && kind === "U" && localSupport.has(name)),
    ...checkInventory("Postgres", pg, "public", cloud, "relkind", kind => kind === "r" || kind === "p",
      (schema, name, kind) => {
        if (managedCloud.has(schema)) return true;
        if (schema === "public") return (kind === "r" && (SERVER_ONLY_TABLES.has(name) || name === "schema_migrations")) ||
          (kind === "v" && cloudViews.has(name));
        return kind === "r" && cloudSupport.get(schema)?.includes(name);
      }),
  ];
}

module.exports = { compareInstalledRegistry };
