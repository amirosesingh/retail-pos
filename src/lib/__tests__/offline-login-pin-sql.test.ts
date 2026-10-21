import { PGlite } from "@electric-sql/pglite";
import {readFileSync} from "node:fs";
import {beforeAll,afterAll,expect,it} from "vitest";
let db:PGlite;
beforeAll(async()=>{
 db=new PGlite();
 // Stub crypt only to test SQL control flow. A separate test checks a real
 // Postgres bcrypt hash against the Electron bcrypt implementation.
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA extensions;
 CREATE FUNCTION extensions.gen_salt(text,int) RETURNS text LANGUAGE sql AS $$ SELECT 'test-salt'::text $$;
 CREATE FUNCTION extensions.crypt(text,text) RETURNS text LANGUAGE sql AS $$ SELECT 'test-hash:'||$1||$2 $$;
 CREATE TABLE app_users(user_id text,full_name text,role_slug text,store_id text,is_active boolean,email text,pin_hash text,updated_at timestamptz);
 CREATE TABLE cashiers(username text,is_active boolean,pin_hash text);
 INSERT INTO app_users VALUES('admin','Admin','admin',NULL,true,'admin@example.com','approval-hash',now()),('cashier','Cashier','cashier','a',true,'cashier@pos-internal.local','approval-hash',now()),('inactive','Inactive','manager','b',false,'inactive@example.com','approval-hash',now());
 INSERT INTO cashiers VALUES('cashier',true,'login-hash');`);
 const sql=readFileSync('supabase/migrations/20261021030000_windows_offline_login_pin.sql','utf8');await db.exec(sql);await db.exec(sql);
});
afterAll(async()=>{await db.close()});
it('provisions only a separate offline verifier, preserving approval credentials',async()=>{
 await db.exec("SELECT set_offline_login_pin('admin','123456')");
 const {rows}=await db.query("SELECT pin_hash,offline_login_pin_hash FROM app_users WHERE user_id='admin'");
 expect(rows[0]).toMatchObject({pin_hash:'approval-hash',offline_login_pin_hash:'test-hash:123456test-salt'});
});
it('rejects disabled, missing, non-email accounts and malformed PINs',async()=>{
 for(const name of ['inactive','missing','cashier']) await expect(db.query('SELECT set_offline_login_pin($1,$2)',[name,'123456'])).rejects.toThrow('active email');
 await expect(db.exec("SELECT set_offline_login_pin('admin','12')")).rejects.toThrow('6 digits');
});
it('keeps online cashier choices branch-scoped and excludes email accounts',async()=>{
 expect((await db.query("SELECT user_id FROM terminal_staff_list('a')")).rows).toEqual([{user_id:'cashier'}]);
 expect((await db.query("SELECT user_id FROM terminal_staff_list('b')")).rows).toEqual([]);
});
it('does not permit public/authenticated direct provisioning',async()=>{
 expect((await db.query("SELECT has_function_privilege('anon','set_offline_login_pin(text,text)','EXECUTE') AS anon,has_function_privilege('authenticated','set_offline_login_pin(text,text)','EXECUTE') AS authenticated,has_function_privilege('service_role','set_offline_login_pin(text,text)','EXECUTE') AS service")).rows[0]).toEqual({anon:false,authenticated:false,service:true});
});
