import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("stale deployment asset recovery", () => {
  it("reloads a stale Vite page once and guards against a reload loop", () => {
    const recovery = readFileSync("src/lib/stale-asset-recovery.ts", "utf8");
    const router = readFileSync("src/router.tsx", "utf8");

    expect(recovery).toContain('window.addEventListener("vite:preloadError"');
    expect(recovery).toContain("event.preventDefault()");
    expect(recovery).toContain("RELOAD_GUARD_MS");
    expect(recovery).toContain("window.location.reload()");
    expect(router).toContain("installStaleAssetRecovery();");
  });
});
