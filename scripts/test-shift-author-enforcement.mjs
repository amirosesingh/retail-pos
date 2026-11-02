// In-memory PostgreSQL fixtures only. No database URL/profile is accepted.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash, generateKeyPairSync, sign } from 'node:crypto';
import assert from 'node:assert/strict';
import { enrollmentMessage, intentMessage } from '../electron/security/shift-author-protocol.cjs';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const schema=(await read('supabase/schema.sql')).replaceAll('\r\n','\n');
const names=['shifts','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts'];
function fn(name){const start=schema.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);assert(start>=0,name);const tail=schema.slice(start),delimiter=tail.match(/\bAS\s+(\$[\w]*\$)/i)[1],begin=tail.indexOf(delimiter);return tail.slice(0,tail.indexOf(delimiter+';',begin+delimiter.length)+delimiter.length+1);}
function table(name){const start=schema.indexOf(`CREATE TABLE IF NOT EXISTS public.${name} (`);assert(start>=0,name);return schema.slice(start,schema.indexOf('\n);',start)+3);}
const source=await read('scripts/test-shift-causal-intents.mjs');
const fixtureTemplate=source.slice(source.indexOf('const fixtureSql=')+'const fixtureSql='.length,source.indexOf('await db.exec(fixtureSql);'));
let fixture=new Function('fn','table','names',`return ${fixtureTemplate}`)(fn,table,names);
fixture=fixture.replace('CREATE TABLE app_users(id text,auth_user_id uuid,role text,permissions jsonb,is_active boolean,store_id text);',
 'CREATE TABLE app_users(id uuid PRIMARY KEY,user_id text,auth_user_id uuid,role text,role_slug text,permissions jsonb,is_active boolean,store_id text);');
