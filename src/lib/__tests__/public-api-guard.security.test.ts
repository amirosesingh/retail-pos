import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Everything under /api/public/* answers without a signed-in session, so each
 * handler must name the guard it relies on — a real check, or an explicit
 * "this is deliberately open" marker. This test fails the build if a new
 * endpoint ships without one, which is the whole point of the shared guard.
 */
const DIR = join(process.cwd(), "src/routes/api/public");

const GUARDS = [
  "verifyHmacSignature",
  "verifySharedSecret",
  "publiclyReadable",
  "callerVerifiedDownstream",
];

describe("public API endpoints", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".ts"));

  it("has endpoints to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s names a guard from the shared module", (file) => {
    const src = readFileSync(join(DIR, file), "utf8");
    let handler = src;
    if (file === "cashier-login.ts") {
      // This route delegates to the same guarded endpoint as the Worker entry.
      // Follow that exact implementation, retaining the guard requirement.
      expect(src).toContain('import { handleCashierLogin } from "@/lib/cashier-login-endpoint.server"');
      expect(src).toContain("withCors(await handleCashierLogin(request), request)");
      handler = readFileSync(join(process.cwd(), "src/lib/cashier-login-endpoint.server.ts"), "utf8");
    }
    expect(handler).toContain("@/lib/public-api-guard.server");
    expect(GUARDS.some((g) => handler.includes(g))).toBe(true);
  });
});
