import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("rejects malformed protected responses before HTTP success in actual workerd", () => {
  const output = execFileSync(process.execPath, ["scripts/measure-history-workerd-cpu.mjs", "--functional"], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)), encoding: "utf8", timeout: 45_000, maxBuffer: 1024 * 1024,
  });
  const result = JSON.parse(output);
  expect(result.nativeBoundaryChecks).toEqual({ shortResponses: 3, overlongResponses: 3, lateExcess: 3, explicitAbortPropagation: 3 });
  expect(result.results).toHaveLength(3);
}, 50_000);
