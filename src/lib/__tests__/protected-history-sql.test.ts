import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("passes isolated PostgreSQL projection, admission, byte-bound and cursor regressions", () => {
  const root=fileURLToPath(new URL("../../../",import.meta.url));
  const output=execFileSync(process.execPath,["scripts/test-protected-history-page.mjs"],{
    cwd:root,encoding:"utf8",timeout:90_000,maxBuffer:1024*1024,
  });
  expect(output).toContain("PASS 994 projection parity / denied-access scenarios");
},100_000);
