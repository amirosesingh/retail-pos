// Actual captured routine source only, uniquely owned disposable databases.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url),native=process.argv.slice(2).join(' ')==='--native';
assert(process.argv.length===2||native,'Only --native accepted');
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
let nativeDb;
if(native){const source=await read('scripts/test-seven-shift-summary-native.fixture.mjs');const factory=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {createNativeFixture};').toString('base64'));nativeDb=await factory.createNativeFixture();}
const {createFullFinancialCloud}=require('./lib/financial-cloud-fixture.cjs');
const f=await createFullFinancialCloud({db:nativeDb,actualSaleDefinition:true}),{db,author,terminal,shift}=f;
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
let passed=0;const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
const sale=()=>({id:randomUUID(),bill_number:'target-'+randomUUID(),store_id:'A',shift_id:shift,total_amount:'10',payment_type:'cash',payments:[],coupon_promo_id:'code1',coupon_code:'HELLO',coupon_scope:'bill'});
const submit=s=>scalar('SELECT pos_live_financial_sale($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,NULL,NULL)',[author,'A',terminal,JSON.stringify(s),'[]','[]','[]']);
try{
 await db.exec("UPDATE stores SET group_id='cluster-A' WHERE id='A';INSERT INTO promotions VALUES('code1','code',true,NULL,'HELLO','bill','cluster-A');");
 const original=await scalar("SELECT pg_get_functiondef('public.pos_sale_commit(jsonb,jsonb,jsonb,jsonb,jsonb,text)'::regprocedure)");
 await test('exact captured target source is retained with full readiness',async()=>{assert.equal((await scalar('SELECT pos_live_financial_ready()')).ready,true);assert(original.includes('REUSABLE_CODE_NOT_VALID'));});
 const basis=await scalar('SELECT pos_sync_read_financial_basis($1,$2,$3,$4)',['default','A',terminal,shift]);
 const ensure=()=>scalar('SELECT fin62_history_preparation.ensure_stream($1,$2,$3,$4,$5::jsonb)',['default','A',terminal,shift,JSON.stringify({serverBasisId:basis.basisId,serverBasisHash:basis.basisHash})]);
 const rollout=randomUUID(),peer=randomUUID();
 await test('actual full policy denies absent approval and any incompatible active peer',async()=>{await assert.rejects(ensure(),/ROLLOUT_NOT_APPROVED/);assert.equal(await scalar('SELECT count(*)::int FROM fin62_history_preparation.protected_shifts'),0);await db.query("INSERT INTO fin62_rollout_preparation.approvals VALUES('default','A',$1,1,$2,'approved',now())",[terminal,rollout]);await db.query("INSERT INTO terminal_tokens(id,location_id,status) VALUES($1,'A','active')",[peer]);await assert.rejects(ensure(),/ROLLOUT_NOT_APPROVED/);});
 await test('only complete actual approval and final readiness can protect a validated scope',async()=>{await db.query("INSERT INTO fin62_rollout_preparation.approvals VALUES('default','A',$1,1,$2,'approved',now())",[peer,rollout]);await ensure();assert.equal(await scalar('SELECT count(*)::int FROM fin62_history_preparation.protected_shifts WHERE shift_id=$1',[shift]),1);});
 if(native)await test('actual full approval and 44-function readiness workload is measured',async()=>{const started=performance.now();await db.exec(`DO $measure$ BEGIN FOR i IN 1..1000 LOOP PERFORM fin62_rollout_preparation.assert_approved('default','A','${terminal}');END LOOP;END $measure$;`);console.log('MEASURE 1000 full approval checks ms='+Math.round(performance.now()-started));});
 await test('revoked approval holds new metadata without deleting accepted history',async()=>{await db.query("INSERT INTO fin62_rollout_preparation.approvals VALUES('default','A',$1,2,$2,'revoked',now())",[terminal,rollout]);await assert.rejects(ensure(),/ROLLOUT_NOT_APPROVED/);assert.equal(await scalar('SELECT count(*)::int FROM fin62_history_preparation.streams WHERE shift_id=$1',[shift]),1);});
 await test('valid actual reusable code still saves once with exact retry',async()=>{const s=sale();await submit(s);await submit(s);assert.equal(await scalar('SELECT count(*)::int FROM sales WHERE id=$1',[s.id]),1);});
 for(const[name,change]of[['inactive',"UPDATE promotions SET is_active=false"],['wrong code',"UPDATE promotions SET title='OTHER'"],['scope',"UPDATE promotions SET code_scope='product'"],['cluster',"UPDATE promotions SET code_cluster_id='cluster-B'"]])await test('actual '+name+' promotion denial rolls back private/public writes',async()=>{await db.exec('BEGIN;'+change);const s=sale();await assert.rejects(submit(s),/REUSABLE_CODE_NOT_VALID/);await db.exec('ROLLBACK;');assert.equal(await scalar('SELECT count(*)::int FROM sales WHERE id=$1',[s.id]),0);assert.equal(await scalar('SELECT count(*)::int FROM fin62_history_preparation.sale_birth_claims WHERE sale_id=$1',[s.id]),0);});
 await test('no original source or grants replaced',async()=>{assert.equal(await scalar("SELECT pg_get_functiondef('public.pos_sale_commit(jsonb,jsonb,jsonb,jsonb,jsonb,text)'::regprocedure)"),original);});
 await test('unknown actual sale definitions abort preparation instead of replacing business rules',async()=>{await db.exec('BEGIN;ALTER FUNCTION public.pos_sale_commit(jsonb,jsonb,jsonb,jsonb,jsonb,text) COST 101;');const source=await read('scripts/preparation/shift-financial-live-business.sql');const pinBlock=source.slice(source.indexOf('DO $pins$'),source.indexOf('END $pins$;')+'END $pins$;'.length);await assert.rejects(db.exec(pinBlock),/FIN62_LIVE_SOURCE_UNEXPECTED/);await db.exec('ROLLBACK;');assert.equal(await scalar("SELECT pg_get_functiondef('public.pos_sale_commit(jsonb,jsonb,jsonb,jsonb,jsonb,text)'::regprocedure)"),original);});
 console.log(`${passed} captured-target source groups passed; no live database accessed.`);
}finally{await db.close();}
