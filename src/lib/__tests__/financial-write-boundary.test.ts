import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { aggregatePolicy } = require("../../../electron/db/write-policy.cjs");
const { OperationsRepository } = require("../../../electron/db/repositories/operations.cjs");
const identity = (permissions = {}) => ({ source: "pos", level: "staff", permissions: { can_process_sale: true, ...permissions } });
const sale = { id: "new-sale", store_id: "branch-a", bill_number: "NEW-1", total_amount: 12 };
const create = { kind: "upsert", table: "sales", rows: [sale] };
const exchange = { kind: "update", table: "sales", values: { exchanged_to_bill_number: "NEW-1" },
  match: { id: "old-sale", bill_number: "OLD-1", exchanged_to_bill_number: null, is_refunded: false }, requireMatch: true };

describe("native posted financial mutation boundary", () => {
  it.each(["sale", "payment", "product", "booking", "general"])("does not grant posted-sale edits through %s", kind => {
    for (const values of [{ is_refunded: true }, { total_amount: 0 }, { discount_amount: 10 }, { payment_type: "cash" }]) {
      expect(() => aggregatePolicy(kind, [{ kind: "update", table: "sales", match: { id: "existing" }, values }], identity())).toThrow("protected refund or correction");
    }
  });
  it.each(["sales", "sale_items", "payment_transactions"])("rejects direct update/delete of %s before SQL access", async table => {
    const repository = new OperationsRepository({}, { tables: [] });
    for (const kind of ["update", "delete"]) await expect(repository.applyOperation({}, { kind, table, values: { amount: 0 }, match: { id: "existing" } }, { enforcePermissions: true })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
  it("preserves ordinary sale inserts and immutable upsert retries without inventory permissions", () => {
    const operations = [create, { kind: "upsert", table: "sale_items", rows: [{ id: "item", sale_id: sale.id }] },
      { kind: "upsert", table: "payment_transactions", rows: [{ id: "payment", sale_id: sale.id, amount: 12 }] },
      { kind: "update", table: "products", match: { id: "product" }, values: { stock_quantity: 2, stock_by_store: { "branch-a": 2 } } }];
    expect(aggregatePolicy("sale", operations, identity()).enforcePermissions).toBe(true);
  });
  it("checks the alternative values insertion shape for sale permission", () => {
    expect(() => aggregatePolicy("product", [{ kind: "upsert", table: "sales", values: sale }], identity({ can_process_sale: false }))).toThrow("Sale permission");
  });
  it("allows only an authorized guarded link to the matching new exchange bill", () => {
    const newExchange = { ...create, rows: [{ ...sale, is_exchange: true, original_bill_number: "OLD-1" }] };
    const permitted = identity({ can_process_exchange: true });
    expect(aggregatePolicy("sale", [newExchange, exchange], permitted).financialExchangeLinks.size).toBe(1);
    expect(() => aggregatePolicy("sale", [newExchange, exchange], identity())).toThrow("protected refund or correction");
    expect(() => aggregatePolicy("sale", [create, exchange], permitted)).toThrow("protected refund or correction");
    expect(() => aggregatePolicy("sale", [newExchange, { ...exchange, values: { ...exchange.values, total_amount: 0 } }], permitted)).toThrow("protected refund or correction");
    expect(() => aggregatePolicy("sale", [newExchange, { ...exchange, match: { id: "old-sale" } }], permitted)).toThrow("protected refund or correction");
  });
  it("preserves booking collection without sale permission", () => {
    expect(aggregatePolicy("payment", [
      { kind: "insert", table: "booking_payments", rows: [{ id: "collection", booking_id: "booking", amount: 12 }] },
      { kind: "update", table: "bookings", match: { id: "booking" }, values: { paid: 12, status: "collected" } },
    ], identity({ can_process_sale: false, can_collect_booking: true })).enforcePermissions).toBe(true);
  });
  it.each([false, true])("checks the persisted replacement before an exchange link (valid=%s)", async valid => {
    let writes = 0;
    class Request {
      input() { return this; }
      async query(sql: string) {
        if (sql.startsWith("SELECT id FROM dbo.sales WITH")) return { recordset: valid ? [{ id: sale.id }] : [] };
        writes++;
        return { rowsAffected: [1] };
      }
    }
    const repository = new OperationsRepository({ sql: () => ({ Request }) }, { tables: [{
      cloudTable: "sales", sqlServerTable: "sales", columns: [
        { sqlServerColumn: "id", primaryKey: true }, { sqlServerColumn: "exchanged_to_bill_number" },
      ],
    }] });
    const newExchange = { ...create, rows: [{ ...sale, is_exchange: true, original_bill_number: "OLD-1" }] };
    const scope = { ...aggregatePolicy("sale", [newExchange, exchange], identity({ can_process_exchange: true })), branchId: "branch-a" };
    const result = repository.applyOperation({}, exchange, scope);
    if (valid) { await expect(result).resolves.toBe(1); expect(writes).toBe(1); }
    else { await expect(result).rejects.toThrow("matching replacement exchange bill"); expect(writes).toBe(0); }
  });
});
