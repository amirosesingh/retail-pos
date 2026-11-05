import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ calls: [] as { table: string; operation: string; column?: string; values?: string[] }[], from: vi.fn() }));
vi.mock("@/core/local-db/local-db", () => ({ localDb: () => null }));
vi.mock("@/core/local-db/db-mode", () => ({ effectiveDatabaseMode: () => "online" }));
vi.mock("@/integrations/supabase/external-client", () => ({ supabaseExternal: { from: h.from } }));
import { fetchBoard } from "../analytics-board";
beforeEach(() => {
  h.calls = [];
  h.from.mockReset().mockImplementation((table: string) => {
    const query = {
      select: vi.fn(() => query),
      in: vi.fn((column: string, values: string[]) => { h.calls.push({ table, operation: "scope", column, values }); return query; }),
      gte: vi.fn(() => query), lte: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => query),
      range: vi.fn(async () => { h.calls.push({ table, operation: "page" }); return { data: [], error: null, count: 0 }; }),
    };
    return query;
  });
});
describe("company-scoped live board reads", () => {
  it("adds the selected company's branch filter before every paged financial/directory read", async () => {
    await fetchBoard("2026-10-01", "2026-10-26", ["a", "a2"]);
    for (const table of ["v_daily_store_sales", "v_daily_item_sales", "sales", "stores"]) {
      const calls = h.calls.filter(call => call.table === table);
      expect(calls[0]).toEqual({ table, operation: "scope", column: table === "stores" ? "id" : "store_id", values: ["a", "a2"] });
      expect(calls[1]?.operation).toBe("page");
    }
  });
  it("does not turn an empty known company context into an unscoped database read", async () => {
    expect(await fetchBoard("2026-10-01", "2026-10-26", [])).toMatchObject({ storeDays: [], itemDays: [], bills: [], liveStoreIds: [] });
    expect(h.from).not.toHaveBeenCalled();
  });
});
