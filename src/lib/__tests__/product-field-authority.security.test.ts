import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { OperationsRepository } = require("../../../electron/db/repositories/operations.cjs");
const { aggregatePolicy } = require("../../../electron/db/write-policy.cjs");
const columns = ["id", "selling_price", "cost_price", "ecom_price", "name", "stock_quantity", "stock_by_store"].map(name => ({ sqlServerColumn: name, cloudColumn: name, cloudType: name.includes("price") || name === "stock_quantity" ? "numeric" : name === "stock_by_store" ? "jsonb" : "text", primaryKey: name === "id" }));
const current = { id: "product", selling_price: 10, cost_price: 5, ecom_price: 12, name: "Product", stock_quantity: 8, stock_by_store: '{"branch-a":8}' };
const query = vi.fn();
class Request { input() { return this; } query(sql: string) { return query(sql); } }
const repository = new OperationsRepository({ sql: () => ({ Request }) }, { tables: [{ sqlServerTable: "products", cloudTable: "products", columns }] });
const scope = { enforcePermissions: true, permissions: { can_adjust_stock: true } };
beforeEach(() => query.mockReset().mockResolvedValue({ recordset: [current] }));
describe("product field permission at shared local SQL writer", () => {
  it.each([{ rows: [] }, { rows: [{ id: "product", selling_price: 10 }] }])("checks the UPDATE values even with decoy rows $rows", async ({ rows }) => {
    await expect(repository.assertProductPermissions({}, { table: "products", kind: "update", rows, match: { id: "product" }, values: { selling_price: 99 } }, scope)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
  it.each([false, 0, "0", "false"])("requires restore authority for false encoding %j", async value => {
    query.mockResolvedValue({ recordset: [{ ...current, is_archived: true }] });
    const op = { table: "products", kind: "update", match: { id: "product" }, values: { is_archived: value } };
    await expect(repository.assertProductPermissions({}, op, { ...scope, permissions: { can_archive_product: true } })).rejects.toThrow("permission");
    await expect(repository.assertProductPermissions({}, op, { ...scope, permissions: { can_restore_product: true } })).resolves.toBeUndefined();
    expect(op.values.is_archived).toBe(false);
  });
  it.each([["deleted_at", null], ["is_active", true]])("requires restore for lifecycle sibling %s", async (field, value) => {
    query.mockResolvedValue({ recordset: [{ ...current, [field]: field === "is_active" ? false : "2026-01-01" }] });
    await expect(repository.assertProductPermissions({}, { table: "products", kind: "update", match: { id: "product" }, values: { [field as string]: value } }, { ...scope, permissions: { can_archive_product: true } })).rejects.toThrow("permission");
  });
  it.each(["selling_price", "ecom_price", "cost_price", "name"])("rejects stock-authorized %s changes", async field => {
    await expect(repository.assertProductPermissions({}, { table: "products", kind: "update", match: { id: "product" }, values: { [field]: field === "name" ? "Changed" : 99 } }, scope)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
  it("keeps full-row stock updates with unchanged catalogue values working", async () => {
    await expect(repository.assertProductPermissions({}, { table: "products", kind: "upsert", rows: [{ ...current, selling_price: "10.00", stock_quantity: 9, stock_by_store: { "branch-a": 9 } }] }, scope)).resolves.toBeUndefined();
  });
  it("allows an authorized price editor", async () => {
    await expect(repository.assertProductPermissions({}, { table: "products", kind: "update", match: { id: "product" }, values: { selling_price: 15 } }, { ...scope, permissions: { can_edit_product_price: true } })).resolves.toBeUndefined();
  });
  it("preserves receiving cost updates without granting selling-price authority", async () => {
    const receiving = { ...scope, productWriteKind: "receiving", permissions: { can_receive_purchase_order: true } };
    await expect(repository.assertProductPermissions({}, { table: "products", kind: "update", match: { id: "product" }, values: { cost_price: 7 } }, receiving)).resolves.toBeUndefined();
    await expect(repository.assertProductPermissions({}, { table: "products", kind: "update", match: { id: "product" }, values: { selling_price: 7 } }, receiving)).rejects.toThrow("permission");
  });
  it("denies unrelated stock aggregate tables", () => {
    expect(() => aggregatePolicy("stock", [{ table: "sales", kind: "update", values: {}, match: { id: "sale" } }], { source: "pos", level: "cashier", permissions: { can_adjust_stock: true } })).toThrow("unrelated");
  });
  it("requires add-product permission for a new row", async () => {
    query.mockResolvedValue({ recordset: [] });
    const op = { table: "products", kind: "upsert", rows: [{ id: "new", selling_price: 99 }] };
    await expect(repository.assertProductPermissions({}, op, scope)).rejects.toThrow("permission");
    await expect(repository.assertProductPermissions({}, op, { ...scope, permissions: { can_add_new_product: true } })).resolves.toBeUndefined();
  });
  it.each([
    ["ecom_visible", false, "can_publish_product"],
    ["barcode_aliases", ["extra-code"], "can_link_product_barcode"],
    ["is_archived", true, "can_archive_product"],
    ["is_archived", false, "can_restore_product"],
    ["archived_at", null, "can_restore_product"],
  ])("preserves granular %s permission", async (field, value, permission) => {
    const op = { table: "products", kind: "update", match: { id: "product" }, values: { [field]: value } };
    query.mockResolvedValue({ recordset: [{ ...current, [field]: field === "is_archived" ? !value : field === "archived_at" ? "2026-10-01" : null }] });
    await expect(repository.assertProductPermissions({}, op, { ...scope, permissions: { [permission as string]: true } })).resolves.toBeUndefined();
    await expect(repository.assertProductPermissions({}, op, scope)).rejects.toThrow("permission");
  });
});
