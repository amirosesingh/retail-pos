import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
const { readManagementReport } = createRequire(import.meta.url)("../../../electron/db/repositories/management-reports.cjs");
const session = createRequire(import.meta.url)("../../../electron/admin-session.cjs");
const privilege = createRequire(import.meta.url)("../../../electron/ipc-privilege.cjs");
afterEach(() => session.clear());
const options = { kind: "totals", storeIds: ["a", "b"], from: "1900-01-01", to: "2026-10-26", zone: "Asia/Kuala_Lumpur" };
it("enforces report permissions before reaching the dedicated read handler for ordinary accounts", () => {
  session.clear(); expect(privilege.allowed("business:management-report", [options])).toBe(false);
  session.grant("staff", "viewer", {}, "pos", null);
  expect(privilege.allowed("business:management-report", [options])).toBe(false);
  session.grant("staff", "viewer", { can_view_sales_reports: true }, "pos", null);
  expect(privilege.allowed("business:management-report", [options])).toBe(true);
  session.grant("staff", "shift-viewer", { can_shift_expected_cash_view: true }, "pos", null);
  expect(privilege.allowed("business:management-report", [{ ...options, kind: "sales", shiftId: "shift" }])).toBe(true);
  expect(privilege.allowed("business:management-report", [options])).toBe(false);
});
function fixture({ complete = true, branch = null as string | null, management = true, permissions = ["can_view_sales_reports"], cursorAt = "2026-10-26T01:00:00.0000000+00:00" as unknown } = {}) {
  const calls: { sql: string; inputs: Record<string, unknown> }[] = [];
  const pool = { request: () => {
    const inputs: Record<string, unknown> = {};
    const request = { input(name: string, value: unknown) { inputs[name] = value; return request; }, async query(sql: string) {
      calls.push({ sql, inputs });
      if (sql.includes("SELECT requested.")) return { recordset: complete ? [] : [{ id: "b" }] };
      if (sql.includes("COUNT_BIG")) return { recordset: [{ store_id: "a", revenue: 50, bills: 5 }] };
      if (sql.includes("FROM dbo.shifts")) return { recordset: [{ id: "shift", opened_at: new Date("2026-10-26T01:00:00Z"), expected_cash: 99, __pos_report_cursor_at: cursorAt }] };
      return { recordsets: [[{ id: "sale", created_at: new Date("2026-10-26T01:00:00Z"), __pos_report_cursor_at: cursorAt }], [{ sale_id: "sale", unit_cost: 10 }]] };
    } }; return request;
  } };
  return { calls, deps: { manager: { pool, isConnected: () => true }, databaseService: { snapshot: () => ({ tradingReady: true }) },
    session: { hasPosAuthority: () => true, hasLevel: () => false, hasPermission: (key: string) => permissions.includes(key), branchId: () => branch, identity: () => ({ permissions: {} }) }, management, options } };
}
it("refuses branch terminals, unauthorized branches and incomplete replicas before returning totals", async () => {
  const till = fixture({ management: false });
  await expect(readManagementReport(till.deps)).rejects.toMatchObject({ code: "PERMISSION_DENIED" }); expect(till.calls).toHaveLength(0);
  const assigned = fixture({ branch: "a" });
  await expect(readManagementReport(assigned.deps)).rejects.toMatchObject({ code: "PERMISSION_DENIED" }); expect(assigned.calls).toHaveLength(0);
  const partial = fixture({ complete: false });
  await expect(readManagementReport(partial.deps)).rejects.toMatchObject({ code: "EMANAGEMENT_REPLICA_INCOMPLETE" }); expect(partial.calls).toHaveLength(1);
});
it("requires completed full-history bootstrap per shop and aggregates lifetime headers without downloading bill lines", async () => {
  const f = fixture(); const result = await readManagementReport(f.deps);
  expect(result).toMatchObject({ complete: true, source: "management-local", storeTotals: [{ store_id: "a", revenue: 50, bills: 5 }] });
  expect(f.calls[0].sql).toContain("bootstrap_7300"); expect(f.calls[0].sql).toContain("j.status<>N'completed'");
  expect(f.calls[0].sql).toContain("recovered.updated_at>j.updated_at");
  expect(f.calls[1].sql).toContain("COUNT_BIG"); expect(f.calls[1].sql).not.toContain("sale_items");
  expect(f.calls[1].inputs).toMatchObject({ branches: '["a","b"]', to: "2026-10-26T16:00:00.000Z" });
});
it("pages sales using bound cursor and redacts item costs without margin permission", async () => {
  const f = fixture();
  const result = await readManagementReport({ ...f.deps, options: { ...options, kind: "sales", limit: 500, cursor: { ts: "2026-10-26T02:00:00Z", id: "previous" } } });
  expect(result.rows[0]).toMatchObject({ created_at: "2026-10-26T01:00:00.000Z", sale_items: [{ unit_cost: null }] });
  expect(f.calls[1].sql).toContain("@cursorAt"); expect(f.calls[1].sql).toContain("TOP (@limit)");
  expect(f.calls[1].inputs.cursorId).toBe("previous");
  expect(result.cursor.ts).toBe("2026-10-26T01:00:00.0000000+00:00");
  expect(result.rows[0]).not.toHaveProperty("__pos_report_cursor_at");
});
it("uses the existing masked shift projection and shift permissions instead of granting cash details", async () => {
  const denied = fixture();
  await expect(readManagementReport({ ...denied.deps, options: { ...options, kind: "shifts" } })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  const f = fixture({ permissions: ["can_open_shift"] });
  const redactShift = vi.fn(({ expected_cash: _cash, ...row }) => row);
  const result = await readManagementReport({ ...f.deps, options: { ...options, kind: "shifts" }, redactShift });
  expect(redactShift).toHaveBeenCalledOnce(); expect(result.rows[0]).not.toHaveProperty("expected_cash");
  expect(result.rows[0].opened_at).toBe("2026-10-26T01:00:00.000Z");
  expect(result.cursor.ts).toBe("2026-10-26T01:00:00.0000000+00:00");
  expect(result.rows[0]).not.toHaveProperty("__pos_report_cursor_at");
  expect(redactShift.mock.calls[0][0]).not.toHaveProperty("__pos_report_cursor_at");
});

it.each(["2026-10-26T01:00:00.1234567Z", "2026-10-26T09:00:00.1234567+08:00", "2026-10-26T01:00:00Z"])("keeps the exact SQL cursor %s without changing public date serialization", async cursorAt => {
  const f = fixture({ cursorAt });
  const result = await readManagementReport({ ...f.deps, options: { ...options, kind: "sales" } });
  expect(result.cursor.ts).toBe(cursorAt);
  expect(result.rows[0].created_at).toBe("2026-10-26T01:00:00.000Z");
});

it.each([null, "invalid", new Date("2026-10-26T01:00:00Z")])("refuses a page with an unavailable exact SQL cursor (%s)", async cursorAt => {
  const f = fixture({ cursorAt });
  await expect(readManagementReport({ ...f.deps, options: { ...options, kind: "sales" } })).rejects.toMatchObject({ code: "EREPORT_CURSOR" });
});
