// Isolated equivalence tests only. Never connects to the operator database.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const schema=await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8');
const migration=await readFile(new URL('../supabase/migrations/20261030102943_optimize_branch_catalogue_sync_reads.sql',import.meta.url),'utf8');
const keyset=await readFile(new URL('../supabase/migrations/20261030081625_product_bootstrap_uuid_keyset.sql',import.meta.url),'utf8');
function routine(name,first=false){
 const found=[...schema.matchAll(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS (\\$[a-zA-Z_]*\\$)[\\s\\S]*?\\1;`,'g'))];
 assert(found.length,`Missing ${name}`);return(first?found[0]:found.at(-1))[0];
}
function baseline(name){
 return routine(name,true).replace(`public.${name}(`,`public.${name}_scoped(`)
  .replaceAll('public.pos_sync_validate_scope(','public.pos_sync_validate_read_scope(')
  .replaceAll("(NULLIF(x.owner_store_id::text,'') IS NULL OR x.owner_store_id::text=p_branch_id)",'public.product_available_in_catalogue(x.id,p_branch_id)')
  .replaceAll("(NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id)",'public.product_available_in_catalogue(p.id,p_branch_id)')
  .replaceAll('GREATEST(p_limit,100)','GREATEST(p_limit,10)');
}
const bootstrap=baseline('pos_sync_bootstrap'),counts=baseline('pos_sync_counts');
const db=new PGlite();let passed=0;
const check=async(title,run)=>{await run();passed++;console.log(`PASS ${title}`);};
const ids=async(branch,query)=> (await db.query(query,[branch])).rows.map(x=>x.id).sort();
const oldIds=branch=>ids(branch,'SELECT id FROM products WHERE product_available_in_catalogue(id,$1)');
const newIds=branch=>ids(branch,'SELECT public.catalogue_product_ids_for_branch($1) AS id');
const page=async(table,branch,cursor=null,terminal='management-all')=>(await db.query(
 'SELECT public.pos_sync_bootstrap_scoped($1,$2,$3,$4,$5,90,100) AS v',['default',branch,terminal,table,cursor])).rows[0].v;
async function pages(table,branch){
 const result=[];let cursor=null;
 do {const p=await page(table,branch,cursor);result.push(p);cursor=p.cursor;assert(result.length<100,'Unbounded pagination');}while(cursor);
 return result;
}
const countRows=async(branch,terminal='management-all')=>(await db.query(
 'SELECT * FROM public.pos_sync_counts_scoped($1,$2,$3,90) ORDER BY table_name',['default',branch,terminal])).rows;
const definitions=async()=> (await db.query("SELECT proname,pg_get_functiondef(oid) definition FROM pg_proc WHERE proname IN ('pos_sync_bootstrap_scoped','pos_sync_counts_scoped') ORDER BY proname")).rows;
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT 'service_role'::text$$;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULL::uuid$$;
  CREATE TABLE app_users(id uuid,auth_user_id uuid,is_active boolean,role text,permissions jsonb,store_id text);
  CREATE TABLE stores(id text PRIMARY KEY,group_id text,private_catalogue boolean);
  CREATE TABLE pos_settings(integration_settings jsonb);
  CREATE TABLE settings_scoped(scope text,scope_id text,key text,value jsonb);
  CREATE TABLE products(id uuid PRIMARY KEY,owner_store_id text,stock_by_store jsonb,is_active boolean DEFAULT true);
  CREATE TABLE product_barcodes(id uuid PRIMARY KEY,product_id uuid REFERENCES products,barcode text);
  CREATE TABLE stock_transfers(id uuid PRIMARY KEY,from_store_id text,to_store_id text,status text,posted_at timestamptz);
  CREATE TABLE stock_transfer_items(id uuid PRIMARY KEY,transfer_id uuid,product_id uuid,quantity_verified numeric,quantity_received numeric);
  CREATE INDEX ON stock_transfer_items(product_id);
  CREATE FUNCTION pos_sync_validate_read_scope(org text,branch text,terminal text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
   IF org<>'default' OR NOT EXISTS(SELECT 1 FROM stores WHERE id=branch) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN';END IF;
   IF terminal IN ('ops-a','management-a') AND branch<>'A' THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN';END IF;
   IF terminal NOT IN ('ops-a','management-a','management-all') THEN RAISE EXCEPTION 'SYNC_TERMINAL_FORBIDDEN';END IF;
  END$$;
  INSERT INTO stores VALUES('A',' G1 ',true),('A2','G1',true),('B','G2',true),('U',NULL,false),('U2',' ',false),('P',NULL,true);
  INSERT INTO pos_settings VALUES('{"branches":{}}');
  INSERT INTO settings_scoped VALUES('GLOBAL','','pos_field:integration_settings','{"branches":{}}');`);
 // Counts includes every synchronization table. Keep the real union intact,
 // using empty fixtures for tables unrelated to this read-only optimization.
 const existing=new Set((await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(x=>x.tablename));
 for(const name of new Set([...counts.matchAll(/FROM public\."([a-z_]+)"/g)].map(x=>x[1]))){
  if(!existing.has(name))await db.exec(`CREATE TABLE public."${name}"(
   id uuid,store_id text,scope text,scope_id text,scope_type text,key text,section text,
   booking_id uuid,po_id uuid,product_id uuid,foc_product_id uuid,transfer_id uuid,
   branch_id text,from_store_id text,to_store_id text,created_at timestamptz,terminal_id text,
   movement_id uuid,terminal_token_id text,slug text);`);
 }
 await db.exec(routine('branch_catalogue_is_private'));
 await db.exec(routine('product_available_in_catalogue'));
 await db.exec(bootstrap);await db.exec(counts);await db.exec(keyset);
 await db.exec(`REVOKE ALL ON FUNCTION pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer),pos_sync_counts_scoped(text,text,text,integer) FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer),pos_sync_counts_scoped(text,text,text,integer) TO service_role;
  INSERT INTO products(id,owner_store_id,stock_by_store,is_active)
  SELECT md5(owner.n::text||':'||stock.n::text)::uuid,owner.id,stock.value,stock.n%3<>0
  FROM(VALUES(1,'A'),(2,'A2'),(3,'B'),(4,'U'),(5,'U2'),(6,'P'),(7,NULL),(8,''),(9,'gone'))owner(n,id)
  CROSS JOIN(VALUES(1,'{}'::jsonb),(2,'{"A":0}'),(3,'{"A":1}'),(4,'{"A":-1}'),
   (5,'{"a2":2.5}'),(6,'{"B":4}'),(7,'{"A":"invalid"}'),(8,'{"A":null}'),
   (9,'{"U":1}'),(10,'{"unknown":5}'),(11,'{"A":0,"B":-1}'),(12,NULL))stock(n,value);
  INSERT INTO products(id,owner_store_id,stock_by_store,is_active)
  SELECT md5('scale:'||n)::uuid,CASE n%3 WHEN 0 THEN'A' WHEN 1 THEN'B' ELSE NULL END,
   CASE WHEN n%5=0 THEN'{"A":0}'::jsonb ELSE'{}'::jsonb END,n%7<>0 FROM generate_series(1,1000)n;
  INSERT INTO product_barcodes SELECT md5(id::text||':barcode')::uuid,id,'code-'||id FROM products;
  INSERT INTO stock_transfers VALUES
   (md5('t1')::uuid,'A','B','completed',now()),(md5('t2')::uuid,'B','A2','completed_with_discrepancy',now()),
   (md5('t3')::uuid,'A','B','completed',NULL),(md5('t4')::uuid,'A','B','approved',now()),
   (md5('t5')::uuid,'A','B','completed',now());
  INSERT INTO stock_transfer_items VALUES
   (md5('i1')::uuid,md5('t1')::uuid,md5('1:1')::uuid,NULL,2),
   (md5('i2')::uuid,md5('t2')::uuid,md5('3:1')::uuid,1,0),
   (md5('i3')::uuid,md5('t3')::uuid,md5('1:2')::uuid,2,2),
   (md5('i4')::uuid,md5('t4')::uuid,md5('1:3')::uuid,2,2),
   (md5('i5')::uuid,md5('t5')::uuid,md5('1:4')::uuid,0,2);`);
 const beforeDefs=await definitions();const baselinePages={},baselineCounts={};
 for(const branch of ['A','A2','B','U','U2','P']){
  for(const table of ['products','product_barcodes'])baselinePages[`${branch}:${table}`]=await pages(table,branch);
  baselineCounts[branch]=await countRows(branch);
 }
 await db.exec(migration);
 await check('only product/barcode predicates change; every validation, cursor, page limit and other table remains byte-identical',async()=>{
  const after=await definitions();
  const productNew='x.id IN (SELECT public.catalogue_product_ids_for_branch(p_branch_id))';
  const barcodeNew='x.product_id IN (SELECT public.catalogue_product_ids_for_branch(p_branch_id))';
  const barcodeOld='EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=x."product_id"::text AND public.product_available_in_catalogue(p.id,p_branch_id))';
  assert.equal(after.length,2);
  for(let i=0;i<after.length;i++){
   assert.equal(after[i].definition.split(productNew).length-1,1);
   assert.equal(after[i].definition.split(barcodeNew).length-1,1);
   assert.equal(after[i].definition.replaceAll(productNew,'public.product_available_in_catalogue(x.id,p_branch_id)').replaceAll(barcodeNew,barcodeOld),beforeDefs[i].definition);
  }
 });
 await check('branch catalogue IDs match the previous per-product helper across private/shared/ownerless/zero/negative/transferred products',async()=>{
  for(const branch of ['A','A2','B','U','U2','P','missing'])assert.deepEqual(await newIds(branch),await oldIds(branch));
 });
 await check('all product and barcode pages, cursors and counts remain exactly equivalent',async()=>{
  for(const branch of ['A','A2','B','U','U2','P']){
   for(const table of ['products','product_barcodes']){
    const result=await pages(table,branch);assert.deepEqual(result,baselinePages[`${branch}:${table}`]);
    const flat=result.flatMap(x=>x.rows);assert.equal(new Set(flat.map(x=>x.id)).size,flat.length);
    assert.equal(result.at(-1).cursor,null);
   }
   assert.deepEqual(await countRows(branch),baselineCounts[branch]);
  }
 });
 await check('privacy flags and single-cluster fallback preserve exact legacy semantics',async()=>{
  await db.exec(`UPDATE pos_settings SET integration_settings='{"branches":{"u":{"privateCatalogue":true}}}';
   UPDATE settings_scoped SET value='{"branches":{"u2":{"privateCatalogue":true}}}';`);
  for(const branch of ['A','B','U','U2','P'])assert.deepEqual(await newIds(branch),await oldIds(branch));
  await db.exec(`UPDATE pos_settings SET integration_settings='{"branches":{}}';UPDATE settings_scoped SET value='{"branches":{}}';
   UPDATE stores SET group_id='ONLY' WHERE id IN('A','A2','B');`);
  for(const branch of ['A','B','U','U2','P'])assert.deepEqual(await newIds(branch),await oldIds(branch));
 });
 await check('Operations and restricted management cannot change branch even though storage is shared',async()=>{
  for(const terminal of ['ops-a','management-a']){
   await assert.rejects(page('products','B',null,terminal),/SYNC_BRANCH_FORBIDDEN/);
   await assert.rejects(countRows('B',terminal),/SYNC_BRANCH_FORBIDDEN/);
   assert((await page('products','A',null,terminal)).rows.length>0);
  }
  await assert.rejects(page('products','A',null,'unknown'),/SYNC_TERMINAL_FORBIDDEN/);
 });
 await check('private branch helper and sync routines retain service-only execution and idempotent installation',async()=>{
  const before=await definitions();await db.exec(migration);assert.deepEqual(await definitions(),before);
  for(const role of ['anon','authenticated']){
   await db.exec(`SET ROLE ${role}`);
   await assert.rejects(db.query('SELECT public.catalogue_product_ids_for_branch($1)',['A']),/permission denied/);
   await assert.rejects(page('products','A'),/permission denied/);
   await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE service_role');assert((await newIds('A')).length>0);await db.exec('RESET ROLE');
 });
 await check('optimized page computes its branch catalogue set once and no longer invokes the legacy per-product helper',async()=>{
  await db.exec(`CREATE OR REPLACE FUNCTION public.product_available_in_catalogue(p_product uuid,p_branch text) RETURNS boolean
   LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'OLD_PER_ROW_HELPER_USED';END$$;`);
  assert((await page('products','A')).rows.length>0);assert((await page('product_barcodes','A')).rows.length>0);
  const plan=(await db.query(`EXPLAIN(ANALYZE,VERBOSE,FORMAT JSON) SELECT id FROM products x
   WHERE x.id IN(SELECT public.catalogue_product_ids_for_branch($1)) ORDER BY x.id LIMIT 100`,['A'])).rows[0]['QUERY PLAN'];
  const nodes=[];const walk=x=>{if(!x||typeof x!=='object')return;if(x['Node Type']==='ProjectSet'&&JSON.stringify(x.Output).includes('catalogue_product_ids_for_branch'))nodes.push(x);for(const value of Object.values(x))walk(value);};walk(plan);
  assert.equal(nodes.length,1);assert.equal(nodes[0]['Actual Loops'],1);
 });
 await check('unfamiliar predicates or missing scope validators abort rather than silently rewriting authorization',async()=>{
  const original=beforeDefs.find(x=>x.proname==='pos_sync_bootstrap_scoped').definition;
  await db.exec(original.replace('public.product_available_in_catalogue(x.id,p_branch_id)','true'));
  await assert.rejects(db.exec(migration),/Unrecognized catalogue predicate/);await db.exec('ROLLBACK');
  await db.exec(original.replace('public.pos_sync_validate_read_scope(','public.pos_sync_validate_scope('));
  await assert.rejects(db.exec(migration),/Expected validated read scope absent/);await db.exec('ROLLBACK');
 });
 console.log(`${passed} isolated branch catalogue sync-read scenarios passed`);
}finally{await db.close();}
