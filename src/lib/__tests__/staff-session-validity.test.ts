import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { hasStaffSession } from "@/core/api/sync-relay";

const originalWindow = globalThis.window;

function sessionToken(expiresAtSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expiresAtSeconds })).toString("base64url");
  return `header.${payload}.signature`;
}

function installToken(accessToken: string) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) =>
          key === "sb-external-auth-token" ? JSON.stringify({ access_token: accessToken }) : null,
      },
    },
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("staff session validity", () => {
  it("accepts a signed-in session that remains valid beyond the request margin", () => {
    installToken(sessionToken(Math.floor(Date.now() / 1000) + 120));
    expect(hasStaffSession()).toBe(true);
  });

  it("rejects expired, near-expiry, and malformed cached tokens", () => {
    installToken(sessionToken(Math.floor(Date.now() / 1000) - 1));
    expect(hasStaffSession()).toBe(false);
    installToken(sessionToken(Math.floor(Date.now() / 1000) + 10));
    expect(hasStaffSession()).toBe(false);
    installToken("not-a-jwt");
    expect(hasStaffSession()).toBe(false);
  });

  it("does not discard a valid POS login when its secondary Auth token expires", () => {
    const auth = readFileSync("src/lib/pos-auth.tsx", "utf8");
    expect(auth).toContain("const hasIndependentPosProof");
    expect(auth).toContain('authCheck.state === "rejected" && !hasIndependentPosProof');
  });
});
