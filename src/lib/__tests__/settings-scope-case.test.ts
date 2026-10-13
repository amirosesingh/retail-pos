import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { normalizeSettingsScope, toCloudRow } = require("../../../electron/sync/row-codec.cjs");
const { OperationsRepository } = require("../../../electron/db/repositories/operations.cjs");
describe("consistent settings scope casing", () => {
  it.each(["global", "Global", "gLoBaL", "GLOBAL"])("stores %s as GLOBAL before local validation", scope => {
    const registry = { tables: [{ sqlServerTable: "settings_scoped", cloudTable: "settings_scoped",
      columns: [{ sqlServerColumn: "scope" }, { sqlServerColumn: "scope_id" }, { sqlServerColumn: "key" }] }] };
    const repository = new OperationsRepository({}, registry);
    const op = { kind: "upsert", table: "settings_scoped", rows: [{ scope, scope_id: "", key: "example" }] };
    repository.validate([op]);
    expect(op.rows[0].scope).toBe("GLOBAL");
    expect(toCloudRow(registry.tables[0], op.rows[0]).scope).toBe("GLOBAL");
  });
  it("accepts mixed-case terminal input and preserves ownership and values", () => {
    expect(normalizeSettingsScope("settings_scoped", { scope: "pRiVaTe", scope_id: "owner" }).scope).toBe("PRIVATE");
    expect(() => normalizeSettingsScope("settings_overrides", { scope: "PRIVATE" })).toThrow();
    expect(normalizeSettingsScope("settings_overrides", { scope: "tErMiNaL", scope_id: "DEVICE", patch: "MiXeD" }))
      .toEqual({ scope: "TERMINAL", scope_id: "DEVICE", patch: "MiXeD" });
    expect(() => normalizeSettingsScope("settings_scoped", { scope: "everyone" })).toThrow();
    expect(normalizeSettingsScope("other_table", { scope: "mixed" }).scope).toBe("mixed");
  });
});
