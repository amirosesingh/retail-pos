import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("preserves protected history privacy, migration guards and structured values", () => {
  const output = execFileSync(process.execPath, ["scripts/test-history-projection-upgrade.mjs"], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  expect(output).toContain("PASS 13 isolated history projection upgrade scenarios");
}, 35_000);
