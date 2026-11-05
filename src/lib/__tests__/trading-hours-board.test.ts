import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ from: vi.fn(), hours: vi.fn(), proof: vi.fn() }));
vi.mock("@/core/local-db/local-db", () => ({ localDb: () => null }));
vi.mock("@/core/local-db/db-mode", () => ({ effectiveDatabaseMode: () => "online" }));
vi.mock("@/integrations/supabase/external-client", () => ({ supabaseExternal: { from: h.from } }));
vi.mock("../trading-hours.functions", () => ({ loadHourlyTrading: h.hours }));
vi.mock("../hosted-function-client", () => ({ hostedFunction: (_action: string, direct: unknown) => direct }));
vi.mock("../pos-caller-auth", () => ({ getPosCallerAuth: h.proof }));
import { fetchBoard } from "../analytics-board";
beforeEach(() => {
  h.hours.mockReset().mockResolvedValue({ rows: [{ store_id: "A", hour: 8, bills: 1, revenue: 90, cost: 40, profit: 50 }] });
  h.proof.mockReset().mockResolvedValue({ sessionToken: "fixture-proof" });
  h.from.mockReset().mockImplementation(() => {
    const q = { select: () => q, in: () => q, gte: () => q, lte: () => q, eq: () => q, order: () => q,
      range: async () => ({ data: [], error: null, count: 0 }) };
    return q;
  });
});
describe("bounded board hourly addition", () => {
  it("does not add cost reads to ordinary or cost-denied report loads", async () => {
    await fetchBoard("2026-11-01", "2026-11-06", ["A"]);
    expect(h.hours).not.toHaveBeenCalled(); expect(h.proof).not.toHaveBeenCalled();
  });
  it("uses one scoped, authenticated aggregate without downloading raw sale lines", async () => {
    const result = await fetchBoard("2026-11-01", "2026-11-06", ["A", "A"], { includeHourlyProfit: true });
    expect(h.hours).toHaveBeenCalledExactlyOnceWith({ data: { sessionToken: "fixture-proof", from: "2026-11-01", to: "2026-11-06", storeIds: ["A"] } });
    expect(result.hourlyRows).toHaveLength(1);
    expect(h.from.mock.calls.map(([table]) => table)).not.toContain("sale_items");
  });
  it("keeps the successful daily report distinct from unavailable hourly evidence", async () => {
    h.hours.mockRejectedValue(new Error("Hourly report upgrade unavailable"));
    const result = await fetchBoard("2026-11-01", "2026-11-06", ["A"], { includeHourlyProfit: true });
    expect(result.storeDays).toEqual([]); expect(result).not.toHaveProperty("hourlyRows");
    expect(result.hourlyIssue).toBe("Hourly report upgrade unavailable");
  });
  it("never turns empty or unspecified authority into an unscoped private hourly read", async () => {
    await fetchBoard("2026-11-01", "2026-11-06", [], { includeHourlyProfit: true });
    await fetchBoard("2026-11-01", "2026-11-06", undefined, { includeHourlyProfit: true });
    expect(h.hours).not.toHaveBeenCalled();
  });
});
