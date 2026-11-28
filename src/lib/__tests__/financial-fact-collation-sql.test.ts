import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import type {PGlite as PGliteDatabase} from '@electric-sql/pglite';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
const {PGlite}=createRequire(import.meta.url)('@electric-sql/pglite');
const read=(file:string)=>readFileSync(file,'utf8').replaceAll('\r\n','\n');
const source=read('scripts/preparation/shift-financial-operation-history.sql');
const start=source.indexOf('CREATE FUNCTION fin62_history_preparation.fact(');
const end=source.indexOf('CREATE FUNCTION fin62_history_preparation.snapshot_fact',start);
const fixed=source.slice(start,end).trim();
const old=fixed.replace('ORDER BY key COLLATE "C"','ORDER BY key');
const migration=read('supabase/migrations/20261118060529_deterministic_financial_fact_key_order.sql');
const fact={branchId:'A',discountAmount:'0.000000000000',id:'11111111-1111-4111-8111-111111111111',isRefunded:false,
 paymentType:'split',paymentsJson:'[{"method":"cash","amount":"7.50"},{"method":"card","amount":"7.50"}]',
 rowVersion:'1',shiftId:'22222222-2222-4222-8222-222222222222',totalAmount:'15.000000000000'};
let db:PGliteDatabase,directory:string;
const base=resolve('.tmp/financial-fact-collation-tests');
const call=(value:unknown=fact)=>db.query<{value:Record<string,unknown>}>('SELECT fin62_history_preparation.fact($1::jsonb) value',[JSON.stringify(value)]);
const metadata=async()=>(await db.query<Record<string,unknown>>(`SELECT oid,proowner,proacl::text,prosecdef,proisstrict,provolatile,proconfig,proargnames,
 md5(replace(prosrc,E'\r\n',E'\n')) source_hash FROM pg_proc WHERE oid='fin62_history_preparation.fact(jsonb)'::regprocedure`)).rows[0];
