import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("repairs only the selected saved-web shift summaries with exact trigger pins", () => {
  const output = execFileSync(process.execPath, ["scripts/test-web-shift-summary-repair.mjs"], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)), encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024,
  });
  expect(output).toMatch(/PASS \d+ isolated saved-web shift repair scenarios/);
}, 130_000);
