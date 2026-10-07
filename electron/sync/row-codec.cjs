/** SQL Server stores PostgreSQL jsonb and text[] in nvarchar columns. */
function structured(column) {
  const type = String(column.cloudType ?? "").trim().toLowerCase();
  return type === "jsonb" || type.endsWith("[]");
}

function toCloudRow(table, row) {
  const result = { ...row };
  for (const column of table.columns) {
    const name = column.sqlServerColumn;
    if (!structured(column) || typeof result[name] !== "string") continue;
    try { result[column.cloudColumn] = JSON.parse(result[name]); }
    catch { throw new Error(`Invalid local JSON in ${table.sqlServerTable}.${name}.`); }
    if (column.cloudColumn !== name) delete result[name];
  }
  return result;
}

function toLocalValue(column, value) {
  return structured(column) && value !== null
    ? JSON.stringify(value)
    : value;
}

module.exports = { toCloudRow, toLocalValue };
