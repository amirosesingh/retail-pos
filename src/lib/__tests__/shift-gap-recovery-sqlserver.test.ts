import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps real SQL Server recovery acceptance isolated and opt-in", () => {
  const source = readFileSync("scripts/test-shift-gap-recovery-sqlserver.cjs", "utf8");
  expect(source).toContain("CodexGap53_");
  expect(source).toContain("Gap53Fixture_");
  expect(source).not.toContain("config-store.cjs");
  expect(source).not.toContain("terminal-store.cjs");
});

it.skipIf(process.platform !== "win32" || process.env.POS_RUN_ISOLATED_SQLSERVER !== "1")(
  "verifies retained graph recovery against an owned disposable LocalDB",
  () => {
    const output = execFileSync(process.execPath, ["scripts/test-shift-gap-recovery-sqlserver.cjs", "--run"], {
      encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024,
    });
    expect(output).toContain("isolated SQL Server retained-graph recovery groups");
    expect(output).toContain("Cleaned uniquely owned LocalDB fixture");
  }, 125_000,
);
