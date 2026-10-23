import { expect, it, vi } from "vitest";
it("rejects a mismatched cluster before writing a Windows sale and rolls back", async () => {
  const rollback = vi.fn();
  const commit = vi.fn();
  class Transaction { begin = vi.fn(); rollback = rollback; commit = commit; }
  class Request {
    input() { return this; }
    query(sql: string) {
      return { recordset: sql.includes("FROM dbo.promotions") ? [{ title: "CLUB-10", is_active: true, code_scope: "bill", code_cluster_id: "sports", group_id: "other" }] : [] };
    }
  }
  const operations = { validate: (value: unknown) => value, pool: () => ({}), applyOperation: vi.fn(), tables: new Map() };
  const { AggregateRepository } = await import("../../../electron/db/repositories/aggregates.cjs");
  const repository = new AggregateRepository({ sql: () => ({ Transaction, Request, UniqueIdentifier: "uuid", ISOLATION_LEVEL: { SERIALIZABLE: 4 } }) }, operations);
  await expect(repository.commit("sale", { operationId: "11111111-1111-4111-8111-111111111111", branchId: "B", operations: [{ kind: "insert", table: "sales", rows: [{ id: "22222222-2222-4222-8222-222222222222", coupon_promo_id: "33333333-3333-4333-8333-333333333333", coupon_code: "CLUB-10", coupon_scope: "bill" }] }] })).rejects.toThrow();
  expect(rollback).toHaveBeenCalledOnce();
  expect(commit).not.toHaveBeenCalled();
  expect(operations.applyOperation).not.toHaveBeenCalled();
});
