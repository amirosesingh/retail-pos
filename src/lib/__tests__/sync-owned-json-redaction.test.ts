import { performance } from "node:perf_hooks";
import { cpuUsage, env } from "node:process";
import { describe, expect, it } from "vitest";
import { redactOwnedParsedSyncDownload, redactSyncDownload } from "../sync-download-redaction";

const contexts = ["", "products", "terminal_tokens", "settings_scoped", "change_history", "pos_settings"];
const clone = (value: unknown) => JSON.parse(JSON.stringify(value));
function sameSerialization(value: unknown, table: string, management: boolean) {
  const json = JSON.stringify(value);
  const input = JSON.parse(json);
  const reference = JSON.parse(json);
  const expected = JSON.stringify(redactSyncDownload(reference, table, management));
  expect(JSON.stringify(reference)).toBe(json);
  const result = redactOwnedParsedSyncDownload(input, table, management);
  expect(JSON.stringify(result)).toBe(expected);
  expect(JSON.stringify(reference)).toBe(json);
  return result;
}

describe("owned parsed JSON download redaction", () => {
  it.each([false, true])("matches nested downloads, exact key order and cursor for management=%s", management => {
    const value = { rows: [
      { table_name: "products", row_data: { id: "p", ecom_price: 9, selling_price: 4, stock_by_store: { a: 0, b: -2 }, is_published: false, nested: [{ ecom_visible: true, sku: "SKU-0001" }] } },
      { table_name: "terminal_tokens", row_data: { id: "t", claim_secret_hash: "fixture", claim_proof: "fixture", claimed_proof_hash: "fixture", nested: { claim_proof: "fixture", status: "used" } } },
      { table_name: "change_history", row_data: { old_data: { ecommerceEnabled: true, total: 0 }, new_data: { table_name: "products", ecom_enabled: true, total: -1 } } },
    ], tombstones: [{ id: "gone" }], cursor: "same-cursor", count: 3, hasMore: true };
    for (const table of contexts) sameSerialization(value, table, management);
  });

  it.each([false, true])("preserves product-price object/array projection for management=%s", management => {
    for (const value of [null, 0, "text", [], [1, { ecom_price: 20, ecommerceEnabled: true }], { ecom_price: 20, selling_price: 9, nested: { ecom_price: 5 } }]) {
      for (const table of ["settings_scoped", "products", ""]) {
        sameSerialization({ key: "product_price:p", value }, table, management);
        sameSerialization({ table_name: "settings_scoped", key: "product_price:p", value }, table, management);
      }
    }
    const array = redactOwnedParsedSyncDownload(clone({ key: "product_price:p", value: [1, 2] }), "settings_scoped") as { value: unknown };
    expect(Array.isArray(array.value)).toBe(false);
    expect(array.value).toEqual({ 0: 1, 1: 2 });
  });

  it("retains parsed prototype-named keys without changing any prototype", () => {
    const value = JSON.parse('{"__proto__":{"claim_proof":"fixture","ecommerceEnabled":true},"constructor":{"prototype":{"ecom_price":0}},"value":{"__proto__":{"x":1},"ecom_price":4},"key":"product_price:p","toString":"kept"}');
    for (const table of contexts) for (const management of [false, true]) {
      const result = sameSerialization(value, table, management);
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(Object.prototype).not.toHaveProperty("x");
      expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(true);
    }
  });

  it("matches deterministically generated parsed JSON across all contexts and modes", () => {
    let seed = 0x12345678;
    const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
    const keys = ["__proto__", "constructor", "0", "2", "table_name", "key", "value", "ecom_price", "ecom_visible", "ecom_enabled", "is_published", "ecommerceEnabled", "claim_proof", "claim_secret_hash", "claimed_proof_hash", "rows", "cursor", "price"];
    function generated(depth: number): unknown {
      if (depth === 0 || random(4) === 0) return [null, true, false, -1, 0, 1, 2.5, "商品", "product_price:p", ...contexts][random(15)];
      if (random(3) === 0) return Array.from({ length: random(5) }, () => generated(depth - 1));
      return Object.fromEntries(Array.from({ length: random(10) }, () => [keys[random(keys.length)], generated(depth - 1)]));
    }
    for (let index = 0; index < 200; index++) {
      // Wrapping also exercises a JSON primitive at the top of a real envelope.
      const value = { table_name: contexts[random(contexts.length)], rows: [generated(4)], cursor: `cursor-${index}` };
      for (const table of contexts) for (const management of [false, true]) sameSerialization(value, table, management);
    }
  });

  it("keeps the pure helper's input untouched and separate from owned mutation", () => {
    const value = Object.freeze({ rows: Object.freeze([Object.freeze({ claim_proof: "fixture", id: "t" })]), cursor: "next" });
    expect(redactSyncDownload(value, "terminal_tokens")).toEqual({ rows: [{ id: "t" }], cursor: "next" });
    expect(value.rows[0].claim_proof).toBe("fixture");
    const owned = clone(value);
    redactOwnedParsedSyncDownload(owned, "terminal_tokens");
    expect(owned.rows[0]).not.toHaveProperty("claim_proof");
    expect(value.rows[0].claim_proof).toBe("fixture");
  });

  it("reuses untouched containers and replaces only rows that lose fields", () => {
    const value = { rows: [{ id: "p", stock: { a: 0 }, ecom_price: 3 }], cursor: "next" };
    const originalRow = value.rows[0];
    const originalStock = originalRow.stock;
    expect(redactOwnedParsedSyncDownload(value, "products")).toBe(value);
    expect(value.rows[0]).not.toBe(originalRow);
    expect(value.rows[0].stock).toBe(originalStock);
    expect(value.rows[0]).not.toHaveProperty("ecom_price");
  });

  // Opt-in measurement avoids burdening the ordinary correctness suite with
  // amortized CPU samples. It has no performance pass/fail threshold.
  it.runIf(env.POS_SYNC_CPU_BENCH === "1")("measures complete parse/redact/serialize work without timing pass criteria", () => {
    const fixtures = [
      { label: "history-100", table: "change_history", value: { rows: Array.from({ length: 100 }, (_, id) => ({ id, old_data: { total: 0, stock_by_store: { a: 0, b: -1 } }, new_data: { label: "item", ecommerceEnabled: true, detail: Array.from({ length: 12 }, (_, index) => ({ index, text: "line".repeat(12) })) } })), cursor: "next" } },
      { label: "history-500", table: "change_history", value: { rows: Array.from({ length: 500 }, (_, id) => ({ id, old_data: { stock_by_store: { a: 0, b: -1 } }, new_data: { detail: Array.from({ length: 12 }, (_, index) => ({ index, text: "line".repeat(12), ecommerceEnabled: true })) } })), cursor: "next" } },
      { label: "settings-wide-1", table: "pos_settings", value: { rows: [{ id: 1, integration_settings: { ecommerceEnabled: true }, receipt: Array.from({ length: 1200 }, (_, index) => ({ index, text: "receipt".repeat(10) })) }], cursor: null } },
      { label: "stock-wide-500", table: "products", value: { rows: Array.from({ length: 500 }, (_, id) => ({ id, selling_price: 12, ecom_price: 15, stock_by_store: Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`branch-${index}`, index - 3])) })), cursor: "next" } },
    ];
    for (const fixture of fixtures) for (const management of [false, true]) {
      const raw = JSON.stringify(fixture.value);
      const run = (owned: boolean) => JSON.stringify((owned ? redactOwnedParsedSyncDownload : redactSyncDownload)(JSON.parse(raw), fixture.table, management));
      const reference = run(false);
      expect(run(true)).toBe(reference);
      for (let warmup = 0; warmup < 3; warmup++) { run(false); run(true); }
      const samples: number[][] = [[], []];
      const cpuSamples: number[][] = [[], []];
      const repeats = 32;
      for (let sample = 0; sample < 7; sample++) for (const mode of sample % 2 ? [1, 0] : [0, 1]) {
        const cpuStart = cpuUsage();
        const start = performance.now();
        for (let repeat = 0; repeat < repeats; repeat++) run(mode === 1);
        samples[mode].push((performance.now() - start) / repeats);
        const cpu = cpuUsage(cpuStart);
        cpuSamples[mode].push((cpu.user + cpu.system) / (1000 * repeats));
      }
      const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)].toFixed(3);
      console.info(`parsed-json ${fixture.label} management=${management} median ms: wall pure=${median(samples[0])} owned=${median(samples[1])}; CPU pure=${median(cpuSamples[0])} owned=${median(cpuSamples[1])}`);
    }
  }, 60_000);
});
