import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {beforeAll,afterAll,beforeEach,describe,it,expect} from 'vitest';
import {managementDeviceAllowed} from '../management-device-access';
const require=createRequire(import.meta.url),c=require('../../../electron/db/stock-history-contract.cjs');
const migration=readFileSync('supabase/migrations/20261105113916_stock_history_effective_ledger.sql','utf8');
const schema=readFileSync('supabase/schema.sql','utf8');
const normal='10000000-0000-4000-8000-000000000001',management='10000000-0000-4000-8000-000000000002',mobile='10000000-0000-4000-8000-000000000003';
const product='20000000-0000-4000-8000-000000000001',archived='20000000-0000-4000-8000-000000000002',baseline='30000000-0000-4000-8000-000000000001';
const start='2026-11-05T00:00:00.0000000Z',cutoff='2026-11-05T01:00:00.0000001Z';
let db:PGlite;
beforeAll(async()=>{
 db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
  CREATE SCHEMA auth;CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'$$;
  CREATE TABLE app_users(user_id text PRIMARY KEY,role text,role_slug text,store_id text,is_active boolean,permissions jsonb);
  CREATE TABLE stores(id text PRIMARY KEY);
  CREATE TABLE terminal_tokens(id uuid PRIMARY KEY,location_id text,status text,revoked_at timestamptz,platform text,is_claimed boolean,management_sync_enabled boolean);
  CREATE TABLE shifts(id uuid PRIMARY KEY,store_id text,status text,closed_at timestamptz);`);
 for(const name of ['pos_sync_validate_scope','pos_sync_validate_read_scope']){
  const text=new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$fn\\$;`).exec(schema)?.[0];if(!text)throw Error('Current scope helper missing');await db.exec(text);
 }
 await db.exec(migration);
},30000);
afterAll(async()=>db?.close());
beforeEach(async()=>{
 await db.exec(`TRUNCATE stock_history_movements,stock_history_openings,stock_history_baselines,stock_history_heads,app_users,terminal_tokens,stores,shifts CASCADE;
 INSERT INTO stores VALUES('a'),('b');
 INSERT INTO app_users VALUES('admin','admin','admin',NULL,true,'{}'),('cashier','staff','cashier','a',true,'{"can_view_inventory":true}'),
 ('manager','manager','supervisor',NULL,true,'{"can_view_inventory":true,"can_export_reports":true}');
 INSERT INTO terminal_tokens VALUES('${normal}','a','active',NULL,'pc',true,false),('${management}',NULL,'active',NULL,'pc',true,true),('${mobile}',NULL,'active',NULL,'mobile',true,false);`);
});
async function seed(){
 await db.query(`INSERT INTO stock_history_baselines(id,store_id,cutoff_at_raw,cutoff_ticks,captured_at_raw,captured_ticks,source_cursor,opening_kind,verification_state,expected_pairs,terminal_watermarks,verified_by,evidence_hash)
  VALUES($1,'a',$2,$3,$2,$3,0,'system_snapshot','verified',2,'{"fixture":"isolated"}','admin',$4)`,[baseline,start,String(c.instant(start)),'a'.repeat(64)]);
 await db.query(`INSERT INTO stock_history_heads(store_id,committed_cursor,coverage_generation,coverage_state,baseline_id,coverage_from_ticks,coverage_through_ticks)
  VALUES('a',1,0,'complete',$1,$2,$3)`,[baseline,String(c.instant(start)),String(c.instant('2026-11-06T00:00:00Z'))]);
 await db.exec(`INSERT INTO stock_history_openings(id,baseline_id,product_id,store_id,quantity,product_name,sku,barcode)
  VALUES(gen_random_uuid(),'${baseline}','${product}','a',3,'鞋 “A”',NULL,'00001'),(gen_random_uuid(),'${baseline}','${archived}','a',0,'Archived zero','SKU-0',NULL);`);
 const source=c.normalizeContext({operationId:'40000000-0000-4000-8000-000000000001',branchId:'a',terminalId:normal,actorId:'cashier',kind:'sale',clockState:'verified'},cutoff);
 const row=c.changes(source,[{id:product,name:'鞋 “A”',stock_by_store:{a:3}}],[{id:product,name:'鞋 “A”',barcode:'00001',stock_by_store:{a:1}}])[0];
 await db.query(`INSERT INTO stock_history_movements(id,operation_id,product_id,store_id,terminal_id,actor_id,source_kind,quantity_delta,effective_at_raw,effective_ticks,
  recorded_at_raw,recorded_ticks,product_name,sku,barcode,clock_state,payload_hash,payload_json,ingested_cursor)
  VALUES($1,$2,$3,'a',$4,'cashier','sale',-2,$5,$6,$5,$6,$7,NULL,'00001','verified',$8,$9,1)`,
 [row.id,row.operation_id,product,normal,cutoff,String(c.instant(cutoff)),row.product_name,row.payload_hash,row.payload_json]);
}
type Call={actor?:string;terminal?:string|null;branch?:string;at?:string;after?:string|null;limit?:number;revision?:string|null;export?:boolean;closedShift?:string|null};
async function page(value:Call={}){
 const result=await db.query<{page:Record<string,unknown>}>(`SELECT public.pos_stock_history_page($1,$2,$3,$4,'Asia/Brunei',$5,$6,$7,$8,$9) page`,
  [value.actor??'cashier',value.terminal===undefined?normal:value.terminal,value.branch??'a',value.at??cutoff,value.after??null,value.limit??100,value.revision??null,value.export??false,value.closedShift??null]);
 return result.rows[0]!.page;
}
describe('actual cloud stock-history SQL read and authorization',()=>{
 it('never fabricates past stock without a verified opening',async()=>{
  expect(await page()).toMatchObject({status:'incomplete',reasons:['NO_VERIFIED_OPENING'],rows:[]});
 });
 it('uses exact effective cutoff, preserves zero/archived identities and returns bounded matching cursors',async()=>{
  await seed();const first=await page({limit:1});expect(first).toMatchObject({status:'complete',rows:[{productId:product,quantity:'1',name:'鞋 “A”'}],next:product});
  expect(await page({after:product,limit:1,revision:String(first.sourceRevision)})).toMatchObject({rows:[{productId:archived,quantity:'0'}],next:null});
  expect(await page({at:'2026-11-05T01:00:00.0000000Z'})).toMatchObject({rows:[{quantity:'3'},{quantity:'0'}]});
 });
 it('rejects normal Administrator terminal crossbranch access',async()=>{
  await expect(page({actor:'admin',branch:'b'})).rejects.toThrow(/BRANCH_DENIED|SYNC_TERMINAL_SCOPE_FORBIDDEN/);
 });
 it('preserves assigned branch restrictions on browser and Management users',async()=>{
  await db.exec("UPDATE app_users SET store_id='a' WHERE user_id='manager';");
  await expect(page({actor:'manager',terminal:management,branch:'b'})).rejects.toThrow(/BRANCH_DENIED/);
  await expect(page({actor:'manager',terminal:null,branch:'b'})).rejects.toThrow(/BRANCH_DENIED/);
 });
 it('admits actual existing unrestricted Management and browser scope without inventing an assignment list',async()=>{
  expect(await page({actor:'manager',terminal:management,branch:'b'})).toMatchObject({status:'incomplete',branchId:'b'});
  expect(await page({actor:'manager',terminal:null,branch:'b'})).toMatchObject({status:'incomplete',branchId:'b'});
 });
 it('reuses actual PC read validator, including claimed/enabled registration state',async()=>{
  await db.exec(`UPDATE terminal_tokens SET management_sync_enabled=false WHERE id='${management}';`);
  await expect(page({actor:'manager',terminal:management})).rejects.toThrow(/SYNC_TERMINAL_SCOPE_FORBIDDEN/);
 });
 it.each([['manager','supervisor',{},true],['manager','supervisor',{can_use_management_mobile:false},false],['staff','cashier',{can_use_management_mobile:true},true]] as const)(
  'matches actual mobile Management admission %s / %j',async(role,roleSlug,flags,allowed)=>{
   expect(managementDeviceAllowed({role,roleSlug,permissions:flags},true)).toBe(allowed);
   await db.query("UPDATE app_users SET role=$1,role_slug=$2,permissions=$3 WHERE user_id='manager'",[role,roleSlug,JSON.stringify({can_view_inventory:true,...flags})]);
   const result=page({actor:'manager',terminal:mobile});if(allowed)expect(await result).toMatchObject({branchId:'a'});else await expect(result).rejects.toThrow(/MANAGEMENT_DENIED/);
  });
 it('rechecks revocation, current permission and hidden page instead of accepting prior claims',async()=>{
  await db.exec("UPDATE app_users SET permissions='{}' WHERE user_id='cashier';");await expect(page()).rejects.toThrow(/PERMISSION_DENIED/);
  await db.exec("UPDATE app_users SET permissions='{\"can_view_inventory\":true,\"page:inventory\":false}' WHERE user_id='cashier';");await expect(page()).rejects.toThrow(/PERMISSION_DENIED/);
  await db.exec("UPDATE app_users SET permissions='{\"can_view_inventory\":true}' WHERE user_id='cashier';UPDATE terminal_tokens SET revoked_at=now();");await expect(page()).rejects.toThrow(/TERMINAL_DENIED/);
 });
 it('keeps export permission separate and accepts the actual permitted manager',async()=>{
  await expect(page({export:true})).rejects.toThrow(/EXPORT_DENIED/);
  expect(await page({actor:'manager',terminal:management,export:true})).toMatchObject({branchId:'a'});
 });
 it('resolves only a closed samebranch shift at its actual stored source precision',async()=>{
  await seed();const shift='50000000-0000-4000-8000-000000000001';
  await db.exec(`INSERT INTO shifts VALUES('${shift}','a','CLOSED','2026-11-05T01:00:00.123456Z');`);
  expect(await page({at:'2026-11-05T00:00:00.0000000Z',closedShift:shift})).toMatchObject({cutoff:'2026-11-05T01:00:00.1234560Z'});
  await db.exec(`UPDATE shifts SET status='OPEN' WHERE id='${shift}';`);await expect(page({closedShift:shift})).rejects.toThrow(/SHIFT_UNAVAILABLE/);
  await db.exec(`UPDATE shifts SET status='CLOSED',store_id='b' WHERE id='${shift}';`);await expect(page({closedShift:shift})).rejects.toThrow(/SHIFT_UNAVAILABLE/);
 });
 it('denies direct anon/authenticated RPC execution and generic ledger mutation',async()=>{
  for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);try{await expect(page()).rejects.toThrow(/permission denied/);}finally{await db.exec('RESET ROLE');}}
  await db.exec('SET ROLE service_role');try{await expect(db.exec("INSERT INTO stock_history_heads(store_id) VALUES('forged');")).rejects.toThrow(/permission denied/);}finally{await db.exec('RESET ROLE');}
 });
 it('keeps physical movements/openings immutable and refuses incomplete/future coverage',async()=>{
  await seed();await expect(db.exec('UPDATE stock_history_movements SET quantity_delta=3;')).rejects.toThrow(/IMMUTABLE/);
  await expect(db.exec('DELETE FROM stock_history_openings;')).rejects.toThrow(/IMMUTABLE/);
  expect(await page({at:'2020-01-01T00:00:00.0000000Z'})).toMatchObject({status:'unsupported'});
  expect(await page({at:'2099-01-01T00:00:00.0000000Z'})).toMatchObject({status:'unsupported'});
 });
 it('does not silently ignore a late prebaseline arrival even if a stale head says complete',async()=>{
  await seed();const effective='2026-11-04T23:00:00.0000000Z';
  const source=c.normalizeContext({operationId:'40000000-0000-4000-8000-000000000099',branchId:'a',terminalId:normal,actorId:'cashier',kind:'receiving',clockState:'verified',effectiveAt:effective},cutoff);
  const row=c.changes(source,[{id:product,name:'Fixture',stock_by_store:{a:0}}],[{id:product,name:'Fixture',stock_by_store:{a:1}}])[0];
  await db.query(`INSERT INTO stock_history_movements(id,operation_id,product_id,store_id,terminal_id,actor_id,source_kind,quantity_delta,effective_at_raw,effective_ticks,
   recorded_at_raw,recorded_ticks,product_name,clock_state,payload_hash,payload_json,ingested_cursor)
   VALUES($1,$2,$3,'a',$4,'cashier','receiving',1,$5,$6,$7,$8,'Fixture','verified',$9,$10,2)`,
   [row.id,row.operation_id,product,normal,effective,String(c.instant(effective)),cutoff,String(c.instant(cutoff)),row.payload_hash,row.payload_json]);
  await db.exec('UPDATE stock_history_heads SET committed_cursor=2;');
  expect(await page()).toMatchObject({status:'incomplete',reasons:['BASELINE_PREHISTORY_CHANGED'],rows:[]});
 });
});
