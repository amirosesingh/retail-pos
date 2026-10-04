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
    expect(db).toContain('[fieldOp, op2]');
    expect(db).toContain("delete compatibleRow[col]");
    expect(db).toContain("const fieldSourceRow = patch ? settingsPatchRow(s, patch) : buildSettingsRow(s)");
    expect(db).toContain("settingsFieldRows(fieldSourceRow)");
    expect(db).toContain("applySettingsFields");
  });

  it("uses the existing timestamp-first bidirectional settings contract", () => {
    const cloud = read("electron/sync/cloud-client.cjs");
    const schema = read("supabase/schema.sql");
    expect(cloud).toContain('"settings_scoped"');
    expect(cloud).toContain("timestampedConfiguration");
    expect(schema).toContain("WHEN 'settings_scoped' THEN");
    expect(schema).toContain("CREATE POLICY settings_scoped_pos_fields_insert");
    expect(schema).toContain("CREATE POLICY settings_scoped_pos_fields_update");
    expect(schema).toContain("CREATE POLICY settings_scoped_pos_fields_delete");
    expect(schema).toContain("key LIKE 'pos_field:%'");
  });

  it("hydrates the same field overlay from local SQL Server", () => {
    const operations = read("electron/db/repositories/operations.cjs");
    expect(operations).toContain("WHERE [key] LIKE N'pos_field:%'");
    expect(operations).toContain("output.settingFields");
  });

  it("uploads only explicit global field rows from an Electron till", () => {
    const { terminalWritableChanges } = require("../../../electron/sync/push-worker.cjs");
    const field = { key: { scope: "GLOBAL", scope_id: "", key: "pos_field:show_logo" } };
    const cached = { key: { scope: "GLOBAL", scope_id: "", key: "other" } };
    expect(terminalWritableChanges("settings_scoped", [field, cached])).toEqual([field]);
  });
});
