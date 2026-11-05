import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const path = "supabase/migrations/20261026162030_isolate_cluster_catalogue_reads.sql";
const canonical = readFileSync("supabase/schema.sql", "utf8");
function definition(name: string, first = false) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...canonical.matchAll(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${escaped}\\([\\s\\S]*?AS (\\$[a-zA-Z_]*\\$)[\\s\\S]*?\\1;`, "g"))];
  const found = first ? matches[0] : matches.at(-1);
  if (!found) throw new Error(`Missing canonical function: ${name}`);
  return found[0];
}

it("isolates cluster product reads without changing ownership, writes, or sponsorship amounts", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'::text$$;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT null::uuid$$;
      CREATE TABLE public.app_users(id uuid,auth_user_id uuid,is_active boolean,role text,permissions jsonb,store_id text);
      CREATE TABLE public.stores(id text PRIMARY KEY,group_id text,private_catalogue boolean DEFAULT false);
      CREATE TABLE public.pos_settings(integration_settings jsonb);
      CREATE TABLE public.settings_scoped(scope text,scope_id text,key text,value jsonb);
      CREATE TABLE public.products(id uuid PRIMARY KEY,owner_store_id text,stock_by_store jsonb,row_version integer DEFAULT 1);
      CREATE TABLE public.stock_transfers(id uuid PRIMARY KEY,to_store_id text,status text,posted_at timestamptz);
      CREATE TABLE public.stock_transfer_items(transfer_id uuid,product_id uuid,quantity_verified numeric,quantity_received numeric);
      CREATE TABLE public.product_barcodes(id uuid,product_id uuid,row_version integer);
      CREATE TABLE public.promotions(id uuid,foc_product_id uuid,row_version integer);
      CREATE FUNCTION public.is_staff_now() RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
      CREATE FUNCTION public.user_has_store_access(p_store text) RETURNS boolean LANGUAGE sql AS $$SELECT p_store=current_setting('test.branch',true)$$;
      CREATE FUNCTION public.pos_sync_validate_scope(text,text,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN END$$;
      INSERT INTO public.stores VALUES ('A','sports',true),('B','sports',true),('C','apparel',true),('D',null,false);
      INSERT INTO public.products(id,owner_store_id,stock_by_store) VALUES
       ('00000000-0000-4000-8000-000000000001','A','{"A":0}'),
       ('00000000-0000-4000-8000-000000000002','C','{"C":0}'),
       ('00000000-0000-4000-8000-000000000003',null,'{"A":2}'),
       ('00000000-0000-4000-8000-000000000004',null,'{"A":0,"B":0}'),
       ('00000000-0000-4000-8000-000000000005',null,'{"A":"invalid"}');`);
    // Use the real deployed function bodies: the migration aborts if any exact
    // read contract has changed, rather than broad rewriting arbitrary SQL.
    await db.exec(definition("pos_sync_bootstrap", true).replace("public.pos_sync_bootstrap(", "public.pos_sync_bootstrap_scoped("));
    await db.exec(definition("pos_sync_counts", true).replace("public.pos_sync_counts(", "public.pos_sync_counts_scoped("));
    await db.exec(definition("pos_sync_pull"));
    // Sponsorship depends on many accounting types. Its exact inspected guard
    // is enough for this narrow migration test; financial body is not changed.
    await db.exec(`CREATE FUNCTION public.prepare_sponsorship(p_id uuid,p_store text,p_recipient text,p_contact text,p_purpose text,p_lines jsonb,p_actor text)
      RETURNS boolean LANGUAGE plpgsql AS $$DECLARE product public.products; BEGIN
       SELECT * INTO product FROM public.products WHERE id=p_id;
       IF product.owner_store_id IS NOT NULL AND product.owner_store_id<>p_store THEN RAISE EXCEPTION 'A selected product belongs to another private catalogue'; END IF;
       RETURN true; END$$;`);
    await db.exec(definition("sync_feed_products"));
    await db.exec(definition("sync_feed_product_barcodes"));
    await db.exec(definition("sync_feed_promotions"));
    const migration = readFileSync(path, "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const available = async (id: number, branch: string) => (await db.query<{v:boolean}>(
      `SELECT public.product_available_in_catalogue($1::uuid,$2) v`,
      [`00000000-0000-4000-8000-${String(id).padStart(12,"0")}`,branch])).rows[0].v;
    expect(await available(1,"A")).toBe(true);
    expect(await available(1,"B")).toBe(true);
    expect(await available(1,"C")).toBe(false);
    expect(await available(1,"missing")).toBe(false);
    expect(await available(3,"B")).toBe(true);
    expect(await available(3,"C")).toBe(false);
    expect(await available(4,"B")).toBe(false);
    expect(await available(5,"B")).toBe(false);
    await db.exec(`INSERT INTO public.pos_settings VALUES ('{"branches":{"D":{"privateCatalogue":true}}}')`);
    expect((await db.query<{v:boolean}>(`SELECT public.branch_catalogue_is_private('D') v`)).rows[0].v).toBe(true);
    await db.exec(`INSERT INTO public.stock_transfers VALUES ('10000000-0000-4000-8000-000000000001','B','received',null);
      INSERT INTO public.stock_transfer_items VALUES ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',1,1);`);
    expect(await available(2,"A")).toBe(false);
    await db.exec(`UPDATE public.stock_transfers SET status='completed',posted_at=now()`);
    expect(await available(2,"A")).toBe(true); // stock remains zero, proof persists
    const projection=async(id:number)=>(await db.query<{ids:string[]}>(
      `SELECT catalogue_store_ids ids FROM public.products WHERE id=$1::uuid`,
      [`00000000-0000-4000-8000-${String(id).padStart(12,"0")}`])).rows[0].ids;
    expect(await projection(2)).toEqual(["B"]);
    await db.exec(`INSERT INTO public.stock_transfer_items VALUES ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',1,1)`);
    expect(await projection(2)).toEqual(["B"]); // repeated items do not duplicate destinations
    await db.exec(`UPDATE public.products SET catalogue_store_ids=ARRAY['C'] WHERE id='00000000-0000-4000-8000-000000000001'`);
    expect(await projection(1)).toEqual([]); // caller-supplied proof is overwritten
    expect(await available(1,"C")).toBe(false);
    await db.exec(`UPDATE public.stock_transfer_items SET quantity_verified=0`);
    expect(await available(2,"A")).toBe(false); // received is not a fallback for explicit verified zero
    expect(await projection(2)).toEqual([]);
    await db.exec(`UPDATE public.stock_transfer_items SET quantity_verified=null`);
    expect(await available(2,"A")).toBe(true);
    expect(await projection(2)).toEqual(["B"]);
    await db.exec(`UPDATE public.stock_transfers SET status='cancelled'`);
    expect(await projection(2)).toEqual([]); // reversal revokes the derived projection
    await db.exec(`UPDATE public.stock_transfers SET status='completed'`);
    expect(await projection(2)).toEqual(["B"]);
    await db.exec(`SET test.branch='B'; ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA public TO authenticated; GRANT SELECT ON public.products TO authenticated; SET ROLE authenticated;`);
    expect((await db.query(`SELECT id FROM public.products`)).rows).toHaveLength(3);
    await expect(db.query(`SELECT public.product_available_in_catalogue('00000000-0000-4000-8000-000000000001','A')`)).rejects.toThrow(/permission denied/);
    await expect(db.query(`SELECT public.received_product_catalogue_stores('00000000-0000-4000-8000-000000000001')`)).rejects.toThrow(/permission denied/);
    await db.exec("RESET ROLE");
    expect((await db.query<{v:boolean}>(`SELECT public.prepare_sponsorship('00000000-0000-4000-8000-000000000001','B','','','','[]','') v`)).rows[0].v).toBe(true);
    await expect(db.query(`SELECT public.prepare_sponsorship('00000000-0000-4000-8000-000000000001','C','','','','[]','')`)).rejects.toThrow(/another private catalogue/);
    const bootstrap = (await db.query<{v:{rows:unknown[]}}>(`SELECT public.pos_sync_bootstrap_scoped('default','B','terminal','products',null,90,500) v`)).rows[0].v;
    expect(bootstrap.rows).toHaveLength(3);
    const registry = JSON.parse(readFileSync("database/sqlserver/schema-registry.json", "utf8")) as {
      tables: Array<{cloudTable:string;columns:Array<{primaryKey:boolean;cloudColumn:string;cloudType:string}>}>;
    };
    const existing = new Set(["app_users","stores","products","stock_transfers","stock_transfer_items","product_barcodes","promotions","pos_settings","settings_scoped"]);
    for (const table of registry.tables) {
      if (existing.has(table.cloudTable)) continue;
      const fields=table.columns.filter(column=>column.primaryKey).map(column=>`"${column.cloudColumn}" ${column.cloudType}`);
      await db.exec(`CREATE TABLE IF NOT EXISTS public."${table.cloudTable}" (${fields.join(",")})`);
    }
    await db.exec(`ALTER TABLE public.pos_settings ADD COLUMN id integer;
      ALTER TABLE public.stock_transfer_items ADD COLUMN id uuid;
      CREATE TABLE public.sync_change_feed(cursor bigint,organization_id text,branch_id text,terminal_id text,table_name text,entity_id text,operation text,row_version bigint,tombstone boolean);
      INSERT INTO public.sync_change_feed VALUES
      (1,'default','global',null,'products','{"id":"00000000-0000-4000-8000-000000000001"}','update',1,false),
      (2,'default','global',null,'products','{"id":"00000000-0000-4000-8000-000000000004"}','update',1,false);`);
    const deltas=await db.query<{cursor:number;row_data:unknown}>(`SELECT * FROM public.pos_sync_pull('default','B','terminal',0,50)`);
    expect(deltas.rows).toHaveLength(2);
    expect(deltas.rows[0].row_data).not.toBeNull();
    expect(deltas.rows[1].row_data).toBeNull(); // cursor advances without leaking another catalogue's values
    // The original owner is preserved; no data backfill is performed.
    expect((await db.query<{n:number}>(`SELECT count(*)::int n FROM public.products WHERE owner_store_id IS NULL`)).rows[0].n).toBe(3);
  } finally { await db.close(); }
});
