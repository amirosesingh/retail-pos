import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("SQL Server user role synchronization", () => {
  it("merges a replay by the composite unique assignment instead of generated id", () => {
    const source = readFileSync("electron/sync/cloud-client.cjs", "utf8");
    expect(source).toContain('table.cloudTable === "user_roles" ? ["user_id", "role"] : primary');
    expect(source).toContain("const on = mergeKey.map");
    expect(source).toContain("!mergeKey.includes(name)");
  });

  it("generates a composite-key MERGE that canonicalizes a legacy local id", async () => {
    let query = "";
    class Request {
      input() {
        return this;
      }
      async query(sql: string) {
        query = sql;
        return { rowsAffected: [1] };
      }
    }
    const { CloudClient } = await import("../../../electron/sync/cloud-client.cjs");
    const client = new CloudClient({
      configStore: { get: () => "" },
      terminalStore: { read: () => ({}) },
      connectionManager: { sql: () => ({ Request }) },
    });
    const table = {
      cloudTable: "user_roles",
      sqlServerTable: "user_roles",
      conflictRule: "highest_version",
      columns: [
        { cloudColumn: "id", sqlServerColumn: "id", primaryKey: true },
        { cloudColumn: "user_id", sqlServerColumn: "user_id" },
        { cloudColumn: "role", sqlServerColumn: "role" },
        { cloudColumn: "created_at", sqlServerColumn: "created_at" },
      ],
    };
    await client.applyLocalBatch({}, table, {
      rows: [
        {
          row_data: {
            id: "cloud-id",
            user_id: "f46085c5-e9bb-4c21-a373-94d220dc750c",
            role: "staff",
            created_at: "2026-09-28T00:00:00Z",
          },
        },
      ],
      tombstones: [],
    });
    expect(query).toContain(
      "ON target.[user_id]=source.[user_id] AND target.[role]=source.[role]",
    );
    expect(query).toContain("target.[id]=source.[id]");
  });
});
