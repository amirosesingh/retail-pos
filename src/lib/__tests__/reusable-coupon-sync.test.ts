import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
let db: PGlite;
const id = "11111111-1111-4111-8111-111111111111";
const product = "22222222-2222-4222-8222-222222222222";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create table stores(id text primary key, group_id text);
    create function pos_sale_commit(_sale jsonb,_items jsonb,_payments jsonb,_movements jsonb,_member jsonb,_exchange_bill text)
    returns jsonb language plpgsql as $$ declare s jsonb:=_sale; existing_id uuid; begin
      IF existing_id IS NULL THEN return s; end if; return s; end $$;
    create table products(id uuid primary key, owner_store_id text);
    create table promotions(id uuid primary key, title text, promo_type text, min_spend numeric,
      discount_percent numeric, discount_amount numeric, foc_product_id uuid,
      points_per_dollar numeric, tier_rates jsonb, is_active boolean, start_date date,
      end_date date, created_at timestamptz, updated_at timestamptz, row_version bigint, deleted_at text);
    create table sync_change_feed(organization_id text, branch_id text, terminal_id text,
      table_name text, entity_id text, operation text, row_version bigint, tombstone boolean);
    create function pos_sync_bootstrap_scoped(p_branch_id text) returns setof promotions language sql as $$
      select x.* from promotions x where EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=x."foc_product_id"::text AND (NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id)) $$;
    create function pos_sync_counts_scoped(p_branch_id text) returns bigint language sql as $$
      select count(*) from promotions x where EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=x."foc_product_id"::text AND (NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id)) $$;
    create function sync_delete_promotions(p_branch_id text) returns void language sql as $$
      delete from promotions x where EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=x."foc_product_id"::text AND (NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id)) $$;
  `);
  await db.exec(readFileSync("supabase/migrations/20261023160000_reusable_campaign_codes.sql", "utf8"));
  await db.exec("create trigger feed after insert or update or delete on promotions for each row execute function sync_feed_promotions()");
}, 30_000);
afterAll(async () => { await db?.close(); });
it("syncs code scope and cluster, publishes global changes and preserves FOC branch isolation", async () => {
  const row = { id, title: "CLUB-10", promo_type: "code", code_scope: "item", code_cluster_id: "sports", partner: "Club", is_active: true, row_version: 1 };
  await db.query("select sync_apply_promotions($1::jsonb)", [JSON.stringify([row])]);
  expect((await db.query("select code_scope,code_cluster_id from promotions")).rows).toEqual([{ code_scope: "item", code_cluster_id: "sports" }]);
  expect((await db.query("select branch_id from sync_change_feed")).rows).toEqual([{ branch_id: "global" }]);
  await db.exec("insert into stores values('A','sports'),('B','other')");
  const sale = { coupon_promo_id: id, coupon_code: "CLUB-10", coupon_scope: "item", store_id: "B" };
  await expect(db.query("select pos_sale_commit($1::jsonb,null,null,null,null,null)", [JSON.stringify(sale)])).rejects.toThrow("REUSABLE_CODE_NOT_VALID");
  await expect(db.query("select pos_sale_commit($1::jsonb,null,null,null,null,null)", [JSON.stringify({ ...sale, store_id: "A" })])).resolves.toBeDefined();
  await db.query("insert into products values($1,'A')", [product]);
  await db.query("insert into promotions(id,title,promo_type,foc_product_id) values(gen_random_uuid(),'Gift','foc',$1)", [product]);
  expect((await db.query("select * from pos_sync_bootstrap_scoped('B')")).rows).toHaveLength(1);
  expect((await db.query("select * from pos_sync_bootstrap_scoped('A')")).rows).toHaveLength(2);
  expect((await db.query("select pos_sync_counts_scoped('B') as n")).rows[0]).toEqual({ n: 1 });
  await db.query("select sync_apply_promotions($1::jsonb)", [JSON.stringify([{ ...row, code_scope: "bill", code_cluster_id: null, row_version: 2 }])]);
  expect((await db.query("select code_cluster_id from promotions where id=$1", [id])).rows[0]).toEqual({ code_cluster_id: null });
  await expect(db.query("insert into promotions(id,title,promo_type) values(gen_random_uuid(),'club-10','code')")).rejects.toThrow();
  await db.exec("select sync_delete_promotions('B')");
  expect((await db.query("select title from promotions")).rows).toEqual([{ title: "Gift" }]);
});
