import { beforeEach, describe, expect, it, vi } from "vitest";

const { orders, ranges } = vi.hoisted(() => ({
  orders: [] as string[],
  ranges: [] as [number, number][],
}));

vi.mock("@/integrations/supabase/external-client", () => ({
  supabaseExternal: {
    from: () => ({
      select: () => {
        const query = {
          eq: () => query,
          in: () => query,
          order: (column: string) => {
            orders.push(column);
            return query;
          },
          limit: () => query,
          range: (from: number, to: number) => {
            ranges.push([from, to]);
            return Promise.resolve({ data: [], error: null, count: 0 });
          },
        };
        return query;
      },
    }),
  },
}));

vi.mock("@/core/local-db/db-mode", () => ({
  effectiveDatabaseMode: () => "online",
  isConnectionError: () => false,
}));

vi.mock("@/core/activation/connection-health", () => ({ lastHealth: () => null }));
vi.mock("@/lib/offline-snapshot", () => ({ readSnapshot: () => null }));
vi.mock("@/lib/row-versions", () => ({ noteVersions: () => undefined }));

import { routedQuery } from "@/core/api/db-query";

describe("routed query ordering", () => {
  beforeEach(() => {
    orders.splice(0);
    ranges.splice(0);
  });

  it("does not append id when a composite-key table supplies its own order", async () => {
    await routedQuery("settings_overrides", {
      columns: "section,patch",
      match: { scope: "CLUSTER", scope_id: "361-degree" },
      orderBy: { column: "section" },
      limit: 1,
    });

    expect(orders).toEqual(["section"]);
  });

  it("retains id as the default order for ordinary entity tables", async () => {
    await routedQuery("products", { limit: 1 });

    expect(orders).toEqual(["id"]);
  });

  it("honours bounded offsets for large paged reads", async () => {
    await routedQuery("stock_transfer_items", { offset: 2000, limit: 1000 });
    expect(ranges).toEqual([[2000, 2999]]);
  });
});
