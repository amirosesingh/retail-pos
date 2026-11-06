// Disposable PostgreSQL only. No operator connection/profile/credentials.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const template=await read('scripts/maintenance/repair-str1-three-product-ownership.sql');
const capture=JSON.parse(await read('src/lib/__tests__/fixtures/ownership22-live-metadata.json'));
const manifest=JSON.parse(template.match(/\$manifest\$([\s\S]*?)\$manifest\$/)[1]);
const provenance=JSON.parse(template.match(/\$provenance\$([\s\S]*?)\$provenance\$/)[1]);
const branch='a611a328-2217-4d77-944a-5f6a637d123b';
const sentinel='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const quote=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const md5=s=>createHash('md5').update(s).digest('hex');
const native=process.argv.includes('--native');
if(process.argv.slice(2).some(x=>x!=='--native'))throw Error('Only optional --native fixture mode accepted');
const nativeFactory=native?await import('data:text/javascript;base64,'+Buffer.from((await read('scripts/test-seven-shift-summary-native.fixture.mjs')).replace('FROM shifts WHERE','FROM products WHERE')+'\nexport {createNativeFixture};').toString('base64')):null;
const createDatabase=async()=>{if(!native)return new PGlite();const connection=await nativeFactory.createNativeFixture();const exec=connection.exec;connection.exec=async text=>{if(/^\s*--[\s\S]*\bBEGIN;[\s\S]*COMMIT;\s*$/.test(text)){await exec(text.replace(/COMMIT;\s*$/,''));return exec('COMMIT;');}return exec(text);};return connection;};
let db=await createDatabase();let passed=0;
async function fixture(){
 await db.exec("SET TimeZone='UTC'");
 await db.exec(`CREATE ROLE service_role;CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA private;CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;CREATE FUNCTION public.has_perm(text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE TABLE store_groups(id text PRIMARY KEY);INSERT INTO store_groups VALUES('361-degree-sports'),('foreign');CREATE TABLE members(id uuid PRIMARY KEY);
 CREATE TABLE public.stock_transfers(id uuid PRIMARY KEY,to_store_id text,posted_at timestamptz,status text);
 CREATE TABLE public.stock_transfer_items(product_id uuid,transfer_id uuid,quantity_verified numeric,quantity_received numeric);
 CREATE TABLE public.pos_settings(id integer,integration_settings jsonb);INSERT INTO pos_settings VALUES(1,'{}');
 CREATE TABLE public.settings_scoped(scope text,scope_id text,key text,value jsonb);
 CREATE TABLE public.sku_number_state(singleton boolean PRIMARY KEY,next_value bigint,updated_at timestamptz);INSERT INTO sku_number_state VALUES(true,999999,now());`);
 await db.exec(`CREATE SCHEMA realtime;CREATE TABLE realtime.fixture_hints(payload jsonb,event text,topic text,private boolean);CREATE FUNCTION realtime.send(payload jsonb,event text,topic text,private boolean) RETURNS void LANGUAGE sql AS $$INSERT INTO realtime.fixture_hints VALUES(payload,event,topic,private)$$;`);
 for(const name of [...new Set(capture.columns.map(c=>c.table_name))]){
  const columns=capture.columns.filter(c=>c.table_name===name).sort((a,b)=>a.ordinal_position-b.ordinal_position);
  await db.exec(`CREATE TABLE public.${name}(${columns.map(c=>`"${c.column_name}" ${c.udt_name.startsWith('_')?c.udt_name.slice(1)+'[]':c.udt_name}${c.is_identity==='YES'?' GENERATED ALWAYS AS IDENTITY':c.column_default?' DEFAULT '+c.column_default:''}${c.is_nullable==='NO'?' NOT NULL':''}`).join(',')});`);
 }
 for(const c of [...capture.constraints].sort((a,b)=>Number(a.type==='f')-Number(b.type==='f')))await db.exec(`ALTER TABLE public.${c.table} ADD CONSTRAINT "${c.name}" ${c.definition};`);
 const fill=(table,overrides)=>Object.fromEntries(capture.columns.filter(c=>c.table_name===table&&c.is_nullable==='NO'&&!c.column_default&&c.is_identity!=='YES').map(c=>[c.column_name,c.udt_name==='uuid'?'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa':/^(int|numeric|float)/.test(c.udt_name)?0:c.udt_name==='bool'?true:'fixture']).concat(Object.entries(overrides)));
 const insert=async(table,row)=>{const keys=Object.keys(row);await db.exec(`INSERT INTO public.${table}(${keys.map(k=>'"'+k+'"').join(',')}) VALUES(${keys.map(k=>quote(typeof row[k]==='object'&&row[k]!==null?JSON.stringify(row[k]):row[k])).join(',')});`);};
 await insert('stores',fill('stores',{id:branch,code:'STR1',name:'Synthetic STR1',group_id:'361-degree-sports',private_catalogue:true,is_active:true,location_type:'store'}));
 await insert('stores',fill('stores',{id:'10000000-0000-4000-8000-000000000010',code:'SIBLING',name:'Synthetic sibling',group_id:'361-degree-sports',private_catalogue:true,is_active:true,location_type:'store'}));
 await insert('stores',fill('stores',{id:'10000000-0000-4000-8000-000000000011',code:'OTHER',name:'Synthetic foreign',group_id:'foreign',private_catalogue:true,is_active:true,location_type:'store'}));
 await db.exec('CREATE TABLE public.item_activity_logs(id uuid PRIMARY KEY,product_id uuid,store_id text,activity_type text,reference text,quantity_delta integer);CREATE TABLE public.stock_delta_applied(movement_id uuid PRIMARY KEY,product_id uuid,store_id text,delta integer);CREATE TABLE public.purchase_orders(id uuid PRIMARY KEY,store_id text,reference text,status text);CREATE TABLE public.purchase_order_items(id uuid PRIMARY KEY,po_id uuid,product_id uuid,quantity_received integer);');
 for(const proof of new Map(provenance.map(p=>[p.sale_id,p])).values())await insert('sales',fill('sales',{id:proof.sale_id,store_id:branch,bill_number:proof.sale_reference,is_refunded:false}));
 for(const proof of new Map(provenance.map(p=>[p.po,p])).values())await insert('purchase_orders',{id:proof.po,store_id:branch,reference:proof.receive_reference,status:'posted'});
 for(const proof of provenance){
  await insert('purchase_order_items',{id:proof.po_item,po_id:proof.po,product_id:proof.id,quantity_received:1});
  for(const [movement,type,reference,delta]of [[proof.receive,'receive',proof.receive_reference,1],[proof.sale,'sale',proof.sale_reference,-1]]){
   await insert('item_activity_logs',{id:movement,product_id:proof.id,store_id:branch,activity_type:type,reference,quantity_delta:delta});
   await insert('stock_delta_applied',{movement_id:movement,product_id:proof.id,store_id:branch,delta});
  }
 }
 for(let i=0;i<manifest.length;i++){
  await insert('products',fill('products',{id:manifest[i].id,barcode:'synthetic-'+i,name:'Synthetic product '+i,owner_store_id:null,stock_quantity:0,stock_by_store:{[branch]:0},catalogue_store_ids:'{}',sku:'SKU-'+(i+1),row_version:7,updated_at:'2026-01-01T00:00:00Z',is_archived:i%2===0}));
  const proof=provenance.find(p=>p.id===manifest[i].id);await insert('sale_items',fill('sale_items',{id:proof.sale_item,sale_id:proof.sale_id,product_id:manifest[i].id,quantity:1,refunded_qty:0,is_return:false}));
 }
 await insert('products',fill('products',{id:sentinel,barcode:'UNRELATED-SENTINEL',name:'Unrelated branch product',owner_store_id:'10000000-0000-4000-8000-000000000011',stock_quantity:17,stock_by_store:{'10000000-0000-4000-8000-000000000011':17},catalogue_store_ids:'{}',sku:'SKU-UNRELATED',row_version:3,updated_at:'2026-01-01T00:00:00Z',is_archived:false}));
 // Keep captured CRLF function bodies as exact bytes even through Windows psql.
 for(const f of [...capture.functions].sort((a,b)=>Number(a.signature.startsWith('product_available'))-Number(b.signature.startsWith('product_available')))){const match=f.definition.match(/AS (\$\w*\$)([\s\S]*?)\1/);const body=match[2];const literal="E'"+body.replaceAll('\\','\\\\').replaceAll("'","''").replaceAll('\r','\\r').replaceAll('\n','\\n')+"'";await db.exec(f.definition.replace(match[0],()=> 'AS '+literal));
  const sig=f.signature.includes('.')?f.signature:'public.'+f.signature;
  await db.exec(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`);
  for(const grant of f.acl.slice(1,-1).split(',')){const role=grant.split('=')[0];if(role!=='postgres')await db.exec(`GRANT EXECUTE ON FUNCTION ${sig} TO ${role||'PUBLIC'};`);}
 }
 for(const t of capture.triggers)await db.exec(t.trigger_definition);
 const current=(await db.query(`SELECT id,md5(to_jsonb(p)::text) before_md5 FROM products p WHERE id<>'${sentinel}' ORDER BY id`)).rows;
 return template.replace(/\$manifest\$[\s\S]*?\$manifest\$/,'$manifest$'+JSON.stringify(current)+'$manifest$');
}
const snapshot=async()=>JSON.stringify((await db.query(`SELECT jsonb_build_object('products',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM products x),'history',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM change_history x),'feed',(SELECT jsonb_agg(to_jsonb(x) ORDER BY cursor) FROM sync_change_feed x),'audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM audit_logs x),'sales',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM sales x),'items',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM sale_items x),'sku',(SELECT jsonb_agg(to_jsonb(x)) FROM sku_number_state x),'hints',(SELECT jsonb_agg(to_jsonb(x) ORDER BY topic) FROM realtime.fixture_hints x),'activity',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM item_activity_logs x),'deltas',(SELECT jsonb_agg(to_jsonb(x) ORDER BY movement_id) FROM stock_delta_applied x),'receiving',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM purchase_orders x),'receiving_items',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM purchase_order_items x)) v`)).rows[0].v);
const reject=async(sql,pattern)=>{const before=await snapshot();await assert.rejects(db.exec(sql),pattern);await db.exec('ROLLBACK');assert.equal(await snapshot(),before);passed++;};
try{
 const sql=await fixture();
 await reject(template,/BEFORE_IMAGE_CHANGED/);
 const unrelated=(await db.query(`SELECT to_jsonb(p) r FROM products p WHERE id='${sentinel}'`)).rows[0].r;
 const before=(await db.query(`SELECT to_jsonb(p) r FROM products p WHERE id<>'${sentinel}' ORDER BY id`)).rows.map(r=>r.r);
 await db.exec("SET TimeZone='Pacific/Auckland'");
 await db.exec(sql);
 assert.equal((await db.query("SELECT current_setting('TimeZone') zone")).rows[0].zone,'Pacific/Auckland');
 await db.exec("SET TimeZone='UTC'");passed++;
 const after=(await db.query(`SELECT to_jsonb(p) r FROM products p WHERE id<>'${sentinel}' ORDER BY id`)).rows.map(r=>r.r);
 assert.equal(after.length,3);for(let i=0;i<3;i++){assert.equal(after[i].owner_store_id,branch);assert.equal(after[i].row_version,before[i].row_version+1);const omit=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['owner_store_id','row_version','updated_at'].includes(k)));assert.deepEqual(omit(after[i]),omit(before[i]));}passed++;
 assert.deepEqual((await db.query('SELECT (SELECT count(*) FROM change_history)::integer history,(SELECT count(*) FROM sync_change_feed)::integer feed,(SELECT count(*) FROM audit_logs)::integer audit')).rows[0],{history:3,feed:4,audit:1});passed++;
 assert.deepEqual((await db.query(`SELECT to_jsonb(p) r FROM products p WHERE id='${sentinel}'`)).rows[0].r,unrelated);passed++;
 assert.deepEqual((await db.query('SELECT topic,payload FROM realtime.fixture_hints ORDER BY topic')).rows,[{topic:'pos-sync:default:branch:'+branch,payload:{table:'audit_logs'}},{topic:'pos-sync:default:global',payload:{table:'products'}}]);passed++;
 const saved=await snapshot();await db.exec(sql);assert.equal(await snapshot(),saved);passed++;
 assert.equal((await db.query(`SELECT count(*)::integer n FROM products p WHERE public.product_available_in_catalogue(p.id,'10000000-0000-4000-8000-000000000010') AND NOT public.product_available_in_catalogue(p.id,'10000000-0000-4000-8000-000000000011')`)).rows[0].n,3);passed++;
 await db.exec(`UPDATE audit_logs SET details=details-'repair_key'`);await reject(sql,/INVALID_REPLAY/);
 await db.exec(`UPDATE audit_logs SET details=jsonb_set(details,'{repair_key}','"OWNERSHIP3-STR1-20261106"')`);
 await db.exec(`UPDATE products SET selling_price=selling_price+1 WHERE id='${manifest[0].id}'`);await reject(sql,/INVALID_REPLAY/);
 // Each negative case starts with its own clean, disposable database. The
 // production metadata and trigger pins are never substituted by the fixture.
 const fresh=async()=>{await db.close();db=await createDatabase();return fixture();};
 for(const [label,mutate,pattern] of [
  ['changed row',`UPDATE products SET name='changed' WHERE id='${manifest[0].id}'`,/BEFORE_IMAGE_CHANGED/],
  ['missing row',`DELETE FROM products WHERE id='${manifest[0].id}'`,/MISSING_PRODUCT/],
  ['foreign sales',`UPDATE sales SET store_id='10000000-0000-4000-8000-000000000011'`,/PROVENANCE_CHANGED|SOURCE_PROOF_CHANGED/],
  ['missing accepted deduction',`DELETE FROM stock_delta_applied WHERE movement_id='${provenance[0].sale}'`,/SOURCE_PROOF_CHANGED/],
  ['unposted original receiving',`UPDATE purchase_orders SET status='draft'`,/SOURCE_PROOF_CHANGED/],
  ['changed receiving quantity',`UPDATE purchase_order_items SET quantity_received=2`,/SOURCE_PROOF_CHANGED/],
  ['competing foreign receiving',`INSERT INTO purchase_orders VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','10000000-0000-4000-8000-000000000011','SYNTHETIC-FOREIGN-RECEIVE','posted');INSERT INTO purchase_order_items VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','${manifest[0].id}',1);`,/COMPETING_RECEIVING/],
  ['branch cluster',`UPDATE stores SET group_id='foreign' WHERE id='${branch}'`,/BRANCH_CHANGED/],
  ['disabled trigger','ALTER TABLE products DISABLE TRIGGER products_row_version',/TRIGGER_CHANGED/],
  ['altered function',"ALTER FUNCTION public.products_bump_row_version() SET statement_timeout='1s'",/ROUTINE_CHANGED/],
  ['unknown trigger',`CREATE TRIGGER fixture_unknown AFTER UPDATE ON products FOR EACH ROW EXECUTE FUNCTION public.sync_feed_products()`,/TRIGGER_CHANGED/],
 ]){const candidate=await fresh();await db.exec(mutate);await reject(candidate,pattern);console.log('PASS '+label+' guard');}
 {const candidate=await fresh();await db.exec(`ALTER TABLE audit_logs ADD CONSTRAINT fixture_fail_receipt CHECK(action_category<>'maintenance')`);await reject(candidate.replace(/"constraints":\[[\s\S]*?\]\}\$metadata\$/g,m=>m),/CONSTRAINT_CHANGED/);}
 {const candidate=await fresh();await reject(candidate.replace('INSERT INTO public.audit_logs(id,','RAISE EXCEPTION \'fixture receipt failure\'; INSERT INTO public.audit_logs(id,'),/fixture receipt failure/);}
 {const candidate=await fresh();await reject(candidate.replace('UPDATE public.products p SET owner_store_id=branch',"UPDATE public.products p SET selling_price=selling_price+1, owner_store_id=branch"),/UNEXPECTED_PRODUCT_CHANGE/);}
 {const candidate=await fresh();await reject(candidate.replace('UPDATE public.products p SET owner_store_id=branch',"EXECUTE 'CREATE TRIGGER fixture_late AFTER UPDATE ON products FOR EACH ROW EXECUTE FUNCTION public.sync_feed_products()'; UPDATE public.products p SET owner_store_id=branch"),/PRODUCT_FEED_MISSING|TRIGGER_CHANGED/);}
 if(native){const candidate=await fresh();const before=await snapshot();await db.testContention(candidate.replace(/COMMIT;\s*$/,''),manifest[0].id);await db.exec('ROLLBACK');assert.equal(await snapshot(),before);passed++;}
 console.log(`PASS ${passed} isolated ownership3 captured-trigger/schema/audit/feed/replay/visibility scenarios`);
}catch(error){console.error(error.message);process.exitCode=1;}finally{await db.close();}
