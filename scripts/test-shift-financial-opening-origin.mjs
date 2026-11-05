// FIN62 disposable actual guarded OPEN writer fixture only. No operator DB/network.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import Module from 'node:module';
import {dirname} from 'node:path';
const native=process.argv.slice(2).join(' ')==='--native';assert(process.argv.length===2||native,'Only --native fixture mode is accepted');
const require=createRequire(import.meta.url),read=p=>readFile(new URL('../'+p,import.meta.url),'utf8'),helperPath=require.resolve('./lib/shift-protocol-integration-fixture.cjs');
let{createCloud}=require(helperPath),nativeDb;
if(native){const source=await read('scripts/test-seven-shift-summary-native.fixture.mjs');const factory=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {createNativeFixture};').toString('base64'));nativeDb=await factory.createNativeFixture();globalThis.__fin62OriginFixture=nativeDb;
 const sourceCloud=await read('scripts/lib/shift-protocol-integration-fixture.cjs'),anchor="const db = new PGlite(), schema = read('supabase/schema.sql');";assert(sourceCloud.includes(anchor));const compiled=new Module(helperPath);compiled.filename=helperPath;compiled.paths=Module._nodeModulePaths(dirname(helperPath));compiled._compile(sourceCloud.replace(anchor,"const db = globalThis.__fin62OriginFixture, schema = read('supabase/schema.sql');"),helperPath);createCloud=compiled.exports.createCloud;}
