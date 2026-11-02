import { describe, expect, it } from "vitest";
import { redactSyncDownload } from "../sync-download-redaction";

// Frozen beta behavior, independent of the optimized implementation. This is
// intentionally kept as the original projection to catch privacy/output drift.
function betaRedaction(value: unknown, table = "", management = false): unknown {
  const ecommerce = new Set(["ecom_price", "ecom_visible", "ecom_enabled", "is_published"]);
  const secrets = new Set(["claim_secret_hash", "claim_proof", "claimed_proof_hash"]);
  if (Array.isArray(value)) return value.map(row => betaRedaction(row, table, management));
  if (!value || typeof value !== "object") return value;
  let row = value as Record<string, unknown>;
  if (!management && (table === "settings_scoped" || row.table_name === "settings_scoped") && typeof row.key === "string" && row.key.startsWith("product_price:") && row.value && typeof row.value === "object") {
    row = { ...row, value: Object.fromEntries(Object.entries(row.value as Record<string, unknown>).filter(([key]) => key !== "ecom_price")) };
  }
  const context = typeof row.table_name === "string" ? row.table_name : table;
  return Object.fromEntries(Object.entries(row)
    .filter(([key]) => (context !== "terminal_tokens" || !secrets.has(key)) && (management || context !== "products" || !ecommerce.has(key)) && (management || key !== "ecommerceEnabled"))
    .map(([key, child]) => [key, betaRedaction(child, context, management)]));
}

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

  it.each([false, true])("keeps own __proto__, constructor and prototype fields as data with management=%s", management => {
    const input = JSON.parse('{"9":"nine","2":"two","table_name":"products","z":null,"__proto__":{"marker":"fixture","ecom_price":17},"constructor":{"prototype":{"label":"fixture","ecom_visible":true}},"prototype":0,"ecommerceEnabled":false,"a":"last"}');
    freezeTree(input);
    const output = redactSyncDownload(input, "", management) as Record<string, unknown>;
    const expected = betaRedaction(input, "", management) as Record<string, unknown>;
    expect(output).toEqual(expected);
    expect(Object.keys(output)).toEqual(Object.keys(expected));
    expect(JSON.stringify(output)).toBe(JSON.stringify(expected));
    expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(output, "__proto__")).toEqual({ value: expected["__proto__"], writable: true, enumerable: true, configurable: true });
    expect(Object.getPrototypeOf(output["__proto__"])).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty("marker");
    expect(Object.keys(input)).toContain("ecommerceEnabled");
  });

  it.each([false, true])("preserves array-valued product-price settings and context overrides with management=%s", management => {
    const price = [1] as unknown[] & Record<string, unknown>;
    price.length = 2;
    price.push({ ecom_price: 8, keep: null });
    price.ecom_price = 9;
    price.extra = { claim_proof: "fixture-proof", ecommerceEnabled: true };
    Object.defineProperty(price, "__proto__", { value: { keep: 3 }, enumerable: true });
    const input = freezeTree({ table_name: "terminal_tokens", key: "product_price:p", value: price });
    const output = redactSyncDownload(input, "settings_scoped", management) as Record<string, unknown>;
    const expected = betaRedaction(input, "settings_scoped", management);
    expect(output).toEqual(expected);
    expect(JSON.stringify(output)).toBe(JSON.stringify(expected));
    expect(Array.isArray(output.value)).toBe(management);
    expect(Object.hasOwn(price, "ecom_price")).toBe(true);
    expect(1 in price).toBe(false);
  });

  it("preserves inherited context and ignores non-enumerable and symbol properties", () => {
    const input = Object.create({ table_name: "terminal_tokens", inherited: "fixture" }) as Record<string, unknown>;
    input.id = "fixture-terminal";
    input.claim_proof = "fixture-proof";
    Object.defineProperty(input, "not_enumerable", { value: "fixture" });
    Object.defineProperty(input, Symbol("fixture"), { get: () => { throw new Error("Symbols must not be read"); }, enumerable: true });
    freezeTree(input);
    expect(redactSyncDownload(input)).toEqual({ id: "fixture-terminal" });
    expect(redactSyncDownload(input)).toEqual(betaRedaction(input));
    expect(Object.getPrototypeOf(redactSyncDownload(input))).toBe(Object.prototype);
  });

  it.each(["setter", "readonly"])("copies own data without invoking an inherited %s property", mode => {
    const key = "fixtureSyncRedactionProperty";
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, key);
    const input = Object.fromEntries([[key, 7], ["keep", false]]);
    let setterCalls = 0;
    try {
      Object.defineProperty(Object.prototype, key, mode === "setter"
        ? { configurable: true, set: () => { setterCalls++; } }
        : { configurable: true, writable: false, value: "inherited" });
      const output = redactSyncDownload(input) as Record<string, unknown>;
      expect(output).toEqual(betaRedaction(input));
      expect(Object.getOwnPropertyDescriptor(output, key)).toEqual({ value: 7, writable: true, enumerable: true, configurable: true });
      expect(setterCalls).toBe(0);
    } finally {
      if (previous) Object.defineProperty(Object.prototype, key, previous);
      else Reflect.deleteProperty(Object.prototype, key);
    }
  });

  it("keeps the price-settings preclone behavior when table context is inherited", () => {
    const input = Object.create({ table_name: "terminal_tokens", key: "product_price:p", value: { ecom_price: 20, keep: false } }) as Record<string, unknown>;
    input.claim_proof = "fixture-proof";
    freezeTree(input);
    const output = redactSyncDownload(input, "settings_scoped");
    expect(output).toEqual(betaRedaction(input, "settings_scoped"));
    expect(output).toEqual({ claim_proof: "fixture-proof", value: { keep: false } });
  });

  it("reads object entries before recursive traversal in the same order as beta", () => {
    const make = () => {
      const calls: string[] = [];
      const row = Object.defineProperties({}, {
        table_name: { enumerable: true, value: "terminal_tokens" },
        first: { enumerable: true, get: () => { calls.push("first"); return { get value() { calls.push("nested"); return 0; } }; } },
        claim_proof: { enumerable: true, get: () => { calls.push("secret"); return "fixture-proof"; } },
        last: { enumerable: true, get: () => { calls.push("last"); return false; } },
      });
      return { row, calls };
    };
    const actual = make(), reference = make();
    expect(redactSyncDownload(actual.row)).toEqual(betaRedaction(reference.row));
    expect(actual.calls).toEqual(reference.calls);
    expect(actual.calls).toEqual(["first", "secret", "last", "nested"]);
  });

  it("returns independent fresh objects even when management retains every ordinary field", () => {
    const input = freezeTree({ rows: [{ id: "fixture", values: { n: 0, optional: undefined }, list: [null, false] }], cursor: "next" });
    const output = redactSyncDownload(input, "", true) as typeof input;
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
    expect(output.rows).not.toBe(input.rows);
    expect(output.rows[0]).not.toBe(input.rows[0]);
    expect(output.rows[0].values).not.toBe(input.rows[0].values);
    expect(output.rows[0].list).not.toBe(input.rows[0].list);
  });

  it("matches frozen beta output for varied synthetic nested response pages", () => {
    const contexts = ["", "products", "terminal_tokens", "settings_scoped", "change_history"];
    for (let index = 0; index < 120; index++) {
      const input = freezeTree({
        rows: [{
          table_name: contexts[index % contexts.length], cursor: index,
          row_data: JSON.parse(JSON.stringify({
            id: `fixture-${index}`, key: index % 2 ? "product_price:fixture" : "other",
            value: { ecom_price: index, keep: index % 3 ? 0 : null, nested: { ecommerceEnabled: false } },
            stock_by_store: { "fixture-a": index - 2, "fixture-b": 0 },
            items: [{ claim_proof: "fixture-proof", ecom_visible: false }, null, index % 2 === 0],
            claim_secret_hash: "fixture-secret", ecom_enabled: false,
            child: { table_name: contexts[(index + 1) % contexts.length], ecom_price: index, claim_proof: "fixture-proof" },
          })),
        }], tombstones: [{ entity_id: `removed-${index}`, table_name: "products" }], cursor: index + 1, count: 2,
      });
      for (const management of [false, true]) {
        const output = redactSyncDownload(input, contexts[(index + 2) % contexts.length], management);
        const expected = betaRedaction(input, contexts[(index + 2) % contexts.length], management);
        expect(output).toEqual(expected);
        expect(JSON.stringify(output)).toBe(JSON.stringify(expected));
      }
    }
  });
});
