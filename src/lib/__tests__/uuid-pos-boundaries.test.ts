import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { Product } from "@/core/types/pos-types";
import { normalizeUuidFields } from "../uuid-fields";
import { stockCountChanges } from "../stock-count-plan";
const require = createRequire(import.meta.url);
const guard = require("../../../electron/ipc-guard.cjs");
const { toRendererRow, toCloudRow } = require("../../../electron/sync/row-codec.cjs");
const { OperationsRepository } = require("../../../electron/db/repositories/operations.cjs");
const { normalizeUuidFields: nativeNormalize } = require("../../../electron/sync/uuid-fields.cjs");
const productId = "A1234567-1234-7234-8234-123456789ABC";
const branchId = "B1234567-1234-4234-8234-123456789ABC";
const mixed = productId.slice(0, 12).toLowerCase() + productId.slice(12);

describe("POS UUID boundaries", () => {
  it.each([productId, productId.toLowerCase(), mixed])("accepts UUID presentation %s in IPC and links stock counts", id => {
    expect(guard.uuid(id)).toBe(productId.toLowerCase());
    const product = { id: productId, name: "Test product", sku: "SKU", barcode: "123", category: "", price: 1, cost: 1, reorderLevel: 0, taxRate: 0, stockByStore: { [branchId]: 4 } } satisfies Product;
    const changes = stockCountChanges([product], [{ productId: id, counted: 7 }], branchId);
    expect(changes).toEqual([{ product, before: 4, counted: 7, delta: 3 }]);
  });
  it("does not post duplicate movements for case aliases of one counted product", () => {
    const product = { id: productId, name: "Test product", sku: "SKU", barcode: "123", category: "", price: 1, cost: 1, reorderLevel: 0, taxRate: 0, stockByStore: { [branchId]: 4 } } satisfies Product;
    expect(stockCountChanges([product], [{ productId, counted: 7 }, { productId: mixed, counted: 7 }], branchId)).toHaveLength(1);
  });
  it("rejects invalid counts, missing products, and conflicting UUID aliases before posting", () => {
    const product = { id: productId, name: "Test", sku: "SKU", barcode: "123", category: "", price: 1, cost: 1, reorderLevel: 0, taxRate: 0, stockByStore: { [branchId]: 4 } } satisfies Product;
    for (const counted of [-1, 1.5, NaN, Infinity])
      expect(() => stockCountChanges([product], [{ productId, counted }], branchId)).toThrow("non-negative whole");
    expect(() => stockCountChanges([], [{ productId, counted: 7 }], branchId)).toThrow("missing from inventory");
    expect(() => stockCountChanges([product], [{ productId, counted: 7 }, { productId: mixed, counted: 8 }], branchId)).toThrow("conflicting stock counts");
  });
  it("matches booking UUID aliases without authorizing a different branch", () => {
    const { aggregatePolicy } = require("../../../electron/db/write-policy.cjs");
    const identity = { source: "pos", permissions: { can_create_booking: true } };
    const operations = (storeId: string) => [
      { table: "held_orders", kind: "update", match: { store_id: branchId }, values: { status: "completed", note: "booking:" + productId } },
      { table: "bookings", kind: "upsert", rows: [{ id: mixed, store_id: storeId }] },
    ];
    expect(() => aggregatePolicy("booking", operations(branchId.toLowerCase()), identity)).not.toThrow();
    expect(() => aggregatePolicy("booking", operations(productId), identity)).toThrow("Permission");
  });
  it("preserves unchanged state references while retaining serialized JSON normalization", () => {
    const value = { id: productId.toLowerCase(), lines: [{ productId: productId.toLowerCase() }], stockByStore: { [branchId.toLowerCase()]: 4 }, linkedIds: [productId.toLowerCase()] };
    expect(normalizeUuidFields(value)).toBe(value);
    expect(normalizeUuidFields({ lines: JSON.stringify([{ productId }]) }).lines)
      .toBe(JSON.stringify([{ productId: productId.toLowerCase() }]));
  });
  it("normalizes JSON children, identifier lists and stock buckets without changing opaque fields", () => {
    const value = { id: productId, linkedIds: [productId, "LC1"], code: productId, token: productId, name: productId,
      lines: [{ productId: mixed }], stockByStore: { [branchId]: 4, [branchId.toLowerCase()]: -1 } };
    const expected = { ...value, id: productId.toLowerCase(), linkedIds: [productId.toLowerCase(), "LC1"],
      lines: [{ productId: productId.toLowerCase() }], stockByStore: { [branchId.toLowerCase()]: 3 } };
    expect(normalizeUuidFields(value)).toEqual(expected);
    expect(nativeNormalize(value)).toEqual(expected);
    expect(guard.writeOps([{ kind: "upsert", table: "stock_adjustments", rows: [{ id: productId, product_id: mixed, store_id: branchId }] }])[0].rows[0])
      .toEqual({ id: productId.toLowerCase(), product_id: productId.toLowerCase(), store_id: branchId.toLowerCase() });
  });
  it("canonicalizes snapshots and cloud uploads, including saved count lines", () => {
    const table = { sqlServerTable: "stock_count_drafts", columns: [
      { sqlServerColumn: "id", cloudColumn: "id", cloudType: "uuid" },
      { sqlServerColumn: "store_id", cloudColumn: "store_id", cloudType: "text" },
      { sqlServerColumn: "lines", cloudColumn: "lines", cloudType: "jsonb" },
    ] };
    const row = { id: productId, store_id: branchId, lines: JSON.stringify([{ productId: mixed, barcode: productId }]) };
    const expected = { id: productId.toLowerCase(), store_id: branchId.toLowerCase(), lines: [{ productId: productId.toLowerCase(), barcode: productId }] };
    expect(toRendererRow(table, row)).toEqual(expected);
    expect(toCloudRow(table, row)).toEqual(expected);
  });
  it("normalizes branch UUID casing but rejects different branches", () => {
    const table = { sqlServerTable: "stock_adjustments", columns: [{ sqlServerColumn: "store_id" }] };
    const repository = new OperationsRepository({}, { tables: [table] });
    const ops = [{ kind: "insert", table: "stock_adjustments", rows: [{ store_id: branchId }] }];
    expect(() => repository.assertWriteScope(ops, { branchId })).not.toThrow();
    expect(() => repository.assertWriteScope(ops, { branchId: branchId.toLowerCase() })).not.toThrow();
    expect(() => repository.assertWriteScope(ops, { branchId: productId })).toThrow("terminal's branch");
  });
  it("uses lowercase UUIDs for branch directories, scopes and stock buckets", () => {
    for (const normalize of [normalizeUuidFields, nativeNormalize]) {
      expect(normalize({ stores: [{ id: branchId, parentId: branchId }], scope: "branch", scope_id: branchId }))
        .toEqual({ stores: [{ id: branchId.toLowerCase(), parentId: branchId.toLowerCase() }], scope: "branch", scope_id: branchId.toLowerCase() });
    }
    const table = { cloudTable: "stores", sqlServerTable: "stores", columns: [{ cloudColumn: "id", sqlServerColumn: "id", cloudType: "text" }] };
    expect(toRendererRow(table, { id: branchId }).id).toBe(branchId.toLowerCase());
    expect(toCloudRow(table, { id: branchId }).id).toBe(branchId.toLowerCase());
  });
  it("rejects malformed UUIDs and preserves case-sensitive location codes", () => {
    expect(() => guard.uuid("ABC-not-a-UUID")).toThrow("UUID");
    expect(nativeNormalize({ store_id: "LC1", token: productId })).toEqual({ store_id: "LC1", token: productId });
  });
});
