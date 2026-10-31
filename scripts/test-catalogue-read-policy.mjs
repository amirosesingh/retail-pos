// Isolated PostgreSQL equivalence tests. Never connects to a live database.
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const directory = new URL('../supabase/migrations/', import.meta.url);
const names = await readdir(directory);
const name = names.find(name => name.endsWith('_optimize_catalogue_read_policy.sql'));
assert(name, 'Create the reviewed migration using the Supabase CLI first');
const migration = await readFile(new URL(name, directory), 'utf8');
const baseline = await readFile(new URL('20261026162030_isolate_cluster_catalogue_reads.sql', directory), 'utf8');
function routine(name) {
  const start = baseline.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = baseline.indexOf('$fn$;', start) + 5;
  assert(start >= 0 && end > start);
  return baseline.slice(start, end);
}
const db = new PGlite();
let passed = 0;
const check = async (title, run) => { await run(); passed++; console.log(`PASS ${title}`); };
const rows = async sql => (await db.query(sql)).rows.map(row => row.id).sort();
async function actor(branches, staff = true) {
  await db.query("SELECT set_config('test.branches',$1,false),set_config('test.staff',$2,false)", [JSON.stringify(branches), String(staff)]);
}
async function equivalent() {
  const before = await rows('SELECT id FROM products WHERE public.product_catalogue_visible_to_me(id)');
  const after = await rows('SELECT public.readable_catalogue_product_ids() AS id');
  assert.deepEqual(after,before);
  await db.exec('SET ROLE authenticated');
  try { assert.deepEqual(await rows('SELECT id FROM products'),before); }
  finally { await db.exec('RESET ROLE'); }
  return after;
}
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE stores(id text PRIMARY KEY,group_id text,private_catalogue boolean DEFAULT false);
    CREATE TABLE pos_settings(id integer PRIMARY KEY,integration_settings jsonb);
    CREATE TABLE settings_scoped(scope text,scope_id text,key text,value jsonb,PRIMARY KEY(scope,scope_id,key));
    CREATE TABLE products(id uuid PRIMARY KEY,owner_store_id text,stock_by_store jsonb);
    CREATE TABLE stock_transfers(id uuid PRIMARY KEY,to_store_id text,status text,posted_at timestamptz);
    CREATE TABLE stock_transfer_items(id uuid PRIMARY KEY,product_id uuid,transfer_id uuid,quantity_verified numeric,quantity_received numeric);
    CREATE INDEX ON stock_transfer_items(product_id);
    CREATE OR REPLACE FUNCTION public.is_staff_now() RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT coalesce(current_setting('test.staff',true),'false')::boolean $$;
    CREATE OR REPLACE FUNCTION public.user_has_store_access(branch text) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT coalesce(current_setting('test.branches',true),'[]')::jsonb ? branch $$;
    ${routine('branch_catalogue_is_private')}
    ${routine('product_available_in_catalogue')}
    ${routine('product_catalogue_visible_to_me')}
    ALTER TABLE products ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON products TO authenticated;
    INSERT INTO stores VALUES('A',' G1 ',true),('A2','G1',true),('B','G2',true),('U',NULL,false),('U2',' ',false),('P',NULL,true);
    INSERT INTO pos_settings VALUES(1,'{"branches":{}}');
    INSERT INTO settings_scoped VALUES('GLOBAL','','pos_field:integration_settings','{"branches":{}}');
    INSERT INTO products(id,owner_store_id,stock_by_store)
    SELECT md5(owner.n::text||':'||stock.n::text)::uuid,owner.id,stock.value
    FROM (VALUES(1,'A'),(2,'A2'),(3,'B'),(4,'U'),(5,'U2'),(6,'P'),(7,NULL),(8,''),(9,'gone')) owner(n,id)
    CROSS JOIN (VALUES(1,'{}'::jsonb),(2,'{"A":0}'),(3,'{"A":1}'),(4,'{"A":-1}'),
      (5,'{"a2":2.5}'),(6,'{"B":4}'),(7,'{"A":"invalid"}'),(8,'{"A":null}'),
      (9,'{"U":1}'),(10,'{"unknown":5}'),(11,'{"A":0,"B":-1}'),(12,NULL)) stock(n,value);
  `);
  await db.exec(migration);
  await check('owner, same-cluster, ownerless evidence, zero/negative and foreign-cluster equivalence', async () => {
    for(const branches of [[],['A'],['A2'],['B'],['U'],['P'],['A','B'],['A','A2','B','U','U2','P']]) {
      await actor(branches); await equivalent();
    }
  });
  await check('a non-staff caller receives no product IDs despite branch grants', async () => {
    await actor(['A','B','U'],false); assert.deepEqual(await equivalent(),[]);
  });
  await check('legacy and scoped case-insensitive privacy flags preserve OR semantics', async () => {
    await db.exec(`UPDATE pos_settings SET integration_settings='{"branches":{"u":{"privateCatalogue":true},"U2":{"privateCatalogue":false}}}';
      UPDATE settings_scoped SET value='{"branches":{"u2":{"privateCatalogue":true}}}';`);
    for(const branches of [['U'],['U2'],['A'],['U','U2']]) { await actor(branches); await equivalent(); }
    await db.exec(`UPDATE pos_settings SET integration_settings='{"branches":{}}';UPDATE settings_scoped SET value='{"branches":{}}';`);
  });
  await check('posted positive received transfers preserve destination-cluster visibility', async () => {
    await db.exec(`INSERT INTO stock_transfers VALUES
      (md5('t1')::uuid,'B','completed',now()),(md5('t2')::uuid,'A2','completed_with_discrepancy',now()),
      (md5('t3')::uuid,'B','completed',NULL),(md5('t4')::uuid,'B','approved',now()),
      (md5('t5')::uuid,'B','completed',now());
      INSERT INTO stock_transfer_items VALUES
      (md5('i1')::uuid,md5('1:1')::uuid,md5('t1')::uuid,NULL,2),
      (md5('i2')::uuid,md5('3:1')::uuid,md5('t2')::uuid,1,0),
      (md5('i3')::uuid,md5('1:2')::uuid,md5('t3')::uuid,2,2),
      (md5('i4')::uuid,md5('1:3')::uuid,md5('t4')::uuid,2,2),
      (md5('i5')::uuid,md5('1:4')::uuid,md5('t5')::uuid,0,2);`);
    for(const branches of [['A'],['A2'],['B'],['U'],['A','B']]) { await actor(branches); await equivalent(); }
    await actor(['B']); const ids=await equivalent();
    assert(ids.includes((await db.query("SELECT md5('1:1')::uuid AS id")).rows[0].id));
    for(const stock of [2,3,4]) assert(!ids.includes((await db.query(`SELECT md5('1:${stock}')::uuid AS id`)).rows[0].id));
  });
  await check('single-cluster legacy ownerless fallback remains exact', async () => {
    await db.exec(`UPDATE stores SET group_id='ONLY' WHERE id='B';UPDATE stores SET group_id='ONLY' WHERE id IN('A','A2');`);
    for(const branches of [['A'],['U'],['P'],['U','P']]) { await actor(branches); await equivalent(); }
  });
  await check('thousands of catalogue rows preserve exactly the same authorized IDs', async () => {
    await db.exec(`UPDATE stores SET group_id='G1' WHERE id IN('A','A2');UPDATE stores SET group_id='G2' WHERE id='B';
      INSERT INTO products(id,owner_store_id,stock_by_store)
      SELECT md5('scale:'||n)::uuid,CASE n%3 WHEN 0 THEN 'A' WHEN 1 THEN 'B' ELSE NULL END,
        CASE WHEN n%5=0 THEN '{"A":0}'::jsonb ELSE '{}'::jsonb END
      FROM generate_series(1,3000) n;`);
    for(const branches of [['A'],['U'],['A','B','U']]) { await actor(branches); await equivalent(); }
  });
  await check('anonymous users cannot invoke the private read-policy helper', async () => {
    await db.exec('SET ROLE anon');
    try { await assert.rejects(db.query('SELECT public.readable_catalogue_product_ids()'),/permission denied/); }
    finally { await db.exec('RESET ROLE'); }
  });
  await check('RLS computes the authorized product-ID set only once per statement', async () => {
    await actor(['A','B']);
    await db.exec('SET ROLE authenticated');
    let plan;
    try { plan=(await db.query('EXPLAIN (ANALYZE,VERBOSE,FORMAT JSON) SELECT id FROM products ORDER BY id')).rows[0]['QUERY PLAN']; }
    finally { await db.exec('RESET ROLE'); }
    const nodes=[]; const walk=value=>{if(!value||typeof value!=='object')return;if(value['Node Type']==='ProjectSet' && JSON.stringify(value.Output).includes('readable_catalogue_product_ids'))nodes.push(value);for(const child of Object.values(value))if(typeof child==='object')walk(child);};walk(plan);
    assert.equal(nodes.length,1);assert.equal(nodes[0]['Actual Loops'],1);
  });
  console.log(`${passed} isolated catalogue read-policy scenarios passed`);
} finally { await db.close(); }
