import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps real Management pagination checks isolated and opt-in", () => {
  const source = readFileSync("scripts/test-management-report-cursors-sqlserver.cjs", "utf8");
  expect(source).toContain("CodexMgmtCursor_");
  expect(source).toContain("MgmtCursorFixture_");
  expect(source).toContain("assert.deepEqual(process.argv.slice(2), ['--run'])");
  expect(source).not.toContain("config-store.cjs");
  expect(source).not.toContain("terminal-store.cjs");
});

it.skipIf(process.platform !== "win32" || process.env.POS_RUN_ISOLATED_SQLSERVER !== "1")(
  "preserves exact sales and shifts cursors against an owned disposable LocalDB",
  () => {
    const output = execFileSync(process.execPath, ["scripts/test-management-report-cursors-sqlserver.cjs", "--run"], {
      encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024,
    });
    expect(output).toContain("PASS 13 actual isolated SQL Server Management cursor groups");
    expect(output).toContain("Cleaned uniquely owned Management cursor LocalDB fixture");
  }, 125_000,
);
