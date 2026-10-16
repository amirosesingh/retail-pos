import { beforeEach, describe, expect, it, vi } from "vitest";

const { orders, ranges, nullFilters, auth, counts, page } = vi.hoisted(() => ({
  orders: [] as string[],
  ranges: [] as [number, number][],
  nullFilters: [] as string[],
  auth: { present: true, restored: true },
  counts: [] as (string | undefined)[],
  page: vi.fn<(from: number, to: number) => Promise<{ data: Record<string, unknown>[]; error: { message: string; code?: string } | null; count?: number }>>(),
}));

vi.mock("@/integrations/supabase/external-client", () => {
  const client = {
    from: () => ({
      select: (_columns: string, options?: { count?: string }) => {
        counts.push(options?.count);
        const query = {
          eq: () => query,
          is: (column: string) => {
            nullFilters.push(column);
            return query;
          },
          in: () => query,
          order: (column: string) => {
            orders.push(column);
            return query;
          },
          limit: () => query,
          range: (from: number, to: number) => {
            ranges.push([from, to]);
            return page(from, to);
          },
        };
        return query;
      },
    }),
  };
  return {
    supabaseExternal: client,
    authenticatedExternalClientSnapshot: async () => (auth.restored ? client : null),
  };
});

vi.mock("@/lib/session-presence", () => ({
  hasCentralAuthSession: () => auth.present,
}));

vi.mock("@/core/local-db/db-mode", () => ({
  effectiveDatabaseMode: () => "online",
  isConnectionError: () => false,
}));

vi.mock("@/core/activation/connection-health", () => ({ lastHealth: () => null }));
vi.mock("@/lib/offline-snapshot", () => ({ readSnapshot: () => null }));
vi.mock("@/lib/row-versions", () => ({ noteVersions: () => undefined }));

import { routedQuery } from "@/core/api/db-query";
import { __resetSessionEpoch, bumpSessionEpoch } from "../session-epoch";

describe("routed query ordering", () => {
  beforeEach(() => {
    orders.splice(0);
    ranges.splice(0);
    nullFilters.splice(0);
    auth.present = true;
    auth.restored = true;
    counts.splice(0);
    page.mockReset().mockResolvedValue({ data: [], error: null, count: 0 });
    __resetSessionEpoch();
  });

  it("does not count bounded reads and counts an uncapped table only once", async () => {
    await routedQuery("stock_transfers", { limit: 500 });
    expect(counts).toEqual([undefined]);
    counts.splice(0);
    page.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, id) => ({ id })), count: 1001, error: null })
      .mockResolvedValueOnce({ data: [{ id: 1000 }], error: null });
    expect(await routedQuery("products")).toHaveLength(1001);
    expect(counts).toEqual(["exact", undefined]);
  });

  it("shares simultaneous reads only within the same signed-in generation", async () => {
    let finish!: (value: { data: Record<string, unknown>[]; error: null }) => void;
    page.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = routedQuery("stock_transfers", { limit: 500 });
    const shared = routedQuery("stock_transfers", { limit: 500 });
    const old = Promise.allSettled([first, shared]);
    await vi.waitFor(() => expect(page).toHaveBeenCalledOnce());
    bumpSessionEpoch();
    page.mockResolvedValueOnce({ data: [{ id: "new-user-row" }], error: null });
    expect(await routedQuery("stock_transfers", { limit: 500 })).toEqual([{ id: "new-user-row" }]);
    finish({ data: [{ id: "old-user-row" }], error: null });
    const results = await old;
    expect(results.every(result => result.status === "rejected")).toBe(true);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it("retries a timed-out cloud page without losing its filters or pagination", async () => {
    page.mockResolvedValueOnce({ data: [], error: { code: "57014", message: "statement timeout" } })
      .mockResolvedValueOnce({ data: [{ id: "transfer" }], error: null });
    expect(await routedQuery("stock_transfers", { offset: 500, limit: 500 })).toEqual([{ id: "transfer" }]);
    expect(ranges).toEqual([[500, 999], [500, 999]]);
  });

  it("uses composite keys as stable ties without appending a nonexistent id", async () => {
    await routedQuery("settings_overrides", {
      columns: "section,patch",
      match: { scope: "CLUSTER", scope_id: "361-degree" },
      orderBy: { column: "section" },
      limit: 1,
    });

    expect(orders).toEqual(["section", "scope", "scope_id"]);
  });

  it("retains id as the default order for ordinary entity tables", async () => {
    await routedQuery("products", { limit: 1 });

    expect(orders).toEqual(["id"]);
  });

  it("uses PostgREST is.null semantics for active-row filters", async () => {
    await routedQuery("products", { match: { deleted_at: null }, limit: 1 });
    expect(nullFilters).toEqual(["deleted_at"]);
  });

  it("uses the complete primary key when a cloud table has no id column", async () => {
    await routedQuery("settings_scoped", { limit: 5000 });

    expect(orders).toEqual(["scope", "scope_id", "key"]);
    expect(ranges).toEqual([[0, 4999]]);
  });

  it("adds an id tie-breaker for timestamp cursor reads", async () => {
    await routedQuery("bookings", {orderBy:{column:"created_at",ascending:false},limit:500});
    expect(orders).toEqual(["created_at","id"]);
  });

  it("honours bounded offsets for large paged reads", async () => {
    await routedQuery("stock_transfer_items", { offset: 2000, limit: 1000 });
    expect(ranges).toEqual([[2000, 2999]]);
  });

  it("does not send protected reads before the verified client session is ready", async () => {
    auth.restored = false;
    await expect(routedQuery("settings_scoped", { limit: 1 })).rejects.toThrow(
      "still being restored",
    );
    expect(ranges).toEqual([]);
  });

  it("keeps the deliberately public bootstrap surface available while signed out", async () => {
    auth.present = false;
    auth.restored = false;
    await expect(routedQuery("public_flags", { limit: 1 })).resolves.toEqual([]);
    expect(ranges).toEqual([[0, 0]]);
  });
});
