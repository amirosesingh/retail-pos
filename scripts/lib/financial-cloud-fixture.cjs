// Test-only complete actual-writer bootstrap. Never reads POS profiles or URLs.
const assert=require('node:assert/strict');
const{readFileSync}=require('node:fs');const{resolve,dirname}=require('node:path');
const{randomUUID,createHash}=require('node:crypto');const Module=require('node:module');
const root=resolve(__dirname,'../..');const read=async p=>readFileSync(resolve(root,p),'utf8');
async function createFullFinancialCloud({db:suppliedDb,terminal=randomUUID(),author=randomUUID(),manager=randomUUID(),admin=randomUUID(),shift=randomUUID(),product=randomUUID(),actualSaleDefinition=false,upgradeSql=null,capturedActual=false}={}){
 const schema=(await read('supabase/schema.sql')).replaceAll('\r\n','\n');
 function fn(name){const start=schema.lastIndexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');assert(start>=0,name);const tail=schema.slice(start),tag=tail.match(/\bAS\s+(\$[\w]*\$)/i)?.[1],first=tail.indexOf(tag),end=tail.indexOf(tag+';',first+tag.length);assert(end>first);return tail.slice(0,end+tag.length+1);}
 function table(name){const start=schema.indexOf('CREATE TABLE IF NOT EXISTS public.'+name+' (');assert(start>=0,name);return schema.slice(start,schema.indexOf('\n);',start)+3);}
 const helperPath=require.resolve('./shift-protocol-integration-fixture.cjs');let{createCloud}=require(helperPath);
 if(suppliedDb){const source=await read('scripts/lib/shift-protocol-integration-fixture.cjs'),anchor="const db = new PGlite(), schema = read('supabase/schema.sql');";assert(source.includes(anchor));const module=new Module(helperPath);module.filename=helperPath;module.paths=Module._nodeModulePaths(dirname(helperPath));module.__financialFixture=suppliedDb;module._compile(source.replace(anchor,"const db = module.__financialFixture, schema = read('supabase/schema.sql');"),helperPath);createCloud=module.exports.createCloud;}
 const db=await createCloud('A',terminal,{financialRolloutStub:false});
 try{
 await db.exec("INSERT INTO stores VALUES('A','A'),('B','B');ALTER TABLE terminal_tokens ADD management_sync_enabled boolean DEFAULT false;SET pos.shift_fn='on'");
 await db.query("INSERT INTO shifts(id,store_id,terminal_id,status,state,opening_float,row_version,opened_at) VALUES($1,'A',$2,'OPEN','ACTIVE',20,1,now())",[shift,terminal]);await db.exec("SET pos.shift_fn=''");
 const captures=JSON.parse(await read('scripts/fixtures/management-shift-read-validators.json'));for(const row of captures){assert.equal(createHash('sha256').update(row.definition).digest('hex'),row.sha256);await db.exec(row.definition);}
 if(!upgradeSql)for(const path of['shift-financial-math-postgres.sql','shift-financial-cloud-receipts.sql','shift-financial-version-receipts.sql','shift-financial-known-basis.sql','shift-financial-opening-origin.sql','shift-financial-admission.sql','shift-financial-operation-history.sql'])await db.exec(await read('scripts/preparation/'+path));
 for(const name of['products','stock_delta_applied','item_activity_logs','members'])await db.exec(table(name));
 await db.exec('ALTER TABLE products ADD PRIMARY KEY(id);ALTER TABLE item_activity_logs ADD PRIMARY KEY(id);ALTER TABLE stock_delta_applied ADD PRIMARY KEY(movement_id);ALTER TABLE sale_items ADD COLUMN refunded_qty integer NOT NULL DEFAULT 0;');
 await db.exec("CREATE TYPE public.app_role AS ENUM('admin','manager','staff');CREATE TABLE public.user_roles(user_id uuid,role public.app_role);ALTER TABLE app_users ALTER COLUMN role TYPE public.app_role USING role::public.app_role;ALTER TABLE app_users ADD COLUMN full_name text,ADD COLUMN email text;CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;");
 for(const name of['current_app_user','is_app_supervisor','is_supervisor_now','user_store_id','store_visible','is_staff','is_staff_now','has_perm','user_has_store_access','stock_apply_delta','stock_apply_deltas','pos_sale_commit','sale_refund'])await db.exec(fn(name));
 await db.exec('REVOKE ALL ON FUNCTION public.pos_sale_commit(jsonb,jsonb,jsonb,jsonb,jsonb,text),public.sale_refund(uuid,jsonb,text,text,text) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.pos_sale_commit(jsonb,jsonb,jsonb,jsonb,jsonb,text),public.sale_refund(uuid,jsonb,text,text,text) TO authenticated,service_role;');
 for(const[id,role,permissions]of[[author,'staff',{can_process_sale:true,can_process_refund:true}],[manager,'manager',{}],[admin,'admin',{}]])await db.query("INSERT INTO app_users(id,user_id,role,role_slug,permissions,is_active,store_id) VALUES($1::uuid,$1::text,$2::public.app_role,$2::text,$3::jsonb,true,'A')",[id,role,JSON.stringify(permissions)]);
 await db.query("INSERT INTO products(id,name,barcode,stock_by_store,stock_quantity) VALUES($1,'Fixture','fixture-barcode','{\"A\":10}',10)",[product]);
 const before=(await db.query("SELECT proname,pg_get_functiondef(oid) definition,proacl::text FROM pg_proc WHERE oid IN('public.pos_sale_commit(jsonb,jsonb,jsonb,jsonb,jsonb,text)'::regprocedure,'public.sale_refund(uuid,jsonb,text,text,text)'::regprocedure) ORDER BY proname")).rows;
 await db.exec("ALTER TABLE pos_settings ADD COLUMN integration_settings jsonb NOT NULL DEFAULT '{}';");await db.exec(table('pos_store_settings'));for(const name of['has_role','pos_rules_defaults','pos_rules_row','pos_rules_get','shift_log_event','shift_close_start','shift_variance_approve','shift_reconcile_now','shift_cash_count_submit','shift_recount_submit'])await db.exec(fn(name));
 if(!upgradeSql)await db.exec(await read('scripts/preparation/shift-financial-web-actions.sql'));
 if(actualSaleDefinition||capturedActual){await db.exec("CREATE TABLE promotions(id text PRIMARY KEY,promo_type text,is_active boolean,deleted_at timestamptz,title text,code_scope text,code_cluster_id text);ALTER TABLE stores ADD COLUMN IF NOT EXISTS group_id text;");const fixture=JSON.parse(await read('scripts/fixtures/fin62-pos-sale-live-definition.json'));assert.equal(createHash('sha256').update(fixture.definition).digest('hex'),fixture.sha256);await db.exec(fixture.definition);}
 if(!upgradeSql)await db.exec(await read('scripts/preparation/shift-financial-live-business.sql'));
 await db.exec(table('missed_bill_entries'));
 for(const name of['pos_admin_correct_sale','pos_admin_correct_tender','pos_admin_add_missed_bill'])await db.exec(fn(name));
 await db.exec("REVOKE ALL ON FUNCTION public.pos_admin_correct_sale(uuid,text,integer,jsonb,jsonb,text,text,text,text,uuid),public.pos_admin_correct_tender(uuid,text,text),public.pos_admin_add_missed_bill(jsonb,text,text) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.pos_admin_correct_sale(uuid,text,integer,jsonb,jsonb,text,text,text,text,uuid),public.pos_admin_correct_tender(uuid,text,text),public.pos_admin_add_missed_bill(jsonb,text,text) TO service_role;");
 const original=(await db.query("SELECT oid::regprocedure::text signature,pg_get_functiondef(oid) definition,proacl::text FROM pg_proc WHERE oid IN('public.pos_admin_correct_sale(uuid,text,integer,jsonb,jsonb,text,text,text,text,uuid)'::regprocedure,'public.pos_admin_correct_tender(uuid,text,text)'::regprocedure,'public.pos_admin_add_missed_bill(jsonb,text,text)'::regprocedure) ORDER BY 1")).rows;
 await db.exec("ALTER TABLE payment_transactions ADD PRIMARY KEY(id);ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS corrected_at timestamptz;ALTER TABLE stores ADD COLUMN IF NOT EXISTS address text,ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,ADD COLUMN IF NOT EXISTS deleted_at timestamptz,ADD COLUMN IF NOT EXISTS group_id text,ADD COLUMN IF NOT EXISTS private_catalogue boolean DEFAULT true;ALTER TABLE products ADD COLUMN IF NOT EXISTS owner_store_id text,ADD COLUMN IF NOT EXISTS deleted_at timestamptz;ALTER TABLE pos_store_settings ADD COLUMN IF NOT EXISTS prevent_negative_stock_sale boolean DEFAULT false;CREATE TABLE IF NOT EXISTS settings_scoped(scope text,scope_id text,key text,value jsonb);CREATE TABLE IF NOT EXISTS stock_transfers(id uuid PRIMARY KEY,to_store_id text,posted_at timestamptz,status text);CREATE TABLE IF NOT EXISTS stock_transfer_items(product_id uuid,transfer_id uuid,quantity_verified integer,quantity_received integer);UPDATE stores SET address='Fixture address',group_id='cluster-A' WHERE id='A';UPDATE products SET owner_store_id='A';UPDATE app_users SET full_name='Verified administrator' WHERE role='admin';UPDATE app_users SET full_name='Verified cashier' WHERE id='"+author+"';");
 for(const name of['branch_catalogue_is_private','product_available_in_catalogue'])await db.exec(fn(name));
 if(!upgradeSql)await db.exec(await read('scripts/preparation/shift-financial-admin-aliases.sql'));

 await db.exec('ALTER TABLE terminal_tokens ADD COLUMN IF NOT EXISTS claimed_at timestamptz;');
 if(capturedActual){
  assert(upgradeSql,'Captured originals require the exact artifact');
  await db.exec('SET check_function_bodies=off;');
  try{for(const file of['fin62-web-live-definitions.json','fin62-writers-delegates-live-definitions.json'])for(const row of JSON.parse(await read('scripts/fixtures/'+file)).definitions){
   if(row.normalized_md5)assert.equal(createHash('md5').update(row.definition.replaceAll('\r\n','\n')).digest('hex'),row.normalized_md5);
   await db.exec(row.definition);
   if(typeof row.acl==='string'){await db.exec('REVOKE ALL ON FUNCTION '+row.signature+' FROM PUBLIC,anon,authenticated,service_role;');for(const role of['PUBLIC','anon','authenticated','service_role'])if(new RegExp('(?:\\{|,)'+(role==='PUBLIC'?'':role)+'=X/').test(row.acl))await db.exec('GRANT EXECUTE ON FUNCTION '+row.signature+' TO '+role+';');}
  }}finally{await db.exec('RESET check_function_bodies;');}
 }
 if(upgradeSql)await db.exec(upgradeSql);
 else{
  await db.exec(await read('scripts/preparation/shift-financial-rollout-capability.sql'));
  await db.exec(await read('scripts/preparation/shift-financial-final-readiness.sql'));
 }
 return{db,terminal,author,manager,admin,shift,product};
 }catch(error){await db.close();throw error;}
}
module.exports={createFullFinancialCloud};
