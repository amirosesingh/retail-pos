import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { isLocalWebCashierTest } from "@/platform-config/platform";

describe("local browser cashier testing", () => {
  it("is available only for local development hosts", () => {
    expect(isLocalWebCashierTest("localhost", true)).toBe(true);
    expect(isLocalWebCashierTest("127.0.0.1", true)).toBe(true);
    expect(isLocalWebCashierTest("pos.example.com", true)).toBe(false);
    expect(isLocalWebCashierTest("localhost", false)).toBe(false);
  });

  it("uses the shared branch-bound relay proof for authorization calls", () => {
    const functions = readFileSync("src/lib/authorization.functions.ts", "utf8");
    expect(functions).toContain("sessionToken: z.string().min(10).optional()");
    expect(functions).toContain("verifyRelayCaller(data)");
    expect(functions).toContain("resolveRelayScope(verified)");
  });
});
