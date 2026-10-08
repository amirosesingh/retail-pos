import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { OperationsRepository } = require("../../../electron/db/repositories/operations.cjs");
const { aggregatePolicy } = require("../../../electron/db/write-policy.cjs");
const { shiftSummaryRow } = require("../../../electron/db/shift-summary.cjs");
const query = vi.fn();
class Request { input() { return this; } query(sql: string) { return query(sql); } }
const repository = new OperationsRepository({ sql: () => ({ Request }) }, { tables: [] });
const scope = { branchId: "branch-a", terminalId: "terminal-a", enforcePermissions: true, permissions: { can_access_pos_settings: true, can_open_shift: true } };
beforeEach(() => query.mockReset().mockResolvedValue({ recordset: [] }));
describe("trusted settings and shift operations", () => {
  it("does not convert branch settings permission into administrator authority", () => {
    expect(aggregatePolicy("general", [], { source: "pos", level: "cashier", permissions: { can_access_pos_settings: true } }).isSettingsAdmin).toBe(false);
    expect(aggregatePolicy("general", [], { source: "pos", level: "admin", permissions: {} }).isSettingsAdmin).toBe(true);
  });
  it.each(["pos_settings", "settings_locks", "public_flags", "payment_types"])("refuses staff global %s writes", async (table) => {
    await expect(repository.assertSettingsPermissions({}, { table, kind: "upsert", rows: [{ id: 1 }] }, scope)).rejects.toThrow("administrator");
    expect(query).not.toHaveBeenCalled();
  });
  it("checks the settings lock within the write transaction", async () => {
    query.mockResolvedValue({ recordset: [{ locked: true }] });
    await expect(repository.assertSettingsPermissions({}, { table: "settings_overrides", kind: "upsert", rows: [{ scope: "BRANCH", scope_id: "branch-a", section: "tax" }] }, scope)).rejects.toThrow("locked");
    expect(query.mock.calls[0][0]).toContain("UPDLOCK,HOLDLOCK");
  });
  it("refuses another branch and cluster even with branch settings permission", async () => {
    for (const [tier, id] of [["BRANCH", "branch-b"], ["CLUSTER", "cluster-a"]])
      await expect(repository.assertSettingsPermissions({}, { table: "settings_overrides", kind: "upsert", rows: [{ scope: tier, scope_id: id, section: "tax" }] }, scope)).rejects.toThrow("this branch");
    expect(query).not.toHaveBeenCalled();
  });
  it("admits an unlocked own-branch override", async () => {
    await expect(repository.assertSettingsPermissions({}, { table: "settings_overrides", kind: "upsert", rows: [{ scope: "BRANCH", scope_id: "branch-a", section: "tax" }] }, scope)).resolves.toBeUndefined();
  });
  it("requires opening permission and refuses closing through generic writes", async () => {
    const op = { table: "shifts", kind: "upsert", rows: [{ opening_float: 20, status: "OPEN" }] };
    await expect(repository.assertShiftOpening({}, op, { ...scope, permissions: {} })).rejects.toThrow("permission");
    await expect(repository.assertShiftOpening({}, { ...op, rows: [{ ...op.rows[0], closed_at: "now" }] }, scope)).rejects.toThrow("cash-count");
    expect(query).not.toHaveBeenCalled();
  });
  it("prevents duplicate shifts with a serializable branch lock", async () => {
    query.mockResolvedValue({ recordset: [{ id: "existing" }] });
    await expect(repository.assertShiftOpening({}, { table: "shifts", kind: "insert", rows: [{ opening_float: 20, status: "OPEN" }] }, scope)).rejects.toThrow("already open");
    expect(query.mock.calls[0][0]).toContain("UPDLOCK,HOLDLOCK");
  });
  it("retains complete database totals for shifts larger than the visible bill cache", () => {
    const row = shiftSummaryRow({ id: "summary", shift: { id: "shift", opening_float: 50, opened_at: "now" }, branchId: "a", branchName: "A", terminalName: "T", actor: "Amy", closedAt: "later", countedCash: 1050,
      totals: { total_sales: 100000, transactions: 10000, expected_cash: 1050, expected_card: 99000, expected_digital: 0, discounts: 200, refunds: 50 } });
    expect(row).toMatchObject({ transactions: 10000, total_sales: 100000, refunds: 50, payment_breakdown: { cash: 1000, card: 99000 } });
    expect(row.summary).toContain("10000 bill(s)");
  });
});
