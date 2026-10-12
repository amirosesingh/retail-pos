import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { OperationsRepository } = require("../../../electron/db/repositories/operations.cjs");
const { AggregateRepository } = require("../../../electron/db/repositories/aggregates.cjs");
const { aggregatePolicy } = require("../../../electron/db/write-policy.cjs");
describe("complete Electron notification commit", () => {
  it("carries the verified operator through the aggregate and commits one JSON array", async () => {
    const commit = vi.fn(); const rollback = vi.fn(); const parameters: Record<string, unknown>[] = [];
    class Transaction { async begin() {} commit = commit; rollback = rollback; }
    class Request {
      values: Record<string, unknown> = {};
      constructor() { parameters.push(this.values); }
      input(key: string, value: unknown, typedValue?: unknown) { this.values[key] = typedValue ?? value; return this; }
      async query(sql: string) {
        if (sql.includes("FROM dbo.app_users")) return { recordset: [{ id: "verified-a", user_id: "operator-a" }] };
        if (sql.includes("FROM dbo.activity_events WITH")) return { recordset: [{ store_id: "branch-a", event_type: "approval_requested", meta: JSON.stringify({ audience_user_ids: ["verified-a"] }) }] };
        if (sql.includes("SELECT CASE WHEN EXISTS")) return { recordset: [{ allowed: 1 }] };
        return { recordset: [], rowsAffected: [1] };
      }
    }
    const sql = { Request, Transaction, UniqueIdentifier: "uuid", ISOLATION_LEVEL: { SERIALIZABLE: 4 } };
    const connection = { sql: () => sql, pool: {} };
    const registry = { tables: [{ sqlServerTable: "activity_events", cloudTable: "activity_events", scope: "branch", direction: "bidirectional", updateRule: "append_only", columns: [
      { sqlServerColumn: "id", primaryKey: true }, { sqlServerColumn: "store_id" },
      { sqlServerColumn: "cleared_by", cloudType: "text[]" },
    ] }] };
    const operations = [{ kind: "update", table: "activity_events", match: { id: "event-a" }, values: { cleared_by: JSON.stringify(["forged-identity"]) }, requireMatch: true }];
    const trusted = aggregatePolicy("general", operations, { level: "staff", subject: "operator-a", source: "pos", permissions: {} });
    const repository = new AggregateRepository(connection, new OperationsRepository(connection, registry));
    await expect(repository.commit("general", { operationId: "11111111-1111-4111-8111-111111111111", operations, branchId: "branch-a", ...trusted })).resolves.toMatchObject({ ok: true, affected: 1 });
    expect(JSON.parse(String(parameters.find(values => "v0" in values)?.v0))).toEqual(["verified-a"]);
    expect(commit).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
  });
});
