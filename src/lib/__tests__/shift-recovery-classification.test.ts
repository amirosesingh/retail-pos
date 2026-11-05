import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("runs the exact retained-graph classifier regression suite in the native runtime", () => {
  const output = execFileSync(process.execPath, ["--test", "scripts/test-shift-recovery-classification.cjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  expect(output).toContain("# fail 0");
  expect(output).toContain("legacy uncounted card/digital NULL");
  expect(output).toContain("365-day offline history expiry");
});

it("runs the recovery-evidence safety tests without requiring a live database", () => {
  const output = execFileSync(process.execPath, ["--test", "scripts/test-shift-recovery-evidence.cjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  expect(output).toContain("# fail 0");
  expect(output).toContain("90/365-day capture retries retain evidence");
  expect(output).toContain("scope denial happens before SQL");
});
