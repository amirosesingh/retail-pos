import { describe, expect, it, vi } from "vitest";

describe("branch-scoped synchronization reconciliation", () => {
  it("keeps COUNT_BIG values exact and applies branch/history filters", async () => {
    const queries: string[] = [];
    const request = {
      input: vi.fn(() => request),
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        return { recordset: [{ table_name: "sales", row_count: "99999999999999999" }] };
      }),
    };
    const manager = { pool: { request: () => request } };
    const registry = { tables: [{
      cloudTable: "sales", sqlServerTable: "sales", retentionClass: "historical",
      columns: [
        { cloudColumn: "id", sqlServerColumn: "id", primaryKey: true },
        { cloudColumn: "store_id", sqlServerColumn: "store_id" },
        { cloudColumn: "created_at", sqlServerColumn: "created_at" },
      ],
    }] };
    const { localTableCounts } = await import("../../../electron/sync/reconciliation.cjs");
    const counts = await localTableCounts(manager, registry, "branch-1", 90);
    expect(counts.sales).toBe("99999999999999999");
    expect(queries[0]).toContain("source.[store_id]=@branch");
    expect(queries[0]).toContain("source.[created_at]>=@cutoff");
  });

  it("counts only settings visible to the current branch, cluster, and terminal", async () => {
    const queries: string[] = [];
    const inputs: Record<string, unknown> = {};
    const request = {
      input: vi.fn((name: string, value: unknown) => {
        inputs[name] = value;
        return request;
      }),
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        return { recordset: [{ table_name: "settings_overrides", row_count: "4" }] };
      }),
    };
    const manager = { pool: { request: () => request } };
    const registry = {
      tables: [
        {
          cloudTable: "settings_overrides",
          sqlServerTable: "settings_overrides",
          columns: [
            { cloudColumn: "scope", sqlServerColumn: "scope" },
            { cloudColumn: "scope_id", sqlServerColumn: "scope_id" },
          ],
        },
      ],
    };
    const { localTableCounts } = await import("../../../electron/sync/reconciliation.cjs");
    await localTableCounts(manager, registry, "branch-1", 90, "terminal-1");
    expect(inputs).toMatchObject({ branch: "branch-1", terminal: "terminal-1" });
    expect(queries[0]).toContain("lower(source.[scope])='global'");
    expect(queries[0]).toContain("source.[scope_id]=@branch");
    expect(queries[0]).toContain("source.[scope_id]=@terminal");
    expect(queries[0]).toContain("dbo.[stores] scoped_store");
  });

  it("counts only governance rules visible to the branch or its cluster", async () => {
    const queries: string[] = [];
    const request = {
      input: vi.fn(() => request),
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        return { recordset: [{ table_name: "authorization_actions", row_count: "3" }] };
      }),
    };
    const manager = { pool: { request: () => request } };
    const registry = {
      tables: [
        {
          cloudTable: "authorization_actions",
          sqlServerTable: "authorization_actions",
          columns: [
            { cloudColumn: "scope_type", sqlServerColumn: "scope_type" },
            { cloudColumn: "scope_id", sqlServerColumn: "scope_id" },
          ],
        },
      ],
    };
    const { localTableCounts } = await import("../../../electron/sync/reconciliation.cjs");
    await localTableCounts(manager, registry, "branch-1", 90, "terminal-1");
    expect(queries[0]).toContain("lower(source.[scope_type])='global'");
    expect(queries[0]).toContain("source.[scope_id]=@branch");
    expect(queries[0]).not.toContain("source.[scope_id]=@terminal");
  });

  it("counts all registry tables in one SQL Server round trip", async () => {
    const request = {
      input: vi.fn(() => request),
      query: vi.fn(async () => ({
        recordset: [
          { table_name: "stores", row_count: "2" },
          { table_name: "products", row_count: "1300" },
        ],
      })),
    };
    const manager = { pool: { request: () => request } };
    const registry = {
      tables: [
        { cloudTable: "stores", sqlServerTable: "stores", columns: [] },
        { cloudTable: "products", sqlServerTable: "products", columns: [] },
      ],
    };
    const { localTableCounts } = await import("../../../electron/sync/reconciliation.cjs");
    await expect(localTableCounts(manager, registry, "branch-1", 90, "terminal-1")).resolves.toEqual({
      stores: "2",
      products: "1300",
    });
    expect(request.query).toHaveBeenCalledTimes(1);
    expect(request.query.mock.calls[0][0]).toContain(" UNION ALL ");
  });

  it("builds an order-independent data signature with normalized timestamps", async () => {
    const { signatureRows } = await import("../../../electron/sync/verifier.cjs");
    const table = { columns: [
      { cloudColumn: "id", sqlServerColumn: "id", cloudType: "uuid" },
      { cloudColumn: "amount", sqlServerColumn: "amount", cloudType: "numeric" },
      { cloudColumn: "created_at", sqlServerColumn: "created_at", cloudType: "timestamp with time zone" },
    ] };
    const first = [
      { id: "a", amount: "10.00", created_at: "2026-01-01T00:00:00+00:00" },
      { id: "b", amount: 5, created_at: new Date("2026-01-02T00:00:00Z") },
    ];
    const second = [first[1], first[0]];
    expect(signatureRows(table, first)).toBe(signatureRows(table, second));
  });

  it("treats SQL Server and Supabase UUID casing as the same value", async () => {
    const { signatureRows } = await import("../../../electron/sync/verifier.cjs");
    const table = {
      columns: [{ cloudColumn: "id", sqlServerColumn: "id", cloudType: "uuid" }],
    };
    expect(signatureRows(table, [{ id: "A57D50E1-B20F-44B4-A638-11A0786BF013" }])).toBe(
      signatureRows(table, [{ id: "a57d50e1-b20f-44b4-a638-11a0786bf013" }]),
    );
  });
});
