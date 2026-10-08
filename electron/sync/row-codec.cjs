/** SQL Server stores PostgreSQL jsonb and text[] in nvarchar columns. */
function structured(column) {
  const type = String(column.cloudType ?? "").trim().toLowerCase();
  return type === "jsonb" || type.endsWith("[]");
}

function toCloudRow(table, row) {
  const result = { ...row };
  for (const column of table.columns) {
    const name = column.sqlServerColumn;
    // SQL Server drivers can return uppercase GUIDs. PostgreSQL emits UUIDs
    // in lowercase, and sync ownership checks compare JSON identifiers.
    if (String(column.cloudType ?? "").trim().toLowerCase() === "uuid" &&
        typeof result[name] === "string") {
      result[column.cloudColumn] = result[name].toLowerCase();
      if (column.cloudColumn !== name) delete result[name];
    }
    if (!structured(column) || typeof result[name] !== "string") continue;
    try { result[column.cloudColumn] = JSON.parse(result[name]); }
    catch {
      // Older tills wrote polymorphic scoped string settings as bare text.
      // Preserve that value as a string instead of stopping the entire sync.
      if (table.sqlServerTable === "settings_scoped" && name === "value") {
        result[column.cloudColumn] = result[name];
      } else {
        throw new Error(`Invalid local JSON in ${table.sqlServerTable}.${name}.`);
      }
    }
    if (column.cloudColumn !== name) delete result[name];
  }
  return result;
}

/** Return native values to Electron without exposing JSON-encoded SQL text. */
function toRendererRow(table, row) {
  const result = { ...row };
  for (const column of table.columns) {
    const valueName = Object.hasOwn(result, column.cloudColumn)
      ? column.cloudColumn : column.sqlServerColumn;
    // SQL drivers return native Dates; Electron IPC preserves them. Match
    // PostgREST's string contract before a screen renders a date as text.
    if (result[valueName] instanceof Date) {
      const value = result[valueName];
      const iso = Number.isNaN(value.valueOf()) ? null : value.toISOString();
      result[column.cloudColumn] = iso && column.cloudType === "date"
        ? iso.slice(0, 10) : iso;
      if (column.cloudColumn !== valueName) delete result[valueName];
    }
    if (!structured(column)) continue;
    const name = Object.hasOwn(result, column.cloudColumn)
      ? column.cloudColumn : column.sqlServerColumn;
    if (typeof result[name] !== "string") continue;
    try { result[column.cloudColumn] = JSON.parse(result[name]); }
    catch { result[column.cloudColumn] = result[name]; }
    if (column.cloudColumn !== name) delete result[name];
  }
  return result;
}

function toLocalValue(column, value) {
  return structured(column) && value !== null
    ? JSON.stringify(value)
    : value;
}

module.exports = { toCloudRow, toLocalValue, toRendererRow };
