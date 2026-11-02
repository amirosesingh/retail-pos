import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

it("keeps online-only ledgers out of the generated desktop replication schema", () => {
  const script = resolve("scripts/supabase-registry-report.cjs");
  const require = createRequire(script);
  const cloudSchema = readFileSync("supabase/schema.sql", "utf8");
  let generated = "";
  runInNewContext(readFileSync(script, "utf8"), {
    __dirname: resolve("scripts"),
    require: (name: string) =>
      name === "node:fs"
        ? {
            readFileSync: () => cloudSchema,
            mkdirSync: () => undefined,
            writeFileSync: (_path: string, contents: string) => {
              generated = contents;
            },
          }
        : require(name),
    console: { log: () => undefined },
  });
  const report = JSON.parse(generated) as { tables: { name: string }[] };
  const names = report.tables.map((table) => table.name);
  expect(names).toContain("products");
  expect(names).toContain("stock_adjustments");
  for (const table of [
    "notification_deliveries",
    "sponsorship_issues",
    "sponsorship_direct_issue_policy",
    "missed_bill_entries",
  ]) {
    expect(new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?public\\.${table}\\b`, "i").test(cloudSchema)).toBe(true);
    expect(names).not.toContain(table);
  }
});
