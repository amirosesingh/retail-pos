import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(file, "utf8");

describe("Electron database error recovery", () => {
  it("starts a fresh active-error window for each app launch and resolves successful syncs", () => {
    const diagnostics = source("electron/diagnostics.cjs");
    const main = source("electron/main.cjs");

    expect(main).toContain('diagnostics.logConnection("application.started"');
    expect(main).toContain('diagnostics.logConnection("synchronization.automatic.succeeded"');
    expect(diagnostics).toContain("const lastStart");
    expect(diagnostics).toContain("const active = new Map()");
    expect(diagnostics).toContain("occurrences:");
  });

  it("lets Main replace stale renderer branch aliases only for audit rows", () => {
    const main = source("electron/main.cjs");
    const database = source("src/core/api/pos-db.ts");

    expect(main).toContain('operation.table==="audit_logs"');
    expect(database).toContain("store_id: null");
    expect(main).toContain("Other supplied mismatches remain rejected");
  });

  it("routes public flags through the central authenticated relay on Electron", () => {
    const flags = source("src/lib/public-flags.ts");
    const policy = source("src/core/api/relay-policy.server.ts");

    expect(flags).toContain('platformName() === "electron"');
    expect(flags).toContain("await relayOp");
    expect(policy).toContain('public_flags: { write: "can_access_pos_settings"');
  });
});
