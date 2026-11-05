import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,beforeEach,describe,it,expect} from 'vitest';
const prepared=readFileSync('supabase/migrations/20261105113916_stock_history_effective_ledger.sql','utf8');
const capture=readFileSync('supabase/migrations/20261105172030_stock_history_accepted_effect_capture.sql','utf8');
const product='11111111-1111-4111-8111-111111111111',receipt='22222222-2222-4222-8222-222222222222';
let db:PGlite;
beforeAll(async()=>{
 db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
  CREATE TABLE app_users(user_id text PRIMARY KEY,role text,role_slug text,store_id text,is_active boolean,permissions jsonb);
  CREATE TABLE terminal_tokens(id uuid PRIMARY KEY,location_id text,status text,revoked_at timestamptz,platform text,is_claimed boolean,management_sync_enabled boolean);
  CREATE TABLE products(id uuid PRIMARY KEY,name text,sku text,barcode text,owner_store_id text,stock_by_store jsonb,stock_quantity integer,price numeric);
  CREATE TABLE stock_delta_applied(movement_id uuid PRIMARY KEY,product_id uuid,store_id text,delta integer);
  CREATE TABLE item_activity_logs(id uuid PRIMARY KEY,product_id uuid,store_id text,quantity_delta integer);
  CREATE TABLE shifts(id uuid PRIMARY KEY,store_id text,status text,closed_at timestamptz);
  CREATE TABLE stores(id text PRIMARY KEY);
  INSERT INTO stores VALUES('a'),('b');
  INSERT INTO app_users VALUES('admin','admin','admin',NULL,true,'{}');
  INSERT INTO products VALUES('${product}','Existing','0001','00001','a','{"a":3,"b":2}',5,19.95);
  GRANT SELECT ON products TO service_role;`);
 await db.exec(prepared);await db.exec(capture);
 const rows=await db.query('SELECT * FROM private.stock_history_accepted_effects');expect(rows.rows).toHaveLength(0);
 expect((await db.query<{stock_by_store:object}>('SELECT stock_by_store FROM products')).rows[0]!.stock_by_store).toEqual({a:3,b:2});
},30000);
afterAll(async()=>db?.close());
beforeEach(async()=>{
 await db.exec(`TRUNCATE private.stock_history_effect_coverage,private.stock_history_effect_sources,private.stock_history_accepted_effects,private.stock_history_source_receipts,private.stock_history_capture_gaps,stock_delta_applied,item_activity_logs,stock_history_heads,stock_history_openings,stock_history_baselines;
  UPDATE products SET stock_by_store='{"a":3,"b":2}',stock_quantity=5,price=19.95 WHERE id='${product}';
  DELETE FROM products WHERE id<>'${product}';
  TRUNCATE private.stock_history_effect_coverage,private.stock_history_effect_sources,private.stock_history_accepted_effects,private.stock_history_source_receipts,private.stock_history_capture_gaps;
  INSERT INTO stock_history_heads(store_id) VALUES('a'),('b');`);
});
const rows=async(table:string)=>(await db.query<Record<string,unknown>>('SELECT * FROM private.'+table)).rows;
async function sourceAndChange(branch='a',delta=-1){
 await db.exec(`BEGIN;INSERT INTO stock_delta_applied VALUES('${receipt}','${product}','${branch}',${delta});
  UPDATE products SET stock_by_store='{"a":2,"b":2}' WHERE id='${product}';COMMIT;`);
}
describe('actual accepted cloud stock effects, without claiming original author/time',()=>{
 it('captures the real persisted delta and uniquely matching same-transaction receipt once',async()=>{
  await sourceAndChange();const effects=await rows('stock_history_accepted_effects'),links=await rows('stock_history_effect_sources');
  expect(effects).toHaveLength(1);expect(effects[0]).toMatchObject({product_id:product,store_id:'a',previous_quantity:'3',next_quantity:'2',quantity_delta:'-1',operation:'UPDATE',timing_state:'unverified'});
  expect(links).toEqual([{effect_id:effects[0]!.id,movement_id:receipt}]);
  expect((await db.query('SELECT price,stock_quantity FROM products')).rows[0]).toEqual({price:'19.95',stock_quantity:5});
  expect((await db.query('SELECT count(*)::int n FROM stock_history_movements')).rows[0]).toEqual({n:0});
  expect((await db.query("SELECT private.stock_history_capture_state('a') state")).rows[0]).toEqual({state:{revision:'1:0:0',unvalidatedEffects:'1',captureGaps:'0'}});
  expect((await db.query("SELECT coverage_state,coverage_generation::text generation FROM stock_history_heads WHERE store_id='a'")).rows[0]).toEqual({coverage_state:'unverified',generation:'0'});
  expect((await db.query("SELECT coverage_state FROM stock_history_heads WHERE store_id='b'")).rows[0]).toEqual({coverage_state:'unverified'});
 });
 it('does not turn a source receipt alone into an actual movement',async()=>{
  await db.exec(`INSERT INTO stock_delta_applied VALUES('${receipt}','${product}','a',-1);`);
  expect(await rows('stock_history_source_receipts')).toHaveLength(1);
  expect(await rows('stock_history_accepted_effects')).toHaveLength(0);expect(await rows('stock_history_effect_sources')).toHaveLength(0);
 });
 it('returns candidate effects only for exact accepted quantities, scope and real source representations',async()=>{
  await sourceAndChange();const refs=[['stock_delta_applied',receipt,'-1']];
  const query=async(delta=-1,branch='a',references=refs)=>(await db.query<{proof:Record<string,unknown>}>(
   `SELECT private.stock_history_match_effect_candidates($1,$2,$3,$4::jsonb) proof`,[product,branch,delta,JSON.stringify(references)])).rows[0]!.proof;
  const proof=await query();expect(proof).toMatchObject({quantity:'-1',timingState:'unverified'});expect(proof.effectIds).toHaveLength(1);
  await expect(query(-2)).rejects.toThrow(/SOURCE_NOT_ACCEPTED/);await expect(query(-1,'b')).rejects.toThrow(/SOURCE_NOT_ACCEPTED/);
  await expect(query(-1,'a',[['stock_delta_applied',product,'-1']])).rejects.toThrow(/SOURCE_NOT_ACCEPTED/);
  await expect(query(-1,'a',[...refs,...refs])).rejects.toThrow(/INVALID_SOURCE/);
  await expect(query(-1,'a',[['item_activity_logs',receipt,'-1']])).rejects.toThrow(/SOURCE_NOT_ACCEPTED/);
  await db.exec(`INSERT INTO item_activity_logs VALUES('${receipt}','${product}','a',-1);`);
  expect(await query(-1,'a',[...refs,['item_activity_logs',receipt,'-1']])).toMatchObject({effectIds:proof.effectIds,quantity:'-1'});
  await expect(query(-1,'a',[['stock_adjustments',receipt,'-1']])).rejects.toThrow(/SOURCE_NOT_ACCEPTED/);
  expect((await db.query('SELECT count(*)::int n FROM stock_history_movements')).rows[0]).toEqual({n:0});
 });
 it.each([['wrong branch','b',-1],['wrong delta','a',-2]] as const)('retains an unbound effect for %s',async(_,branch,delta)=>{
  await sourceAndChange(branch,delta);expect(await rows('stock_history_accepted_effects')).toHaveLength(1);
  expect(await rows('stock_history_effect_sources')).toHaveLength(0);
 });
 it('does not pick a source by UUID/time when two equal candidates are ambiguous',async()=>{
  await db.exec(`BEGIN;INSERT INTO stock_delta_applied VALUES('${receipt}','${product}','a',-1),(gen_random_uuid(),'${product}','a',-1);
   UPDATE products SET stock_by_store='{"a":2,"b":2}' WHERE id='${product}';COMMIT;`);
  expect(await rows('stock_history_accepted_effects')).toHaveLength(1);expect(await rows('stock_history_effect_sources')).toHaveLength(0);
 });
 it('cannot reuse a receipt from an earlier transaction or a prior actual effect',async()=>{
  await sourceAndChange();await db.exec(`UPDATE products SET stock_by_store='{"a":1,"b":2}' WHERE id='${product}';`);
  expect(await rows('stock_history_accepted_effects')).toHaveLength(2);expect(await rows('stock_history_effect_sources')).toHaveLength(1);
 });
 it('keeps actual effects, receipt evidence and business writes atomic on rollback',async()=>{
  await db.exec(`BEGIN;INSERT INTO stock_delta_applied VALUES('${receipt}','${product}','a',-1);UPDATE products SET stock_by_store='{"a":2,"b":2}' WHERE id='${product}';ROLLBACK;`);
  expect(await rows('stock_history_accepted_effects')).toHaveLength(0);expect(await rows('stock_history_source_receipts')).toHaveLength(0);
  expect((await db.query('SELECT stock_by_store FROM products')).rows[0]).toEqual({stock_by_store:{a:3,b:2}});
  expect((await db.query("SELECT coverage_generation::text generation FROM stock_history_heads WHERE store_id='a'")).rows[0]).toEqual({generation:'0'});
 });
 it('avoids repeating identical stock or metadata-only writes',async()=>{
  await sourceAndChange();await db.exec(`INSERT INTO stock_delta_applied VALUES('${receipt}','${product}','a',-1) ON CONFLICT DO NOTHING;
   UPDATE products SET stock_by_store='{"b":2,"a":2}',price=20 WHERE id='${product}';`);
  expect(await rows('stock_history_accepted_effects')).toHaveLength(1);expect(await rows('stock_history_source_receipts')).toHaveLength(1);
 });
 it('preserves zero/negative stock, product creation and deletion evidence',async()=>{
  await db.exec(`INSERT INTO products VALUES(gen_random_uuid(),'Zero',NULL,'00000','a','{"a":0}',0,1);`);
  expect((await rows('stock_history_accepted_effects'))[0]).toMatchObject({quantity_delta:'0',operation:'INSERT',store_id:'a'});
  await db.exec(`UPDATE products SET stock_by_store='{"a":-1,"b":2}' WHERE id='${product}';DELETE FROM products WHERE name='Zero';`);
  expect((await rows('stock_history_accepted_effects')).map(row=>[row.operation,row.quantity_delta])).toEqual([['INSERT','0'],['UPDATE','-4'],['DELETE','0']]);
 });
 it.each([['{"a":1.5,"b":2}','UNVERIFIED_STOCK_QUANTITY'],['[]','UNVERIFIED_STOCK_SHAPE']] as const)(
  'records unsupported stock as a coverage gap without rewriting or refusing the business value %s',async(map,reason)=>{
   await db.query(`UPDATE products SET stock_by_store=$1::jsonb WHERE id=$2`,[map,product]);
   expect((await rows('stock_history_capture_gaps'))[0]).toMatchObject({reason,product_id:product});
   expect((await db.query('SELECT stock_by_store FROM products')).rows[0]).toEqual({stock_by_store:JSON.parse(map)});
   expect((await db.query<{state:{captureGaps:string}}>("SELECT private.stock_history_capture_state('a') state")).rows[0]!.state.captureGaps).toBe('1');
  });
 it('does not invent an empty-map product branch from ownership or aggregate stock',async()=>{
  await db.exec(`INSERT INTO products VALUES(gen_random_uuid(),'Unscoped',NULL,NULL,'a','{}',7,1);`);
  expect((await rows('stock_history_capture_gaps'))[0]).toMatchObject({reason:'MISSING_SCOPED_COHORT',store_id:null});
  expect(await rows('stock_history_accepted_effects')).toHaveLength(0);
 });
 it('an older complete reader head cannot silently omit a newly accepted unvalidated effect',async()=>{
  const baseline='55555555-5555-4555-8555-555555555555',start='2026-11-05T00:00:00.0000000Z',cutoff='2026-11-05T01:00:00.0000000Z';
  await db.exec(`INSERT INTO stock_history_baselines(id,store_id,cutoff_at_raw,cutoff_ticks,captured_at_raw,captured_ticks,source_cursor,opening_kind,verification_state,expected_pairs,terminal_watermarks,verified_by,evidence_hash)
   VALUES('${baseline}','a','${start}',private.stock_history_ticks('${start}'),'${start}',private.stock_history_ticks('${start}'),0,'system_snapshot','verified',1,'{}','fixture','${'a'.repeat(64)}');
   INSERT INTO stock_history_openings(id,baseline_id,product_id,store_id,quantity,product_name) VALUES(gen_random_uuid(),'${baseline}','${product}','a',3,'Existing');
   UPDATE stock_history_heads SET baseline_id='${baseline}',coverage_state='complete',coverage_from_ticks=private.stock_history_ticks('${start}'),coverage_through_ticks=private.stock_history_ticks('${cutoff}') WHERE store_id='a';`);
  const read=async()=>(await db.query<{page:Record<string,unknown>}>(`SELECT pos_stock_history_page('admin',NULL,'a','${cutoff}','Asia/Brunei',NULL,100,NULL,false,NULL) page`)).rows[0]!.page;
  expect(await read()).toMatchObject({status:'complete',rows:[{quantity:'3'}]});await sourceAndChange();
  expect(await read()).toMatchObject({status:'incomplete',reasons:['UNVALIDATED_STOCK_EFFECTS'],rows:[]});
  expect((await db.query("SELECT coverage_state FROM stock_history_heads WHERE store_id='a'")).rows[0]).toEqual({coverage_state:'complete'});
 });
 it('keeps private evidence immutable and denies every API role direct writes/reads/execution',async()=>{
  await sourceAndChange();await expect(db.exec('UPDATE private.stock_history_accepted_effects SET quantity_delta=5')).rejects.toThrow(/IMMUTABLE/);
  await expect(db.exec('DELETE FROM private.stock_history_effect_sources')).rejects.toThrow(/IMMUTABLE/);
  for(const role of ['anon','authenticated','service_role']){
   await db.exec('SET ROLE '+role);try{
    await expect(db.exec('SELECT * FROM private.stock_history_accepted_effects')).rejects.toThrow(/permission denied/);
    await expect(db.exec(`SELECT private.stock_history_capture_gap('${product}',NULL,'UPDATE','forged')`)).rejects.toThrow(/permission denied/);
   }finally{await db.exec('RESET ROLE');}
  }
  expect((await db.query("SELECT has_table_privilege('service_role','products','SELECT') allowed")).rows[0]).toEqual({allowed:true});
 });
 it('aborts unknown existing capture schema instead of replacing it',async()=>{
  await expect(db.exec(capture)).rejects.toThrow(/EXISTING_SCHEMA_REVIEW_REQUIRED/);await db.exec('ROLLBACK');
  expect(await rows('stock_history_accepted_effects')).toHaveLength(0);
 });
});
