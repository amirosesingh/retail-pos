// Isolated PostgreSQL regression of the actual owner-preservation migration.
// No connector, production URL, credential or live database is used.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const root = new URL("../", import.meta.url);
const migration = await readFile(new URL("supabase/migrations/20261029064933_preserve_product_owner_on_stale_sync.sql", root), "utf8");
const db = new PGlite();
let checks = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
try {
  await db.exec(`CREATE TABLE public.products(id integer PRIMARY KEY,owner_store_id text,row_version bigint,
    selling_price numeric,cost_price numeric,ecom_price numeric,ecom_visible boolean,
    stock_quantity numeric,stock_by_store jsonb,is_archived boolean);
    CREATE FUNCTION public.sync_apply_products(p_rows jsonb) RETURNS integer LANGUAGE plpgsql AS $$
    DECLARE v_count integer; BEGIN
      INSERT INTO public."products"(id,owner_store_id,row_version,selling_price,cost_price,ecom_price,ecom_visible,stock_quantity,stock_by_store,is_archived)
      SELECT id,owner_store_id,row_version,selling_price,cost_price,NULL::numeric,false,stock_quantity,stock_by_store,is_archived
      FROM jsonb_populate_recordset(NULL::public.products,p_rows)
      ON CONFLICT(id) DO UPDATE SET "owner_store_id"=EXCLUDED."owner_store_id",
      "row_version"=EXCLUDED."row_version","selling_price"=EXCLUDED."selling_price","cost_price"=EXCLUDED."cost_price",
      "is_archived"=EXCLUDED."is_archived" WHERE EXCLUDED."row_version">public."products"."row_version";
      GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count; END $$;
    INSERT INTO products VALUES(1,'STR1',10,19.95,7.25,25,true,0,'{"STR1":0}',true),
      (2,NULL,10,19.95,7.25,25,true,0,'{"STR1":0}',true);`);
  const definition = async () => (await db.query("SELECT pg_get_functiondef('public.sync_apply_products(jsonb)'::regprocedure) def")).rows[0].def;
  const before = await definition();
  await db.exec(migration);
  const protectedDefinition = await definition();
  check(protectedDefinition.includes('"owner_store_id"=COALESCE(NULLIF(btrim(EXCLUDED."owner_store_id"),\'\'),public."products"."owner_store_id")'),true,"migration protects only owner assignment");
  check(protectedDefinition.replace('"owner_store_id"=COALESCE(NULLIF(btrim(EXCLUDED."owner_store_id"),\'\'),public."products"."owner_store_id")','"owner_store_id"=EXCLUDED."owner_store_id"'),before,"all other routine behavior remains exact");
  await db.exec(migration);
  check(await definition(),protectedDefinition,"migration is idempotent");
  const row = async id => (await db.query("SELECT to_jsonb(p) data FROM products p WHERE id=$1",[id])).rows[0].data;
  const apply = async (id,owner,version,price=29.95) => {
    const original = await row(id);
    const input = { ...original,id,owner_store_id:owner,row_version:version,selling_price:price,
      stock_quantity:987,stock_by_store:{FOREIGN:987},ecom_price:999,ecom_visible:false };
    return (await db.query("SELECT sync_apply_products($1::jsonb) n",[JSON.stringify([input])])).rows[0].n;
  };
  const baseline = await row(1);
  check(await apply(1,null,11),1,"newer null-owner upload still applies legitimate price update");
  check((await row(1)).owner_store_id,"STR1","null upload preserves repaired owner");
  check((await row(1)).selling_price,29.95,"legitimate sale price update remains");
  for (const field of ["stock_quantity","stock_by_store","is_archived","ecom_price","ecom_visible"])
    check((await row(1))[field],baseline[field],`${field} preserved on legacy upload`);
  check(await apply(1,"   ",12,31),1,"newer whitespace-owner upload remains valid");
  check((await row(1)).owner_store_id,"STR1","blank upload preserves owner");
  check(await apply(1,"OTHER",12,99),0,"equal revision rejected");
  check(await apply(1,"OTHER",11,99),0,"older revision rejected");
  check((await row(1)).selling_price,31,"rejected upload does not update price");
  check(await apply(1,"STR2",13),1,"explicit nonblank reassignment semantics preserved");
  check((await row(1)).owner_store_id,"STR2","nonblank owner is not silently replaced with old owner");
  check(await apply(2,"STR1",11),1,"existing unowned product accepts explicit initial owner");
  check((await row(2)).owner_store_id,"STR1","initial owner assigned");
  const newRows=[{id:3,owner_store_id:"STR1",row_version:1,selling_price:3,cost_price:1,stock_quantity:2,stock_by_store:{STR1:2},is_archived:false},
    {id:4,owner_store_id:null,row_version:1,selling_price:4,cost_price:1,stock_quantity:0,stock_by_store:{STR1:0},is_archived:true}];
  check((await db.query("SELECT sync_apply_products($1::jsonb) n",[JSON.stringify(newRows)])).rows[0].n,2,"new inserts unaffected");
  check((await row(3)).owner_store_id,"STR1","new nonblank owner preserved");
  check((await row(4)).owner_store_id,null,"new null-owner insertion retains prior semantics");

  const generator=await readFile(new URL("scripts/generate-supabase-sync-contract.cjs",root),"utf8");
  check(generator.includes('table.cloudTable === "products" && column.cloudColumn === "owner_store_id"'),true,"generator protection is product-owner specific");
  check(generator.includes('"owner_store_id"=COALESCE(NULLIF(btrim(EXCLUDED."owner_store_id"),\'\'),public."products"."owner_store_id")'),true,"generator retains protected assignment");
  const operations=await readFile(new URL("electron/db/repositories/operations.cjs",root),"utf8");
  check(operations.includes('op.table === "products" && column === "owner_store_id"'),true,"local protection is product-only");
  check(operations.includes("target.[owner_store_id]=COALESCE(NULLIF(LTRIM(RTRIM(source.[owner_store_id])),N''),target.[owner_store_id])"),true,"local upsert preserves owner on null/blank upload");
  const pull=await readFile(new URL("electron/sync/cloud-client.cjs",root),"utf8");
  check(pull.includes('`target.[${name}]=source.[${name}]`'),true,"cloud pull keeps authoritative incoming assignments");
  check(pull.includes("target.[owner_store_id]=COALESCE"),false,"cloud pull does not acquire upload-only owner coalesce");
  console.log(`${checks} isolated product owner sync checks passed. No live database accessed.`);
} finally { await db.close(); }
