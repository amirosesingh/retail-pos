import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);

describe("branch history and bounded held-status SQL preparation", () => {
  it.each([
    ["scripts/test-history-scope.mjs", "PASS 28 history branch/Management scope groups"],
    ["scripts/test-held-status.mjs", "PASS 20 held-status SQL groups"],
  ])("executes guarded source, privacy, scope, retry and rollback cases in %s", (script, result) => {
    const output = execFileSync(process.execPath, [script], { encoding: "utf8", windowsHide: true, timeout: 90_000, maxBuffer: 1024 * 1024 });
    expect(output).toContain(result);
  }, 95_000);

  it("keeps the prepared migrations and canonical components aligned without changing existing writer sources", () => {
    const history = require("../../../scripts/prepare-history-scope.cjs"), held = require("../../../scripts/prepare-held-status.cjs");
    const canonical = require("../../../scripts/history-scope-canonical.cjs");
    const transport = require("../../../scripts/prepare-scoped-history-transport.cjs");
    const historySql = readFileSync("supabase/migrations/" + history.MIGRATION, "utf8").replaceAll("\r\n", "\n");
    const heldSql = readFileSync("supabase/migrations/" + held.MIGRATION, "utf8").replaceAll("\r\n", "\n");
    const transportSql = readFileSync("supabase/migrations/" + transport.MIGRATION, "utf8").replaceAll("\r\n", "\n");
    const metadata = JSON.parse(readFileSync("src/lib/__tests__/fixtures/history-scope-live-metadata.json", "utf8"));
    expect(historySql).toBe(history.render(metadata));
    expect(heldSql).toBe(held.render());
    expect(transportSql).toBe(transport.render(metadata));
    const sourceMetadata = [...historySql.matchAll(/\$history_scope_data\$([^\r\n]*?)\$history_scope_data\$::jsonb/g)].map(match => JSON.parse(match[1]));
    expect(sourceMetadata[0]).toEqual(history.build(metadata).original);
    for (const entry of sourceMetadata[0]) {
      expect(history.md5(entry.definition)).toBe(entry.definition_md5);
    }
    const heldSources = JSON.parse(heldSql.match(/\$held_metadata\$([^\r\n]*?)\$held_metadata\$::jsonb/)![1]);
    for (const entry of heldSources) {
      expect(entry.definition).toBe(metadata.functions.find((item: { signature: string }) => item.signature === entry.signature).definition);
      expect(history.md5(entry.definition)).toBe(entry.definition_md5);
    }
    const schema = readFileSync("supabase/schema.sql", "utf8").replaceAll("\r\n", "\n");
    expect(canonical.withScopedHistoryTransportContract(canonical.withBoundedHeldStatusContract(canonical.withHistoryScopeContract(schema, historySql), heldSql),transportSql)).toBe(schema);
    for (const sql of [historySql, heldSql, transportSql]) {
      expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/mi);
      // Captured trigger definitions are inert JSON source fingerprints. Reject
      // executable DDL statements, not the reviewed metadata inside that JSON.
      expect(/^\s*(?:CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER|ALTER\s+TABLE|DISABLE\s+TRIGGER)/mi.test(sql)).toBe(false);
    }
    const hardening = schema.lastIndexOf("-- Final public-schema privilege hardening");
    expect(schema.indexOf("-- HISTORY_SCOPE82_BEGIN")).toBeLessThan(hardening);
    expect(schema.indexOf("-- BOUNDED_HELD_STATUS_BEGIN")).toBeLessThan(hardening);
    expect(schema.indexOf("-- SCOPED_HISTORY_TRANSPORT_BEGIN")).toBeGreaterThan(schema.indexOf("-- HISTORY_SCOPE82_END"));
    expect(schema.indexOf("-- SCOPED_HISTORY_TRANSPORT_END")).toBeLessThan(hardening);
  });
});
