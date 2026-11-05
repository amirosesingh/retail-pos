import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { readAnalytics } = require("../../../electron/db/repositories/analytics.cjs");
const guard = require("../../../electron/ipc-guard.cjs");
const fixture = (rows: unknown[] = []) => {
  let query = "";
  const request = { input: () => request, query: async (sql: string) => { query = sql; return { recordsets: [[], [], [], [], rows] }; } };
  return { manager: { pool: { request: () => request } }, query: () => query };
};
describe("native hourly analytics admission", () => {
  it("does not request private hourly costs from an untrusted flag or missing authority", async () => {
    for (const options of [{}, { canViewHourlyCost: true }, { canViewHourlyCost: () => false }]) {
      const f = fixture(); const result = await readAnalytics(f.manager, "A", "2026-11-01", "2026-11-01", "UTC", options);
      expect(f.query()).not.toContain("COALESCE(f.cost,0) cost FROM #bills"); expect(result).not.toHaveProperty("hourlyRows");
    }
  });
  it("aggregates actual saved net and cost by selected business timezone with exact branch scope", async () => {
    const f = fixture([{ store_id: "A", created_at: "2026-11-01T00:01:00Z", revenue: 90, cost: 40 },
      { store_id: "A", created_at: "2026-11-01T00:02:00Z", revenue: -20, cost: -10 }]);
    const result = await readAnalytics(f.manager, "A", "2026-11-01", "2026-11-01", "Asia/Singapore", { canViewHourlyCost: () => true });
    expect(result.hourlyRows).toEqual([{ store_id: "A", hour: 8, bills: 2, revenue: 70, cost: 30, profit: 40 }]);
    expect(result.bills).toEqual([]);
  });
  it("holds foreign or invalid hourly evidence instead of silently treating it as zero", async () => {
    for (const row of [{ store_id: "B", created_at: "2026-11-01T00:01:00Z", revenue: 90, cost: 40 },
      { store_id: "A", created_at: "2026-11-01T00:01:00Z", revenue: NaN, cost: 40 }]) {
      const f = fixture([row]); await expect(readAnalytics(f.manager, "A", "2026-11-01", "2026-11-01", "UTC", { canViewHourlyCost: () => true })).rejects.toThrow();
    }
  });
  it("rechecks cost authority after SQL answers", async () => {
    let calls = 0; const f = fixture([{ store_id: "A", created_at: "2026-11-01T00:01:00Z", revenue: 90, cost: 40 }]);
    const result = await readAnalytics(f.manager, "A", "2026-11-01", "2026-11-01", "UTC", { canViewHourlyCost: () => ++calls === 1 });
    expect(result).not.toHaveProperty("hourlyRows");
  });
  it("executes the actual Main wrapper, ignores forged flags and rejects authority handover", async () => {
    const source = readFileSync("electron/main.cjs", "utf8");
    const begin = source.indexOf('  ipcMain.handle("business:analytics"');
    const block = source.slice(begin, source.indexOf('  ipcMain.handle("business:query"', begin));
    let handler: (...args: unknown[]) => Promise<unknown> = async () => null;
    let epoch = 1, cost = false;
    const session = { epoch: () => epoch, hasPosAuthority: () => true, hasPermission: (key: string) => key === "can_view_sales_reports" || cost };
    const run = new Function("ipcMain", "guard", "adminSession", "readAnalytics", "databaseManager", "authorizedLocalBranch", block);
    run({ handle: (_name: string, callback: typeof handler) => { handler = callback; } }, guard, session,
      async (_db: unknown, _branch: string, _from: string, _to: string, _zone: string, options: { canViewHourlyCost: () => boolean }) => ({ cost: options.canViewHourlyCost() }), {}, () => "A");
    expect(await handler({}, "2026-11-01", "2026-11-01", "UTC", { canViewHourlyCost: true })).toEqual({ cost: false });
    cost = true;
    run({ handle: (_name: string, callback: typeof handler) => { handler = callback; } }, guard, session, async () => { epoch++; return { private: true }; }, {}, () => "A");
    expect(await handler({}, "2026-11-01", "2026-11-01", "UTC")).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
  });
});
