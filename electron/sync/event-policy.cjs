const ACTIVITY_TABLES = new Set(["audit_logs", "activity_events", "item_activity_logs"]);
const ACTIVITY_INTERVAL_MS = 120_000;
function activityOnly(operations) {
  return Array.isArray(operations) && operations.length > 0 &&
    operations.every(operation => ACTIVITY_TABLES.has(operation.table ?? operation.entity_type));
}
module.exports = { ACTIVITY_TABLES, ACTIVITY_INTERVAL_MS, activityOnly };
