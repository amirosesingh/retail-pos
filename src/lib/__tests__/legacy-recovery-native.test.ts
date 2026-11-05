import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("checks actual native administrator epochs, sealed enrolled keys and legacy-only signatures", () => {
  const output = execFileSync(process.execPath, ["--test", "scripts/test-legacy-shift-recovery-authority.cjs", "scripts/test-shift-author-key.cjs"], {
    encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  expect(output).toContain("90/365-day frozen approvals replay under a later cashier");
  expect(output).toContain("# fail 0");
}, 35_000);

it.skipIf(process.platform !== "win32" || process.env.POS_RUN_ISOLATED_SQLSERVER !== "1")(
  "freezes and acknowledges legacy recovery in a uniquely owned disposable LocalDB", () => {
    const output = execFileSync(process.execPath, ["scripts/test-legacy-shift-recovery-outbox-sqlserver.cjs", "--run"], {
      encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024,
    });
    expect(output).toContain("PASS 19 isolated SQL Server legacy recovery groups");
    expect(output).toContain("Cleaned uniquely owned LocalDB fixture");
  }, 125_000,
);
