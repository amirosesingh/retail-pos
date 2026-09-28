const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const schemaPath = path.join(root, "supabase", "schema.sql");
const outputPath = path.join(root, "reports", "supabase-schema-registry-report.json");
const sql = fs.readFileSync(schemaPath, "utf8");
const tables = [];
const CONTROL_TABLES = new Set([
  "sync_idempotency_receipts",
  "sync_change_feed",
  // Server-managed authentication state must never be copied into a till database.
  "user_sessions",
]);

// ALTER TABLE may add several columns in one statement. Split its clauses
// without breaking numeric(18,4), array literals, or quoted JSON defaults.
function splitTopLevelCommas(value) {
  const parts = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "'") {
      if (quoted && value[index + 1] === "'") {
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === "(") round += 1;
    else if (char === ")") round = Math.max(0, round - 1);
    else if (char === "[") square += 1;
    else if (char === "]") square = Math.max(0, square - 1);
    else if (char === "," && round === 0 && square === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

for (const match of sql.matchAll(
  /CREATE TABLE IF NOT EXISTS public\.([a-z0-9_]+)\s*\(([\s\S]*?)\n\);/gi,
)) {
  if (CONTROL_TABLES.has(match[1])) continue;
  const columns = [];
  for (const raw of match[2].split(/,\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(?:CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK)\b/i.test(line)) continue;
    const column = /^([a-z_][a-z0-9_]*)\s+(.+)$/i.exec(line);
    if (!column) continue;
    columns.push({
      name: column[1],
      declaration: column[2].replace(/\s+/g, " ").trim(),
      nullable: !/\bNOT NULL\b/i.test(column[2]),
      hasDefault: /\bDEFAULT\b/i.test(column[2]),
    });
  }
  const body = match[2];
  const primaryKey = (/PRIMARY\s+KEY\s*\(([^)]+)\)/i.exec(body)?.[1] ?? "")
    .split(",")
    .map((value) => value.replace(/["\s]/g, ""))
    .filter(Boolean);
  const uniqueKeys = [...body.matchAll(/UNIQUE\s*\(([^)]+)\)/gi)].map((item) =>
    item[1]
      .split(",")
      .map((value) => value.replace(/["\s]/g, ""))
      .filter(Boolean),
  );
  const foreignKeys = [
    ...body.matchAll(
      /FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([^)]+)\)/gi,
    ),
  ].map((item) => ({
    column: item[1].replace(/["\s]/g, ""),
    table: item[2],
    targetColumn: item[3].replace(/["\s]/g, ""),
  }));
  tables.push({ name: match[1], columns, primaryKey, uniqueKeys, foreignKeys });
}

const byName = new Map(tables.map((table) => [table.name, table]));
for (const match of sql.matchAll(
  /ALTER\s+TABLE(?:\s+ONLY)?\s+public\.([a-z0-9_]+)\s+([\s\S]*?);/gi,
)) {
  const table = byName.get(match[1]);
  if (!table) continue;
  for (const clause of splitTopLevelCommas(match[2])) {
    const column =
      /^ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([a-z_][a-z0-9_]*)"?\s+([\s\S]+)$/i.exec(clause);
    if (!column || table.columns.some((existing) => existing.name === column[1])) continue;
    const declaration = column[2].replace(/\s+/g, " ").trim();
    table.columns.push({
      name: column[1],
      declaration,
      nullable: !/\bNOT NULL\b/i.test(declaration),
      hasDefault: /\bDEFAULT\b/i.test(declaration),
    });
  }
}
for (const match of sql.matchAll(
  /ALTER\s+TABLE(?:\s+ONLY)?\s+public\.([a-z0-9_]+)\s+ADD\s+CONSTRAINT\s+[a-z0-9_".]+\s+([\s\S]*?);/gi,
)) {
  const table = byName.get(match[1]);
  if (!table) continue;
  const rule = match[2];
  const primary = /PRIMARY\s+KEY\s*\(([^)]+)\)/i.exec(rule);
  if (primary)
    table.primaryKey = primary[1]
      .split(",")
      .map((value) => value.replace(/["\s]/g, ""))
      .filter(Boolean);
  const unique = /UNIQUE\s*\(([^)]+)\)/i.exec(rule);
  if (unique)
    table.uniqueKeys.push(
      unique[1]
        .split(",")
        .map((value) => value.replace(/["\s]/g, ""))
        .filter(Boolean),
    );
  const foreign =
    /FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([^)]+)\)/i.exec(
      rule,
    );
  if (foreign)
    table.foreignKeys.push({
      column: foreign[1].replace(/["\s]/g, ""),
      table: foreign[2],
      targetColumn: foreign[3].replace(/["\s]/g, ""),
    });
}

// PostgreSQL commonly expresses idempotency keys as partial unique indexes
// instead of table constraints. Preserve simple column-only indexes in the
// portable registry so the local SQL Server enforces the same uniqueness.
for (const match of sql.matchAll(
  /CREATE\s+UNIQUE\s+INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+[a-z0-9_".]+\s+ON\s+(?:ONLY\s+)?public\.([a-z0-9_]+)(?:\s+USING\s+\w+)?\s*\(([^;]+?)\)(?:\s+WHERE\s+[\s\S]*?)?;/gi,
)) {
  const table = byName.get(match[1]);
  if (!table) continue;
  const key = match[2]
    .split(",")
    .map((value) => value.replace(/["\s]/g, ""))
    .filter((value) => /^[a-z_][a-z0-9_]*$/i.test(value));
  if (!key.length || key.length !== match[2].split(",").length) continue;
  if (
    !table.uniqueKeys.some(
      (existing) =>
        existing.length === key.length && existing.every((value, index) => value === key[index]),
    )
  )
    table.uniqueKeys.push(key);
}

const report = {
  source: "supabase/schema.sql",
  generatedAt: new Date().toISOString(),
  tableCount: tables.length,
  columnCount: tables.reduce((total, table) => total + table.columns.length, 0),
  tables,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Supabase registry report: ${report.tableCount} tables, ${report.columnCount} columns`);
