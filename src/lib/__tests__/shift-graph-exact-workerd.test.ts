import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
it("preserves graph numeric wire/privacy and authorization in actual workerd", () => {
  const result = JSON.parse(
    execFileSync(process.execPath, ["scripts/test-shift-graph-exact-workerd.mjs"], {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      encoding: "utf8",
      timeout: 90000,
      maxBuffer: 1024 * 1024,
    }),
  );
  expect(result.wireChecks).toEqual({
    exactNumbers: true,
    privacy: true,
    malformed: 4,
    foreignBranchDenied: true,
    errorContract: true,
  });
  expect(result.results).toHaveLength(3);
}, 95000);
