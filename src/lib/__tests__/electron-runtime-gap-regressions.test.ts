import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(file, "utf8");

describe("Electron runtime regression guards", () => {
  it("waits for the old local server before restoring the same origin", () => {
    const main = source("electron/main.cjs");
    expect(main).toContain("const previousPort = baseUrl ? Number(new URL(baseUrl).port) : null");
    expect(main).toContain("await stopAppServer()");
    expect(main).toContain("await startAppServer(previousPort)");
    expect(main).toContain("child.exitCode !== null || child.signalCode !== null");
  });

  it("checks directly for any open shift before installing an update", () => {
    const main = source("electron/main.cjs");
    expect(main).toContain('match: { closed_at: null }, limit: 1');
    expect(main).toContain('code: "EBRANCH"');
    expect(main).not.toContain('query(localBranchId(), "shifts", { limit: 500 }');
  });

  it("does not bypass a local recovery PIN lock through the hosted fallback", () => {
    const main = source("electron/main.cjs");
    const local = main.indexOf("const local = await verifySyncedApprovalPin");
    const fallback = main.indexOf("const authorizationUrl = authorizationServerUrl()", local);
    expect(local).toBeGreaterThan(-1);
    expect(main.slice(local, fallback)).toContain('["unavailable", "missing"].includes(local.reason)');
    expect(main.slice(local, fallback)).toContain("Never use that fallback to bypass a local lock");
  });

  it("supports values-shaped inserts and stamps only registered branch columns", () => {
    const main = source("electron/main.cjs");
    expect(main).toContain("operation.rows??(operation.values?[operation.values]:[])");
    expect(main).toContain('supportedColumns.has("store_id")');
    expect(main).toContain("{...operation,values:stamped[0]}");
  });

  it("does not delay governance failures and still runs a queued final pass", () => {
    const push = source("electron/sync/push-worker.cjs");
    const coordinator = source("electron/sync/coordinator.cjs");
    expect(push).toContain('error?.code === "GOVERNANCE_AUTH_REQUIRED"');
    expect(coordinator).toContain("await active.catch(() => undefined)");
  });
});
