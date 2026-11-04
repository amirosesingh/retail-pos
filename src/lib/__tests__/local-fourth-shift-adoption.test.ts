import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { validateSource, NAMES } = require("../../../scripts/lib/local54-fourth-adoption.cjs");
const { loadRegistry } = require("../../../electron/db/schema-registry.cjs");
const tables = loadRegistry()
  .tables.filter((t: { cloudTable: string }) => NAMES.includes(t.cloudTable))
  .sort(
    (a: { cloudTable: string }, b: { cloudTable: string }) =>
      NAMES.indexOf(a.cloudTable) - NAMES.indexOf(b.cloudTable),
  );
type Row = Record<string, unknown>;
function source() {
  const branch = randomUUID(),
    shift = randomUUID();
  const row = (table: {
    columns: Array<{ cloudColumn: string; nullable: boolean; cloudType: string }>;
  }): Row =>
    Object.fromEntries(
      table.columns.map((c) => [
        c.cloudColumn,
        c.cloudColumn === "id"
          ? randomUUID()
          : c.nullable
            ? null
            : c.cloudType === "uuid"
              ? randomUUID()
              : /^(numeric|decimal|integer|bigint|smallint)/.test(c.cloudType)
                ? 0
                : c.cloudType === "boolean"
                  ? false
                  : /^timestamp/.test(c.cloudType)
                    ? "2026-01-01T01:00:00.1234567Z"
                    : c.cloudType === "date"
                      ? "2026-01-01"
                      : c.cloudType === "jsonb"
                        ? {}
                        : c.cloudType.endsWith("[]")
                          ? []
                          : "synthetic",
      ]),
    );
  const parent = {
    ...row(tables[0]),
    id: shift,
    store_id: branch,
    status: "CLOSED",
    state: "CLOSED",
    row_version: 3,
    opened_at: "2026-01-01T01:00:00.1234567Z",
    closed_at: "2026-01-01T09:00:00.1234567Z",
    counted_cash: 20,
    final_counted_cash: 20,
    counted_card: null,
    counted_digital: null,
    expected_cash: 18,
    expected_card: 0,
    expected_digital: 0,
    variance_cash: 2,
    variance_card: null,
    variance_digital: null,
    variance_total: 2,
    variance_status: "OVER",
  };
  const count: Row = {
    ...row(tables[1]),
    store_id: branch,
    shift_id: shift,
    kind: "ORIGINAL",
    counted_cash: 20,
    counted_card: null,
    counted_digital: null,
  };
  const reconciliation: Row = {
    ...row(tables[2]),
    store_id: branch,
    shift_id: shift,
    count_id: count.id,
    counted_cash: 20,
    counted_card: null,
    counted_digital: null,
    expected_cash: 18,
    expected_card: 0,
    expected_digital: 0,
    variance_cash: 2,
    variance_card: null,
    variance_digital: null,
    variance_total: 2,
    variance_status: "OVER",
  };
  const events = Array.from({ length: 3 }, () => ({
    ...row(tables[3]),
    store_id: branch,
    shift_id: shift,
  }));
  const notification = { ...row(tables[4]), store_id: branch, shift_id: shift };
  const alert = {
    ...row(tables[5]),
    store_id: branch,
    shift_id: shift,
    reconciliation_id: reconciliation.id,
  };
  return {
    branch,
    shift,
    graph: NAMES.map((table: string, i: number) => ({
      table,
      rows:
        i === 0
          ? [parent]
          : i === 1
            ? [count]
            : i === 2
              ? [reconciliation]
              : i === 3
                ? events
                : i === 4
                  ? [notification]
                  : [alert],
    })),
  };
}
describe("fourth adoption preparation safety", () => {
  it("refuses absent or changed durable private archives and changed SQL before returning verified inputs", () => {
    const {
      loadVerified,
    } = require("../../../scripts/maintenance/verify-fourth-str1-cloud-adoption.cjs");
    const { sha } = require("../../../scripts/lib/local54-fourth-adoption.cjs");
    const directory = mkdtempSync(join(tmpdir(), "codex-local54-verify-"));
    try {
      const source = "Synthetic preparation only",
        identity = {
          server_name: "fixture",
          database_name: "fixture",
          database_guid: randomUUID(),
        },
        packageText = JSON.stringify({
          identity,
          branch: "fixture-branch",
          shift: randomUUID(),
          beforeTables: [],
          sourceGraphText: "[]",
        }),
        payload = JSON.parse(packageText),
        packageHash = sha(packageText, "utf8");
      const manifest = {
        version: 1,
        preparedOnly: true,
        executionAuthorized: false,
        identity,
        branch: payload.branch,
        shift: payload.shift,
        sqlArtifact: "scripts/maintenance/adopt-fourth-str1-cloud-closing.sql",
        sqlSha256: sha(source, "utf8"),
        privatePackage: "maintenance-private.local/local54-fourth/" + packageHash + ".json",
        privatePackageSha256: packageHash,
        packageSqlSha256: sha(packageText),
      };
      mkdirSync(join(directory, "scripts/maintenance"), { recursive: true });
      mkdirSync(join(directory, "maintenance-private.local/local54-fourth"), { recursive: true });
      writeFileSync(
        join(directory, "scripts/maintenance/fourth-str1-cloud-adoption.manifest.json"),
        JSON.stringify(manifest),
      );
      writeFileSync(join(directory, manifest.sqlArtifact), source);
      writeFileSync(join(directory, manifest.privatePackage), packageText);
      expect(loadVerified(directory).packageText).toBe(packageText);
      writeFileSync(join(directory, manifest.privatePackage), packageText + " ");
      expect(() => loadVerified(directory)).toThrow();
      unlinkSync(join(directory, manifest.privatePackage));
      expect(() => loadVerified(directory)).toThrow();
      writeFileSync(join(directory, manifest.privatePackage), packageText);
      writeFileSync(join(directory, manifest.sqlArtifact), source + " changed");
      expect(() => loadVerified(directory)).toThrow();
    } finally {
      expect(directory.startsWith(join(tmpdir(), "codex-local54-verify-"))).toBe(true);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts only complete synthetic source and rejects precision, ownership, duplicate IDs and inconsistent effective closing", () => {
    const f = source();
    expect(() => validateSource(JSON.stringify(f.graph), tables, f.branch, f.shift)).not.toThrow();
    for (const mutate of [
      (g: typeof f.graph) => {
        g[0].rows[0].counted_cash = 21;
      },
      (g: typeof f.graph) => {
        g[2].rows[0].expected_cash = 19;
      },
      (g: typeof f.graph) => {
        g[3].rows[1].id = g[3].rows[0].id;
      },
      (g: typeof f.graph) => {
        g[1].rows[0].id = "-".repeat(36);
      },
      (g: typeof f.graph) => {
        g[5].rows[0].store_id = randomUUID();
      },
      (g: typeof f.graph) => {
        g[0].rows[0].closed_at = "2026-01-01T09:00:00.12345678Z";
      },
    ]) {
      const changed = structuredClone(f.graph);
      mutate(changed);
      expect(() => validateSource(JSON.stringify(changed), tables, f.branch, f.shift)).toThrow();
    }
    const precise = JSON.stringify(f.graph).replace(
      '"expected_cash":18',
      '"expected_cash":18.000000000001',
    );
    expect(() => validateSource(precise, tables, f.branch, f.shift)).toThrow();
  });
  it("keeps preparation and native fixture away from operator configuration and live execution", () => {
    const cli = readFileSync("scripts/prepare-local54-fourth-adoption.cjs", "utf8"),
      fixture = readFileSync("scripts/test-local54-fourth-adoption.cjs", "utf8");
    expect(cli).toContain("Only --prepare is supported");
    expect(cli).toContain("maintenance-private.local");
    expect(cli).not.toContain("ConnectionPool");
    expect(fixture).toContain("CodexFourth54_");
    expect(fixture).toContain("Fourth54Fixture_");
    expect(fixture).not.toContain("config-store.cjs");
    expect(fixture).not.toContain("terminal-store.cjs");
  });
});
it.skipIf(process.platform !== "win32" || process.env.POS_RUN_ISOLATED_SQLSERVER !== "1")(
  "verifies exact fourth adoption, real51022, rollback and guarded replay on an owned disposable SQL Server",
  () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/test-local54-fourth-adoption.cjs", "--run"],
      { encoding: "utf8", timeout: 180000, maxBuffer: 1024 * 1024 },
    );
    expect(output).toContain("isolated fourth-adoption SQL Server groups passed");
    expect(output).toContain("Cleaned owned fixture");
  },
  185000,
);
