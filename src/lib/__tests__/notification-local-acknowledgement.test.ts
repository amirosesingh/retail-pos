import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { OperationsRepository } = require("../../../electron/db/repositories/operations.cjs");
const repository = new OperationsRepository(
  {},
  {
    tables: [
      {
        sqlServerTable: "activity_events",
        cloudTable: "activity_events",
        updateRule: "append_only",
        columns: ["id", "cleared_by", "title"].map((sqlServerColumn) => ({ sqlServerColumn })),
      },
    ],
  },
);
const clear = {
  kind: "update",
  table: "activity_events",
  match: { id: "event-a" },
  values: { cleared_by: JSON.stringify(["admin-a"]) },
  requireMatch: true,
};
describe("local notification acknowledgement", () => {
  it("allows a required-match acknowledgement without editing the event", () => {
    expect(repository.validate([clear])).toEqual([clear]);
  });
  it("keeps event content and deletion immutable", () => {
    expect(() => repository.validate([{ ...clear, values: { title: "rewritten" } }])).toThrow(
      "append-only",
    );
    expect(() => repository.validate([{ ...clear, kind: "delete" }])).toThrow("append-only");
    expect(() => repository.validate([{ ...clear, requireMatch: false }])).toThrow("append-only");
  });
  it("refuses malformed or empty acknowledgements", () => {
    for (const cleared_by of ["broken", "[]", "[null]", '[""]']) {
      expect(() => repository.validate([{ ...clear, values: { cleared_by } }])).toThrow(
        "acknowledgement",
      );
    }
  });
  it("refuses a directed notification belonging to another operator", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ recordset: [{ id: "verified-a", user_id: "operator-a" }] })
      .mockResolvedValueOnce({
        recordset: [
          {
            store_id: "branch-a",
            event_type: "approval_requested",
            meta: JSON.stringify({ audience_user_ids: ["operator-b"] }),
          },
        ],
      });
    class Request {
      input() {
        return this;
      }
      query(sql: string) {
        return query(sql);
      }
    }
    const guarded = new OperationsRepository({ sql: () => ({ Request }) }, { tables: [] });
    await expect(
      guarded.applyOperation({}, clear, {
        branchId: "branch-a",
        activityOperator: { subject: "operator-a", role: "admin", mayViewGeneralActivity: true },
      }),
    ).rejects.toThrow("Notification access denied");
    expect(query).toHaveBeenCalledTimes(2);
  });
  it("requires a main-process verified operator before any database write", async () => {
    const guarded = new OperationsRepository({}, { tables: [] });
    await expect(guarded.applyOperation({}, clear, { branchId: "branch-a" })).rejects.toThrow(
      "verified notification operator",
    );
  });
  it("preserves other recipients and encodes the trusted acknowledgement once for SQL Server text arrays", async () => {
    const parameters: Record<string, unknown>[] = [];
    class Request {
      values: Record<string, unknown> = {};
      constructor() {
        parameters.push(this.values);
      }
      input(key: string, value: unknown) {
        this.values[key] = value;
        return this;
      }
      async query(sql: string) {
        if (sql.includes("FROM dbo.app_users"))
          return { recordset: [{ id: "verified-a", user_id: "operator-a" }] };
        if (sql.includes("FROM dbo.activity_events WITH"))
          return {
            recordset: [
              {
                store_id: "branch-a",
                event_type: "approval_requested",
                meta: JSON.stringify({ audience_user_ids: ["verified-a", "verified-b"] }),
                cleared_by: JSON.stringify(["verified-b"]),
              },
            ],
          };
        return { rowsAffected: [1] };
      }
    }
    const registry = {
      tables: [
        {
          sqlServerTable: "activity_events",
          cloudTable: "activity_events",
          columns: [
            { sqlServerColumn: "id", primaryKey: true },
            { sqlServerColumn: "store_id" },
            { sqlServerColumn: "cleared_by", cloudType: "text[]" },
          ],
        },
      ],
    };
    const guarded = new OperationsRepository({ sql: () => ({ Request }) }, registry);
    await expect(
      guarded.applyOperation({}, clear, {
        branchId: "branch-a",
        activityOperator: { subject: "operator-a", role: "staff", mayViewGeneralActivity: false },
      }),
    ).resolves.toBe(1);
    const written = parameters.find((values) => "v0" in values)?.v0;
    expect(JSON.parse(String(written))).toEqual(["verified-b", "verified-a"]);
    expect(JSON.parse(String(written))).not.toBeTypeOf("string");
  });
  it("permits signed-in staff to acknowledge visible notifications without granting general write access", () => {
    const session = require("../../../electron/admin-session.cjs");
    const privilege = require("../../../electron/ipc-privilege.cjs");
    session.grant("staff", "operator-a", {}, "pos", "branch-a");
    try {
      expect(
        privilege.allowed("business:commit-aggregate", [{ kind: "general", operations: [clear] }]),
      ).toBe(true);
      expect(
        privilege.allowed("business:commit-aggregate", [
          { kind: "general", operations: [{ ...clear, values: { title: "rewritten" } }] },
        ]),
      ).toBe(false);
      session.clear();
      expect(
        privilege.allowed("business:commit-aggregate", [{ kind: "general", operations: [clear] }]),
      ).toBe(false);
    } finally {
      session.clear();
    }
  });
});
