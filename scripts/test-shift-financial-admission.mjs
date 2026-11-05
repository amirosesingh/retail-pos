// Actual existing causal/author/start SQL and seven shift triggers, isolated
// fixture identities only. HTTP Ed25519 checks are represented by real Node
// verification of the same public protocol messages, not PostgreSQL crypto.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID,createHash,generateKeyPairSync,sign,verify} from 'node:crypto';
import Module from 'node:module';
import {dirname} from 'node:path';
const native=process.argv.slice(2).join(' ')==='--native';
assert(process.argv.length===2||native,'Only --native accepted; never a URL or operator database');
const require=createRequire(import.meta.url),read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const helperPath=require.resolve('./lib/shift-protocol-integration-fixture.cjs');
let{createCloud}=require(helperPath),nativeDb;
if(native){
 const nativeSource=await read('scripts/test-seven-shift-summary-native.fixture.mjs');
 const race=String.raw`concurrentAdmissions:async(firstSQL,secondSQL)=>{
  const h=nativeSpawn(nativeJoin(bin,'psql.exe'),args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});let text='',holderError='',ended=false,waiting;
  h.stdout.on('data',value=>{text+=value;});h.stderr.on('data',value=>{holderError+=value;});
  const finished=new Promise(accept=>h.once('close',accept));
  try{
   h.stdin.write("BEGIN;SET LOCAL test.auth_role='service_role';"+firstSQL+"\n\\echo FIN62_FIRST_READY\n");
   const limit=Date.now()+5000;while(!text.includes('FIN62_FIRST_READY')){if(Date.now()>limit)throw Error('Financial holder not ready: '+holderError);await new Promise(resolve=>setTimeout(resolve,20));}
   if(holderError.includes('ERROR:'))throw Error(holderError);
   waiting=execute(secondSQL).then(()=>({ok:true}),error=>({error}));
   await new Promise(resolve=>setTimeout(resolve,150));
   const blocked=command('psql',[...args,'-c','SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND cardinality(pg_blocking_pids(pid))>0);']).trim();
   if(blocked!=='t')throw Error('Expected an independently blocked stale financial admission');
   h.stdin.end('COMMIT;\n\\q\n');ended=true;await finished;
   if(holderError.includes('ERROR:'))throw Error(holderError);
   const result=await waiting;if(!/SYNC_SHIFT_BASELINE_CONFLICT/.test(result.error?.message??''))throw Error('Expected actual stale baseline denial: '+(result.error?.message??'unexpected success'));
  }finally{if(!ended)h.stdin.end('ROLLBACK;\n\\q\n');await finished;if(waiting)await waiting;}
 },`;
 assert(nativeSource.includes('close:async()=>{'));
 const factory=await import('data:text/javascript;base64,'+Buffer.from(nativeSource.replace('close:async()=>{',race+'\nclose:async()=>{')+'\nexport {createNativeFixture};').toString('base64'));
 nativeDb=await factory.createNativeFixture();globalThis.__fin62AdmissionFixture=nativeDb;
 const source=await read('scripts/lib/shift-protocol-integration-fixture.cjs');
 const anchor="const db = new PGlite(), schema = read('supabase/schema.sql');";assert(source.includes(anchor));
 const module=new Module(helperPath);module.filename=helperPath;module.paths=Module._nodeModulePaths(dirname(helperPath));
 module._compile(source.replace(anchor,"const db = globalThis.__fin62AdmissionFixture, schema = read('supabase/schema.sql');"),helperPath);
 createCloud=module.exports.createCloud;
}
const branch=randomUUID(),terminal=randomUUID(),shift=randomUUID(),sale=randomUUID();
let db;try{db=await createCloud(branch,terminal);}catch(error){await nativeDb?.close();throw error;}finally{delete globalThis.__fin62AdmissionFixture;}
const authorProtocol=require('../electron/security/shift-author-protocol.cjs');
const financialProtocol=require('../electron/security/shift-financial-protocol.cjs');
const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
const unsigned=({signature:_,...fields})=>fields;
const graphNames=['shifts','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts'];
const permissions={can_close_shift:true,can_shift_cash_count:true,can_shift_cash_recount:true,can_shift_variance_approve:true};
const actor=()=>{const{publicKey,privateKey}=generateKeyPairSync('ed25519');return{id:randomUUID(),keyId:randomUUID(),subject:'cashier',publicKey,privateKey};};
const cashier=actor();let passed=0,originalBasis;
const scalar=async(sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0];
const typed=(name,row)=>scalar(`SELECT to_jsonb(jsonb_populate_record(NULL::public.${name},$1::jsonb))`,[JSON.stringify(row)]);
const graph=()=>scalar('SELECT pos_sync_shift_graph($1,$2,$3,$4)', ['default',branch,terminal,shift]);
const signGraph=(author,wire)=>{
 const fields={version:1,algorithm:'Ed25519',keyId:author.keyId,projectOrigin:'https://fixture.supabase.co',terminalId:terminal,authorId:author.id,
  subject:author.subject,branchId:branch,shiftId:shift,intentId:wire.intentId,action:wire.kind,payloadHash:hash(wire.payloadJson)};
 return {...fields,signature:sign(null,Buffer.from(authorProtocol.intentMessage(fields)),author.privateKey).toString('base64url')};
};
const enroll=async author=>{
 await db.query('INSERT INTO app_users(id,user_id,role,role_slug,permissions,is_active,store_id) VALUES($1,$2,\'staff\',\'cashier\',$3::jsonb,true,$4)',[author.id,author.subject,JSON.stringify(permissions),branch]);
 const fields={version:1,algorithm:'Ed25519',keyId:author.keyId,projectOrigin:'https://fixture.supabase.co',terminalId:terminal,authorId:author.id,publicKey:author.publicKey.export({format:'der',type:'spki'}).toString('base64url')};
 const signature=sign(null,Buffer.from(authorProtocol.enrollmentMessage(fields)),author.privateKey);assert(verify(null,Buffer.from(authorProtocol.enrollmentMessage(fields)),author.publicKey,signature));
 await db.query('SELECT pos_shift_author_enroll($1::jsonb,$2)',[JSON.stringify(fields),author.subject]);
};
const seed=async()=>{
 await db.exec(`TRUNCATE public.shifts,public.sales,public.sale_items,public.payment_transactions,public.app_users,public.activity_events,public.record_edits,public.sync_idempotency_receipts,public.sync_change_feed,
  pos_sync_private.shift_intent_receipts,pos_sync_private.shift_author_keys,pos_sync_private.shift_author_receipts,pos_sync_private.shift_closing_start_receipts,
  fin62_action_preparation.receipts,fin62_cloud_preparation.bases,fin62_version_preparation.sales_versions CASCADE;
  SET test.auth_role='service_role';SET pos.shift_fn='on';`);
 await db.query('INSERT INTO shifts(id,store_id,terminal_id,opened_by_name,opened_by_staff_id,opened_by_role,opened_at,opening_float,state,status,row_version) VALUES($1,$2,$3,$4,$4,\'cashier\',\'2026-10-31T00:00:00Z\',20,\'ACTIVE\',\'OPEN\',1)',[shift,branch,terminal,cashier.subject]);
 await db.exec("SET pos.shift_fn=''");await enroll(cashier);
 await db.query('INSERT INTO sales(id,bill_number,store_id,total_amount,subtotal_amount,payment_type,payments,shift_id,row_version) VALUES($1,\'SYNTHETIC\',$2,100,100,\'cash\',\'[]\',$3,1)',[sale,branch,shift]);
 originalBasis=await scalar('SELECT prototype_fin62_create_basis($1,$2,$3,$4)', ['default',branch,terminal,shift]);
};
const pack=async({counted=120,expectedCash=120,kind='ORIGINAL',author=cashier,startAuthor=null,base=null,actionBasis=null,refs=[]}={})=>{
 const current=base??await graph(),ops=structuredClone(current.tables),countId=randomUUID(),time='2026-11-04T08:00:00.000Z';
 const parent=ops[0].rows[0],variance=counted-expectedCash,status=variance===0?'NO_VARIANCE':variance>0?'OVER':'SHORT';
 Object.assign(parent,{status:'CLOSED',state:'CLOSED',closed_at:parent.closed_at??time,closed_by_name:author.subject,closed_by_staff_id:author.subject,
  counted_cash:counted,final_counted_cash:counted,closing_float:counted,counted_card:null,counted_digital:null,
  expected_cash:expectedCash,expected_card:0,expected_digital:0,variance_cash:variance,variance_card:null,variance_digital:null,variance_total:variance,variance_status:status,row_version:Number(parent.row_version??1)+1});
 ops[1].rows.push(await typed('shift_cash_counts',{id:countId,shift_id:shift,store_id:branch,terminal_id:terminal,kind,counted_cash:counted,counted_card:null,counted_digital:null,
  counted_by_name:author.subject,counted_by_staff_id:author.subject,reason:kind==='RECOUNT'?'Synthetic correction':null,client_key:randomUUID(),created_at:time}));
 ops[2].rows.push(await typed('shift_reconciliations',{id:randomUUID(),shift_id:shift,store_id:branch,count_id:countId,expected_cash:expectedCash,expected_card:0,expected_digital:0,
  counted_cash:counted,counted_card:null,counted_digital:null,variance_cash:variance,variance_card:null,variance_digital:null,variance_total:variance,variance_status:status,created_at:time}));
 const events=kind==='ORIGINAL'?[['cash_count_submitted','CASH_COUNT_REQUIRED','CASH_COUNT_SUBMITTED'],['reconciled','CASH_COUNT_SUBMITTED','CLOSED']]:[['recount_submitted','CLOSED','CLOSED']];
 for(const[event,from,to]of events)ops[3].rows.push(await typed('shift_close_events',{id:randomUUID(),shift_id:shift,store_id:branch,terminal_id:terminal,event,from_state:from,to_state:to,detail:{count_id:countId},actor_name:author.subject,actor_staff_id:author.subject,created_at:time}));
 let start;
 if(startAuthor){
  const eventId=randomUUID(),startTime='2026-11-04T07:00:00.000Z';
  Object.assign(parent,{closing_started_at:startTime,closing_started_by:startAuthor.subject,close_reason:'END_OF_DAY'});
  const event={id:eventId,shift_id:shift,store_id:branch,terminal_id:terminal,event:'closing_started',from_state:'ACTIVE',to_state:'CASH_COUNT_REQUIRED',detail:{reason:'END_OF_DAY'},actor_name:startAuthor.subject,actor_staff_id:startAuthor.subject,created_at:startTime};
  ops[3].rows.push(await typed('shift_close_events',event));
  const sourceParent=Object.fromEntries(['id','store_id','terminal_id','opened_at','opened_by_staff_id','opened_by_name','closing_started_at','closing_started_by','close_reason'].map(key=>[key,parent[key]]));
  const payloadJson=JSON.stringify({version:1,branchId:branch,shiftId:shift,eventId,parent:sourceParent,event});
  const fields={version:1,algorithm:'Ed25519',keyId:startAuthor.keyId,projectOrigin:'https://fixture.supabase.co',terminalId:terminal,authorId:startAuthor.id,subject:startAuthor.subject,branchId:branch,shiftId:shift,eventId,payloadHash:hash(payloadJson),payloadJson};
  start={...fields,signature:sign(null,Buffer.from(authorProtocol.closingStartMessage(fields)),startAuthor.privateKey).toString('base64url')};
 }
 const intentId=randomUUID(),fields={version:1,intentId,shiftId:shift,kind,baseToken:current.graphToken,predecessorIntentId:null,predecessorIntentHash:null};
 const operations=ops.map(part=>({...part,changes:[]})),payloadJson=JSON.stringify({...fields,branchId:branch,operations}),wire={...fields,payloadJson};
 const graphAuthor=signGraph(author,wire),basisJson=JSON.stringify({...structuredClone(actionBasis??originalBasis.basis),versionReferences:refs});
 const proofFields={version:1,algorithm:'Ed25519',keyId:author.keyId,projectOrigin:'https://fixture.supabase.co',terminalId:terminal,authorId:author.id,subject:author.subject,branchId:branch,shiftId:shift,intentId,
  action:kind,graphPayloadHash:hash(payloadJson),basisHash:hash(basisJson),serverBasisId:originalBasis.basisId,formula:'canonical-exact-decimal-v2'};
 const proof={...proofFields,signature:sign(null,Buffer.from(financialProtocol.financialBasisMessage(proofFields)),author.privateKey).toString('base64url')};
 return{intentId,wire,graphAuthor,author,start,startSigner:startAuthor,basis:{basisJson,proof}};
};
const send=async(value,{allowed=true,startAllowed=true,crypto=true,scope=branch}={})=>{
 if(crypto){assert(verify(null,Buffer.from(authorProtocol.intentMessage(unsigned(value.graphAuthor))),value.author.publicKey,Buffer.from(value.graphAuthor.signature,'base64url')));
  assert(verify(null,Buffer.from(financialProtocol.financialBasisMessage(unsigned(value.basis.proof))),value.author.publicKey,Buffer.from(value.basis.proof.signature,'base64url')));
  if(value.start)assert(verify(null,Buffer.from(authorProtocol.closingStartMessage(unsigned(value.start))),value.startSigner.publicKey,Buffer.from(value.start.signature,'base64url')));}
 return scalar('SELECT pos_sync_push_financial_shift_intent($1,$2,$3,$4,NULL,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb)',[
  value.intentId,'default',scope,terminal,JSON.stringify(value.wire),JSON.stringify(value.graphAuthor),JSON.stringify({allowed,authority:{authorId:value.author.id}}),
  value.start?JSON.stringify(value.start):null,value.start?JSON.stringify({allowed:startAllowed,authority:{authorId:value.start.authorId}}):null,JSON.stringify(value.basis)]);
};
const image=async()=>scalar(`SELECT jsonb_build_object('graph',pos_sync_private.shift_graph('${shift}'),'intent',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY intent_id),'[]') FROM pos_sync_private.shift_intent_receipts x),
 'author',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY intent_id),'[]') FROM pos_sync_private.shift_author_receipts x),
 'start',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY intent_id),'[]') FROM pos_sync_private.shift_closing_start_receipts x),
 'financial',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY intent_id),'[]') FROM fin62_action_preparation.receipts x))`);
