import { beforeAll, afterAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
let db: PGlite;
beforeAll(async () => {
 db = new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TYPE public.app_role AS ENUM ('admin','manager','staff');
 CREATE TABLE app_users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id text UNIQUE,full_name text,email text,role app_role,role_slug text,store_id text,is_active boolean,auth_user_id uuid,pin_length smallint,permissions jsonb);
 CREATE TABLE cashiers(username text,is_active boolean,pin_hash text,last_login_at timestamptz);
 CREATE TABLE user_roles(user_id uuid,role app_role);
 CREATE FUNCTION staff_account_upsert(text,text,text,app_role,text,text,boolean,text,smallint,uuid,jsonb) RETURNS void LANGUAGE sql AS $$ UPDATE app_users SET full_name=$2,email=$3,role=$4,role_slug=$5,store_id=$6,is_active=$7 WHERE user_id=$1; $$;
 CREATE FUNCTION staff_account_set_terminal_pin(text,text) RETURNS void LANGUAGE sql AS $$ SELECT; $$;
 INSERT INTO app_users(user_id,role,is_active,auth_user_id,permissions) VALUES ('admin','admin',true,'11111111-1111-4111-8111-111111111111','{"can_sell":true}'),('cashier','staff',true,'22222222-2222-4222-8222-222222222222','{}');`);
 await db.exec(readFileSync('supabase/migrations/20261019102437_staff_login_alias_and_profile_edit.sql','utf8'));
});
afterAll(async () => { await db.close(); });
it('reserves aliases against canonical names case insensitively',async()=>{
 await db.exec("UPDATE app_users SET login_username='NewAdmin' WHERE user_id='admin'");
 await expect(db.exec("UPDATE app_users SET login_username='NEWADMIN' WHERE user_id='cashier'")).rejects.toThrow('already in use');
 await expect(db.exec("UPDATE app_users SET login_username='ADMIN' WHERE user_id='cashier'")).rejects.toThrow('already in use');
});
it('preserves account identity and permissions on edit',async()=>{
 await db.exec("SELECT staff_account_edit('cashier','newcashier','New Name','staff@example.com','staff','cashier','branch-a',true,'22222222-2222-4222-8222-222222222222',NULL)");
 const {rows}=await db.query("SELECT user_id,login_username,store_id,permissions FROM app_users WHERE user_id='cashier'");
 expect(rows[0]).toEqual({user_id:'cashier',login_username:'newcashier',store_id:'branch-a',permissions:{}});
});
it('refuses to disable the last active admin',async()=>{
 await expect(db.exec("SELECT staff_account_edit('admin','newadmin','Admin','admin@example.com','admin','admin',NULL,false,'11111111-1111-4111-8111-111111111111',NULL)")).rejects.toThrow('last active administrator');
});
it('allows only service role to invoke edits',async()=>{
 const {rows}=await db.query("SELECT has_function_privilege('anon','staff_account_edit(text,text,text,text,app_role,text,text,boolean,uuid,text)','EXECUTE') AS anon,has_function_privilege('authenticated','staff_account_edit(text,text,text,text,app_role,text,text,boolean,uuid,text)','EXECUTE') AS authenticated,has_function_privilege('service_role','staff_account_edit(text,text,text,text,app_role,text,text,boolean,uuid,text)','EXECUTE') AS service");
 expect(rows[0]).toEqual({anon:false,authenticated:false,service:true});
});
