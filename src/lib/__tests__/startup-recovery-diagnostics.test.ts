import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { bootstrapDiagnostic, tagBootstrapDiagnostic, sqlErrorDiagnostic } = require("../../../electron/diagnostics.cjs");
const main = readFileSync("electron/main.cjs", "utf8");
const source = main.slice(main.indexOf("let localDataPreparePromise=null;"), main.indexOf("let localDatabaseRecoveryPromise=null;"));
function fixture(failure: unknown, cached = false) {
  const transition = vi.fn(), markReady = vi.fn(), finish = vi.fn(), logConnection = vi.fn();
  const prepare = new Function("databaseConfig", "databaseService", "diagnostics", "localDataLifecycle", "isManagementDevice", "managementReplica", "localBranchId", "syncRegistry",
    source + ";return prepareLocalData;")(
    { profile: () => ({ retentionDays: 30 }) },
    { snapshot: () => ({ localRecoveryPending: false }), beginStartupActivity: () => ({ report: vi.fn(), finish }), transition, markReady },
    { bootstrapDiagnostic, sqlErrorDiagnostic, logConnection },
    { ensure: async () => { throw failure; }, preserveCachedReady: () => cached },
    () => false, {}, () => "fixture-branch", { tables: [{ cloudTable: "shifts" }, { cloudTable: "products" }] },
  );
  return { prepare, transition, markReady, finish, logConnection };
}

describe("native startup recovery domain marker", () => {
  it.each([false, true])("preserves a registered shift domain and the original error without changing cached admission (%j)", async cached => {
    const failure = Object.assign(new Error("Retained shift facts remain unverified"), { code: "ELOCAL_PENDING_UNVERIFIED", table: "shifts", sqlNumber: 547 });
    const f = fixture(failure, cached);
    await expect(f.prepare()).rejects.toBe(failure);
    const detail = cached ? f.markReady.mock.calls[0][0] : f.transition.mock.calls[0][1];
    expect(detail).toMatchObject({ code: failure.code, error: failure.message, table: "shifts", syncReady: false });
    expect(cached ? f.transition : f.markReady).not.toHaveBeenCalled(); expect(f.finish).toHaveBeenCalledWith(failure);
  });

  it("retains a real non-shift domain without converting it into a shift review", async () => {
    const failure = Object.assign(new Error("Stock verification is pending"), { code: "ELOCAL_PENDING_UNVERIFIED", table: "products" });
    const f = fixture(failure); await expect(f.prepare()).rejects.toBe(failure);
    expect(f.transition).toHaveBeenCalledWith("enabled_bootstrapping", expect.objectContaining({ code: failure.code, table: "products" }));
  });

  it.each(["unknown_table", "https://private.invalid?key=PRIVATE", { toString: (): string => "shifts" }])(
    "does not copy unknown or sensitive domain values into startup state", async table => {
      const failure = Object.assign(new Error("Original public failure"), { code: "ELOCAL_PENDING_UNVERIFIED", table, query: "PRIVATE query", credentials: "PRIVATE credential" });
      const f = fixture(failure); await expect(f.prepare()).rejects.toBe(failure);
      const detail = f.transition.mock.calls[0][1];
      expect(detail).not.toHaveProperty("table"); expect(detail).not.toHaveProperty("query"); expect(detail).not.toHaveProperty("credentials");
      expect(JSON.stringify(detail)).not.toContain("PRIVATE"); expect(detail.error).toBe(failure.message);
    });

  it("uses a registered private diagnostic without invoking a foreign table getter", async () => {
    const getter = vi.fn(() => { throw Error("PRIVATE getter"); });
    const failure = tagBootstrapDiagnostic(Object.defineProperty(Object.assign(new Error("Original shift failure"), { code: "ELOCAL_CT_PENDING" }), "table", { get: getter }),
      { table: "shifts", phase: "local_apply", origin: "gap_recovery" });
    const f = fixture(failure); await expect(f.prepare()).rejects.toBe(failure);
    expect(getter).not.toHaveBeenCalled();
    expect(f.transition).toHaveBeenCalledWith("enabled_bootstrapping", expect.objectContaining({ table: "shifts", code: "ELOCAL_CT_PENDING" }));
    expect(f.logConnection).toHaveBeenCalledWith("synchronization.bootstrap.failed", expect.objectContaining({ table: "shifts", bootstrapPhase: "local_apply" }));
  });
});
