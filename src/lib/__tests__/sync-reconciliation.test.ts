import { describe, expect, it, vi } from "vitest";

describe("branch-scoped synchronization reconciliation", () => {
  it("keeps COUNT_BIG values exact and applies branch/history filters", async () => {
    const queries: string[] = [];
    const request = {
      input: vi.fn(() => request),
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        return { recordset: [{ count: "99999999999999999" }] };
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