beforeAll(async()=>{
 mkdirSync(base,{recursive:true});directory=mkdtempSync(join(base,'owned-'));
 db=new PGlite(directory);await db.waitReady;
 // A non-C name alone is insufficient in WASM libc. ICU supplies real
 // linguistic key ordering and reproduces Supabase en_US's failing pair.
 await db.exec("CREATE DATABASE fixture_non_c TEMPLATE template0 LOCALE_PROVIDER icu ICU_LOCALE 'en-US';");
 await db.close();db=new PGlite(directory,{database:'fixture_non_c'});await db.waitReady;
 await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA fin62_cloud_preparation;CREATE SCHEMA fin62_history_preparation;');
 await db.exec(read('scripts/preparation/shift-financial-math-postgres.sql'));
 const known=read('scripts/preparation/shift-financial-known-basis.sql');
 await db.exec(known.slice(0,known.indexOf('CREATE FUNCTION fin62_cloud_preparation.snapshot_financial_fact')));
 await db.exec("CREATE TABLE retained_events(payload text,proof text);INSERT INTO retained_events VALUES('original immutable financial bytes','original author proof');");
},15000);
beforeEach(async()=>{
 await db.exec(`RESET ROLE;DROP FUNCTION IF EXISTS fin62_history_preparation.fact(jsonb);DROP TABLE IF EXISTS fin62_history_preparation.nodes;${old}
 REVOKE ALL ON FUNCTION fin62_history_preparation.fact(jsonb) FROM PUBLIC,anon,authenticated,service_role;`);
});
afterAll(async()=>{
 await db?.close();if(directory){if(!resolve(directory).startsWith(base+sep))throw new Error('Unsafe owned fixture cleanup');rmSync(directory,{recursive:true});}
});
describe('locale-independent strict financial fact keys',()=>{
 it('reproduces the hosted linguistic-order refusal, then admits the same exact split facts',async()=>{
  const keys=(await db.query<{keys:string[]}>('SELECT array_agg(key ORDER BY key) keys FROM jsonb_object_keys($1::jsonb) key',[JSON.stringify(fact)])).rows[0].keys;
  expect(keys.indexOf('paymentsJson')).toBeLessThan(keys.indexOf('paymentType'));
  await expect(call()).rejects.toThrow('FIN62_OPERATION_FACT_INVALID');
  await db.exec(migration);
  expect((await call()).rows[0].value).toMatchObject({id:fact.id,branchId:'A',totalAmount:15,discountAmount:0,isRefunded:false,
   paymentType:'split',payments:[{method:'cash',amount:7.5},{method:'card',amount:7.5}]});
 });
 it('preserves routine identity, all privileges, invocation contract and retained financial bytes across reapply',async()=>{
  const before=await metadata(),rows=(await db.query('SELECT * FROM retained_events')).rows;
  await db.exec(migration);const after=await metadata();
  expect(after).toEqual({...before,source_hash:'49814368b1669fc9d9943aca23eb5ce1'});
  await db.exec(migration);expect(await metadata()).toEqual(after);
  expect((await db.query('SELECT * FROM retained_events')).rows).toEqual(rows);
  const grants=(await db.query("SELECT has_function_privilege('anon','fin62_history_preparation.fact(jsonb)','EXECUTE') anonymous,has_function_privilege('authenticated','fin62_history_preparation.fact(jsonb)','EXECUTE') authenticated,has_function_privilege('service_role','fin62_history_preparation.fact(jsonb)','EXECUTE') service")).rows[0];
  expect(grants).toEqual({anonymous:false,authenticated:false,service:false});
  expect((await db.query<{value:null}>('SELECT fin62_history_preparation.fact(NULL::jsonb) value')).rows[0].value).toBeNull();
 });
 it.each(['extra','missing','number','boolean','tender-type'])('continues to reject malformed %s facts',async kind=>{
  await db.exec(migration);const value:Record<string,unknown>={...fact};
  if(kind==='extra')value.unapproved=true;if(kind==='missing')delete value.discountAmount;
  if(kind==='number')value.totalAmount=15;if(kind==='boolean')value.rowVersion=true;
  if(kind==='tender-type')value.paymentsJson='[{"method":"cash","amount":true}]';
  await expect(call(value)).rejects.toThrow(/FIN62_OPERATION_FACT_INVALID|FIN62_FINANCIAL_FACT_UNVERIFIED/);
 });
 it.each(['body','privilege','definer','strictness'])('refuses an unrecognized %s contract without changing it',async kind=>{
  if(kind==='body')await db.exec("CREATE OR REPLACE FUNCTION fin62_history_preparation.fact(value jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$BEGIN RETURN value;END$$;");
  if(kind==='privilege')await db.exec('GRANT EXECUTE ON FUNCTION fin62_history_preparation.fact(jsonb) TO service_role;');
  if(kind==='definer')await db.exec('ALTER FUNCTION fin62_history_preparation.fact(jsonb) SECURITY DEFINER;');
  if(kind==='strictness')await db.exec('ALTER FUNCTION fin62_history_preparation.fact(jsonb) CALLED ON NULL INPUT;');
  const before=await metadata();await expect(db.exec(migration)).rejects.toThrow('FIN62_FACT_KEY_ORDER_SOURCE_UNEXPECTED');expect(await metadata()).toEqual(before);
 });
 it('does not install optional financial preparation and refuses an incomplete existing baseline',async()=>{
  await db.exec('DROP FUNCTION fin62_history_preparation.fact(jsonb);');
  await db.exec(migration);
  expect((await db.query("SELECT to_regprocedure('fin62_history_preparation.fact(jsonb)') IS NULL absent")).rows[0]).toEqual({absent:true});
  await db.exec('CREATE TABLE fin62_history_preparation.nodes(id int);');
  await expect(db.exec(migration)).rejects.toThrow('FIN62_FACT_KEY_ORDER_BASELINE_MISSING');
 });
});
