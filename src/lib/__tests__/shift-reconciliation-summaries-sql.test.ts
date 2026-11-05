import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("preserves guarded shift reconciliation while persisting derived summaries", () => {
  const output = execFileSync(process.execPath, ["scripts/test-shift-reconciliation-summaries.mjs"], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)), encoding: "utf8", timeout: 90_000, maxBuffer: 1024 * 1024,
  });
  expect(output).toMatch(/PASS \d+ isolated shift-reconciliation summary scenarios/);
}, 100_000);

it("repairs only seven exact synthetic parent summaries with real captured triggers", () => {
  const output = execFileSync(process.execPath, ["scripts/test-seven-shift-summary-repair.mjs"], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)), encoding: "utf8", timeout: 90_000, maxBuffer: 1024 * 1024,
  });
  expect(output).toMatch(/PASS \d+ isolated seven-shift repair scenarios/);
}, 100_000);
