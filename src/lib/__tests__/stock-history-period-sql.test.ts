import{PGlite}from'@electric-sql/pglite';
import{readFileSync}from'node:fs';
import{createRequire}from'node:module';
import{beforeAll,beforeEach,afterAll,describe,it,expect}from'vitest';
import{stockReportDay}from'../../../electron/shared/stock-report-day.mjs';
const require=createRequire(import.meta.url),c=require('../../../electron/db/stock-history-contract.cjs');
const base=readFileSync('supabase/migrations/20261105113916_stock_history_effective_ledger.sql','utf8'),upgrade=readFileSync('supabase/migrations/20261106065813_stock_history_selected_time_period_reader.sql','utf8');
const multiDayUpgrade=readFileSync('scripts/preparation/stock-history-multi-day-report.sql','utf8');
const recordedPreparation=readFileSync('scripts/preparation/stock-history-recorded-continuation.sql','utf8');
const schema=readFileSync('supabase/schema.sql','utf8'),terminal='11111111-1111-4111-8111-111111111111',product='22222222-2222-4222-8222-222222222222',zero='22222222-2222-4222-8222-222222222223',baseline='33333333-3333-4333-8333-333333333333';
const opening='2026-11-04T00:00:00.0000000Z',start='2026-11-05T00:00:00.0000000Z',cutoff='2026-11-05T12:00:00.1234567Z';
let db:PGlite,before:Record<string,unknown>;
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0]!)[0];
async function originalDatabase(){
 const fresh=new PGlite();await fresh.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'$$;
 CREATE TABLE app_users(user_id text PRIMARY KEY,role text,role_slug text,store_id text,is_active boolean,permissions jsonb);CREATE TABLE stores(id text PRIMARY KEY);
 CREATE TABLE terminal_tokens(id uuid PRIMARY KEY,location_id text,status text,revoked_at timestamptz,platform text,is_claimed boolean,management_sync_enabled boolean);
 CREATE TABLE shifts(id uuid PRIMARY KEY,store_id text,status text,closed_at timestamptz);`);
 for(const name of ['pos_sync_validate_scope','pos_sync_validate_read_scope']){const fn=new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$fn\\$;`).exec(schema)?.[0];if(!fn)throw Error('Missing current scope helper');await fresh.exec(fn);}
 await fresh.exec(base);return fresh;
}
beforeAll(async()=>{
 db=await originalDatabase();before=(await db.query<Record<string,unknown>>("SELECT oid,proowner,proacl::text,proconfig,prosecdef,provolatile,prokind,proisstrict,proleakproof,proparallel FROM pg_proc WHERE oid='public.pos_stock_history_page(text,text,text,text,text,uuid,integer,text,boolean,uuid)'::regprocedure")).rows[0]!;
 await db.exec(upgrade);
 await db.exec(multiDayUpgrade);
},30000);
afterAll(async()=>db?.close());
beforeEach(async()=>{await db.exec(`RESET ROLE;TRUNCATE stock_history_movements,stock_history_openings,stock_history_baselines,stock_history_heads,app_users,terminal_tokens,stores,shifts CASCADE;
 INSERT INTO stores VALUES('a'),('b');INSERT INTO app_users VALUES('cashier','staff','cashier','a',true,'{"can_view_inventory":true}'),('admin','admin','admin',NULL,true,'{}');
 INSERT INTO terminal_tokens VALUES('${terminal}','a','active',NULL,'pc',true,false);`);});
