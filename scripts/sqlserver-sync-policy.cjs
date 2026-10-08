// The local SQL Server contains operational POS data only. Authentication
// identities and server-side allocation state stay in Supabase.
const SERVER_ONLY_TABLES = new Set([
  "sync_idempotency_receipts",
  "sync_change_feed",
  "user_sessions",
  "sku_number_leases",
  "sku_number_state",
]);

const EXCLUDED_COLUMNS = new Map([
  [
    "members",
    new Set([
      "auth_user_id",
      "is_verified",
      "verified_at",
      "verified_channel",
      "membership_member_id",
      "membership_revision",
      "membership_status",
    ]),
  ],
]);

function isServerOnlyTable(tableName) {
  return SERVER_ONLY_TABLES.has(tableName);
}

function excludedColumns(tableName) {
  return EXCLUDED_COLUMNS.get(tableName) ?? new Set();
}

function isLocalColumn(tableName, columnName) {
  return !excludedColumns(tableName).has(columnName);
}

module.exports = {
  SERVER_ONLY_TABLES,
  EXCLUDED_COLUMNS,
  excludedColumns,
  isLocalColumn,
  isServerOnlyTable,
};
