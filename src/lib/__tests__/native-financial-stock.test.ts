import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { aggregatePolicy } = require("../../../electron/db/write-policy.cjs");
const { assertFinancialStockUpdate } = require("../../../electron/db/financial-stock-policy.cjs");
const { OperationsRepository } = require("../../../electron/db/repositories/operations.cjs");
const registry = require("../../../database/sqlserver/schema-registry.json");
const identity = { source: "pos", level: "staff", permissions: { can_process_sale: true } };
const sale = { kind: "upsert", table: "sales", rows: [{ id: "sale", store_id: "branch-b" }] };
const items = { kind: "upsert", table: "sale_items", rows: [{ id: "line", sale_id: "sale", product_id: "product", quantity: 2 }] };
const update = { kind: "update", table: "products", match: { id: "product" }, values: { stock_quantity: 8, stock_by_store: { "branch-a": 4, "branch-b": 4 } } };
const current = { id: "product", owner_store_id: "branch-a", stock_quantity: 10, stock_by_store: { "branch-a": 4, "branch-b": 6 } };
const scope = () => ({ ...aggregatePolicy("sale", [sale, items, update], identity), permissions: identity.permissions, branchId: "branch-b" });
describe("native cashier stock-only sale boundary", () => {
  it("allows only this bill's quantity delta at the verified branch", () => {
    expect(assertFinancialStockUpdate(update, scope(), current)).toBe(true);
    for (const values of [
      { ...update.values, name: "Changed" },
      { ...update.values, cost_price: 0 },
      { ...update.values, catalogue_store_ids: ["foreign"] },
      { ...update.values, stock_by_store: { "branch-a": 3, "branch-b": 5 } },
      { ...update.values, stock_quantity: 9 },
    ]) expect(() => assertFinancialStockUpdate({ ...update, values }, scope(), current)).toThrow("only its branch's stock");
    expect(() => aggregatePolicy("sale", [sale, items, { ...update, match: { id: "unrelated" } }], identity)).toThrow();
    expect(() => aggregatePolicy("sale", [sale, items, update, update], identity)).toThrow();
    expect(() => aggregatePolicy("sale", [sale, { ...items, rows: [...items.rows, ...items.rows] }, update], identity)).toThrow();
  });
  it("preserves signed exchange credit quantities without reversing stock twice", () => {
    const returnedItems = { ...items, rows: [{ ...items.rows[0], quantity: -2, is_return: true }] };
    const returnedUpdate = { ...update, values: { stock_quantity: 12, stock_by_store: { "branch-a": 4, "branch-b": 8 } } };
    const returnedScope = { ...scope(), ...aggregatePolicy("sale", [sale, returnedItems, returnedUpdate], identity) };
    expect(assertFinancialStockUpdate(returnedUpdate, returnedScope, current)).toBe(true);
  });
  it("sums legacy UUID aliases but refuses ambiguous aliases in newly submitted stock", () => {
    const uuid = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const legacy = { ...current, stock_quantity: 9, stock_by_store: { [uuid]: 2, [uuid.toUpperCase()]: 3, "branch-a": 4 } };
    const canonicalUpdate = { ...update, values: { stock_quantity: 7, stock_by_store: { [uuid]: 3, "branch-a": 4 } } };
    expect(assertFinancialStockUpdate(canonicalUpdate, { ...scope(), branchId: uuid }, legacy)).toBe(true);
    expect(() => assertFinancialStockUpdate({ ...canonicalUpdate, values: { stock_quantity: 7, stock_by_store: { [uuid]: 1, [uuid.toUpperCase()]: 2, "branch-a": 4 } } }, { ...scope(), branchId: uuid }, legacy)).toThrow();
    const foreign = { ...current, stock_quantity: 11, stock_by_store: { [uuid]: 2, [uuid.toUpperCase()]: 3, "branch-b": 6 } };
    expect(() => assertFinancialStockUpdate({ ...update, values: { stock_quantity: 9, stock_by_store: { [uuid]: 4, "branch-b": 4 } } }, scope(), foreign)).toThrow();
  });
  it.each([true, false])("requires locked catalogue eligibility before applying stock (eligible=%s)", async eligible => {
    const queries: string[] = [];
    class Request {
      input() { return this; }
      async query(sql: string) {
        queries.push(sql);
        if (sql.startsWith("SELECT source.* FROM dbo.products")) return { recordset: eligible ? [current] : [] };
        if (sql.startsWith("SELECT * FROM dbo.products")) return { recordset: [current] };
        return { rowsAffected: [1] };
      }
    }
    const repository = new OperationsRepository({ sql: () => ({ Request }) }, registry);
    const result = repository.applyOperation({}, update, scope());
    if (eligible) {
      await expect(result).resolves.toBe(1);
      expect(queries.at(-1)).toContain("co.[group_id]");
    } else {
      await expect(result).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      expect(queries).toHaveLength(1);
    }
    expect(queries[0]).toContain("UPDLOCK,HOLDLOCK");
    expect(queries[0]).toContain("cv.[posted_at] IS NOT NULL");
  });
});
