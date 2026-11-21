import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createActualStockWriter } = require("../../../scripts/lib/stock-actual-writer-fixture.cjs");

describe("catalogue-only imports and independently accepted product-merge effects", () => {
  let fixture: Awaited<ReturnType<typeof createActualStockWriter>>;

  beforeAll(async () => {
    fixture = await createActualStockWriter();
    await fixture.db.exec("CREATE TABLE fixture_product_reference(product_id uuid REFERENCES products(id))");
  }, 30_000);

  afterAll(async () => fixture?.db.close());

  async function product(stock: number, name: string) {
    const id = randomUUID();
    return { ...await fixture.productRow(stock), id, name, barcode: id, sku: id, owner_store_id: "A" };
  }

  async function effects(ids: string[]) {
    return (await fixture.db.query(`
      SELECT product_id,store_id,operation,previous_quantity::text,next_quantity::text,quantity_delta::text,
        product_snapshot->>'name' AS name,transaction_id::text,
        EXISTS(SELECT 1 FROM private.stock_history_effect_coverage c WHERE c.effect_id=e.id) AS validated
      FROM private.stock_history_accepted_effects e
      WHERE product_id=ANY($1::uuid[]) ORDER BY transaction_id,product_id
    `, [ids])).rows;
  }

  const write = (rows: Record<string, unknown>[]) => fixture.push(randomUUID(), [{ table: "products", rows }]);
  const remove = (id: string) =>
    fixture.push(randomUUID(), [{ table: "products", rows: [], changes: [{ operation: "D", key: { id } }] }]);

  it("records a scoped zero-stock birth and no movement for an imported metadata edit", async () => {
    const birth = await product(0, "Imported catalogue product");
    const existing = { ...await fixture.productRow(10), name: "Imported metadata" };
    expect(await write([birth, existing])).toMatchObject({ ok: true });
    expect(await fixture.stock()).toBe("10");
    expect(await effects([birth.id, fixture.product])).toMatchObject([{
      product_id: birth.id, operation: "INSERT", store_id: "A", previous_quantity: "0", next_quantity: "0",
      quantity_delta: "0", name: birth.name, validated: false,
    }]);
    expect(await fixture.scalar("SELECT count(*)::int FROM stock_delta_applied")).toBe(0);
    expect(await fixture.scalar("SELECT count(*)::int FROM stock_history_movements")).toBe(0);
    expect(await write([birth, existing])).toMatchObject({ ok: true });
    expect(await effects([birth.id, fixture.product])).toHaveLength(1);
  });

  it("keeps a failed merge deletion separate from its accepted master and actual loser deletion", async () => {
    const master = await product(10, "Merge master");
    const removed = await product(2, "Removed duplicate");
    const blocked = await product(3, "Referenced duplicate");
    const ids = [master.id, removed.id, blocked.id];
    expect(await write([master, removed, blocked])).toMatchObject({ ok: true });
    await fixture.db.query("INSERT INTO fixture_product_reference(product_id) VALUES($1)", [blocked.id]);

    // A directly accepted master update is independent of the later deletes.
    await fixture.db.query(`
      UPDATE products SET stock_quantity=15,stock_by_store='{"A":15}',row_version=row_version+1 WHERE id=$1
    `, [master.id]);
    const masterEffect = (await effects(ids)).find((row: { operation: string }) => row.operation === "UPDATE");
    expect(masterEffect).toMatchObject({ product_id: master.id, quantity_delta: "5", validated: false });
    expect(await remove(removed.id)).toMatchObject({ ok: true });
    await expect(remove(blocked.id)).rejects.toThrow(/fixture_product_reference/);
    const changes = (await effects(ids)).filter((row: { operation: string }) => row.operation !== "INSERT");
    expect(changes).toMatchObject([
      { product_id: master.id, operation: "UPDATE", quantity_delta: "5", validated: false },
      { product_id: removed.id, operation: "DELETE", previous_quantity: "2", next_quantity: "0",
        quantity_delta: "-2", name: removed.name, validated: false },
    ]);
    expect(changes[0]?.transaction_id).not.toEqual(changes[1]?.transaction_id);
    expect(await fixture.scalar("SELECT stock_by_store->>'A' FROM products WHERE id=$1", [blocked.id])).toBe("3");
  });

  it("does not infer a master stock credit from the actual grouped catalogue upsert", async () => {
    const master = await product(6, "Grouped merge master");
    const loser = await product(4, "Grouped duplicate");
    expect(await write([master, loser])).toMatchObject({ ok: true });
    expect(await write([{ ...master, stock_by_store: { A: 10 }, stock_quantity: 10, row_version: 21 }]))
      .toMatchObject({ ok: true });
    expect(await fixture.scalar("SELECT stock_by_store->>'A' FROM products WHERE id=$1", [master.id])).toBe("6");
    expect(await remove(loser.id)).toMatchObject({ ok: true });
    const changes = (await effects([master.id, loser.id])).filter((row: { operation: string }) => row.operation !== "INSERT");
    expect(changes).toMatchObject([{ product_id: loser.id, operation: "DELETE", quantity_delta: "-4", validated: false }]);
  });
});
