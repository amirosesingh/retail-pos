import { beforeEach, describe, expect, it, vi } from "vitest";

const { orders, ranges, nullFilters, auth } = vi.hoisted(() => ({
  orders: [] as string[],
  ranges: [] as [number, number][],
  nullFilters: [] as string[],
  auth: { present: true, restored: true },
}));

vi.mock("@/integrations/supabase/external-client", () => {
  const client = {
    from: () => ({
      select: () => {
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
            return Promise.resolve({ data: [], error: null, count: 0 });
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

describe("routed query ordering", () => {
  beforeEach(() => {
    orders.splice(0);
    ranges.splice(0);
    nullFilters.splice(0);
    auth.present = true;
    auth.restored = true;
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

  it("uses PostgREST is.null semantics for active-row filters", async () => {
    await routedQuery("products", { match: { deleted_at: null }, limit: 1 });
    expect(nullFilters).toEqual(["deleted_at"]);
  });

  it("uses the complete primary key when a cloud table has no id column", async () => {
    await routedQuery("settings_scoped", { limit: 5000 });

    expect(orders).toEqual(["scope", "scope_id", "key"]);
    expect(ranges).toEqual([[0, 4999]]);
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
