import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("source-neutral settings field merge", () => {
  it("writes independently versioned field rows alongside the legacy snapshot", () => {
    const db = read("src/core/api/pos-db.ts");
    expect(db).toContain('key: `pos_field:${fieldKey}`');
    expect(db).toContain('table: "settings_scoped"');
    expect(db).toContain('table: "pos_settings"');
    expect(db).toContain('[fieldOp, op]');
    expect(db).toContain("applySettingsFields");
  });

  it("uses the existing timestamp-first bidirectional settings contract", () => {
    const cloud = read("electron/sync/cloud-client.cjs");
    const schema = read("supabase/schema.sql");
    expect(cloud).toContain('"settings_scoped"');
    expect(cloud).toContain("timestampedConfiguration");
    expect(schema).toContain("WHEN 'settings_scoped' THEN");
    expect(schema).toContain("settings_scoped_pos_fields_write");
    expect(schema).toContain("key LIKE 'pos_field:%'");
  });

  it("hydrates the same field overlay from local SQL Server", () => {
    const operations = read("electron/db/repositories/operations.cjs");
    expect(operations).toContain("WHERE [key] LIKE N'pos_field:%'");
    expect(operations).toContain("output.settingFields");
  });
});
