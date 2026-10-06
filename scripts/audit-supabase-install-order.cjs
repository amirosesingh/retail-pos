const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const schemaPath = path.join(root, "supabase", "schema.sql");
const sql = fs.readFileSync(schemaPath, "utf8");

const indexes = [...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX[\s\S]*?;/gi)].map((match) => ({
  offset: match.index,
  sql: match[0],
}));

const additions = [
  ...sql.matchAll(
    /ALTER\s+TABLE(?:\s+ONLY)?\s+public\."?([a-zA-Z_][\w]*)"?[\s\S]{0,1500}?ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z_][\w]*)"?/gi,
  ),
].map((match) => ({
  offset: match.index,
  table: match[1],
  column: match[2],
}));

const reported = new Set();
const failures = [];

for (const addition of additions) {
  const key = `${addition.table}.${addition.column}`;
  if (reported.has(key)) continue;
  reported.add(key);

  const tablePattern = new RegExp(
    `ON\\s+(?:ONLY\\s+)?public\\."?${addition.table}"?\\b`,
    "i",
  );
  const columnPattern = new RegExp(`\\b${addition.column}\\b`, "i");

  for (const index of indexes) {
    if (
      index.offset < addition.offset &&
      tablePattern.test(index.sql) &&
      columnPattern.test(index.sql)
    ) {
      failures.push({ key, addition: addition.offset, index: index.offset, sql: index.sql });
    }
  }
}

if (failures.length === 0) {
  console.log("No index-before-column ordering defects detected.");
  process.exit(0);
}

for (const failure of failures) {
  console.error(
    `${failure.key}: index at byte ${failure.index} precedes column addition at byte ${failure.addition}`,
  );
  console.error(`  ${failure.sql.replace(/\s+/g, " ").slice(0, 260)}`);
}

process.exitCode = 1;
