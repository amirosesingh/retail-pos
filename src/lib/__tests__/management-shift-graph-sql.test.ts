import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("executes actual PostgreSQL graph read scope, migration refusal and generation regressions", async () => {
  const result = await promisify(execFile)(process.execPath, ["scripts/test-management-shift-graph-read.mjs"], {
    cwd: process.cwd(), timeout: 30_000, windowsHide: true,
  });
  expect(result.stdout).toContain("Management closing-graph SQL scenarios passed (pinned captured validators)");
}, 35_000);
