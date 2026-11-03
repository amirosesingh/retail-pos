const { recordId } = require("./uuid-fields.cjs");
const TABLES = [
  "shifts",
  "shift_cash_counts",
  "shift_reconciliations",
  "shift_close_events",
  "shift_notifications",
  "shift_variance_alerts",
];
const CLOCKS = new Set(["row_version", "updated_at"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = () => {
  throw Object.assign(
    new Error(
      "The central database has not proved which complete closing rows matched. Their local copies remain pending.",
    ),
    { code: "ESHIFT_COVERAGE_UNCONFIRMED", table: "shifts" },
  );
};
const exactKeys = (value, names) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));
const sameSet = (values, expected) =>
  Array.isArray(values) &&
  values.length === expected.length &&
  new Set(values).size === values.length &&
  values.every((value) => typeof value === "string" && expected.includes(value));

// A request hash proves only the immutable request. This separately validates
// the server's actual full business-field match, with only two declared clocks
// allowed to be server-managed. It never changes local rows or a cloud baseline.
function validateCoverage(coverage, intent, registry) {
  if (
    !registry ||
    !exactKeys(coverage, ["version", "mode", "tables"]) ||
    coverage.version !== 1 ||
    coverage.mode !== "matched_request_rows" ||
    !Array.isArray(coverage.tables) ||
    coverage.tables.length !== TABLES.length ||
    Buffer.byteLength(JSON.stringify(coverage), "utf8") > 512 * 1024
  )
    fail();
  const seenTables = new Set();
  let total = 0;
  for (const entry of coverage.tables) {
    if (
      !exactKeys(entry, ["table", "fields", "serverManagedFields", "rows"]) ||
      !TABLES.includes(entry.table) ||
      seenTables.has(entry.table) ||
      !Array.isArray(entry.rows)
    )
      fail();
    seenTables.add(entry.table);
    const table = registry.tables.find((table) => table.cloudTable === entry.table);
    if (!table) fail();
    const columns = table.columns.map((column) => column.cloudColumn),
      managed = columns.filter((name) => CLOCKS.has(name)),
      business = columns.filter((name) => !CLOCKS.has(name));
    if (!sameSet(entry.fields, business) || !sameSet(entry.serverManagedFields, managed)) fail();
    const requested = new Map(
      (intent.operations.find((operation) => operation.table === entry.table)?.rows ?? []).map(
        (row) => [recordId(String(row.id ?? "")), row],
      ),
    );
    const seen = new Set();
    for (const item of entry.rows) {
      const id = recordId(String(item?.id ?? ""));
      if (
        !exactKeys(item, ["id", "serverValues"]) ||
        !UUID.test(id) ||
        seen.has(id) ||
        !requested.has(id) ||
        !exactKeys(item.serverValues, managed)
      )
        fail();
      seen.add(id);
      total++;
      for (const name of managed) {
        const value = item.serverValues[name],
          column = table.columns.find((column) => column.cloudColumn === name);
        if (value == null) {
          if (!column.nullable) fail();
          continue;
        }
        if (name === "row_version") {
          if (
            !["number", "string"].includes(typeof value) ||
            !/^\d+$/.test(String(value)) ||
            !Number.isSafeInteger(Number(value)) ||
            Number(value) < 1
          )
            fail();
        } else if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail();
      }
    }
    if (total > 2000) fail();
  }
  return coverage;
}
module.exports = { validateCoverage };
