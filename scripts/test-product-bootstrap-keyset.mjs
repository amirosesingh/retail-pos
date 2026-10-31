// Isolated PostgreSQL fixture only. Never connects to live POS data.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const schema = await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261030081625_product_bootstrap_uuid_keyset.sql',import.meta.url),'utf8');
function routine(name, first=false) {
  const matches=[...schema.matchAll(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS (\\$[a-zA-Z_]*\\$)[\\s\\S]*?\\1;`,'g'))];
  assert(matches.length,`Missing routine ${name}`);
  return (first?matches[0]:matches.at(-1))[0];
}
const db=new PGlite();
const id=n=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
let passed=0;
const check=async(name,fn)=>{await fn();passed++;console.log(`PASS ${name}`);};
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'::text$$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT null::uuid$$;
    CREATE TABLE app_users(id uuid,auth_user_id uuid,is_active boolean,role text,permissions jsonb,store_id text);
    CREATE TABLE stores(id text PRIMARY KEY,group_id text,private_catalogue boolean DEFAULT false);
    CREATE TABLE pos_settings(integration_settings jsonb);
    CREATE TABLE settings_scoped(scope text,scope_id text,key text,value jsonb);
    CREATE TABLE products(id uuid PRIMARY KEY,owner_store_id text,stock_by_store jsonb,is_active boolean DEFAULT true);
    CREATE TABLE product_barcodes(id uuid PRIMARY KEY,product_id uuid,barcode text);
    CREATE TABLE stock_transfers(id uuid PRIMARY KEY,to_store_id text,status text,posted_at timestamptz);
    CREATE TABLE stock_transfer_items(transfer_id uuid,product_id uuid,quantity_verified numeric,quantity_received numeric);
    CREATE FUNCTION pos_sync_validate_scope(text,text,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN END$$;
    INSERT INTO stores VALUES ('A','sports',true),('B','sports',true),('C','apparel',true);`);
  await db.exec(routine('branch_catalogue_is_private'));
  await db.exec(routine('product_available_in_catalogue'));
  // Reconstruct the exact deployed cluster filter and live minimum of ten.
  // Canonical first definition predates the inspected cluster migration.
  const before=routine('pos_sync_bootstrap',true)
    .replace('public.pos_sync_bootstrap(','public.pos_sync_bootstrap_scoped(')
    .replaceAll("(NULLIF(x.owner_store_id::text,'') IS NULL OR x.owner_store_id::text=p_branch_id)",'public.product_available_in_catalogue(x.id,p_branch_id)')
    .replaceAll("(NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id)",'public.product_available_in_catalogue(p.id,p_branch_id)')
    .replaceAll('GREATEST(p_limit,100)','GREATEST(p_limit,10)');
  await db.exec(before);
  await db.exec('REVOKE ALL ON FUNCTION pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer) TO service_role;');
  for(let n=1;n<=39;n++) {
    const owner=n%3===0?'C':n%2===0?'B':'A';
    await db.query('INSERT INTO products VALUES ($1,$2,$3,$4)',[id(n),owner,JSON.stringify({[owner]:n%5===0?0:n}),n%4!==0]);
    await db.query('INSERT INTO product_barcodes VALUES ($1,$2,$3)',[id(1000-n),id(n),`code-${n}`]);
  }
  // UUID case is canonicalized before serialization; exercise high hex digits too.
  await db.exec(`INSERT INTO products VALUES ('FFFFFFFF-FFFF-4FFF-8FFF-FFFFFFFFFFFF','B','{"B":0}',false);`);
  const page=async(table,branch,cursor=null,limit=10)=>(await db.query(
    'SELECT pos_sync_bootstrap_scoped($1,$2,$3,$4,$5,$6,$7) AS v',['default',branch,'terminal',table,cursor,90,limit])).rows[0].v;
  const pages=async(table,branch)=>{
    const result=[];let cursor=null;
    do {const p=await page(table,branch,cursor);result.push(p);cursor=p.cursor;assert(result.length<20,'Unbounded pages');}while(cursor);
    return result;
  };
  const baseline={};
  for(const table of ['products','product_barcodes'])for(const branch of ['A','B','C','missing']) baseline[`${table}:${branch}`]=await pages(table,branch);
  const definition=async()=>(await db.query("SELECT pg_get_functiondef('pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)'::regprocedure) AS d")).rows[0].d;
  const original=await definition();
  await db.exec(migration);
  const upgraded=await definition();
  await check('only two inspected UUID predicate/order tails change; catalogue filters, cursor shape and limits preserved',async()=>{
    const oldTail=`AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text`;
    const newTail=`AND (p_after_cursor IS NULL OR x."id">((p_after_cursor::jsonb)->>'id')::uuid) ORDER BY x."id"`;
    assert.equal(upgraded.split(newTail).length-1,2);
    assert.equal(upgraded.replaceAll(newTail,oldTail),original);
  });
  for(const table of ['products','product_barcodes']) {
    await check(`${table}: exact legacy/new pages, JSON cursors and cluster boundaries match`,async()=>{
      for(const branch of ['A','B','C','missing']) assert.deepEqual(await pages(table,branch),baseline[`${table}:${branch}`]);
      const all=(await pages(table,'A')).flatMap(p=>p.rows);
      assert.equal(new Set(all.map(p=>p.id)).size,all.length);
      assert(all.length>20,'Fixture must cross multiple page boundaries');
      const end=(await pages(table,'A')).at(-1);assert.equal(end.cursor,null);
      const afterLast=JSON.stringify({id:'ffffffff-ffff-ffff-ffff-ffffffffffff'});
      assert.deepEqual(await page(table,'A',afterLast),{rows:[],cursor:null});
    });
  }
  await check('archived/zero-stock products stay visible within their catalogue cluster',async()=>{
    const rows=(await pages('products','A')).flatMap(p=>p.rows);
    assert(rows.some(p=>p.is_active===false));
    assert(rows.some(p=>p.id==='ffffffff-ffff-4fff-8fff-ffffffffffff'));
    assert(rows.every(p=>['A','B'].includes(p.owner_store_id)));
  });
  await check('reapplication is idempotent and does not change service-only grants',async()=>{
    await db.exec(migration);assert.equal(await definition(),upgraded);
    const grants=(await db.query("SELECT has_function_privilege('anon','pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)','EXECUTE') anon,has_function_privilege('authenticated','pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)','EXECUTE') authenticated,has_function_privilege('service_role','pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)','EXECUTE') service")).rows[0];
    assert.deepEqual(grants,{anon:false,authenticated:false,service:true});
  });
  await check('UUID range/order exposes the existing primary-key seek instead of a JSON sort',async()=>{
    // Small fixtures normally prefer a sequential scan. Disable that preference
    // only for this planner-capability check, not as production configuration.
    await db.exec('SET enable_seqscan=off');
    const cursor=JSON.stringify({id:id(10)});
    const oldPlan=(await db.query(`EXPLAIN (FORMAT JSON) SELECT id FROM products x
      WHERE product_available_in_catalogue(x.id,'A') AND jsonb_build_object('id',x.id)::text>$1
      ORDER BY jsonb_build_object('id',x.id)::text LIMIT 10`,[cursor])).rows[0]['QUERY PLAN'];
    const newPlan=(await db.query(`EXPLAIN (FORMAT JSON) SELECT id FROM products x
      WHERE product_available_in_catalogue(x.id,'A') AND x.id>(($1::jsonb)->>'id')::uuid
      ORDER BY x.id LIMIT 10`,[cursor])).rows[0]['QUERY PLAN'];
    assert(JSON.stringify(oldPlan).includes('"Node Type":"Sort"'));
    assert(JSON.stringify(newPlan).includes('"Index Cond"'));
    assert(!JSON.stringify(newPlan).includes('"Node Type":"Sort"'));
    await db.exec('RESET enable_seqscan');
  });
  await check('unfamiliar query contracts abort rather than guessing at scope',async()=>{
    await db.exec(upgraded.replace('ORDER BY x."id"','ORDER BY x."id" DESC'));
    await assert.rejects(db.exec(migration),/Unrecognized bootstrap keyset contract/);
    await db.exec('ROLLBACK');
  });
  console.log(`${passed} isolated product bootstrap keyset scenarios passed`);
} finally {await db.close();}
