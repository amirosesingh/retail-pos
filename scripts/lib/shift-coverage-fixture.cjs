// Synthetic test server ONLY: callers explicitly assume matching rows or omit
// mismatches. This constructs DTOs; it is not evidence that real SQL matched.
function matchingCoverage(registry, operations, omitted = {}) {
  return {
    version: 1,
    mode: "matched_request_rows",
    tables: [
      "shifts",
      "shift_cash_counts",
      "shift_reconciliations",
      "shift_close_events",
      "shift_notifications",
      "shift_variance_alerts",
    ].map((name) => {
      const table = registry.tables.find((table) => table.cloudTable === name),
        clocks = table.columns
          .map((column) => column.cloudColumn)
          .filter((name) => ["row_version", "updated_at"].includes(name));
      return {
        table: name,
        fields: table.columns
          .map((column) => column.cloudColumn)
          .filter((name) => !clocks.includes(name)),
        serverManagedFields: clocks,
        rows: (operations.find((operation) => operation.table === name)?.rows ?? [])
          .filter((row) => !(omitted[name] ?? []).includes(row.id))
          .map((row) => ({
            id: row.id,
            serverValues: Object.fromEntries(
              clocks.map((clock) => {
                const column = table.columns.find((column) => column.cloudColumn === clock),
                  fallback = clock === "row_version" ? 1 : "2026-11-02T03:00:00.000Z";
                return [clock, row[clock] ?? (column.nullable ? null : fallback)];
              }),
            ),
          })),
      };
    }),
  };
}
module.exports = { matchingCoverage };