const terminal=randomUUID(),shift=randomUUID(),local=randomUUID(),batch=randomUUID();let db;try{db=await createCloud('A',terminal);}catch(error){await nativeDb?.close();throw error;}finally{delete globalThis.__fin62OriginFixture;}
let passed=0;const test=async(name,run)=>{await run();passed++;console.log('PASS '+name);};const hash=text=>createHash('sha256').update(text).digest('hex');
const operations=row=>[{table:'shifts',rows:[row],changes:[],dependencyOrder:1}];
const opening=async(row,extra={})=>{const raw=extra.raw??JSON.stringify(row);return(await db.query('SELECT public.prototype_fin62_push_open_origin($1,$2,$3,$4,$5,$6,$7,$8::jsonb) value',[extra.batch??batch,'default',extra.branch??'A',extra.terminal??terminal,extra.local??local,raw,extra.hash??hash(raw),JSON.stringify(extra.operations??operations(row))])).rows[0].value;};
const counts=async()=>(await db.query('SELECT (SELECT count(*)::int FROM fin62_origin_preparation.origins) origins,(SELECT count(*)::int FROM fin62_origin_preparation.births) births,(SELECT count(*)::int FROM fin62_origin_preparation.active_context) pending')).rows[0];
try{
 await db.exec("INSERT INTO stores VALUES('A','A'),('B','B');ALTER TABLE terminal_tokens ADD management_sync_enabled boolean DEFAULT false;SET pos.shift_fn='on'");
 await db.query("INSERT INTO shifts(id,store_id,terminal_id,status,state,opening_float,row_version,opened_at) VALUES($1,'A',$2,'OPEN','ACTIVE',20,1,now())",[shift,terminal]);await db.exec("SET pos.shift_fn=''");
 const row=(await db.query('SELECT to_jsonb(s) value FROM shifts s WHERE id=$1',[shift])).rows[0].value;await db.query('DELETE FROM shifts WHERE id=$1',[shift]);
 const captures=JSON.parse(await read('scripts/fixtures/management-shift-read-validators.json'));for(const row of captures){assert.equal(hash(row.definition),row.sha256);await db.exec(row.definition);}
 for(const file of ['shift-financial-math-postgres.sql','shift-financial-cloud-receipts.sql','shift-financial-version-receipts.sql','shift-financial-known-basis.sql','shift-financial-opening-origin.sql'])await db.exec(await read('scripts/preparation/'+file));
 const oldWriter=(await db.query("SELECT pg_get_functiondef('public.pos_sync_push_aggregate(uuid,text,text,text,jsonb)'::regprocedure) value")).rows[0].value;
 let accepted;
 await test('actual guarded first OPEN creates one same-transaction empty birth basis and immutable origin',async()=>{
  accepted=await opening(row);assert.equal(accepted.ok,true);assert.equal(accepted.originReplayed,false);assert.deepEqual(accepted.openingOrigin,{localAggregateId:local,rowHash:hash(JSON.stringify(row))});
  assert.deepEqual(await counts(),{origins:1,births:1,pending:0});const stored=(await db.query('SELECT basis FROM fin62_cloud_preparation.bases WHERE id=$1',[accepted.birthBasisId])).rows[0].basis;assert.deepEqual(stored.inputs,[]);assert.equal(stored.openingFloat,'20');
 });
 await test('exact accepted replay returns the old birth without regenerating it',async()=>{const reply=await opening(row);assert.equal(reply.originReplayed,true);assert.equal(reply.birthBasisId,accepted.birthBasisId);assert.deepEqual(await counts(),{origins:1,births:1,pending:0});});
 await test('origin resolves only exact terminal branch shift local aggregate and raw opening hash',async()=>{
  const resolve=(origin,branch='A',device=terminal,id=shift)=>db.query('SELECT fin62_origin_preparation.resolve($1,$2,$3,$4,$5::jsonb) value',['default',branch,device,id,JSON.stringify(origin)]);
  assert.equal((await resolve(accepted.openingOrigin)).rows[0].value,accepted.birthBasisId);
  for(const origin of [{...accepted.openingOrigin,rowHash:'a'.repeat(64)},{...accepted.openingOrigin,localAggregateId:randomUUID()}])await assert.rejects(resolve(origin),/UNPROVEN/);
  await assert.rejects(resolve(accepted.openingOrigin,'B'),/UNPROVEN/);await assert.rejects(resolve(accepted.openingOrigin,'A',randomUUID()),/UNPROVEN/);await assert.rejects(resolve(accepted.openingOrigin,'A',terminal,randomUUID()),/UNPROVEN/);
 });
 await test('raw hash operations or replay body substitutions are rejected',async()=>{await assert.rejects(opening(row,{hash:'a'.repeat(64)}),/INPUT_INVALID/);await assert.rejects(opening({...row,opening_float:21}),/CONFLICT/);await assert.rejects(opening(row,{operations:[...operations(row),{table:'sales',rows:[],changes:[]}]}),/OPERATIONS_INVALID/);});
 await test('existing write scope rejects another branch before any origin is created',async()=>{await assert.rejects(opening({...row,id:randomUUID(),store_id:'B'},{branch:'B',local:randomUUID(),batch:randomUUID()}),/SCOPE_FORBIDDEN/);assert.deepEqual(await counts(),{origins:1,births:1,pending:0});});
 await test('legacy unwrapped OPEN cannot be retrospectively relabeled with a fabricated birth',async()=>{
  const legacy={...row,id:randomUUID()};await db.query('SELECT pos_sync_push_aggregate($1,$2,$3,$4,$5::jsonb)',[randomUUID(),'default','A',terminal,JSON.stringify(operations(legacy))]);
  await assert.rejects(opening(legacy,{local:randomUUID(),batch:randomUUID()}),/NOT_NEW/);assert.deepEqual(await counts(),{origins:1,births:1,pending:0});
 });
 await test('missing actual birth trigger aborts the new opening and all helper metadata',async()=>{
  const missing={...row,id:randomUUID()};await db.exec('ALTER TABLE shifts DISABLE TRIGGER prototype_fin62_capture_open_birth');
  try{await assert.rejects(opening(missing,{local:randomUUID(),batch:randomUUID()}),/BIRTH_MISSING/);}finally{await db.exec('ALTER TABLE shifts ENABLE TRIGGER prototype_fin62_capture_open_birth');}
  assert.equal((await db.query('SELECT count(*)::int n FROM shifts WHERE id=$1',[missing.id])).rows[0].n,0);assert.deepEqual(await counts(),{origins:1,births:1,pending:0});
 });
 await test('failure after actual birth creation rolls back baseline origin and opening together',async()=>{
  const before=(await db.query('SELECT count(*)::int n FROM fin62_cloud_preparation.bases')).rows[0].n,newRow={...row,id:randomUUID()};
  await db.exec("CREATE FUNCTION public.prototype_fin62_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'FIXTURE_AFTER_BIRTH';END$$;CREATE TRIGGER zzz_fin62_fixture_fail AFTER INSERT ON shifts FOR EACH ROW EXECUTE FUNCTION public.prototype_fin62_test_fail();");
  try{await assert.rejects(opening(newRow,{local:randomUUID(),batch:randomUUID()}),/FIXTURE_AFTER_BIRTH/);}finally{await db.exec('DROP TRIGGER zzz_fin62_fixture_fail ON shifts;DROP FUNCTION public.prototype_fin62_test_fail();');}
  assert.equal((await db.query('SELECT count(*)::int n FROM shifts WHERE id=$1',[newRow.id])).rows[0].n,0);assert.equal((await db.query('SELECT count(*)::int n FROM fin62_cloud_preparation.bases')).rows[0].n,before);assert.deepEqual(await counts(),{origins:1,births:1,pending:0});
 });
 await test('later financial writes do not replace birth baseline and old OPEN replay cannot reopen a closed shift',async()=>{
  await db.query("INSERT INTO sales(id,bill_number,store_id,shift_id,total_amount) VALUES($1,'LATER-ONLY','A',$2,100)",[randomUUID(),shift]);
  assert.deepEqual((await db.query('SELECT basis FROM fin62_cloud_preparation.bases WHERE id=$1',[accepted.birthBasisId])).rows[0].basis.inputs,[]);
  await db.exec("SET pos.shift_fn='on'");await db.query("UPDATE shifts SET status='CLOSED',state='CLOSED',closed_at=now() WHERE id=$1",[shift]);await db.exec("SET pos.shift_fn=''");
  assert.equal((await opening(row)).originReplayed,true);assert.equal((await db.query('SELECT status FROM shifts WHERE id=$1',[shift])).rows[0].status,'CLOSED');
 });
 await test('origin receipts are immutable and no client/service role can access private metadata',async()=>{
  await assert.rejects(db.exec('UPDATE fin62_origin_preparation.origins SET row_hash=row_hash'),/IMMUTABLE/);
  for(const role of ['anon','authenticated','service_role']){await db.exec('SET ROLE '+role);await assert.rejects(db.exec('SELECT * FROM fin62_origin_preparation.origins'),/permission denied/);if(role!=='service_role')await assert.rejects(opening(row),/permission denied/);await db.exec('RESET ROLE');}
 });
 await test('actual old aggregate routine remains unchanged',async()=>{assert.equal((await db.query("SELECT pg_get_functiondef('public.pos_sync_push_aggregate(uuid,text,text,text,jsonb)'::regprocedure) value")).rows[0].value,oldWriter);});
 console.log(passed+' isolated actual-OPEN birth-origin groups passed. NOT HTTP/user proof verification, retroactive history or live activation.');
}finally{await db.close();}
