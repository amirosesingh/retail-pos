import { describe, expect, it } from "vitest";

describe("authoritative cloud receipt corrections", () => {
  it.each(["sales", "sale_items"])(
    "merges corrected %s fields only from a newer authoritative cloud row",
    async (name) => {
      const queries: string[] = [];
      class Request {
        input() {
          return this;
        }
        async query(sql: string) {
          queries.push(sql);
          return { rowsAffected: [1] };
        }
      }
      const { CloudClient } = await import("../../../electron/sync/cloud-client.cjs");
      const client = new CloudClient({
        configStore: { get: () => "" },
        terminalStore: { read: () => ({}) },
        connectionManager: { sql: () => ({ Request }) },
      });
      const row =
        name === "sales"
          ? {
              id: "S1",
              bill_number: "B-1042",
              total_amount: 30,
              is_refunded: false,
              row_version: 3,
              corrected_at: "2026-10-10T14:00:00Z",
            }
          : {
              id: "I1",
              sale_id: "S1",
              quantity: 2,
              refunded_qty: 0,
              row_version: 3,
              corrected_at: "2026-10-10T14:00:00Z",
            };
      const table = {
        cloudTable: name,
        sqlServerTable: name,
        conflictRule: "immutable_reversal",
        columns: Object.keys(row).map((key) => ({
          cloudColumn: key,
          sqlServerColumn: key,
          primaryKey: key === "id",
        })),
      };
      await client.applyLocalBatch({}, table, { rows: [{ row_data: row }], tombstones: [] });
      const merge = queries[0];
      expect(merge).toContain(
        "source.[corrected_at] IS NOT NULL AND source.[row_version]>target.[row_version]",
      );
      expect(merge).toContain(
        name === "sales"
          ? "COALESCE(target.[is_refunded],0)=0"
          : "COALESCE(target.[refunded_qty],0)=0",
      );
      expect(merge).toContain(
        name === "sales" ? "target.[total_amount]=CASE" : "target.[quantity]=CASE",
      );
      expect(merge).toContain("CHANGE_TRACKING_CONTEXT (0x434C4F5544)");
    },
  );
  it("keeps ordinary cloud sale rows immutable", async () => {
    const queries: string[] = [];
    class Request {
      input() {
        return this;
      }
      async query(sql: string) {
        queries.push(sql);
        return { rowsAffected: [1] };
      }
    }
    const { CloudClient } = await import("../../../electron/sync/cloud-client.cjs");
    const client = new CloudClient({
      configStore: { get: () => "" },
      terminalStore: { read: () => ({}) },
      connectionManager: { sql: () => ({ Request }) },
    });
    const row = {
      id: "S1",
      total_amount: 30,
      is_refunded: false,
      row_version: 3,
      corrected_at: null,
    };
    await client.applyLocalBatch(
      {},
      {
        cloudTable: "sales",
        sqlServerTable: "sales",
        conflictRule: "immutable_reversal",
        columns: Object.keys(row).map((key) => ({
          cloudColumn: key,
          sqlServerColumn: key,
          primaryKey: key === "id",
        })),
      },
      { rows: [{ row_data: row }], tombstones: [] },
    );
    expect(queries[0]).not.toContain("target.[total_amount]=");
  });
});