async function seed(extra:[string,string][]=[]){
 await db.query(`INSERT INTO stock_history_baselines(id,store_id,cutoff_at_raw,cutoff_ticks,captured_at_raw,captured_ticks,source_cursor,opening_kind,verification_state,expected_pairs,terminal_watermarks,verified_by,evidence_hash)
 VALUES($1,'a',$2,$3,$2,$3,0,'system_snapshot','verified',2,'{"fixture":"isolated"}','admin',$4)`,[baseline,opening,String(c.instant(opening)),'a'.repeat(64)]);
 await db.query(`INSERT INTO stock_history_heads(store_id,committed_cursor,coverage_generation,coverage_state,baseline_id,coverage_from_ticks,coverage_through_ticks) VALUES('a',$4,0,'complete',$1,$2,$3)`,[baseline,String(c.instant(opening)),String(c.instant('2026-11-06T00:00:00Z')),4+extra.length]);
 await db.query(`INSERT INTO stock_history_openings(id,baseline_id,product_id,store_id,quantity,product_name,sku,barcode) VALUES(gen_random_uuid(),$1,$2,'a',9007199254740993,'Original archive','0001','0000001'),(gen_random_uuid(),$1,$3,'a',0,'Zero','0002','0000002')`,[baseline,product,zero]);
 const events:[string,string][]=[[c.utc(c.instant(start)-1n),'3'],[start,'2'],[cutoff,'-1'],[c.utc(c.instant(cutoff)+1n),'-4'],...extra];let sequence=0,current=9007199254740993n;
 for(const[effective,delta]of events){sequence++;const operation=`44444444-4444-4444-8444-${String(sequence).padStart(12,'0')}`;
  const row=c.changes(c.normalizeContext({operationId:operation,branchId:'a',terminalId:terminal,actorId:'cashier',kind:'stock',effectiveAt:effective,clockState:'verified'},'2026-11-08T00:00:00.0000000Z'),
   [{id:product,name:'Original archive',stock_by_store:{a:String(current)}}],[{id:product,name:'Original archive',stock_by_store:{a:String(current+BigInt(delta))}}])[0];current+=BigInt(delta);
  await db.query(`INSERT INTO stock_history_movements(id,operation_id,product_id,store_id,terminal_id,actor_id,source_kind,quantity_delta,effective_at_raw,effective_ticks,recorded_at_raw,recorded_ticks,product_name,sku,barcode,clock_state,payload_hash,payload_json,ingested_cursor)
   VALUES($1,$2,$3,'a',$4,'cashier','stock',$5,$6,$7,$8,$9,'Original archive',NULL,NULL,'verified',$10,$11,$12)`,[row.id,operation,product,terminal,delta,effective,String(c.instant(effective)),row.recorded_at_raw,String(c.instant(row.recorded_at_raw)),row.payload_hash,row.payload_json,sequence]);
 }
}
const read=async({actor='cashier',branch='a',at=cutoff,periodStart=start,after=null,revision=null,exporting=false,shift=null}:
 {actor?:string;branch?:string;at?:string;periodStart?:string;after?:string|null;revision?:string|null;exporting?:boolean;shift?:string|null}={})=>scalar('SELECT public.pos_stock_history_period_page($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[actor,terminal,branch,at,'UTC',after,1,revision,exporting,shift,periodStart]) as Promise<any>;
const readMovements=async(revision:string,{branch='a',productId=product,after=null,limit=1,at=cutoff}:
 {branch?:string;productId?:string;after?:{effectiveAt:string;id:string}|null;limit?:number;at?:string}={})=>
 scalar('SELECT public.pos_stock_history_movements_v1($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,$10,$11)',
  ['cashier',terminal,branch,productId,at,'UTC',revision,start,after?.effectiveAt??null,after?.id??null,limit]) as Promise<any>;
describe('one authorized source revision for selected-time stock and explanatory movements',()=>{
 it('preserves old reader identity/ACL/flags while sharing exact current authorization in a private core',async()=>{
  expect((await db.query("SELECT oid,proowner,proacl::text,proconfig,prosecdef,provolatile,prokind,proisstrict,proleakproof,proparallel FROM pg_proc WHERE oid='public.pos_stock_history_page(text,text,text,text,text,uuid,integer,text,boolean,uuid)'::regprocedure")).rows[0]).toEqual(before);
  for(const role of ['anon','authenticated'])expect(await scalar(`SELECT has_function_privilege('${role}','public.pos_stock_history_period_page(text,text,text,text,text,uuid,integer,text,boolean,uuid,text)','EXECUTE')`)).toBe(false);
  expect(await scalar("SELECT has_function_privilege('service_role','private.stock_history_read_page_core(text,text,text,text,text,uuid,integer,text,boolean,uuid,text,uuid,text,uuid)','EXECUTE')")).toBe(false);
  for(const role of ['anon','authenticated','service_role'])expect(await scalar(`SELECT has_function_privilege('${role}','public.pos_stock_history_movements_v1(text,text,text,uuid,text,text,text,text,uuid,text,uuid,integer)','EXECUTE')`)).toBe(role==='service_role');
 });
 it('returns exact selected-time balance and same-revision signed inventory terms, excluding the next100ns',async()=>{
  await seed();const first=await read();expect(first).toMatchObject({status:'complete',cutoff,period:{start,through:cutoff,fullDay:false},rows:[{productId:product,openingQuantity:'9007199254740996',inQuantity:'2',outQuantity:'1',quantity:'9007199254740997'}],next:product});
  expect(await read({after:product,revision:first.sourceRevision})).toMatchObject({status:'complete',rows:[{productId:zero,openingQuantity:'0',inQuantity:'0',outQuantity:'0',quantity:'0'}],next:null});
  const point=await scalar('SELECT public.pos_stock_history_page($1,$2,$3,$4,$5,NULL,100,NULL,false,NULL)',['cashier',terminal,'a',cutoff,'UTC']) as any;
  expect(point.rows[0].quantity).toBe(first.rows[0].quantity);expect(point.rows[0]).not.toHaveProperty('openingQuantity');
  await expect(read({revision:point.sourceRevision})).rejects.toThrow('STOCK_HISTORY_SOURCE_CHANGED');
 });
 it('pages verified product movements by exact tick and UUID without expanding the requested interval or scope',async()=>{
  await seed([[cutoff,'5']]);const {sourceRevision}=await read();
  const first=await readMovements(sourceRevision);
  expect(first).toMatchObject({status:'complete',branchId:'a',productId:product,baselineAt:opening,cutoff,periodStart:start,sourceRevision,
   rows:[{effectiveAt:start,delta:'2',kind:'stock'}],next:{effectiveAt:start,id:first.rows[0].id}});
  expect(Object.keys(first.rows[0]).sort()).toEqual(['delta','effectiveAt','id','kind','recordedAt']);
  const second=await readMovements(sourceRevision,{after:first.next});
  const third=await readMovements(sourceRevision,{after:second.next});
  expect([second.rows[0].delta,third.rows[0].delta].sort()).toEqual(['-1','5']);
  expect(second.rows[0].effectiveAt).toBe(cutoff);expect(third.rows[0].effectiveAt).toBe(cutoff);
  expect(second.rows[0].id<third.rows[0].id).toBe(true);expect(third.next).toBeNull();
  await expect(readMovements(sourceRevision,{branch:'b'})).rejects.toThrow();
  await expect(readMovements(sourceRevision,{productId:baseline})).rejects.toThrow('STOCK_HISTORY_PRODUCT_UNAVAILABLE');
  await expect(readMovements(sourceRevision,{after:{effectiveAt:start,id:baseline}})).rejects.toThrow('STOCK_HISTORY_MOVEMENT_CURSOR_INVALID');
  await db.exec("UPDATE stock_history_heads SET coverage_generation=coverage_generation+1 WHERE store_id='a'");
  await expect(readMovements(sourceRevision)).rejects.toThrow('STOCK_HISTORY_SOURCE_CHANGED');
 });
 it.each(['permission','inactive','page','branch','revoked','export','shift'])('retains current %s denial',async mode=>{
  await seed();if(mode==='permission')await db.exec("UPDATE app_users SET permissions='{}' WHERE user_id='cashier'");if(mode==='inactive')await db.exec("UPDATE app_users SET is_active=false WHERE user_id='cashier'");
  if(mode==='page')await db.exec("UPDATE app_users SET permissions=permissions||'{\"page:inventory\":false}' WHERE user_id='cashier'");if(mode==='revoked')await db.exec('UPDATE terminal_tokens SET revoked_at=now()');
  await expect(read({branch:mode==='branch'?'b':'a',exporting:mode==='export',shift:mode==='shift'?baseline:null})).rejects.toThrow();
 });
 it('refuses an altered period or missing opening rather than returning estimated zero',async()=>{
  await seed();await expect(read({periodStart:'2026-11-05T01:00:00.0000000Z'})).rejects.toThrow('STOCK_HISTORY_RANGE_INVALID');
  await expect(read({at:'2026-11-04T23:59:59.9999999Z'})).rejects.toThrow('STOCK_HISTORY_RANGE_INVALID');
  await expect(read({at:'2026-12-06T00:00:00.0000000Z'})).rejects.toThrow('STOCK_HISTORY_RANGE_INVALID');
  await db.exec('TRUNCATE stock_history_openings');expect(await read()).toMatchObject({status:'incomplete',rows:[]});
 });
 it('recognizes an exact full day without rounding .9999999 into the next date',async()=>{
  await seed();const at='2026-11-05T23:59:59.9999999Z';expect(await read({at})).toMatchObject({cutoff:at,period:{through:at,fullDay:true},rows:[{quantity:'9007199254740993',outQuantity:'5'}]});
 });
 it('reconciles multiple days at the exact inclusive tick under one pinned revision',async()=>{
  const at='2026-11-07T23:59:59.9999999Z',afterCutoff='2026-11-08T00:00:00.0000000Z';
  await seed([[at,'7'],[afterCutoff,'9']]);
  await db.query('UPDATE stock_history_heads SET coverage_through_ticks=$1',[String(c.instant(afterCutoff))]);
  const page=await read({at});
  expect(page).toMatchObject({status:'complete',cutoff:at,period:{start,through:at,endExclusive:afterCutoff,fullDay:true},
   rows:[{productId:product,openingQuantity:'9007199254740996',inQuantity:'9',outQuantity:'5',quantity:'9007199254741000'}],next:product});
  expect(await read({at,after:product,revision:page.sourceRevision})).toMatchObject({status:'complete',next:null,rows:[{productId:zero,quantity:'0'}]});
  expect(await readMovements(page.sourceRevision,{at,limit:10})).toMatchObject({status:'complete',rows:[
   {effectiveAt:start,delta:'2'},{effectiveAt:cutoff,delta:'-1'},{effectiveAt:c.utc(c.instant(cutoff)+1n),delta:'-4'},{effectiveAt:at,delta:'7'},
  ],next:null});
  await expect(read({revision:page.sourceRevision})).rejects.toThrow('STOCK_HISTORY_SOURCE_CHANGED');
  await db.exec("UPDATE stock_history_heads SET coverage_state='incomplete'");
  expect(await read({at})).toMatchObject({status:'incomplete',reasons:['INCOMPLETE_MOVEMENTS'],rows:[]});
 });
 it('uses the same multi-day boundaries as desktop across a daylight-saving change',async()=>{
  await expect(scalar('SELECT private.stock_history_calendar_period($1,$2,$3)',
   [String(c.instant('2026-03-07T05:00:00Z')),String(c.instant('2026-04-07T03:59:59.9999999Z')),'America/New_York']))
   .resolves.toEqual({start:'2026-03-07T05:00:00.0000000Z',endExclusive:'2026-04-07T04:00:00.0000000Z'});
 });
 it.each([['2026-11-06','Asia/Brunei'],['2026-03-08','America/New_York'],['2026-11-01','America/New_York'],['2026-10-04','Australia/Lord_Howe'],
  ['2018-11-04','America/Sao_Paulo'],['2016-11-06','America/Havana'],['1969-09-30','Pacific/Kwajalein'],['1890-01-01','Europe/Paris']])('uses bounded named-zone calendar parity %s / %s',async(date,zone)=>{
  const expected=stockReportDay(date!,zone!);expect(await scalar('SELECT private.stock_history_calendar_day($1,$2)',[date,zone])).toEqual({start:expected.start,endExclusive:expected.endExclusive});
 });
 it.each([['2011-12-30','Pacific/Apia','STOCK_DAY_SKIPPED'],['1867-10-18','America/Juneau','STOCK_DAY_NONCONTIGUOUS']])('refuses nonrepresentable calendar date %s',async(date,zone,code)=>{
  await expect(scalar('SELECT private.stock_history_calendar_day($1,$2)',[date,zone])).rejects.toThrow(code);
 });
});

describe('selected-time reader upgrade fail-closed lifecycle',()=>{
 const reader='public.pos_stock_history_page(text,text,text,text,text,uuid,integer,text,boolean,uuid)';
 const routineState=(connection:PGlite)=>connection.query(`SELECT p.oid,p.prosrc,p.proowner,p.proacl::text,p.proconfig,p.prosecdef,p.provolatile,p.proisstrict,p.proleakproof,p.proparallel
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private') AND p.proname LIKE '%stock_history%' ORDER BY n.nspname,p.proname;`).then(result=>result.rows);
 it.each([
  ['reader body',`CREATE OR REPLACE FUNCTION ${reader.replace(/\([^)]*\)/,'(p_actor text,p_terminal text,p_branch text,p_cutoff text,p_zone text,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 100,p_source_revision text DEFAULT NULL,p_export boolean DEFAULT false,p_closed_shift uuid DEFAULT NULL)')} RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$BEGIN RETURN '{}'::jsonb;END$$;`,'UNKNOWN_READER'],
  ['reader ACL',`GRANT EXECUTE ON FUNCTION ${reader} TO authenticated;`,'UNKNOWN_READER'],
  ['reader search path',`ALTER FUNCTION ${reader} SET search_path=public;`,'UNKNOWN_READER'],
  ['reader volatility',`ALTER FUNCTION ${reader} STABLE;`,'UNKNOWN_READER'],
  ['private auth source',"CREATE OR REPLACE FUNCTION private.stock_history_authorize_read(p_actor text,p_terminal text,p_branch text,p_export boolean) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$BEGIN RETURN;END$$;",'UNKNOWN_HELPER'],
  ['private helper ACL','GRANT EXECUTE ON FUNCTION private.stock_history_ticks(text) TO service_role;','UNKNOWN_HELPER'],
 ])('refuses unknown %s and changes no function before rollback',async(_name,alter,reason)=>{
  const fresh=await originalDatabase();try{
   await fresh.exec(alter!);const prior=await routineState(fresh);
   await expect(fresh.exec(upgrade)).rejects.toThrow(`STOCK_HISTORY_PERIOD_${reason}`);await fresh.exec('ROLLBACK;');
   expect(await routineState(fresh)).toEqual(prior);
  }finally{await fresh.close();}
 },30000);
 it('rolls back every new helper and the old delegate when the outer migration fails',async()=>{
  const fresh=await originalDatabase();try{const prior=await routineState(fresh);
   await expect(fresh.exec(upgrade.replace(/COMMIT;\s*$/,()=>"DO $$BEGIN RAISE EXCEPTION 'OWNED_FIXTURE_FAILURE';END$$;COMMIT;"))).rejects.toThrow('OWNED_FIXTURE_FAILURE');
   await fresh.exec('ROLLBACK;');expect(await routineState(fresh)).toEqual(prior);
   await fresh.exec(upgrade);expect((await fresh.query("SELECT to_regprocedure('public.pos_stock_history_period_page(text,text,text,text,text,uuid,integer,text,boolean,uuid,text)') IS NOT NULL present")).rows[0]).toEqual({present:true});
  }finally{await fresh.close();}
 },30000);
 it('refuses a repeated migration without replacing the accepted helpers or old RPC again',async()=>{
  const fresh=await originalDatabase();try{await fresh.exec(upgrade);const accepted=await routineState(fresh);
   await expect(fresh.exec(upgrade)).rejects.toThrow('STOCK_HISTORY_PERIOD_ALREADY_PRESENT');await fresh.exec('ROLLBACK;');
   expect(await routineState(fresh)).toEqual(accepted);
  }finally{await fresh.close();}
 },30000);
 it('upgrades the existing one-day function in place and safely accepts a repeat',async()=>{
  const fresh=await originalDatabase();try{
   await fresh.exec(upgrade);
   const recorded=recordedPreparation.slice(recordedPreparation.indexOf('CREATE FUNCTION public.pos_stock_history_recorded_page'),
    recordedPreparation.indexOf(' TO service_role;',recordedPreparation.indexOf('GRANT EXECUTE ON FUNCTION public.pos_stock_history_recorded_page'))+' TO service_role;'.length);
   await fresh.exec(recorded);
   const metadata=(connection:PGlite)=>connection.query<{oid:number;prosrc:string;proacl:string|null}>(`SELECT oid,prosrc,proacl::text FROM pg_proc
    WHERE oid='public.pos_stock_history_recorded_page(text,text,text,text,text,uuid,integer,text,text)'::regprocedure`);
   const priorRecorded=(await metadata(fresh)).rows[0];
   const args=['cashier',terminal,'a','2026-11-06T00:00:00.0000000Z','UTC',start];
   const rpc='SELECT public.pos_stock_history_period_page($1,$2,$3,$4,$5,NULL,1,NULL,false,NULL,$6) report';
   await fresh.exec(`INSERT INTO stores VALUES('a');INSERT INTO app_users VALUES('cashier','staff','cashier','a',true,'{"can_view_inventory":true}');
    INSERT INTO terminal_tokens VALUES('${terminal}','a','active',NULL,'pc',true,false);`);
   await expect(fresh.query(rpc,args)).rejects.toThrow('STOCK_HISTORY_PERIOD_INVALID');
   await fresh.exec(multiDayUpgrade);
   expect((await metadata(fresh)).rows[0]).toEqual({...priorRecorded,
    prosrc:expect.stringContaining('period_range:=private.stock_history_calendar_period(period_start,cutoff,p_zone);')});
   const accepted=await routineState(fresh);
   await fresh.exec(multiDayUpgrade);
   expect(await routineState(fresh)).toEqual(accepted);
   expect((await fresh.query(rpc,args)).rows[0]).toMatchObject({report:{status:'incomplete',reasons:['NO_VERIFIED_OPENING'],
    period:{start,endExclusive:'2026-11-07T00:00:00.0000000Z',through:args[3],fullDay:false}}});
  }finally{await fresh.close();}
 },30000);
});
