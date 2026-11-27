import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const repo = new URL("../../../", import.meta.url);
const fixture = await import(new URL("scripts/fixtures/transfer-dispatch-fixture.mjs", repo).href) as {
  fixtureSql: string;
  migration: string;
  ids: { actor: string; child: string; product: string; product2: string };
  sourceFunction: (name: string, sql: string) => string;
  seedSql: (options?: { extra?: string; cross?: boolean }) => string;
  dispatchSql: (quantity: number, id: string, native: boolean) => string;
  nativeIdentity: string;
};
const loadSql = async (file: string) => (await readFile(new URL(file, repo), "utf8")).replaceAll("\r\n", "\n");
const db = new PGlite();
const receiver = "98712345-1111-4111-8111-111111111111";
const shelf = "A-SHELF";
const install = "scripts/preparation/stock-history-transfer-legs.sql";

beforeAll(async () => {
  await db.exec(fixture.fixtureSql);
  await db.exec(fixture.migration);
  const schema = await loadSql("supabase/schema.sql");
  const canonical = schema.slice(schema.indexOf("-- Receiving now only records arrival; no stock moves here."),
    schema.indexOf("-- Dispatch refuses to move stock the sending branch does not have."));
  for (const name of ["stock_transfer_receive", "stock_transfer_verify"]) {
    const original = fixture.sourceFunction("public." + name, canonical);
    await db.exec(original.replace("public." + name + "(", "private." + name + "("));
  }
  await db.exec(`REVOKE ALL ON FUNCTION private.stock_transfer_verify(uuid,text,jsonb,text),public.current_app_user() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION private.stock_transfer_verify(uuid,text,jsonb,text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.current_app_user() TO authenticated,service_role;`);
  await db.exec(await loadSql("scripts/preparation/pos-sync-native-transfer-receive-v1.sql"));
  // This test exercises an unenrolled feed scope. The actual receipt writer
  // still runs, but no feed publication is expected for the fixture branch.
  await db.exec(`CREATE SCHEMA pos_sync_feed_v1;
    CREATE TABLE pos_sync_feed_v1.feed_heads(organization_id text,scope_id text);
    CREATE FUNCTION pos_sync_feed_v1.extended_scope_epoch(text,text) RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';`);
  await db.exec(await loadSql("scripts/preparation/pos-sync-transfer-receipt-feed-v1.sql"));
  await db.exec(`CREATE TABLE public.stock_delta_applied(movement_id uuid PRIMARY KEY,product_id uuid,store_id text,delta integer);
    CREATE TABLE public.terminal_tokens(id uuid PRIMARY KEY,location_id text,status text,revoked_at timestamptz,
      platform text,is_claimed boolean,management_sync_enabled boolean);
    CREATE TABLE public.shifts(id uuid PRIMARY KEY,store_id text,status text,closed_at timestamptz);`);
  await db.exec(await loadSql("supabase/migrations/20261105113916_stock_history_effective_ledger.sql"));
  await db.exec(await loadSql("supabase/migrations/20261105172030_stock_history_accepted_effect_capture.sql"));
  await db.exec(await loadSql(install));
}, 30000);
afterAll(async () => { await db.close(); });

beforeEach(async () => {
  await db.exec("TRUNCATE private.stock_history_transfer_legs,private.stock_history_effect_sources,private.stock_history_effect_coverage,private.stock_history_accepted_effects;");
  await db.exec(fixture.seedSql({ extra: `
    INSERT INTO stores(id,code,name,parent_id,location_type,group_id)
      VALUES('${shelf}','A-SHELF','Primary shelf','A','sub_warehouse','sports');
    UPDATE products SET stock_by_store='{"A":8,"A-SHELF":2,"B":0,"C":0}'::jsonb WHERE id='${fixture.ids.product}';
    INSERT INTO app_users(id,user_id,full_name,email,role,role_slug,store_id,is_active,auth_user_id,permissions)
      VALUES('${receiver}','receiver','Authorized Receiver','receiver@example.test','staff','warehouse','B',true,'${receiver}','{"can_receive_transfer":true}');`
  }));
});

const evidence = async () => (await db.query(`SELECT w.phase,w.actor_id,w.line_product_id,w.product_id,w.store_id,w.source_store_id,w.destination_store_id,
  e.quantity_delta::text delta,e.previous_quantity::text before,e.next_quantity::text after
 FROM private.stock_history_transfer_legs w JOIN private.stock_history_accepted_effects e ON e.id=w.effect_id
 WHERE w.transfer_id='${fixture.ids.child}' AND e.transaction_id=w.transaction_id ORDER BY w.phase,w.store_id`)).rows;
