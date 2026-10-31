import { describe, expect, it } from "vitest";
import { redactSyncDownload } from "../sync-download-redaction";

function freezeTree<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeTree);
    Object.freeze(value);
  }
  return value;
}

function nestedPage(management: boolean) {
  const input = {
    rows: [
      {
        table_name: "products", entity_id: "product-a", cursor: 41,
        row_data: {
          id: "product-a", sku: "SKU-0001", store_id: "branch-a", selling_price: 12,
          stock_by_store: { "branch-a": 0, "branch-b": -1 },
          ecom_price: 22, ecom_visible: true, ecom_enabled: false, is_published: true,
          details: [{ name: "Size", ecom_price: 23, notes: null }],
        },
      },
      {
        table_name: "terminal_tokens", cursor: 42,
        row_data: {
          id: "terminal-a", status: "used", claim_secret_hash: "fixture-secret",
          claim_proof: "fixture-proof", claimed_proof_hash: "fixture-claimed-proof",
          nested: [{ claim_proof: "fixture-nested-proof", enabled: false }],
        },
      },
      {
        table_name: "settings_scoped", cursor: 43,
        row_data: {
          scope: "BRANCH", scope_id: "branch-a", key: "product_price:product-a",
          value: { selling_price: 12, ecom_price: 24, ecom_visible: false, tax_rate: 0 },
        },
      },
      {
        table_name: "change_history", cursor: 44,
        row_data: {
          id: "history-a", store_id: null, entity_id: "product-a", old_data: { ecom_price: 20 },
          new_data: { stock_by_store: { "branch-a": 0 }, ecommerceEnabled: true },
        },
      },
    ],
    tombstones: [{ table_name: "products", entity_id: "removed-product", tombstone: true }],
    cursor: "page-two", count: 5,
  };
  const product = input.rows[0].row_data;
  const expected = {
    rows: [
      {
        table_name: "products", entity_id: "product-a", cursor: 41,
        row_data: management ? product : {
          id: "product-a", sku: "SKU-0001", store_id: "branch-a", selling_price: 12,
          stock_by_store: { "branch-a": 0, "branch-b": -1 },
          details: [{ name: "Size", notes: null }],
        },
      },
      {
        table_name: "terminal_tokens", cursor: 42,
        row_data: { id: "terminal-a", status: "used", nested: [{ enabled: false }] },
      },
      {
        table_name: "settings_scoped", cursor: 43,
        row_data: {
          scope: "BRANCH", scope_id: "branch-a", key: "product_price:product-a",
          value: management
            ? { selling_price: 12, ecom_price: 24, ecom_visible: false, tax_rate: 0 }
            : { selling_price: 12, ecom_visible: false, tax_rate: 0 },
        },
      },
      {
        table_name: "change_history", cursor: 44,
        row_data: {
          id: "history-a", store_id: null, entity_id: "product-a", old_data: { ecom_price: 20 },
          new_data: management
            ? { stock_by_store: { "branch-a": 0 }, ecommerceEnabled: true }
            : { stock_by_store: { "branch-a": 0 } },
        },
      },
    ],
    tombstones: [{ table_name: "products", entity_id: "removed-product", tombstone: true }],
    cursor: "page-two", count: 5,
  };
  return { input, expected };
}

describe("sync redaction output parity", () => {
  it.each([false, true])("preserves the complete nested page and masking with management=%s", management => {
    const { input, expected } = nestedPage(management);
    const original = structuredClone(input);
    freezeTree(input);
    const output = redactSyncDownload(input, "", management);
    expect(output).toEqual(expected);
    expect(JSON.stringify(output)).toBe(JSON.stringify(expected));
    expect(input).toEqual(original);
    expect(output).not.toBe(input);
  });

  it.each([false, true])("inherits explicit terminal context and removes secrets for management=%s", management => {
    const input = freezeTree({ rows: [{ id: "terminal-a", claim_secret_hash: "fixture-secret", claim_proof: "fixture-proof", claimed_proof_hash: "fixture-claimed", metadata: { claim_proof: "fixture-nested", other: 0 } }], cursor: null });
    expect(redactSyncDownload(input, "terminal_tokens", management)).toEqual({ rows: [{ id: "terminal-a", metadata: { other: 0 } }], cursor: null });
    expect(input.rows[0].claim_proof).toBe("fixture-proof");
  });

  it("honors nested table context changes without applying a product mask to unrelated records", () => {
    const input = freezeTree({
      ecom_price: 10,
      nested: { table_name: "pos_settings", ecom_price: 20, ecommerceEnabled: true, child: { ecom_visible: true } },
      tokens: { table_name: "terminal_tokens", claim_proof: "fixture-proof", ecom_price: 30 },
    });
    expect(redactSyncDownload(input, "products")).toEqual({
      nested: { table_name: "pos_settings", ecom_price: 20, child: { ecom_visible: true } },
      tokens: { table_name: "terminal_tokens", ecom_price: 30 },
    });
  });

  it.each([false, true])("retains exact product-price settings behavior with management=%s", management => {
    const input = freezeTree([
      { key: "product_price:p", value: { selling_price: 12, ecom_price: 25, ecom_visible: false, nested: { ecom_price: 26 } } },
      { key: "product_price:p", value: "{\"ecom_price\":27}" },
      { key: "product_price:p", value: null },
      { key: "other_setting", value: { ecom_price: 28, ecommerceEnabled: true } },
    ]);
    const expected = management ? input : [
      { key: "product_price:p", value: { selling_price: 12, ecom_visible: false, nested: { ecom_price: 26 } } },
      { key: "product_price:p", value: "{\"ecom_price\":27}" },
      { key: "product_price:p", value: null },
      { key: "other_setting", value: { ecom_price: 28 } },
    ];
    expect(redactSyncDownload(input, "settings_scoped", management)).toEqual(expected);
  });

  it("preserves primitives, missing values and sparse array slots", () => {
    const input: unknown[] = [null, undefined, 0, -1, false, "", Number.NaN];
    input.length = 8;
    input.push({ keep: undefined, empty: [] });
    freezeTree(input);
    const output = redactSyncDownload(input);
    expect(output).toEqual(input);
    expect(7 in (output as unknown[])).toBe(false);
    expect(output).not.toBe(input);
  });

  it("keeps every synthetic audit row, branch and cursor while masking only existing fields", () => {
    const input = freezeTree(Array.from({ length: 250 }, (_, index) => ({
      table_name: "change_history", cursor: index + 1,
      row_data: { id: `audit-${index}`, store_id: index % 2 ? "branch-b" : null, before_data: { quantity: index - 1, ecom_price: index }, after_data: { quantity: index, ecommerceEnabled: false } },
    })));
    const expected = input.map(row => ({
      ...row,
      row_data: { id: row.row_data.id, store_id: row.row_data.store_id, before_data: row.row_data.before_data, after_data: { quantity: row.row_data.after_data.quantity } },
    }));
    const output = redactSyncDownload(input);
    expect(output).toEqual(expected);
    expect(JSON.stringify(output)).toBe(JSON.stringify(expected));
    expect(input[249].row_data.after_data.ecommerceEnabled).toBe(false);
  });

  it("keeps repeated ordinary and management calls independent", () => {
    const ordinary = nestedPage(false), management = nestedPage(true);
    expect(redactSyncDownload(ordinary.input)).toEqual(ordinary.expected);
    expect(redactSyncDownload(management.input, "", true)).toEqual(management.expected);
    expect(redactSyncDownload(ordinary.input)).toEqual(ordinary.expected);
  });
});
