import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { managementEcommerceContext } from "../ecommerce-device";
import { redactSyncDownload } from "../sync-download-redaction";
it("makes commerce available only on management web or registered management devices", () => {
 expect(managementEcommerceContext("web",false,false)).toBe(true);
 expect(managementEcommerceContext("web",true,false)).toBe(false);
 expect(managementEcommerceContext("electron",true,false)).toBe(false);
 expect(managementEcommerceContext("android",true,false)).toBe(false);
 expect(managementEcommerceContext("electron",true,true)).toBe(true);
 expect(managementEcommerceContext("ios",true,true)).toBe(true);
});
it("strips branch product commerce fields but preserves normal trading data and management copies", () => {
 const rows=[{table_name:"products",row_data:{id:"p",selling_price:12,stock_by_store:{a:4},ecom_price:25,ecom_visible:true}}];
 expect(redactSyncDownload(rows)).toEqual([{table_name:"products",row_data:{id:"p",selling_price:12,stock_by_store:{a:4}}}]);
 expect(redactSyncDownload(rows,"",true)).toEqual(rows);
 expect(redactSyncDownload({integration_settings:{ecommerceEnabled:true,country:"BN"}},"pos_settings")).toEqual({integration_settings:{country:"BN"}});
 const price={key:"product_price:p",value:{selling_price:12,ecom_price:25}};
 expect(redactSyncDownload(price,"settings_scoped")).toEqual({key:"product_price:p",value:{selling_price:12}});
 expect(redactSyncDownload(price,"settings_scoped",true)).toEqual(price);
});
it("branch product sync preserves current commerce values and creates unpublished products", async () => {
 const db=new PGlite();try {
  await db.exec(`create role anon;create role authenticated;
 create table public_flags(key text primary key,enabled boolean,updated_at timestamptz);
 create table pos_settings(id int primary key,integration_settings jsonb,row_version int);
 CREATE FUNCTION sync_apply_pos_settings(p_rows jsonb) RETURNS integer LANGUAGE plpgsql AS $body$
 BEGIN INSERT INTO pos_settings(id,integration_settings,row_version) SELECT id,integration_settings,row_version FROM jsonb_populate_recordset(NULL::public.pos_settings,p_rows)
 ON CONFLICT(id) DO UPDATE SET integration_settings=EXCLUDED.integration_settings,row_version=EXCLUDED.row_version;RETURN 1;END $body$;
 create table settings_scoped(scope text,scope_id text,key text,value jsonb,row_version int,primary key(scope,scope_id,key));
 CREATE FUNCTION sync_apply_settings_scoped(p_rows jsonb) RETURNS integer LANGUAGE plpgsql AS $body$
 BEGIN
  INSERT INTO public."settings_scoped" ("scope","scope_id","key","value","row_version")
  SELECT "scope","scope_id","key","value","row_version" FROM jsonb_populate_recordset(NULL::public."settings_scoped",p_rows)
  ON CONFLICT ("scope","scope_id","key") DO UPDATE SET "value"=EXCLUDED."value","row_version"=EXCLUDED."row_version";RETURN 1;END $body$;
 create table products(id text primary key,selling_price numeric,ecom_price numeric,ecom_visible boolean not null default true,row_version int);
 CREATE FUNCTION sync_apply_products(p_rows jsonb) RETURNS integer LANGUAGE plpgsql AS $body$
 DECLARE v_count integer;
 BEGIN
  INSERT INTO public."products" ("id","selling_price","ecom_price","ecom_visible","row_version")
  SELECT "id","selling_price","ecom_price","ecom_visible","row_version" FROM jsonb_populate_recordset(NULL::public."products",p_rows)
  ON CONFLICT ("id") DO UPDATE SET "selling_price"=EXCLUDED."selling_price","ecom_price"=EXCLUDED."ecom_price","ecom_visible"=EXCLUDED."ecom_visible","row_version"=EXCLUDED."row_version" WHERE EXCLUDED."row_version">public."products"."row_version";
 GET DIAGNOSTICS v_count=ROW_COUNT;RETURN v_count;END $body$;
 insert into products values('p',10,30,true,1);`);
  const sql=readFileSync("supabase/migrations/20261026114000_preserve_management_ecommerce_during_branch_sync.sql","utf8");
  await db.exec(sql);await db.exec(sql);
  expect((await db.query<{enabled:boolean}>("select enabled from public_flags where key='management_commerce_isolation_ready'")).rows[0].enabled).toBe(true);
  await db.query("select sync_apply_products($1::jsonb)",[JSON.stringify([{id:"p",selling_price:12,ecom_price:1,ecom_visible:false,row_version:2},{id:"new",selling_price:5,ecom_price:100,ecom_visible:true,row_version:1}])]);
  await db.query("insert into settings_scoped values('BRANCH','a','product_price:p',$1::jsonb,1)",[JSON.stringify({selling_price:12,ecom_price:40})]);
  await db.query("select sync_apply_settings_scoped($1::jsonb)",[JSON.stringify([{scope:"BRANCH",scope_id:"a",key:"product_price:p",value:{selling_price:15,ecom_price:1},row_version:2}])]);
  expect((await db.query<{value:unknown}>("select value from settings_scoped")).rows[0].value).toEqual({selling_price:15,ecom_price:40});
  await db.query("update settings_scoped set value=$1::jsonb",[JSON.stringify({selling_price:17})]);
  expect((await db.query<{value:unknown}>("select value from settings_scoped")).rows[0].value).toEqual({selling_price:17,ecom_price:40});
  await db.query("insert into settings_scoped values('GLOBAL','','pos_field:integration_settings',$1::jsonb,1)",[JSON.stringify({ecommerceEnabled:false,country:"BN"})]);
  await db.query("select sync_apply_settings_scoped($1::jsonb)",[JSON.stringify([{scope:"GLOBAL",scope_id:"",key:"pos_field:integration_settings",value:{ecommerceEnabled:true,country:"MY"},row_version:2}])]);
  expect((await db.query<{value:unknown}>("select value from settings_scoped where key='pos_field:integration_settings'")).rows[0].value).toEqual({ecommerceEnabled:false,country:"MY"});
  await db.query("insert into pos_settings values(1,$1::jsonb,1)",[JSON.stringify({ecommerceEnabled:false,country:"BN"})]);
  await db.query("select sync_apply_pos_settings($1::jsonb)",[JSON.stringify([{id:1,integration_settings:{ecommerceEnabled:true,country:"MY"},row_version:2}])]);
  expect((await db.query<{integration_settings:unknown}>("select integration_settings from pos_settings")).rows[0].integration_settings).toEqual({ecommerceEnabled:false,country:"MY"});
  await db.query("update pos_settings set integration_settings=$1::jsonb",[JSON.stringify({country:"SG"})]);
  expect((await db.query<{integration_settings:unknown}>("select integration_settings from pos_settings")).rows[0].integration_settings).toEqual({ecommerceEnabled:false,country:"SG"});
  const {rows}=await db.query("select * from products order by id");
  expect(rows).toEqual([{id:"new",selling_price:"5",ecom_price:null,ecom_visible:false,row_version:1},{id:"p",selling_price:"12",ecom_price:"30",ecom_visible:true,row_version:2}]);
 } finally {await db.close();}
});
