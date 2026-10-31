import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../../', import.meta.url);
export const migrationPath = 'supabase/migrations/20261031042447_atomic_transfer_dispatch_and_verified_native_actor.sql';
export const migration = await readFile(new URL(migrationPath,root),'utf8');
const schema = (await readFile(new URL('supabase/schema.sql',root),'utf8')).split('-- TRF15_ATOMIC_DISPATCH_BEGIN')[0];
const nativeApproval = await readFile(new URL('supabase/migrations/20261026231535_verified_native_transfer_approval.sql',root),'utf8');
const warehouse = await readFile(new URL('supabase/migrations/20261008133703_complete_settings_preferences_and_warehouse_dispatch.sql',root),'utf8');
export function sourceFunction(name, source=schema) {
 const start=source.lastIndexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
 if(start<0)return null;
 const delimiter=source.slice(start).match(/\bAS\s+(\$[\w]*\$)/i)?.[1]; assert(delimiter,name);
 const body=source.indexOf(delimiter,start),end=source.indexOf(`${delimiter};`,body+delimiter.length);
 assert(end>body,name); return source.slice(start,end+delimiter.length+1);
}
const tables=['app_users','user_roles','stores','products','pos_settings','settings_scoped','stock_transfers','stock_transfer_items','item_activity_logs','change_history','entity_status_history','sync_change_feed','authorization_actions','activity_events'];
const guardedTables=['products','stock_transfers','stock_transfer_items','item_activity_logs'];
const triggers=[...schema.matchAll(/CREATE TRIGGER\s+\w+[\s\S]*?;/g)].map(m=>m[0]).filter(sql=>guardedTables.some(table=>new RegExp(`ON public\\.\\"?${table}\\"?\\s`).test(sql)));
const functions = new Map();
function dependency(name) {
 if(functions.has(name))return;
 const definition=sourceFunction(name);if(!definition)return;
 functions.set(name,definition);
 for(const match of definition.matchAll(/\b(?:public|private)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)){
  const qualifier=match[0].startsWith('private.')?'private':'public';dependency(`${qualifier}.${match[1]}`);
 }
}
for(const name of ['public.current_app_user','public.has_perm','public.is_staff','public.is_staff_now','public.user_has_store_access','public.may_approve_cross_group_transfer'])dependency(name);
for(const trigger of triggers){const fn=trigger.match(/EXECUTE FUNCTION\s+((?:public|private)\.\w+)\(/)?.[1];assert(fn,trigger);dependency(fn);}
for(const fn of ['public.stock_transfer_approve','public.stock_transfer_dispatch'])dependency(fn);
const tableSql=tables.map(name=>{
 const start=schema.indexOf(`CREATE TABLE IF NOT EXISTS public.${name} (`);assert(start>=0,name);
 return schema.slice(start,schema.indexOf(';',start)+1);
}).join('\n');
const columns=[...schema.matchAll(/ALTER TABLE public\.(\w+)\s+ADD COLUMN IF NOT EXISTS\s+[^;]+;/g)].filter(m=>tables.includes(m[1])).map(m=>m[0]).join('\n');
const quantityConstraints=await readFile(new URL('supabase/migrations/20261007111500_harden_warehouse_transfer_lifecycle.sql',root),'utf8');
export const fixtureSql=`SET check_function_bodies=off;
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE SCHEMA private;
 CREATE TYPE public.app_role AS ENUM('admin','manager','staff');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULLIF(current_setting('test.uid',true),'')::uuid$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT current_setting('test.role',true)$$;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('email',COALESCE(current_setting('test.email',true),''))$$;
 ${tableSql}
 ${columns}
 ALTER TABLE products ADD PRIMARY KEY(id);
 ALTER TABLE stores ADD PRIMARY KEY(id);
 ALTER TABLE app_users ADD PRIMARY KEY(id);
 ALTER TABLE stock_transfers ADD PRIMARY KEY(id);
 ALTER TABLE stock_transfer_items ADD PRIMARY KEY(id);
 ALTER TABLE stock_transfer_items ADD CONSTRAINT stock_transfer_items_transfer_id_fkey FOREIGN KEY(transfer_id) REFERENCES stock_transfers(id) ON DELETE CASCADE;
 ALTER TABLE stock_transfer_items ADD CONSTRAINT stock_transfer_items_product_id_fkey FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL;
 ALTER TABLE activity_events ADD PRIMARY KEY(id),ADD UNIQUE(client_event_id);
 CREATE UNIQUE INDEX status_fixture_client_event ON entity_status_history(client_event_id) WHERE client_event_id IS NOT NULL;
 ${[...functions.values()].join('\n')}
 ${sourceFunction('private.stock_transfer_dispatch',warehouse)}
 ${triggers.join('\n')}
 ${[...quantityConstraints.matchAll(/ALTER TABLE public\.stock_transfer_items ADD CONSTRAINT [^;]+;/g)].map(m=>m[0]).join('\n')}
 ${nativeApproval}
 SET check_function_bodies=on;
`;
export const ids={actor:'11111111-1111-4111-8111-111111111111',foreign:'22222222-2222-4222-8222-222222222222',parent:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',child:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',child2:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',product:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',product2:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'};
export const quote = value=>`'${String(value).replaceAll("'","''")}'`;
export const webIdentity=`SELECT set_config('test.uid','${ids.actor}',false),set_config('test.role','authenticated',false),set_config('test.email','dispatcher@example.test',false);`;
export const nativeIdentity=`SELECT set_config('test.uid','',false),set_config('test.role','service_role',false),set_config('test.email','',false);`;
export const lineSql=(qty=2,product=ids.product)=>quote(JSON.stringify([{product_id:product,qty}]))+'::jsonb';
export const dispatchSql=(qty=2,child=ids.child,native=false)=>native?`SELECT public.stock_transfer_dispatch_atomic_for_staff('${child}','dispatcher','A',${lineSql(qty)}) proof;`:`SELECT public.stock_transfer_dispatch_atomic('${child}','Forged caller label',${lineSql(qty)}) proof;`;
export function seedSql({request=true,stock=10,quantity=3,approved=3,childQuantity=3,cross=false,extra=''}={}) {
 return `SET session_replication_role=replica;
 DO $reset$ BEGIN IF to_regclass('private.transfer_dispatch_receipts') IS NOT NULL THEN TRUNCATE private.transfer_dispatch_receipts; END IF;END $reset$;
 TRUNCATE stock_transfer_items,stock_transfers,products,stores,app_users,user_roles,item_activity_logs,activity_events,entity_status_history,change_history,sync_change_feed,pos_settings,settings_scoped,authorization_actions;
 INSERT INTO stores(id,code,name,group_id) VALUES('A','A','Source','sports'),('B','B','Destination',${quote(cross?'apparel':'sports')}),('C','C','Foreign','other');
 INSERT INTO app_users(id,user_id,full_name,email,role,role_slug,store_id,is_active,auth_user_id,permissions) VALUES
 ('${ids.actor}','dispatcher','Authorized Dispatcher','dispatcher@example.test','staff','warehouse','A',true,'${ids.actor}','{"can_create_transfer":true,"can_approve_transfer":true}'),
 ('${ids.foreign}','foreign','Foreign Operator','foreign@example.test','staff','warehouse','C',true,'${ids.foreign}','{"can_create_transfer":true}');
 INSERT INTO pos_settings(id,integration_settings) VALUES(1,'{}');
 INSERT INTO products(id,name,barcode,sku,owner_store_id,stock_quantity,stock_by_store) VALUES('${ids.product}','Fixture product','FX-1','FXSKU','A',${stock},${quote(JSON.stringify({A:stock,B:0,C:0}))}::jsonb),('${ids.product2}','Other fixture product','FX-2','FXSKU2','A',40,'{"A":40,"B":0,"C":0}');
 ${request?`INSERT INTO stock_transfers(id,ref,kind,status,from_store_id,to_store_id,created_by,approved_by,approved_at) VALUES('${ids.parent}','RQ-FIXTURE','request','approved','A','B','Requester','Request Approver',now());
 INSERT INTO stock_transfer_items(transfer_id,product_id,quantity,quantity_approved) VALUES('${ids.parent}','${ids.product}',${quantity},${approved});`:''}
 INSERT INTO stock_transfers(id,ref,kind,status,from_store_id,to_store_id,created_by,approved_by,approved_at,source_request_id) VALUES('${ids.child}','ST-FIXTURE','transfer','approved','A','B','Request Approver','Independent Approver',now(),${request?quote(ids.parent)+'::uuid':'NULL'});
 INSERT INTO stock_transfer_items(transfer_id,product_id,quantity,quantity_approved) VALUES('${ids.child}','${ids.product}',${childQuantity},${childQuantity});
 ${extra}
 SET session_replication_role=origin;
 ${webIdentity}`;
}
export const triggerNames=triggers.map(sql=>sql.match(/CREATE TRIGGER\s+(\w+)/)[1]);
// Optional ignored, read-only production-definition captures may be installed
// only into this disposable fixture. They contain routine/trigger DDL, no rows.
export async function liveOverlaySql(definitionsPath,helpersPath) {
 const capture=JSON.parse(await readFile(definitionsPath,'utf8'));
 const helpers=JSON.parse(await readFile(helpersPath,'utf8'));
 assert.equal(capture.triggers.length,25);assert.equal(capture.functions.length,26);
 const drops=triggers.map(sql=>{const name=sql.match(/CREATE TRIGGER\s+(\w+)/)[1],table=sql.match(/ON public\.\"?(\w+)\"?\s/)[1];return `DROP TRIGGER IF EXISTS ${name} ON public.${table};`;});
 return {sql:`SET check_function_bodies=off;${drops.join('\n')}\n${helpers.map(f=>f.definition+';').join('\n')}\n${capture.functions.map(f=>f.definition+';').join('\n')}\n${capture.triggers.map(t=>t.definition+';').join('\n')}\nSET check_function_bodies=on;`,names:capture.triggers.map(t=>t.table+':'+t.definition.match(/CREATE TRIGGER\s+(\w+)/)[1])};
}
