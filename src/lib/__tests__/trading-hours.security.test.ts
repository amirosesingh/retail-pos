import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ scope: vi.fn(), rest: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ validator: (parse: (v: unknown) => unknown) => ({ handler: (fn: (v: { data: unknown }) => unknown) => (v: { data: unknown }) => fn({ data: parse(v.data) }) }) }) }));
vi.mock("../privileged-caller.server", () => ({ requireCallerScope: h.scope }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: h.rest }));
import { assertHourlyReportScope, loadHourlyTrading } from "../trading-hours.functions";
import type { RelayScope } from "@/core/api/relay-policy.server";
const scope = (changes: Partial<RelayScope> = {}): RelayScope => ({ kind: "staff", label: "Test", role: "cashier", roleSlug: "cashier",
  staffUserId: "U1", appUserId: "A1", storeId: "A", terminalId: "T1", branchRestricted: true, isSupervisor: false,
  permissions: { can_view_sales_reports: true, can_view_cost_margin: true }, ...changes });
const data = { sessionToken: "verified-fixture", from: "2026-11-01", to: "2026-11-06", storeIds: ["A"] };
const wrap = (rows: unknown[], changes = {}) => ({ version: 1, complete: true, from: data.from, to: data.to, store_ids: data.storeIds, row_count: rows.length, rows, ...changes });
const row = { store_id: "A", hour: 8, bills: 1, revenue: 90, cost: 40, profit: 50 };
beforeEach(() => { h.scope.mockReset().mockResolvedValue(scope()); h.rest.mockReset().mockResolvedValue(Response.json(wrap([row]))); });
describe("hourly trading privileged read", () => {
  it("uses only the allowlisted bounded read and rechecks current authority before returning cost", async () => {
    expect(await loadHourlyTrading({ data })).toEqual({ rows: [row] });
    expect(h.rest).toHaveBeenCalledWith("rpc/pos_report_store_hours", { method: "POST", body: JSON.stringify({ p_from: data.from, p_to: data.to, p_store_ids: ["A"] }) });
    expect(h.scope).toHaveBeenCalledTimes(2);
  });
  it("normalizes UUID scope without treating case-sensitive branch codes as interchangeable", () => {
    assertHourlyReportScope(scope({ storeId: "A1234567-1234-4234-8234-123456789ABC" }), ["a1234567-1234-4234-8234-123456789abc"]);
    expect(() => assertHourlyReportScope(scope(), ["a"])).toThrow("outside");
  });
  for (const current of [scope({ kind: "terminal" }), scope({ stale: true }), scope({ staffUserId: null }),
    scope({ permissions: { can_view_cost_margin: true } }), scope({ permissions: { can_view_sales_reports: true } }),
    scope({ storeId: null }), scope({ role: "admin", roleSlug: "admin", isSupervisor: true })]) {
    it(`denies unverified, cost-denied or foreign fixed-terminal reads (${JSON.stringify(current)})`, async () => {
      h.scope.mockResolvedValue(current);
      await expect(loadHourlyTrading({ data: { ...data, storeIds: ["B"] } })).rejects.toThrow();
      expect(h.rest).not.toHaveBeenCalled();
    });
  }
  it("allows only the existing supervisor cross-branch capability, including management", async () => {
    h.scope.mockResolvedValue(scope({ managementDevice: true, branchRestricted: false, isSupervisor: true }));
    h.rest.mockResolvedValue(Response.json(wrap([{ ...row, store_id: "B" }], { store_ids: ["B"] })));
    expect(await loadHourlyTrading({ data: { ...data, storeIds: ["B"] } })).toMatchObject({ rows: [{ store_id: "B" }] });
  });
  it("holds data if cost permission is revoked, or the account changes while the read is pending", async () => {
    for (const next of [scope({ permissions: { can_view_sales_reports: true } }), scope({ staffUserId: "U2" }), scope({ appUserId: "A2" }), scope({ terminalId: "T2" })]) {
      h.scope.mockReset().mockResolvedValueOnce(scope()).mockResolvedValueOnce(next);
      h.rest.mockResolvedValue(Response.json(wrap([row])));
      await expect(loadHourlyTrading({ data })).rejects.toThrow();
    }
  });
  it("rejects forged flags, unlimited branches and malformed range input before a service request", async () => {
    for (const invalid of [{ ...data, includeCost: true }, { ...data, storeIds: Array(101).fill("A") }, { ...data, from: "not-a-date" }])
      await expect(async () => loadHourlyTrading({ data: invalid })).rejects.toThrow();
    expect(h.rest).not.toHaveBeenCalled();
  });
  it("does not trust foreign, duplicate, malformed or oversized aggregate responses", async () => {
    for (const raw of [[{ ...row, store_id: "B" }], [row, row], [{ ...row, hour: 24 }], [{ ...row, cost: null }], Array(2401).fill(row), {}]) {
      h.rest.mockResolvedValue(Response.json(Array.isArray(raw) ? wrap(raw) : raw));
      await expect(loadHourlyTrading({ data })).rejects.toThrow();
    }
  });
  it("rejects truncated or mismatched completeness envelopes rather than displaying partial totals", async () => {
    for (const raw of [wrap([row], { row_count: 1008 }), wrap([row], { complete: false }), wrap([row], { complete: "true" }),
      wrap([row], { row_count: null }), wrap([row], { row_count: "1" }), wrap([row], { from: "2026-10-01" }),
      wrap([row], { to: "2026-12-01" }), wrap([row], { store_ids: ["B"] }), wrap([row], { version: 2 }),
      { ...wrap([row]), extra: true }, { ...wrap([row]), complete: undefined }, [row]]) {
      h.rest.mockResolvedValue(Response.json(raw));
      await expect(loadHourlyTrading({ data })).rejects.toThrow();
    }
  });
  it("returns all 1008 unique hourly groups beyond PostgREST's ordinary row cap", async () => {
    const stores = Array.from({ length: 42 }, (_, n) => `shop-${n}`);
    const rows = stores.flatMap(store_id => Array.from({ length: 24 }, (_, hour) => ({ ...row, store_id, hour })));
    h.scope.mockResolvedValue(scope({ branchRestricted: false, isSupervisor: true }));
    h.rest.mockResolvedValue(Response.json(wrap(rows, { store_ids: stores })));
    expect((await loadHourlyTrading({ data: { ...data, storeIds: stores } })).rows).toHaveLength(1008);
  });
  it("reports missing database support without pretending the hourly values are zero", async () => {
    h.rest.mockResolvedValue(new Response("missing", { status: 404 }));
    await expect(loadHourlyTrading({ data })).rejects.toThrow("reviewed database upgrade");
  });
});
