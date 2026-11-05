import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect,it } from "vitest";
const read=(name:string)=>readFileSync(`supabase/migrations/${name}.sql`,"utf8");
it("rechecks the verified native approver, policy and source branch without changing stock or JWT approval",async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create schema private;create schema auth;
   create function auth.role() returns text language sql as $$select current_setting('test.role',true)$$;
   create table app_users(id uuid primary key,user_id text,full_name text,role text,role_slug text,store_id text,email text,permissions jsonb,is_active boolean);
   create table authorization_actions(id uuid primary key default gen_random_uuid(),action_key text,scope_type text,scope_id text,is_enabled boolean,allowed_roles text[],allowed_user_ids text[]);
   create table stock_transfers(id uuid primary key,ref text,status text,from_store_id text,to_store_id text,created_by text,approved_by text,approved_at timestamptz,rejected_reason text,cancelled_reason text,discrepancy_reason text,dispatched_at text,closed_at text,received_at timestamptz,verified_at timestamptz);
   create table stock_transfer_items(transfer_id uuid,product_id uuid,quantity int,quantity_approved int);
   create function current_app_user() returns setof public.app_users language sql as $$select * from public.app_users where user_id=current_setting('test.jwt_actor',true)$$;
   create function has_perm(flag text) returns boolean language sql as $$select coalesce((select permissions->flag='true'::jsonb from public.current_app_user()),false)$$;
   create function is_supervisor_now() returns boolean language sql as $$select false$$;
   create function is_cross_group_transfer(text,text) returns boolean language sql as $$select $1<>$2$$;
   insert into app_users values
   ('11111111-1111-4111-8111-111111111111','selected','Selected','staff','cashier','A','', '{"can_approve_transfer":true}',true),
   ('22222222-2222-4222-8222-222222222222','other','Other','manager','supervisor',null,'', '{"can_approve_transfer":true}',true);
   insert into authorization_actions(action_key,scope_type,scope_id,is_enabled,allowed_roles,allowed_user_ids) values('cross_group_transfer_approval','global','',true,'{}',array['selected']);
   insert into stock_transfers(id,ref,status,from_store_id,to_store_id,created_by) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','T','awaiting_approval','A','B','Requester');
   insert into stock_transfer_items values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',5,null);`);
  await db.exec(read("20261026161839_honor_configured_cross_cluster_transfer_approvers"));
  const schema=readFileSync("supabase/schema.sql","utf8");
  const start=schema.lastIndexOf("CREATE OR REPLACE FUNCTION public.stock_transfers_enforce_lifecycle()");
  const end=schema.indexOf("$function$;",start)+"$function$;".length;
  await db.exec(schema.slice(start,end));
  await db.exec("create trigger lifecycle before update on stock_transfers for each row execute function stock_transfers_enforce_lifecycle()");
  const native=read("20261026231535_verified_native_transfer_approval");
  await db.exec(native);
  await db.exec(native); // Repeatable deployment.
  const approve=(user="selected",bound="A")=>db.query("select stock_transfer_approve_for_staff('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',$1,$2,null)",[user,bound]);
  await db.exec("select set_config('test.role','authenticated',false)");
  await db.exec("select set_config('pos.native_approval_staff','selected',false);select set_config('pos.native_approval_transfer','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false)");
  expect((await db.query<{allowed:boolean}>("select may_approve_cross_group_transfer() as allowed")).rows[0].allowed).toBe(false);
  await db.exec("select set_config('pos.native_approval_staff','',false);select set_config('pos.native_approval_transfer','',false)");
  await expect(approve()).rejects.toThrow("Verified native staff session required");
  expect((await db.query<{allowed:boolean}>("select has_function_privilege('authenticated','stock_transfer_approve_for_staff(uuid,text,text,jsonb)','execute') as allowed")).rows[0].allowed).toBe(false);
  await db.exec("select set_config('test.role','service_role',false)");
  await expect(approve("other")).rejects.toThrow("Independent configured");
  await expect(approve("selected","B")).rejects.toThrow("sending location");
  await expect(approve("missing")).rejects.toThrow("permission required");
  await db.exec("update app_users set permissions='{}' where user_id='selected'");
  await expect(approve()).rejects.toThrow("permission required");
  await db.exec("update app_users set permissions='{\"can_approve_transfer\":true}',is_active=false where user_id='selected'");
  await expect(approve()).rejects.toThrow("permission required");
  await db.exec("update app_users set is_active=true where user_id='selected';update stock_transfers set created_by='selected'");
  await expect(approve()).rejects.toThrow("Independent configured");
  await db.exec("update stock_transfers set created_by='Requester'");
  await approve();
  expect((await db.query<{status:string;approved_by:string}>("select status,approved_by from stock_transfers")).rows[0]).toEqual({status:"approved",approved_by:"Selected"});
  expect((await db.query<{quantity_approved:number}>("select quantity_approved from stock_transfer_items")).rows[0].quantity_approved).toBe(5);
  expect((await db.query<{actor:string}>("select current_setting('pos.native_approval_staff',true) as actor")).rows[0].actor).toBe("");
  await expect(approve()).rejects.toThrow("not waiting");
  await db.exec("insert into stock_transfers(id,ref,status,from_store_id,to_store_id,created_by) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','S','awaiting_approval','A','A','Other')");
  await db.query("select stock_transfer_approve_for_staff('cccccccc-cccc-4ccc-8ccc-cccccccccccc','other','A',null)");
  expect((await db.query<{status:string}>("select status from stock_transfers where ref='S'")).rows[0].status).toBe("approved");
  await db.exec("select set_config('test.role','authenticated',false);select set_config('test.jwt_actor','selected',false)");
  expect((await db.query<{allowed:boolean}>("select may_approve_cross_group_transfer() as allowed")).rows[0].allowed).toBe(true);
 }finally{await db.close();}
});
