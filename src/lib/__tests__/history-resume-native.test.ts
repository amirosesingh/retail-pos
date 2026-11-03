import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("runs the native history-resume transaction and crash-boundary regressions", async () => {
  // This harness uses only its in-memory transactional fixture. The opt-in
  // LocalDB harness remains separate and is never invoked by CI.
  const result = await promisify(execFile)(process.execPath, ["--test", "scripts/test-history-resume.cjs"], {
    cwd: process.cwd(), timeout: 20_000, windowsHide: true,
  });
  expect(result.stdout).toMatch(/# tests 17\b/);
  expect(result.stdout).toMatch(/# pass 17\b/);
  expect(result.stdout).toMatch(/# fail 0\b/);
}, 25_000);