const receive = (stage: "receive" | "verify") =>
  `SELECT public.stock_transfer_receive_for_staff('${fixture.ids.child}','receiver','B','${stage}',NULL,NULL);`;

describe("stock history evidence from the real transfer stock writers", () => {
  it("binds the split dispatch to real shelf effects and keeps its exact replay unchanged", async () => {
    await db.query(fixture.dispatchSql(3, fixture.ids.child, false));
    const legs = await evidence();
    expect(legs).toEqual([
      expect.objectContaining({ phase: "dispatch", actor_id: fixture.ids.actor, store_id: "A", delta: "-1", before: "8", after: "7" }),
      expect.objectContaining({ phase: "dispatch", actor_id: fixture.ids.actor, store_id: shelf, delta: "-2", before: "2", after: "0" }),
    ]);
    await db.query(fixture.dispatchSql(3, fixture.ids.child, false));
    expect(await evidence()).toEqual(legs);
  });

  it("leaves arrival stock unchanged and binds only the verified destination addition", async () => {
    await db.query(fixture.dispatchSql(3, fixture.ids.child, false));
    const dispatch = await evidence();
    await db.exec(fixture.nativeIdentity);
    await db.query(receive("receive"));
    expect(await evidence()).toEqual(dispatch);
    await db.query(receive("verify"));
    expect(await evidence()).toEqual([
      ...dispatch,
      expect.objectContaining({ phase: "verify", actor_id: receiver, product_id: fixture.ids.product, store_id: "B", delta: "3", before: "0", after: "3" }),
    ]);
    await expect(db.query(receive("verify"))).rejects.toThrow("TRANSFER_ALREADY_POSTED");
    expect(await evidence()).toHaveLength(3);
  });

  it("rolls back its witness and all effects with the original operation", async () => {
    await db.exec("BEGIN");
    await db.query(fixture.dispatchSql(3, fixture.ids.child, false));
    expect(await evidence()).toHaveLength(2);
    await db.exec("ROLLBACK");
    expect(await evidence()).toEqual([]);
    expect((await db.query(`SELECT stock_by_store->>'A' source,stock_by_store->>'A-SHELF' shelf
      FROM public.products WHERE id='${fixture.ids.product}'`)).rows).toEqual([{ source: "8", shelf: "2" }]);
  });

  it("binds a cross-group receipt to the actual destination product, even if its source ID differs", async () => {
    await db.exec(fixture.seedSql({ cross: true, extra: `
      UPDATE stock_transfers SET transfer_scope='INTER_GROUP' WHERE id='${fixture.ids.child}';
      UPDATE products SET stock_by_store=stock_by_store-'B' WHERE id='${fixture.ids.product}';
      UPDATE products SET barcode='FX-1',owner_store_id='B',stock_by_store='{"B":5}'::jsonb,stock_quantity=5 WHERE id='${fixture.ids.product2}';
      INSERT INTO app_users(id,user_id,full_name,email,role,role_slug,store_id,is_active,auth_user_id,permissions)
        VALUES('${receiver}','receiver','Authorized Receiver','receiver@example.test','staff','warehouse','B',true,'${receiver}','{"can_receive_transfer":true}');`
    }));
    await db.query(fixture.dispatchSql(3, fixture.ids.child, false));
    await db.exec(fixture.nativeIdentity);
    await db.query(receive("receive"));
    await db.query(receive("verify"));
    expect(await evidence()).toEqual([
      expect.objectContaining({ phase: "dispatch", product_id: fixture.ids.product, store_id: "A", delta: "-3" }),
      expect.objectContaining({ phase: "verify", line_product_id: fixture.ids.product, product_id: fixture.ids.product2, store_id: "B", delta: "3", before: "5", after: "8" }),
    ]);
  });

  it("keeps metadata private and isolates a capture failure from a complete dispatch", async () => {
    expect((await db.query(`SELECT has_table_privilege('authenticated','private.stock_history_transfer_legs','SELECT') a,
      has_function_privilege('service_role','private.stock_history_capture_transfer_legs(uuid,uuid,text,uuid,uuid,jsonb,jsonb)','EXECUTE') s`)).rows)
      .toEqual([{ a: false, s: false }]);
    await db.exec("BEGIN");
    try {
      await db.exec(`ALTER TABLE private.stock_history_transfer_legs ADD CHECK(false);`);
      await db.query(fixture.dispatchSql(3, fixture.ids.child, false));
      expect(await evidence()).toEqual([]);
      expect((await db.query(`SELECT stock_by_store->>'A' source,stock_by_store->>'A-SHELF' shelf
        FROM public.products WHERE id='${fixture.ids.product}'`)).rows).toEqual([{ source: "7", shelf: "0" }]);
    } finally { await db.exec("ROLLBACK"); }
  });
});
