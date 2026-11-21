import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createActualStockWriter } = require("../../../scripts/lib/stock-actual-writer-fixture.cjs");
const read = (path: string) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
const branch = "A";
let fixture: Awaited<ReturnType<typeof createActualStockWriter>>;
let items: Array<{ id: string; sku: string; version: string }>;

beforeEach(async () => {
  fixture = await createActualStockWriter({ sourceAdmission: true });
  const { db, author } = fixture;
  const source = read("database/beta/retail-pos-supabase-beta-fresh.sql");
  const guard = source.indexOf("CREATE OR REPLACE FUNCTION public.product_delete_guard(_product_id uuid)");
  await db.exec(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';`)
    .catch(async () => db.exec(`CREATE TABLE bookings(id uuid PRIMARY KEY,status text,lines jsonb,charges jsonb,
      string_source_product_id uuid,grip_product_id uuid);`));
  await db.exec(`ALTER TABLE held_orders ADD COLUMN IF NOT EXISTS id text,ADD COLUMN IF NOT EXISTS lines jsonb;
    ALTER TABLE promotions ADD COLUMN IF NOT EXISTS foc_product_id uuid;
    CREATE TABLE product_barcodes(id uuid PRIMARY KEY,product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,barcode text UNIQUE,
     label text,pack_size numeric NOT NULL);
    ALTER TABLE sale_items ADD CONSTRAINT fixture_merge_sale_product FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL;
    ALTER TABLE item_activity_logs ADD CONSTRAINT fixture_merge_activity_product FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE;`);
  await db.exec(source.slice(guard, source.indexOf("$$;", guard) + 3));
  await db.query(`UPDATE app_users SET permissions='{"can_merge_products":true,"can_archive_product":true}' WHERE id=$1`, [author]);
  await db.exec(read("scripts/preparation/stock-history-product-merge.sql"));
  items = [];
  for (const [index, count] of [4, 2, 3, 0].entries()) {
    const id = randomUUID(), sku = "sku-fixture-" + index;
    await db.query(`INSERT INTO products(id,name,sku,barcode,stock_quantity,stock_by_store,owner_store_id,barcode_aliases,row_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,1)`, [id, "Item " + index, sku, "barcode-fixture-" + index, count,
      JSON.stringify({ [branch]: count }), branch, [`alias-fixture-${index}`]]);
    items.push({ id, sku, version: "1" });
  }
});
afterEach(async () => { await fixture?.db.close(); });

const roster = (indices = [0, 1, 2, 3]) => indices.map(i => ({ id: items[i]!.id, sku: items[i]!.sku, rowVersion: items[i]!.version }));
const send = (operation = randomUUID(), requested = roster(), overrides: { author?: string; branch?: string } = {}) =>
  fixture.scalar("SELECT public.pos_stock_history_merge_products($1,$2,$3,$4,$5,$6::jsonb)",
    [operation, overrides.branch ?? branch, fixture.terminal, overrides.author ?? fixture.author, items[0]!.id, JSON.stringify(requested)]);
const row = (i: number) => fixture.scalar("SELECT to_jsonb(p) FROM products p WHERE id=$1", [items[i]!.id]);
const receiptCount = () => fixture.scalar("SELECT count(*)::integer FROM private.stock_history_product_merges");
const activity = (i: number) => fixture.db.query("INSERT INTO item_activity_logs(id,product_id,activity_type,store_id,quantity_delta) VALUES($1,$2,'archive','A',0)",
  [randomUUID(), items[i]!.id]);

describe("authoritative product merge", () => {
  it("conserves accepted stock, preserves a blocked loser, and replays the exact outcome", async () => {
    await activity(2);
    const operation = randomUUID(), protectedRow = await row(2);
    const result = await send(operation);
    expect(result.master).toMatchObject({ quantity: "6", stockTotal: "6", sku: items[0]!.sku, rowVersion: "2" });
    expect(result.master.aliases).toContain("sku-fixture-1");
    expect(result.master.aliases).toContain("sku-fixture-3");
    expect(result.master.aliases).not.toContain("sku-fixture-2");
    expect(result.removed.map((entry: { id: string }) => entry.id).sort()).toEqual([items[1]!.id, items[3]!.id].sort());
    expect(result.held).toEqual([{ id: items[2]!.id, name: "Item 2", code: "PRODUCT_HAS_ACTIVITY_HISTORY" }]);
    expect(await row(2)).toEqual(protectedRow);
    expect(await fixture.scalar("SELECT count(*)::int FROM item_activity_logs WHERE product_id=$1", [items[2]!.id])).toBe(1);
    expect(await send(operation, roster().reverse())).toEqual(result);
    await expect(send(operation, roster([0, 2]))).rejects.toThrow(/PRODUCT_MERGE_REPLAY_MISMATCH/);
    expect(await receiptCount()).toBe(1);
    const effects = (await fixture.db.query(`SELECT product_id,operation,quantity_delta::text delta FROM private.stock_history_accepted_effects
      WHERE transaction_id=(SELECT capture_xid::text::bigint FROM private.stock_history_product_merges WHERE operation_id=$1)`, [operation])).rows;
    expect(effects.filter((effect: { delta: string }) => effect.delta !== "0")).toEqual(expect.arrayContaining([
      { product_id: items[0]!.id, operation: "UPDATE", delta: "2" },
      { product_id: items[1]!.id, operation: "DELETE", delta: "-2" },
    ]));
    expect(effects.map((effect: { product_id: string }) => effect.product_id)).not.toContain(items[2]!.id);
  });

  it("keeps open documents, rich barcodes, and foreign stock outside the merge", async () => {
    await fixture.db.query(`INSERT INTO held_orders(id,store_id,shift_id,status,lines) VALUES('fixture-merge','A',NULL,'held',$1)`,
      [JSON.stringify([{ productId: items[1]!.id.toUpperCase() }])]);
    await fixture.db.query("INSERT INTO product_barcodes VALUES($1,$2,'pack-fixture','Six-pack',6)", [randomUUID(), items[2]!.id]);
    await fixture.db.query(`UPDATE products SET stock_by_store='{"A":0,"B":1}',stock_quantity=1 WHERE id=$1`, [items[3]!.id]);
    const before = await Promise.all([0, 1, 2, 3].map(row));
    const result = await send();
    expect(result.removed).toEqual([]);
    expect(result.held.map((entry: { code: string }) => entry.code).sort())
      .toEqual(["PRODUCT_HAS_STRUCTURED_BARCODES", "PRODUCT_HELD_TICKET", "PRODUCT_OTHER_BRANCH_STOCK"].sort());
    expect(await Promise.all([0, 1, 2, 3].map(row))).toEqual(before);
    expect(await receiptCount()).toBe(1);
  });

  it("requires the exact branch, current merge and deletion authorization, and unchanged SKU/revision", async () => {
    const before = await Promise.all([0, 1, 2].map(row));
    await expect(send(randomUUID(), roster(), { branch: "B" })).rejects.toThrow();
    await expect(send(randomUUID(), roster(), { author: fixture.manager })).rejects.toThrow(/PRODUCT_MERGE_AUTHOR_DENIED/);
    const stale = roster();
    stale[1] = { ...stale[1]!, sku: "changed" };
    await expect(send(randomUUID(), stale)).rejects.toThrow(/PRODUCT_MERGE_ROSTER_CHANGED/);
    await fixture.db.exec("SET ROLE authenticated");
    try { await expect(send()).rejects.toThrow(/permission denied/); }
    finally { await fixture.db.exec("RESET ROLE"); }
    expect(await Promise.all([0, 1, 2].map(row))).toEqual(before);
    expect(await receiptCount()).toBe(0);
  });

  it("stops a booked master and preserves a receipt's product reference when another loser is eligible", async () => {
    const booking = randomUUID(), saleLine = randomUUID();
    await fixture.db.query(`INSERT INTO bookings(id,status,lines,charges) VALUES($1,'active',$2,'{}')`,
      [booking, JSON.stringify([{ productId: items[0]!.id }])]);
    await fixture.db.query(`INSERT INTO sale_items(id,sale_id,product_id,product_name) VALUES($1,$2,$3,'Past item')`,
      [saleLine, randomUUID(), items[2]!.id]);
    await expect(send()).rejects.toThrow(/PRODUCT_MERGE_MASTER_IN_USE/);
    expect(await receiptCount()).toBe(0);
    await fixture.db.query("UPDATE bookings SET status='completed' WHERE id=$1", [booking]);
    const result = await send();
    expect(result.held).toEqual([{ id: items[2]!.id, name: "Item 2", code: "PRODUCT_HAS_SALES_HISTORY" }]);
    expect(result.master.quantity).toBe("6");
    expect(await fixture.scalar("SELECT product_id FROM sale_items WHERE id=$1", [saleLine])).toBe(items[2]!.id);
  });

  it("rolls back all product removals and the receipt when the winning update fails", async () => {
    const before = await Promise.all([0, 1, 2, 3].map(row));
    await fixture.db.exec(`CREATE FUNCTION public.fixture_fail_merge() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'FIXTURE_MERGE_WINNER_UPDATE_FAILED'; END $$;
      CREATE TRIGGER fixture_fail_merge BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.fixture_fail_merge();`);
    await expect(send()).rejects.toThrow(/FIXTURE_MERGE_WINNER_UPDATE_FAILED/);
    expect(await Promise.all([0, 1, 2, 3].map(row))).toEqual(before);
    expect(await receiptCount()).toBe(0);
  });
});
