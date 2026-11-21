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
    ALTER TABLE stores ADD COLUMN IF NOT EXISTS code text,ADD COLUMN IF NOT EXISTS parent_id text,
      ADD COLUMN IF NOT EXISTS archived_at timestamptz;
    UPDATE stores SET code='CODEX-STOCK401-MERGE-OWNED01' WHERE id='A';
    ALTER TABLE promotions ADD COLUMN IF NOT EXISTS foc_product_id uuid;
    CREATE TABLE product_barcodes(id uuid PRIMARY KEY,product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,barcode text UNIQUE,
     label text,pack_size numeric NOT NULL);
    ALTER TABLE sale_items ADD CONSTRAINT fixture_merge_sale_product FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL;
    ALTER TABLE item_activity_logs ADD CONSTRAINT fixture_merge_activity_product FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE;`);
  await db.exec(source.slice(guard, source.indexOf("$$;", guard) + 3));
  await db.query(`UPDATE app_users SET permissions='{"can_merge_products":true,"can_archive_product":true,"can_adjust_stock":true,"can_link_product_barcode":true}' WHERE id=$1`, [author]);
  await db.exec(read("scripts/preparation/stock-history-product-merge.sql"));
  await db.exec(read("scripts/preparation/stock-history-product-merge-evidence.sql"));
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
const readReceipt = (operation: string, requested = roster(), overrides: { author?: string; branch?: string; terminal?: string } = {}) =>
  fixture.scalar("SELECT public.pos_stock_history_product_merge_receipt($1,$2,$3,$4,$5,$6::jsonb)",
    [operation, overrides.branch ?? branch, overrides.terminal ?? fixture.terminal, overrides.author ?? fixture.author,
      items[0]!.id, JSON.stringify(requested)]);
const row = (i: number) => fixture.scalar("SELECT to_jsonb(p) FROM products p WHERE id=$1", [items[i]!.id]);
const receiptCount = () => fixture.scalar("SELECT count(*)::integer FROM private.stock_history_product_merges");
const activity = (i: number) => fixture.db.query("INSERT INTO item_activity_logs(id,product_id,activity_type,store_id,quantity_delta) VALUES($1,$2,'archive','A',0)",
  [randomUUID(), items[i]!.id]);
const permissions = (edits: Record<string, boolean> = {}) => fixture.db.query(
  "UPDATE app_users SET permissions=$2::jsonb WHERE id=$1",
  [fixture.author, JSON.stringify({ can_merge_products: true, can_archive_product: true, ...edits })],
);

describe("authoritative product merge", () => {
  it("reads absence and then the original acceptance without writing stock or creating another receipt", async () => {
    const operation = randomUUID(), chosen = roster([0, 1]), originalMaster = await row(0), originalSource = await row(1);
    expect(await readReceipt(operation, chosen)).toEqual({ ok: true, receipt: null });
    expect(await receiptCount()).toBe(0);
    expect(await row(0)).toEqual(originalMaster);
    expect(await row(1)).toEqual(originalSource);

    const committed = await send(operation, chosen), acceptedMaster = await row(0);
    const acceptedEffects = await fixture.scalar("SELECT count(*)::int FROM private.stock_history_product_merge_effects");
    await fixture.db.exec("SET ROLE service_role");
    try { expect(await readReceipt(operation, chosen.reverse())).toEqual({ ok: true, receipt: committed }); }
    finally { await fixture.db.exec("RESET ROLE"); }
    expect(await row(0)).toEqual(acceptedMaster);
    expect(await receiptCount()).toBe(1);
    expect(await fixture.scalar("SELECT count(*)::int FROM private.stock_history_product_merge_effects")).toBe(acceptedEffects);
  });

  it("requires the exact merge lookup binding and current authority", async () => {
    const operation = randomUUID(), chosen = roster([0, 1]);
    await send(operation, chosen);
    await expect(readReceipt(operation, roster([0, 2]))).rejects.toThrow(/PRODUCT_MERGE_REPLAY_MISMATCH/);
    await expect(readReceipt(operation, chosen, { author: fixture.admin })).rejects.toThrow(/PRODUCT_MERGE_REPLAY_MISMATCH/);
    await expect(readReceipt(operation, chosen, { author: fixture.manager })).rejects.toThrow(/PRODUCT_MERGE_AUTHOR_DENIED/);
    await expect(readReceipt(operation, chosen, { branch: "B" })).rejects.toThrow(/PRODUCT_MERGE_WRITER_SCOPE_UNPROVEN/);
    await expect(readReceipt(operation, chosen, { terminal: randomUUID() })).rejects.toThrow(/PRODUCT_MERGE_WRITER_SCOPE_UNPROVEN/);
    await fixture.db.exec("SET ROLE authenticated");
    try { await expect(readReceipt(operation, chosen)).rejects.toThrow(/permission denied/); }
    finally { await fixture.db.exec("RESET ROLE"); }
    await permissions({ can_archive_product: false });
    await expect(readReceipt(operation, chosen)).rejects.toThrow(/PRODUCT_MERGE_AUTHOR_DENIED/);
  });

  it("leaves absence unverified when the transaction cannot refresh its snapshot after the operation lock", async () => {
    await fixture.db.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
    try { await expect(readReceipt(randomUUID())).rejects.toThrow(/PRODUCT_MERGE_RECEIPT_UNVERIFIED/); }
    finally { await fixture.db.exec("ROLLBACK"); }
    expect(await receiptCount()).toBe(0);
  });

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
    const witnessed = (await fixture.db.query(`
      SELECT proof.product_id,proof.leg,e.quantity_delta::text delta,e.transaction_id=m.capture_xid::text::bigint same_transaction
      FROM private.stock_history_product_merge_effects proof
      JOIN private.stock_history_accepted_effects e ON e.id=proof.effect_id
      JOIN private.stock_history_product_merges m USING(operation_id)
      WHERE proof.operation_id=$1 ORDER BY proof.leg`, [operation])).rows;
    expect(witnessed).toEqual([
      { product_id: items[0]!.id, leg: "master", delta: "2", same_transaction: true },
      { product_id: items[1]!.id, leg: "removed", delta: "-2", same_transaction: true },
    ]);
  });

  it("preserves accepted stock and exact replay if optional merge evidence cannot be stored", async () => {
    await fixture.db.exec(`CREATE FUNCTION private.fixture_reject_merge_witness() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'FIXTURE_MERGE_WITNESS_REJECTED'; END $$;
      CREATE TRIGGER fixture_reject_merge_witness BEFORE INSERT ON private.stock_history_product_merge_effects
      FOR EACH ROW EXECUTE FUNCTION private.fixture_reject_merge_witness();`);
    const operation = randomUUID(), chosen = roster([0, 1]);
    const result = await send(operation, chosen);
    expect(result.master.quantity).toBe("6");
    expect(result.removed.map((entry: { id: string }) => entry.id)).toEqual([items[1]!.id]);
    expect(await send(operation, chosen)).toEqual(result);
    expect(await fixture.scalar("SELECT count(*)::int FROM private.stock_history_product_merge_effects")).toBe(0);
    expect(await receiptCount()).toBe(1);
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

  it.each([
    [{ can_adjust_stock: true }, [0, 3]],
    [{ can_link_product_barcode: true }, [0, 1]],
  ] as const)("rolls back all removals when the actual effects require a missing grant", async (grants, selection) => {
    await permissions(grants);
    const before = await Promise.all([0, 1, 2, 3].map(row));
    await expect(send(randomUUID(), roster([...selection]))).rejects.toThrow(/PRODUCT_MERGE_AUTHOR_DENIED/);
    expect(await Promise.all([0, 1, 2, 3].map(row))).toEqual(before);
    expect(await receiptCount()).toBe(0);
  });

  it("allows zero-stock retirements with no alias change and all-held receipts without either field grant", async () => {
    await permissions();
    await activity(1);
    const heldOnly = await send(randomUUID(), roster([0, 1]));
    expect(heldOnly).toMatchObject({ removed: [], master: { quantity: "4", rowVersion: "1" } });
    const aliases = ["sku-fixture-3", "alias-fixture-0", "barcode-fixture-3", "alias-fixture-3"];
    await fixture.db.query("UPDATE products SET barcode_aliases=$2 WHERE id=$1", [items[0]!.id, aliases]);
    const zero = await send(randomUUID(), roster([0, 3]));
    expect(zero).toMatchObject({ removed: [{ id: items[3]!.id, quantity: "0" }], master: { quantity: "4", aliases } });
  });

  it("requires stock authority even when nonzero retired stock nets to zero", async () => {
    await permissions({ can_link_product_barcode: true });
    await fixture.db.query("UPDATE products SET stock_quantity=-2,stock_by_store='{\"A\":-2}' WHERE id=$1", [items[2]!.id]);
    await expect(send(randomUUID(), roster([0, 1, 2]))).rejects.toThrow(/PRODUCT_MERGE_AUTHOR_DENIED/);
    expect(await receiptCount()).toBe(0);
    expect((await row(1)).stock_quantity).toBe(2);
    expect((await row(2)).stock_quantity).toBe(-2);
  });

  it("denies a second retained or historical branch terminal and a branch outside the isolated fixture marker", async () => {
    const prior = randomUUID();
    await fixture.db.query("INSERT INTO terminal_tokens(id,location_id,platform,status,is_claimed) VALUES($1,'A','pc','revoked',true)", [prior]);
    await expect(send()).rejects.toThrow(/PRODUCT_MERGE_WRITER_SCOPE_UNPROVEN/);
    await fixture.db.query("DELETE FROM terminal_tokens WHERE id=$1", [prior]);
    await fixture.db.query(`INSERT INTO sync_change_feed(organization_id,branch_id,table_name,entity_id,operation,row_version,tombstone)
      VALUES('default','A','terminal_tokens',$1,'delete',1,true)`, [JSON.stringify({ id: prior })]);
    await expect(send()).rejects.toThrow(/PRODUCT_MERGE_WRITER_SCOPE_UNPROVEN/);
    await fixture.db.exec("DELETE FROM sync_change_feed WHERE table_name='terminal_tokens';UPDATE stores SET code='NOT-THE-FIXTURE' WHERE id='A';");
    await expect(send()).rejects.toThrow(/PRODUCT_MERGE_WRITER_SCOPE_UNPROVEN/);
    expect(await receiptCount()).toBe(0);
  });
});
