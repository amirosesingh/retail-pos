import { expect, it } from "vitest";
import { createRequire } from "node:module";
import { normalizeUuidFields } from "../uuid-fields";
import { rowToProduct, rowToSale, rowToStore } from "@/core/api/pos-db";
const require = createRequire(import.meta.url);
const codec = require("../../../electron/sync/row-codec.cjs");
const native = require("../../../electron/sync/uuid-fields.cjs");
const lower = "a611a328-2217-4d77-944a-5f6a637d123b";
const mixed = "A611a328-2217-4D77-944a-5F6a637D123B";
it.each([lower, lower.toUpperCase(), mixed])("normalizes SQL Server rows, saved count lines and stock keys consistently: %s", id => {
  const row = { id, product_id: id, store_id: id, name: id, barcode: id,
    lines: JSON.stringify([{ productId: id, sku: id }]),
    stock_by_store: JSON.stringify({ [mixed]: 2, [lower]: 3 }), userIds: [id] };
  const table = { sqlServerTable: "products", columns: [
    ...["id", "product_id"].map(name => ({ cloudColumn: name, sqlServerColumn: name, cloudType: "uuid" })),
    ...["stock_by_store", "lines"].map(name => ({ cloudColumn: name, sqlServerColumn: name, cloudType: "jsonb" }))
  ] };
  const output = codec.toRendererRow(table, row);
  expect(output).toMatchObject({ id: lower, product_id: lower, store_id: lower, name: id, barcode: id,
    lines: [{ productId: lower, sku: id }], stock_by_store: { [lower]: 5 }, userIds: [lower] });
  expect(codec.toCloudRow(table, row)).toEqual(output);
  expect(native.normalizeUuidFields(row)).toEqual(normalizeUuidFields(row));
  expect(JSON.parse(codec.toLocalValue(table.columns[2], { [mixed]: 2, [lower]: 3 }))).toEqual({ [lower]: 5 });
  expect(row.id).toBe(id);
});
it("normalizes direct snapshots and nested receipt references before JavaScript joins", () => {
  expect(rowToProduct({ id: mixed, name: "Shirt", owner_store_id: mixed, stock_by_store: { [mixed]: 1 } })).toMatchObject({ id: lower, ownerStoreId: lower, stockByStore: { [lower]: 1 } });
  expect(rowToStore({ id: mixed, name: "Branch", parent_id: mixed })).toMatchObject({ id: lower, parentId: lower });
  expect(rowToSale({ id: mixed, shift_id: mixed, store_id: mixed, member_id: mixed, sale_items: [{ id: mixed, product_id: mixed }] })).toMatchObject({ id: lower, shiftId: lower, storeId: lower, memberId: lower, lines: [{ saleItemId: lower, productId: lower }] });
});
it("preserves malformed JSON, non-UUID identifiers, credentials and case-sensitive item codes", () => {
  const row = { id: "LOCAL-P1", store_id: "Branch-A", token: mixed, password: mixed, sku: mixed, barcode: mixed, lines: "broken", created_at: new Date("2026-10-14T00:00:00Z") };
  expect(normalizeUuidFields(row)).toEqual(row);
  expect(native.normalizeUuidFields(row)).toEqual(row);
});