const test=async(name,work)=>{await seed();await work();passed++;console.log('PASS '+name);};
try{
 await db.exec("ALTER TABLE terminal_tokens ADD management_sync_enabled boolean DEFAULT false;");
 await db.query('INSERT INTO stores VALUES($1,\'Synthetic branch\')',[branch]);
 const captures=JSON.parse(await read('scripts/fixtures/management-shift-read-validators.json'));
 for(const row of captures){assert.equal(hash(row.definition),row.sha256);await db.exec(row.definition);}
 // The shared causal fixture omits feed delivery. Install the unchanged actual
 // canonical shift feed routine/trigger too, so all seven production-shaped
 // shift triggers participate rather than replacing one with a test double.
 const schema=await read('supabase/schema.sql'),feedStart=schema.lastIndexOf('CREATE OR REPLACE FUNCTION public.sync_feed_shifts()');
 assert(feedStart>=0);const feedEnd=schema.indexOf('REVOKE ALL ON FUNCTION public.sync_feed_shifts()',feedStart);assert(feedEnd>feedStart);
 await db.exec(schema.slice(feedStart,feedEnd));
 const oldPins=await scalar("SELECT jsonb_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid))) FROM pg_proc p WHERE p.oid IN('public.pos_sync_push_shift_intent(uuid,text,text,text,jsonb,jsonb)'::regprocedure,'public.pos_sync_push_author_shift_intent(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure,'public.pos_sync_push_started_shift_intent(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure)");
 const triggerPins=await scalar("SELECT jsonb_object_agg(tgname,md5(pg_get_triggerdef(oid))) FROM pg_trigger WHERE tgrelid='public.shifts'::regclass AND NOT tgisinternal");assert.equal(Object.keys(triggerPins).length,7,'Use actual seven shift triggers');
 for(const path of ['shift-financial-math-postgres.sql','shift-financial-cloud-receipts.sql','shift-financial-version-receipts.sql','shift-financial-known-basis.sql','shift-financial-admission.sql'])await db.exec(await read('scripts/preparation/'+path));
 await test('actual author RPC admits one complete financial action and atomically records immutable receipt',async()=>{
  const value=await pack(),ack=await send(value);assert.equal(ack.ok,true);assert.equal(ack.financial_basis_receipt.basisHash,value.basis.proof.basisHash);assert.equal(ack.financial_basis_receipt.ack_version,1);assert.equal(ack.financial_basis_receipt.graphPayloadHash,hash(value.wire.payloadJson));
  assert.equal(await scalar('SELECT count(*)::int FROM fin62_action_preparation.receipts'),1);assert.equal((await graph()).tables[0].rows[0].status,'CLOSED');
  const receipt=await scalar('SELECT to_jsonb(r) FROM fin62_action_preparation.receipts r');assert.equal(receipt.basis_json,value.basis.basisJson);assert.deepEqual(receipt.basis_proof,value.basis.proof);
  await assert.rejects(db.exec('UPDATE fin62_action_preparation.receipts SET formula=formula'),/IMMUTABLE/);await assert.rejects(db.exec('DELETE FROM fin62_action_preparation.receipts'),/IMMUTABLE/);
 });
 await test('bad expected 999 and fractional expected deny before any old graph writes',async()=>{
  for(const expectedCash of[999,120.005]){const value=await pack({expectedCash}),before=await image();await assert.rejects(send(value),expectedCash===999?/EXPECTED_MISMATCH/:/EXPECTED_FRACTIONAL/);assert.deepEqual(await image(),before);}
 });
 await test('exact decimal-string graph values are preserved, while fractional/invalid/range values deny',async()=>{
  const before=await image();
  for(const amount of['120.001','bad',true,null,'1'.repeat(129)]){
   const value=await pack(),body=JSON.parse(value.wire.payloadJson);body.operations.find(op=>op.table==='shifts').rows[0].expected_cash=amount;value.wire.payloadJson=JSON.stringify(body);
   value.graphAuthor=signGraph(cashier,value.wire);value.basis.proof.graphPayloadHash=hash(value.wire.payloadJson);value.basis.proof.signature=sign(null,Buffer.from(financialProtocol.financialBasisMessage(unsigned(value.basis.proof))),cashier.privateKey).toString('base64url');
   await assert.rejects(send(value),/FIN62_(EXPECTED|NUMERIC)/);assert.deepEqual(await image(),before);
  }
  const value=await pack({expectedCash:'120.00'}),raw=value.wire.payloadJson;assert.equal((await send(value)).ok,true);assert.equal(value.wire.payloadJson,raw);assert.equal(JSON.parse(raw).operations[0].rows[0].expected_cash,'120.00');
 });
 await test('wrong graph hash, author binding, basis scope and version references remain rejected',async()=>{
  const alterations=[v=>{v.basis.proof.graphPayloadHash='a'.repeat(64);},v=>{v.basis.proof.authorId=randomUUID();},v=>{v.basis.proof.serverBasisId=randomUUID();}];
  for(const alter of alterations){const value=await pack(),before=await image();alter(value);await assert.rejects(send(value,{crypto:false}),/FIN62_/);assert.deepEqual(await image(),before);}
  const actual=structuredClone(originalBasis.basis);actual.inputs[0].isRefunded=true;
  const value=await pack({expectedCash:20,actionBasis:actual,refs:[{saleId:sale,receiptId:randomUUID(),side:'after'}]}),before=await image();await assert.rejects(send(value),/STORED_VERSION_REQUIRED/);assert.deepEqual(await image(),before);
  await assert.rejects(send(await pack(),{scope:randomUUID()}),/SCOPE_FORBIDDEN/);
 });
 await test('omitting a baseline sale cannot be hidden by internally consistent math',async()=>{
  const value=await pack({expectedCash:20,actionBasis:{...originalBasis.basis,inputs:[]}}),before=await image();await assert.rejects(send(value),/BASELINE_ROW_OMITTED/);assert.deepEqual(await image(),before);
 });
 await test('actual stored refund receipt supports a new action at that distinct known point',async()=>{
  await db.query('UPDATE sales SET is_refunded=true,row_version=row_version+1 WHERE id=$1',[sale]);
  const receipt=await scalar('SELECT to_jsonb(r) FROM fin62_version_preparation.sales_versions r WHERE sale_id=$1 AND operation=\'UPDATE\' ORDER BY captured_at DESC,id DESC LIMIT 1',[sale]);
  const actionBasis={...originalBasis.basis,inputs:[receipt.after_basis]},refs=[{saleId:sale,receiptId:receipt.id,side:'after'}];
  const value=await pack({counted:20,expectedCash:20,actionBasis,refs});assert.equal((await send(value)).ok,true);
  assert.deepEqual(JSON.parse(await scalar('SELECT basis_json FROM fin62_action_preparation.receipts')).versionReferences,refs);
  assert.equal(Number((await graph()).tables[0].rows[0].expected_cash),20);
 });
 await test('existing false-authority, revoked account permission and unknown key checks still deny NEW writes',async()=>{
  const value=await pack(),before=await image();await assert.rejects(send(value,{allowed:false}),/PERMISSION_REVOKED/);assert.deepEqual(await image(),before);
  const unknown=await pack();unknown.graphAuthor.keyId=randomUUID();unknown.basis.proof.keyId=unknown.graphAuthor.keyId;
  unknown.graphAuthor.signature=sign(null,Buffer.from(authorProtocol.intentMessage(unsigned(unknown.graphAuthor))),cashier.privateKey).toString('base64url');
  unknown.basis.proof.signature=sign(null,Buffer.from(financialProtocol.financialBasisMessage(unsigned(unknown.basis.proof))),cashier.privateKey).toString('base64url');
  await assert.rejects(send(unknown),/AUTHOR_INVALID/);assert.deepEqual(await image(),before);
  await db.query('UPDATE app_users SET permissions=\'{}\' WHERE id=$1',[cashier.id]);await assert.rejects(send(value),/PERMISSION_REVOKED/);assert.deepEqual(await image(),before);
 });
 await test('exact replay after later refund and permission revocation never reprices accepted history',async()=>{
  const value=await pack();await send(value);const before=await image();
  await db.query('UPDATE sales SET is_refunded=true,row_version=row_version+1 WHERE id=$1',[sale]);await db.query('UPDATE app_users SET permissions=\'{}\' WHERE id=$1',[cashier.id]);await db.query('UPDATE pos_sync_private.shift_author_keys SET revoked_at=statement_timestamp() WHERE key_id=$1',[cashier.keyId]);
  const ack=await send(value,{allowed:false});assert.equal(ack.replayed,true);assert.deepEqual(await image(),before);
  const changed=structuredClone(value);changed.basis.basisJson+=' ';changed.basis.proof.basisHash=hash(changed.basis.basisJson);
  changed.basis.proof.signature=sign(null,Buffer.from(financialProtocol.financialBasisMessage(unsigned(changed.basis.proof))),cashier.privateKey).toString('base64url');
  await assert.rejects(send(changed,{allowed:false}),/REPLAY_MISMATCH/);
 });
 await test('fresh receipt-safe ACK follows later correction; a stale baseline cannot write another correction',async()=>{
  const first=await pack();await send(first);const observed=await graph(),second=await pack({kind:'RECOUNT',counted:130,base:observed}),stale=await pack({kind:'RECOUNT',counted:140,base:observed});
  await send(second);const before=await image();await assert.rejects(send(stale),/BASELINE_CONFLICT/);assert.deepEqual(await image(),before);
  const replay=await send(first,{allowed:false});assert.equal(replay.shift_closures[0].superseded,true);assert.equal(replay.shift_closures[0].current_token,(await graph()).graphToken);assert.deepEqual(await image(),before);
 });
 await test('actual started wrapper preserves a distinct starter and denies changed start proof atomically',async()=>{
  const counter={...actor(),subject:'counter'};await enroll(counter);const value=await pack({author:counter,startAuthor:cashier});
  const changed=structuredClone(value);changed.start.payloadHash='b'.repeat(64);const before=await image();await assert.rejects(send(changed,{crypto:false}),/START_INVALID/);assert.deepEqual(await image(),before);
  await assert.rejects(send(value,{startAllowed:false}),/PERMISSION_REVOKED/);assert.deepEqual(await image(),before);
  const ack=await send(value);assert.equal(ack.ok,true);assert.equal(await scalar('SELECT count(*)::int FROM pos_sync_private.shift_closing_start_receipts'),1);
 });
 await test('financial receipt insertion failure rolls back old graph/author/start receipts and exact retry succeeds',async()=>{
  const value=await pack({startAuthor:cashier}),before=await image();await db.exec("CREATE FUNCTION fin62_action_preparation.fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'FIN62_FIXTURE_FAILURE';END$$;CREATE TRIGGER fixture_failure BEFORE INSERT ON fin62_action_preparation.receipts FOR EACH ROW EXECUTE FUNCTION fin62_action_preparation.fixture_failure();");
  await assert.rejects(send(value),/FIXTURE_FAILURE/);assert.deepEqual(await image(),before);await db.exec('DROP TRIGGER fixture_failure ON fin62_action_preparation.receipts;DROP FUNCTION fin62_action_preparation.fixture_failure();');assert.equal((await send(value)).ok,true);
 });
 await test('legacy accepted graph is never silently upgraded with a new financial receipt',async()=>{
  const value=await pack();await scalar('SELECT pos_sync_push_author_shift_intent($1,$2,$3,$4,NULL,$5::jsonb,$6::jsonb,$7::jsonb)',[value.intentId,'default',branch,terminal,JSON.stringify(value.wire),JSON.stringify(value.graphAuthor),JSON.stringify({allowed:true,authority:{authorId:cashier.id}})]);
  const before=await image();await assert.rejects(send(value),/FINANCIAL_HISTORY_UNPROVEN/);assert.deepEqual(await image(),before);
 });
 await test('bounded source, mandatory version references and strict envelope do not accept issuer flags',async()=>{
  const before=await image();
  for(const alter of[v=>{v.basis.authorized=true;},v=>{v.basis.basisJson='x'.repeat(6*1024*1024+1);},v=>{v.basis.proof.subject='x'.repeat(5000);}]){const value=await pack();alter(value);await assert.rejects(send(value,{crypto:false}),/FIN62_PROOF_INVALID/);assert.deepEqual(await image(),before);}
  const value=await pack();const basis=JSON.parse(value.basis.basisJson);basis.versionReferences={allowed:true};value.basis.basisJson=JSON.stringify(basis);value.basis.proof.basisHash=hash(value.basis.basisJson);value.basis.proof.signature=sign(null,Buffer.from(financialProtocol.financialBasisMessage(unsigned(value.basis.proof))),cashier.privateKey).toString('base64url');
  await assert.rejects(send(value),/CONTEXT_MISMATCH/);assert.deepEqual(await image(),before);
 });
 await test('only service role can invoke the new wrapper or mutate its private receipt',async()=>{
  const value=await pack();for(const role of['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(send(value),/permission denied/);await db.exec('RESET ROLE');}
  await db.exec('SET ROLE service_role');await assert.rejects(db.exec('SELECT * FROM fin62_action_preparation.receipts'),/permission denied/);await db.exec('RESET ROLE');
 });
 if(native)await test('actual independent parent lock blocks admission without partial receipts',async()=>{
  const value=await pack(),before=await image();const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
  const args=[quote(value.intentId)+'::uuid',quote('default'),quote(branch),quote(terminal),'NULL',quote(JSON.stringify(value.wire))+'::jsonb',quote(JSON.stringify(value.graphAuthor))+'::jsonb',quote(JSON.stringify({allowed:true,authority:{authorId:cashier.id}}))+'::jsonb','NULL','NULL',quote(JSON.stringify(value.basis))+'::jsonb'];
  await db.testContention('SELECT public.pos_sync_push_financial_shift_intent('+args.join(',')+');',shift);assert.deepEqual(await image(),before);assert.equal((await send(value)).ok,true);
 });
 if(native)await test('two actual concurrent corrections serialize and stale loser leaves no financial receipt',async()=>{
  const first=await pack();await send(first);const base=await graph(),winner=await pack({kind:'RECOUNT',counted:130,base}),loser=await pack({kind:'RECOUNT',counted:140,base});
  const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
  const statement=value=>'SELECT public.pos_sync_push_financial_shift_intent('+[quote(value.intentId)+'::uuid',quote('default'),quote(branch),quote(terminal),'NULL',quote(JSON.stringify(value.wire))+'::jsonb',quote(JSON.stringify(value.graphAuthor))+'::jsonb',quote(JSON.stringify({allowed:true,authority:{authorId:cashier.id}}))+'::jsonb','NULL','NULL',quote(JSON.stringify(value.basis))+'::jsonb'].join(',')+');';
  await db.concurrentAdmissions(statement(winner),statement(loser));
  assert.equal(Number((await graph()).tables[0].rows[0].counted_cash),130);assert.equal(await scalar('SELECT count(*)::int FROM fin62_action_preparation.receipts'),2);
  assert.equal(await scalar('SELECT count(*)::int FROM fin62_action_preparation.receipts WHERE intent_id=$1',[loser.intentId]),0);
 });
 assert.deepEqual(await scalar("SELECT jsonb_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid))) FROM pg_proc p WHERE p.oid IN('public.pos_sync_push_shift_intent(uuid,text,text,text,jsonb,jsonb)'::regprocedure,'public.pos_sync_push_author_shift_intent(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure,'public.pos_sync_push_started_shift_intent(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure)"),oldPins);
 assert.deepEqual(await scalar("SELECT jsonb_object_agg(tgname,md5(pg_get_triggerdef(oid))) FROM pg_trigger WHERE tgrelid='public.shifts'::regclass AND NOT tgisinternal"),triggerPins);
 console.log(passed+' actual guarded financial admission groups passed; old RPCs/seven triggers unchanged. '+(native?'Native PostgreSQL contention verified.':'PGlite fixture only; native contention separate.')+' No live migration or cryptographic-in-PG claim.');
}finally{await db.close();}