const db=new PGlite();let passed=0;
try{
 await db.exec(fixture);
 await db.exec('CREATE TABLE activity_events(id uuid PRIMARY KEY)');
 await db.exec("ALTER TABLE terminal_tokens ADD platform text DEFAULT 'pc',ADD is_claimed boolean DEFAULT true");
 for(const name of ['20261030153259_confirm_shift_closure_sync_acknowledgement','20261030164829_bind_shift_closure_proof_to_requested_revision','20261031031945_preserve_validated_branch_context_for_shift_sync','20261101052452_prevent_closed_shift_reopening_during_sync','20261102082439_shift_closing_causal_intents','20261102101610_shift_author_key_registry','20261102103716_enforce_shift_author_uploads']) await db.exec((await read('supabase/migrations/'+name+'.sql')).replaceAll('\r\n','\n'));
 const authorId=randomUUID(),adminId=randomUUID(),shiftId=randomUUID(),opened='2026-10-31T00:00:00.123456Z',closed='2026-10-31T08:00:00.654321Z';
 const hash=text=>createHash('sha256').update(text).digest('hex');
 const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const typed=(name,row)=>scalar(`SELECT to_jsonb(jsonb_populate_record(NULL::public.${name},$1::jsonb))`,[JSON.stringify(row)]);
 const graph=()=>scalar("SELECT pos_sync_shift_graph('default','a','t-a',$1::uuid)",[shiftId]);
 const allFlags={can_shift_cash_count:true,can_close_shift:true,can_shift_cash_recount:true,can_shift_variance_approve:true};
 async function reset(){
  await db.exec("SET test.auth_role='service_role';SET pos.shift_author='';TRUNCATE pos_sync_private.shift_author_receipts;TRUNCATE pos_sync_private.shift_author_keys CASCADE;TRUNCATE shifts CASCADE;TRUNCATE pos_sync_private.shift_intent_receipts CASCADE;TRUNCATE sync_idempotency_receipts;TRUNCATE app_users CASCADE;UPDATE terminal_tokens SET location_id=CASE id WHEN 't-b' THEN 'b' ELSE 'a' END,status='active',revoked_at=NULL;");
  await db.query("INSERT INTO app_users(id,user_id,role,role_slug,permissions,is_active,store_id) VALUES($1,'cashier','staff','cashier',$3::jsonb,true,'a'),($2,'manager','manager','supervisor',$3::jsonb,true,'a')",[authorId,adminId,JSON.stringify(allFlags)]);
  await db.exec("SET pos.shift_fn='on'");
  await db.query("INSERT INTO shifts(id,store_id,terminal_id,terminal_name,opened_by_name,opened_by_staff_id,opened_by_role,opened_at,opening_float,status,state,row_version,created_at,updated_at) VALUES($1,'a','t-a','Till','cashier','cashier','cashier',$2,10,'OPEN','ACTIVE',99,$2,$2)",[shiftId,opened]);
  await db.exec("SET pos.shift_fn=''");
 }
 async function enroll(id=authorId,subject='cashier'){
  const pair=generateKeyPairSync('ed25519'),keyId=randomUUID();
  const enrollment={version:1,algorithm:'Ed25519',keyId,authorId:id,projectOrigin:'https://cloud.fixture',terminalId:'t-a',publicKey:pair.publicKey.export({type:'spki',format:'der'}).toString('base64url')};
  // Actual proof generation mirrors HTTP; SQL receives only server-verified identity.
  assert.equal(sign(null,Buffer.from(enrollmentMessage(enrollment)),pair.privateKey).length,64);
  await scalar('SELECT pos_shift_author_enroll($1::jsonb,$2)',[JSON.stringify(enrollment),subject]);
  return {pair,enrollment,subject};
 }
 async function closing(cash=100,previous=null,subject='cashier'){
  const view=previous?structuredClone(previous):await graph(),ops=view.tables.map(part=>({...part,changes:[]}));
  Object.assign(ops[0].rows[0],{status:'CLOSED',state:'CLOSED',closed_at:closed,row_version:100,closed_by_name:previous?ops[0].rows[0].closed_by_name:subject,
   closed_by_staff_id:previous?ops[0].rows[0].closed_by_staff_id:subject,counted_cash:cash,final_counted_cash:cash,closing_float:cash,counted_card:null,counted_digital:null,
   expected_cash:100,expected_card:0,expected_digital:0,variance_cash:cash-100,variance_card:null,variance_digital:null,variance_total:cash-100,variance_status:cash===100?'NO_VARIANCE':'OVER'});
  const count=randomUUID();ops[1].rows.push(await typed('shift_cash_counts',{id:count,shift_id:shiftId,store_id:'a',terminal_id:'t-a',kind:previous?'RECOUNT':'ORIGINAL',counted_cash:cash,reason:previous?'Correction':null,counted_by_name:subject,counted_by_staff_id:subject,client_key:randomUUID(),created_at:closed}));
  ops[2].rows.push(await typed('shift_reconciliations',{id:randomUUID(),shift_id:shiftId,store_id:'a',count_id:count,expected_cash:100,expected_card:0,expected_digital:0,counted_cash:cash,variance_cash:cash-100,variance_total:cash-100,variance_status:cash===100?'NO_VARIANCE':'OVER',created_at:closed}));
  for(const event of previous?['recount_submitted']:['cash_count_submitted','reconciled'])ops[3].rows.push(await typed('shift_close_events',{id:randomUUID(),shift_id:shiftId,store_id:'a',terminal_id:'t-a',event,from_state:previous?'CLOSED':'CASH_COUNT_REQUIRED',to_state:'CLOSED',detail:{count_id:count},actor_name:subject,actor_staff_id:subject,created_at:closed}));
  return ops;
 }
 function intent(ops,key,{kind='ORIGINAL',baseToken=null}={}){
  const intentId=randomUUID(),payload={version:1,intentId,branchId:'a',shiftId,kind,baseToken,predecessorIntentId:null,predecessorIntentHash:null,operations:ops},payloadJson=JSON.stringify(payload);
  const {operations:_ops,branchId:_branch,...headers}=payload;
  const unsigned={version:1,algorithm:'Ed25519',keyId:key.enrollment.keyId,authorId:key.enrollment.authorId,subject:key.subject,projectOrigin:key.enrollment.projectOrigin,terminalId:'t-a',branchId:'a',shiftId,intentId,action:kind,payloadHash:hash(payloadJson)};
  return {intentId,wire:{...headers,payloadJson},author:{...unsigned,signature:sign(null,Buffer.from(intentMessage(unsigned)),key.pair.privateKey).toString('base64url')}};
 }
 const push=(value,allowed=true,terminal='t-a',branch='a')=>scalar("SELECT pos_sync_push_author_shift_intent($1::uuid,'default',$2,$3,NULL,$4::jsonb,$5::jsonb,$6::jsonb)",[value.intentId,branch,terminal,JSON.stringify(value.wire),JSON.stringify(value.author),JSON.stringify({allowed,authority:{authorId:value.author.authorId}})]);
 async function test(name,work){await reset();await work();passed++;console.log('PASS '+name);}
 await test('signed ORIGINAL plus historical-author RECOUNT, no-write replay after key/profile/grant revocation',async()=>{
  const cashier=await enroll(),first=intent(await closing(),cashier);await push(first);
  const manager=await enroll(adminId,'manager'),view=await graph(),second=intent(await closing(110,view,'manager'),manager,{kind:'RECOUNT',baseToken:view.graphToken});await push(second);
  const before=await graph();await db.exec("UPDATE app_users SET is_active=false,permissions='{}';UPDATE pos_sync_private.shift_author_keys SET revoked_at=now()");
  assert.equal((await push(first,false)).replayed,true);assert.equal((await push(second,false)).replayed,true);assert.deepEqual(await graph(),before);
  await assert.rejects(scalar("SELECT pos_sync_push_shift_intent($1::uuid,'default','a','t-a',NULL,$2::jsonb)",[first.intentId,JSON.stringify(first.wire)]),/AUTHOR_REQUIRED/);
  await assert.rejects(scalar("SELECT pos_sync_push_aggregate($1::uuid,'default','a','t-a',$2::jsonb)",[first.intentId,JSON.stringify(JSON.parse(first.wire.payloadJson).operations)]),/AUTHOR_REQUIRED/);
  assert.equal(await scalar('SELECT count(*)::int FROM pos_sync_private.shift_author_receipts'),2);
 });
 async function withStart(ops){
  Object.assign(ops[0].rows[0],{closing_started_at:opened,closing_started_by:'cashier',close_reason:'End of shift'});
  ops[3].rows.unshift(await typed('shift_close_events',{id:randomUUID(),shift_id:shiftId,store_id:'a',terminal_id:'t-a',event:'closing_started',from_state:'ACTIVE',to_state:'CASH_COUNT_REQUIRED',detail:{reason:'End of shift',forced:false},actor_name:'cashier',actor_staff_id:'cashier',created_at:opened}));
  return ops;
 }
 await test('same-author saved closing start uploads with ORIGINAL and survives a later different-author recount',async()=>{
  const cashier=await enroll(),ops=await withStart(await closing());await push(intent(ops,cashier));
  const saved=await graph(),start=saved.tables[3].rows.find(row=>row.event==='closing_started');
  assert.equal(start.actor_staff_id,'cashier');
  const manager=await enroll(adminId,'manager');await push(intent(await closing(110,saved,'manager'),manager,{kind:'RECOUNT',baseToken:saved.graphToken}));
  const after=await graph();assert.deepEqual(after.tables[3].rows.find(row=>row.id===start.id),start);
  assert.equal(Number(after.tables[1].rows.find(row=>row.kind==='ORIGINAL').counted_cash),100);
 });
 await test('a different person unuploaded start remains unproven and is not retagged by the ORIGINAL signer',async()=>{
  const key=await enroll(),ops=await withStart(await closing());
  ops[0].rows[0].closing_started_by='manager';
  Object.assign(ops[3].rows[0],{actor_name:'manager',actor_staff_id:'manager'});
  const pending=structuredClone(ops);
  await assert.rejects(push(intent(ops,key)),/ACTOR_MISMATCH/);
  assert.deepEqual(ops,pending);
  assert.equal(await scalar('SELECT count(*)::int FROM shift_cash_counts'),0);
  assert.equal(await scalar('SELECT count(*)::int FROM pos_sync_private.shift_author_receipts'),0);
 });
 await test('new closing start rejects forged author, transition, parent identity, timestamp and reason without retagging history',async()=>{
  const key=await enroll();
  for(const patch of [{actor_name:'manager'},{actor_staff_id:'manager'},{from_state:'CLOSED'},{to_state:'CLOSED'},
   {shift_id:randomUUID()},{store_id:'b'},{terminal_id:'other-a'},{created_at:closed},{detail:{reason:'Invented'}}]){
   const ops=await withStart(await closing());Object.assign(ops[3].rows[0],patch);
   await assert.rejects(push(intent(ops,key)),/ACTOR_MISMATCH/);
  }
  for(const patch of [{closing_started_by:'manager'},{closing_started_at:null},{close_reason:'Other'}]){
   const ops=await withStart(await closing());Object.assign(ops[0].rows[0],patch);
   await assert.rejects(push(intent(ops,key)),/ACTOR_MISMATCH/);
  }
  assert.equal(await scalar('SELECT count(*)::int FROM shift_close_events'),0);
  assert.equal(await scalar('SELECT count(*)::int FROM pos_sync_private.shift_author_receipts'),0);
 });
 await test('current SQL grant/page/profile state defeats a stale allowed API decision before NEW writes',async()=>{
  const key=await enroll(),value=intent(await closing(),key);
  for(const permissions of [{}, {...allFlags,'page:shifts':false}]){await db.query('UPDATE app_users SET permissions=$1::jsonb',[JSON.stringify(permissions)]);await assert.rejects(push(value),/PERMISSION_REVOKED/);}
  assert.equal(await scalar('SELECT count(*)::int FROM shift_cash_counts'),0);
  await db.query('UPDATE app_users SET permissions=$1::jsonb',[JSON.stringify(allFlags)]);await push(value);
 });
 await test('a failed protected graph rolls back author metadata and cannot leak its privileged transaction proof',async()=>{
  const key=await enroll(),bad=await closing();bad[0].rows[0].variance_total=999;bad[2].rows[0].variance_total=999;
  await assert.rejects(push(intent(bad,key)),/SHIFT_TARGET_FACTS_INVALID/);
  assert.equal(await scalar("SELECT COALESCE(current_setting('pos.shift_author',true),'')"),'');
  assert.equal(await scalar('SELECT count(*)::int FROM pos_sync_private.shift_author_receipts'),0);
  const valid=intent(await closing(),key);
  await assert.rejects(scalar("SELECT pos_sync_push_shift_intent($1::uuid,'default','a','t-a',NULL,$2::jsonb)",[valid.intentId,JSON.stringify(valid.wire)]),/AUTHOR_REQUIRED/);
  await push(valid);
 });
 await test('terminal/branch/project/author/actor substitutions cannot create a new graph',async()=>{
  const key=await enroll(),value=intent(await closing(),key);
  for(const patch of [{authorId:adminId},{projectOrigin:'https://other.fixture'},{terminalId:'other-a'},{payloadHash:'a'.repeat(64)}])await assert.rejects(push({...value,author:{...value.author,...patch}}),/AUTHOR_INVALID/);
  await assert.rejects(push(value,true,'t-b','b'),/AUTHOR_INVALID|BRANCH_FORBIDDEN/);
  const bad=await closing();bad[1].rows[0].counted_by_name='manager';await assert.rejects(push(intent(bad,key)),/ACTOR_MISMATCH/);
  assert.equal(await scalar('SELECT count(*)::int FROM pos_sync_private.shift_author_receipts'),0);
 });
 await test('all six child/parent apply helpers and standalone batches enforce enrolled admission',async()=>{
  const key=await enroll(),ops=await closing(),value=intent(ops,key);
  await assert.rejects(scalar("SELECT pos_sync_push_aggregate($1::uuid,'default','a','t-a',$2::jsonb)",[randomUUID(),JSON.stringify(ops)]),/AUTHOR_REQUIRED/);
  await assert.rejects(scalar("SELECT pos_sync_push_shift_intent($1::uuid,'default','a','t-a',NULL,$2::jsonb)",[value.intentId,JSON.stringify(value.wire)]),/AUTHOR_REQUIRED/);
  for(const part of ops.slice(1,4)){
   await assert.rejects(scalar(`SELECT sync_apply_${part.table}($1::jsonb)`,[JSON.stringify(part.rows)]),/AUTHOR_REQUIRED/);
   await assert.rejects(scalar("SELECT pos_sync_push_batch($1::uuid,'default','a','other-a',$2,$3::jsonb,'[]')",[randomUUID(),part.table,JSON.stringify(part.rows)]),/AUTHOR_REQUIRED/);
  }
  await push(value);const saved=(await graph()).tables[0].rows[0];
  await assert.rejects(scalar("SELECT sync_delete_shifts($1::jsonb,'a','other-a')",[JSON.stringify([{operation:'DELETE',key:{id:shiftId}}])]),/AUTHOR_REQUIRED/);
  assert.equal(Number(saved.counted_cash),100);
 });
 await test('normal OPEN and harmless full-row housekeeping remain available on an enrolled terminal',async()=>{
  await enroll();const open=(await graph()).tables[0].rows[0];open.note='housekeeping';open.row_version=100;
  await scalar("SELECT pos_sync_push_batch($1::uuid,'default','a','t-a','shifts',$2::jsonb,'[]')",[randomUUID(),JSON.stringify([open])]);
  assert.equal((await graph()).tables[0].rows[0].note,'housekeeping');
 });
 await test('raw summary mutation is atomic, keeps delivery metadata, and cannot change financial facts or shift ownership',async()=>{
  const key=await enroll();await push(intent(await closing(),key));
  const summary=await scalar("INSERT INTO shift_notifications(shift_id,store_id,store_name,terminal_name,closed_by,opened_at,closed_at,total_sales,transactions,expected_cash,counted_cash,summary) VALUES($1,'a','A','Till','cashier',$2,$3,100,1,100,100,'Summary') RETURNING to_jsonb(shift_notifications)",[shiftId,opened,closed]);
  const raw=(operation,terminal='t-a')=>scalar('SELECT pos_sync_shift_author_raw_write($1::jsonb,$2)',[JSON.stringify(operation),terminal]);
  await raw({kind:'update',table:'shift_notifications',match:{id:summary.id.toUpperCase()},values:{channels:['delivered']}});
  assert.deepEqual(await scalar('SELECT channels FROM shift_notifications WHERE id=$1',[summary.id]),['delivered']);
  await assert.rejects(raw({kind:'update',table:'shift_notifications',match:{id:summary.id.toUpperCase()},values:{expected_cash:0,counted_cash:0}}),/AUTHOR_REQUIRED/);
  const unchanged=await scalar('SELECT to_jsonb(shift_notifications) FROM shift_notifications WHERE id=$1',[summary.id]);
  await raw({kind:'upsert',table:'shift_notifications',rows:[{...unchanged,channels:['acknowledged']}]});
  await assert.rejects(raw({kind:'delete',table:'shift_notifications',match:{shift_id:shiftId}},'other-a'),/AUTHOR_REQUIRED/);
  const otherShift=randomUUID();await db.query("INSERT INTO shifts(id,store_id,terminal_id,opened_at,opening_float) VALUES($1,'a','other-a',$2,0)",[otherShift,opened]);
  await assert.rejects(raw({kind:'update',table:'shift_notifications',match:{id:summary.id},values:{shift_id:otherShift}}),/AUTHOR_REQUIRED/);
  await assert.rejects(raw({kind:'insert',table:'shift_notifications',rows:[{...summary,id:randomUUID()}]}),/AUTHOR_REQUIRED/);
  assert.equal(Number(await scalar('SELECT expected_cash FROM shift_notifications WHERE id=$1',[summary.id])),100);
  assert.equal(await scalar('SELECT shift_id FROM shift_notifications WHERE id=$1',[summary.id]),shiftId);
 });
 await test('notification and alert helper aliases deny new money but retain delivery and personal acknowledgement fields',async()=>{
  const key=await enroll();await push(intent(await closing(),key));
  const summary=await scalar("INSERT INTO shift_notifications(shift_id,store_id,opened_at,closed_at,expected_cash,counted_cash) VALUES($1,'a',$2,$3,100,100) RETURNING to_jsonb(shift_notifications)",[shiftId,opened,closed]);
  const alert=await scalar("INSERT INTO shift_variance_alerts(shift_id,store_id,variance_total,variance_status,message) VALUES($1,'a',10,'OVER','Variance') RETURNING to_jsonb(shift_variance_alerts)",[shiftId]);
  await scalar('SELECT sync_apply_shift_notifications($1::jsonb)',[JSON.stringify([{...summary,channels:['delivered']}])]);
  await scalar('SELECT sync_apply_shift_variance_alerts($1::jsonb)',[JSON.stringify([{...alert,acknowledged_at:closed,acknowledged_by:'cashier',delivery_status:'sent'}])]);
  await assert.rejects(scalar('SELECT sync_apply_shift_notifications($1::jsonb)',[JSON.stringify([{...summary,expected_cash:0}])]),/AUTHOR_REQUIRED/);
  await assert.rejects(scalar('SELECT sync_apply_shift_variance_alerts($1::jsonb)',[JSON.stringify([{...alert,id:randomUUID(),variance_total:999}])]),/AUTHOR_REQUIRED/);
 });
 await test('older unenrolled terminal compatibility remains explicit and is never selected by a version string',async()=>{
  const ops=await closing(),value={intentId:randomUUID()};
  const payload={version:1,intentId:value.intentId,branchId:'a',shiftId,kind:'ORIGINAL',baseToken:null,predecessorIntentId:null,predecessorIntentHash:null,operations:ops};
  const {branchId:_branch,operations:_ops,...headers}=payload;
  await scalar("SELECT pos_sync_push_shift_intent($1::uuid,'default','a','t-a',NULL,$2::jsonb)",[value.intentId,JSON.stringify({...headers,payloadJson:JSON.stringify(payload)})]);
  assert.equal(await scalar('SELECT count(*)::int FROM shift_cash_counts'),1);
 });
 await test('accepted replay still requires the current valid terminal scope',async()=>{
  const key=await enroll(),value=intent(await closing(),key);await push(value);
  await db.exec("UPDATE terminal_tokens SET status='revoked' WHERE id='t-a'");await assert.rejects(push(value,false),/TERMINAL_SCOPE_FORBIDDEN/);
 });
 await test('Management device entitlement is checked after loading the locked current author, without granting production scope',async()=>{
  const originalScope=fn('pos_sync_validate_scope');
  const key=await enroll(),value=intent(await closing(),key);
  await db.exec("UPDATE terminal_tokens SET location_id=NULL WHERE id='t-a'");
  await assert.rejects(push(value),/TERMINAL_SCOPE_FORBIDDEN/);
  // Explicit test-only admission lets this case reach the subsequent entitlement
  // gate. The actual production scope function is restored in the same fixture.
  await db.exec("CREATE OR REPLACE FUNCTION pos_sync_validate_scope(p_organization_id text,p_branch_id text,p_terminal_id text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF p_branch_id<>'a' OR p_terminal_id<>'t-a' THEN RAISE EXCEPTION 'TEST_SCOPE_DENIED';END IF;END$$");
  try{
   await db.exec("UPDATE app_users SET permissions=permissions||'{\"can_use_management_pc\":false}',role='manager',role_slug='supervisor'");await assert.rejects(push(value),/PERMISSION_REVOKED/);
   await db.exec("UPDATE app_users SET permissions=permissions||'{\"can_use_management_pc\":true}'");await push(value);
   await db.exec("UPDATE app_users SET permissions=permissions||'{\"can_use_management_pc\":false}'");assert.equal((await push(value,false)).replayed,true);
  }finally{await db.exec(originalScope);}
 });
 await test('new service wrapper/private receipts have no anon/authenticated/direct-table grants',async()=>{
  assert.equal(await scalar("SELECT has_function_privilege('authenticated','pos_sync_push_author_shift_intent(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb)','EXECUTE')"),false);
  assert.equal(await scalar("SELECT has_table_privilege('service_role','pos_sync_private.shift_author_receipts','SELECT')"),false);
  assert.equal(await scalar("SELECT relrowsecurity FROM pg_class WHERE oid='pos_sync_private.shift_author_receipts'::regclass"),true);
 });
 console.log(`${passed} isolated AUTH-37 PostgreSQL scenarios passed.`);
}catch(error){console.error(error.message);if(error.where)console.error(error.where);process.exitCode=1;}finally{await db.close();}
