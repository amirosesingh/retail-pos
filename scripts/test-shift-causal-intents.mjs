// Disposable in-memory PostgreSQL only. No URL/profile/remote database accepted.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve, basename, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
const read = name => readFile(new URL('../'+name,import.meta.url),'utf8');
const schema=await read('supabase/schema.sql');
const migration=await read('supabase/migrations/20261102082439_shift_closing_causal_intents.sql');
const names=['shifts','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts'];
const redactor=ts.transpileModule(await read('src/lib/sync-download-redaction.ts'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {redactSyncDownload}=await import('data:text/javascript;base64,'+Buffer.from(redactor).toString('base64'));
function fn(name){const start=schema.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);assert(start>=0,name);const tail=schema.slice(start),delimiter=tail.match(/\bAS\s+(\$[\w]*\$)/i)[1];const begin=tail.indexOf(delimiter);return tail.slice(0,tail.indexOf(delimiter+';',begin+delimiter.length)+delimiter.length+1);}
function table(name){const start=schema.indexOf(`CREATE TABLE IF NOT EXISTS public.${name} (`);assert(start>=0,name);return schema.slice(start,schema.indexOf('\n);',start)+3);}
const db=new PGlite();
try {
const fixtureSql=`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.auth_role',true) $$;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
 CREATE TABLE app_users(id text,auth_user_id uuid,role text,permissions jsonb,is_active boolean,store_id text);
 CREATE TABLE terminal_tokens(id text PRIMARY KEY,location_id text,status text,revoked_at timestamptz);
 CREATE TABLE stores(id text PRIMARY KEY,name text);CREATE TABLE pos_settings(id int,notification_settings jsonb);
 CREATE TABLE authorization_requests(id uuid PRIMARY KEY,store_id text,status text,consumed_at timestamptz);
 CREATE TABLE audit_logs(id uuid PRIMARY KEY,store_id text);CREATE TABLE held_orders(store_id text,shift_id text,status text);
 CREATE TABLE sales(id uuid PRIMARY KEY,shift_id text,store_id text);
 CREATE TABLE sync_idempotency_receipts(batch_id uuid PRIMARY KEY,organization_id text,branch_id text,table_name text,payload_hash text,applied_count int);
 CREATE TABLE sync_change_feed(cursor bigint GENERATED ALWAYS AS IDENTITY,organization_id text,branch_id text,terminal_id text,table_name text,entity_id text,operation text,row_version bigint,tombstone boolean,changed_at timestamptz DEFAULT now());
 ${table('shifts')}
 ALTER TABLE shifts ADD PRIMARY KEY(id),ADD COLUMN state text,ADD COLUMN close_reason text,ADD COLUMN closing_started_at timestamptz,
 ADD COLUMN closing_started_by text,ADD COLUMN final_counted_cash numeric,ADD COLUMN variance_status text;
 ${names.slice(1).map(table).join('\n')}
 CREATE UNIQUE INDEX original_count ON shift_cash_counts(shift_id) WHERE kind='ORIGINAL';
 ${fn('pos_sync_validate_scope')}
 ${['pos_sync_assert_shift_ownership','pos_sync_shift_closure_ack','pos_sync_aggregate_shift_closure_ack'].map(fn).join('\n')}
 ${names.flatMap(name=>[fn('sync_apply_'+name),fn('sync_delete_'+name)]).join('\n')}
 ${fn('pos_sync_push_batch')}${fn('pos_sync_push_aggregate')}
 ${['skip_stale_update','bump_row_version','shifts_guard_client_writes','update_updated_at_column','shifts_sync_status','guard_shift_unfinished_tickets','shift_records_immutable','sync_feed_shifts'].map(fn).join('\n')}
 CREATE TRIGGER shifts_aa_stale_guard BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION skip_stale_update();
 CREATE TRIGGER shifts_bump_row_version BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION bump_row_version();
 CREATE TRIGGER shifts_guard_client_writes BEFORE INSERT OR UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION shifts_guard_client_writes();
 CREATE TRIGGER shifts_set_updated_at BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
 CREATE TRIGGER shifts_sync_status_trg BEFORE INSERT OR UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION shifts_sync_status();
 CREATE TRIGGER shifts_unfinished_tickets BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION guard_shift_unfinished_tickets();
 ${fn('sales_block_closing_shift')}
 CREATE TRIGGER sales_block_closing_shift BEFORE INSERT ON sales FOR EACH ROW EXECUTE FUNCTION sales_block_closing_shift();
 ${['shift_cash_counts','shift_reconciliations','shift_close_events'].map(name=>`CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON ${name} FOR EACH ROW EXECUTE FUNCTION shift_records_immutable();`).join('\n')}
 INSERT INTO terminal_tokens VALUES('t-a','a','active',NULL),('t-b','b','active',NULL),('other-a','a','active',NULL);
 SELECT set_config('test.auth_role','service_role',false);`;
await db.exec(fixtureSql);
const capturedArgument=process.argv.indexOf('--captured-routines');
if(capturedArgument<0){
 for(const name of ['20261030153259_confirm_shift_closure_sync_acknowledgement','20261030164829_bind_shift_closure_proof_to_requested_revision','20261031031945_preserve_validated_branch_context_for_shift_sync','20261101052452_prevent_closed_shift_reopening_during_sync'])
  await db.exec((await read('supabase/migrations/'+name+'.sql')).replaceAll('\r\n','\n'));
}
if(capturedArgument>=0){
 const captured=JSON.parse(await readFile(process.argv[capturedArgument+1],'utf8'));
 assert.equal(captured.mode,'read-only pg_catalog capture');
 assert.equal(captured.rows.length,21);
 for(const object of captured.rows){
  assert.equal(createHash('sha256').update(object.definition,'utf8').digest('hex').toLowerCase(),object.sha256.toLowerCase());
  if(object.object_type==='shift_trigger')continue;
  await db.exec(object.definition);
 }
 for(const object of captured.rows.filter(value=>value.object_type==='shift_trigger')){
  assert(/^[a-z_]+$/.test(object.name));await db.exec(`DROP TRIGGER IF EXISTS "${object.name}" ON public.shifts;${object.definition};`);
 }
 await assert.rejects(db.exec(migration),/SHIFT36_REQUIRES_REVIEWED_SHIFT32_PREREQUISITE/);
 await db.exec('ROLLBACK');
 assert.equal((await db.query("SELECT to_regnamespace('pos_sync_private') AS ns")).rows[0].ns,null);
 await db.exec((await read('supabase/migrations/20261101052452_prevent_closed_shift_reopening_during_sync.sql')).replaceAll('\r\n','\n'));
 console.log('PASS captured catalog prerequisites fail/roll back, then exact reviewed SHIFT32 applies in isolation');
}
await db.exec(migration);
const id=randomUUID(), opened='2026-10-31T00:00:00.123456Z', closed='2026-10-31T08:00:00.654321Z';
const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const typed=(name,row)=>scalar(`SELECT to_jsonb(jsonb_populate_record(NULL::public.${name},$1::jsonb))`,[JSON.stringify(row)]);
const graph=()=>scalar("SELECT pos_sync_shift_graph('default','a','t-a',$1::uuid)",[id]);
const seed=async()=>{await db.exec('TRUNCATE shifts CASCADE;TRUNCATE sales,sync_idempotency_receipts;TRUNCATE pos_sync_private.shift_intent_receipts;');await db.exec("SET pos.shift_fn='on'");
 await db.query("INSERT INTO shifts(id,store_id,terminal_id,terminal_name,opened_by_name,opened_by_staff_id,opened_by_role,opened_at,opening_float,status,state,row_version,created_at,updated_at) VALUES($1,'a','t-a','A till','Cashier','cashier','cashier',$2,10,'OPEN','ACTIVE',99,$2,$2)",[id,opened]);await db.exec("SET pos.shift_fn=''");};
async function closure(cash=100,previous=null){const result=previous?structuredClone(previous):await graph();const rows=result.tables;
 Object.assign(rows[0].rows[0],{status:'CLOSED',state:'CLOSED',closed_at:previous?rows[0].rows[0].closed_at:closed,closed_by_name:'Cashier',row_version:previous?1:100,
  counted_cash:cash,final_counted_cash:cash,closing_float:cash,counted_card:null,counted_digital:null,expected_cash:100,expected_card:0,expected_digital:0,
  variance_cash:cash-100,variance_card:null,variance_digital:null,variance_total:cash-100,variance_status:cash===100?'NO_VARIANCE':'OVER'});
 const countId=randomUUID();rows[1].rows.push(await typed('shift_cash_counts',{id:countId,shift_id:id,store_id:'a',terminal_id:'t-a',kind:previous?'RECOUNT':'ORIGINAL',counted_cash:cash,counted_card:null,counted_digital:null,reason:previous?'Correction':null,client_key:randomUUID(),created_at:closed}));
 rows[2].rows.push(await typed('shift_reconciliations',{id:randomUUID(),shift_id:id,store_id:'a',count_id:countId,expected_cash:100,expected_card:0,expected_digital:0,counted_cash:cash,counted_card:null,counted_digital:null,variance_cash:cash-100,variance_card:null,variance_digital:null,variance_total:cash-100,variance_status:cash===100?'NO_VARIANCE':'OVER',created_at:closed}));
 rows[3].rows.push(await typed('shift_close_events',{id:randomUUID(),shift_id:id,store_id:'a',terminal_id:'t-a',event:previous?'recount_submitted':'reconciled',from_state:previous?'CLOSED':'CASH_COUNT_SUBMITTED',to_state:'CLOSED',detail:{count_id:countId},created_at:closed}));
 if(!previous) rows[3].rows.push(await typed('shift_close_events',{id:randomUUID(),shift_id:id,store_id:'a',terminal_id:'t-a',event:'cash_count_submitted',from_state:'CASH_COUNT_REQUIRED',to_state:'CASH_COUNT_SUBMITTED',detail:{count_id:countId},created_at:closed}));
 return rows.map(part=>({...part,changes:[]}));}
function intent(operations,{baseToken=null,predecessor=null,kind='ORIGINAL'}={}){const intentId=randomUUID();const fields={version:1,intentId,shiftId:id,kind,baseToken,predecessorIntentId:predecessor?.intentId??null,predecessorIntentHash:predecessor?.hash??null};const payloadJson=JSON.stringify({...fields,branchId:'a',operations});return{intentId,hash:hash(payloadJson),operations,wire:{...fields,payloadJson}};}
const push=(value,branch='a',terminal='t-a')=>scalar("SELECT pos_sync_push_shift_intent($1::uuid,'default',$2,$3,$4::jsonb,$5::jsonb)",[value.intentId,branch,terminal,null,JSON.stringify(value.wire)]);
let passed=0;async function test(name,work){await seed();await work();passed++;console.log('PASS '+name);}
 await test('initial closure and immutable exact intent replay bind actual/requested clocks and raw bytes',async()=>{const a=intent(await closure());const ack=await push(a);assert.equal(ack.shift_closure_ack_version,3);assert.equal(ack.shift_closures[0].intent_hash,a.hash);assert.equal(ack.shift_closures[0].requested_row_version,100);assert.equal(ack.shift_closures[0].row_version,100);assert.deepEqual((await push(a)).shift_closures,ack.shift_closures);});
 await test('atomic read preserves PostgreSQL microseconds and is stable across session timezones',async()=>{await push(intent(await closure()));const utc=await graph();await db.exec("SET timezone='Asia/Kuala_Lumpur'");const other=await graph();await db.exec("SET timezone='UTC'");assert.deepEqual(utc,other);assert.equal(utc.closedAtRaw,utc.tables[0].rows[0].closed_at);assert.match(utc.closedAtRaw,/654321/);assert.equal(utc.tables.length,6);});
 await test('token ignores equivalent numeric scale and housekeeping revisions without rounding timestamps',async()=>{await push(intent(await closure()));const before=await graph();await db.exec("SET pos.shift_fn='on';UPDATE shifts SET counted_cash=100.00,final_counted_cash=100.000,row_version=row_version+1,note='housekeeping',overdue=true;SET pos.shift_fn=''");assert.equal((await graph()).graphToken,before.graphToken);});
 await test('verified branch/UUID casing aliases preserve frozen bytes and cannot redirect a different branch',async()=>{const ops=await closure();for(const op of ops)for(const row of op.rows){row.store_id='A';row.id=row.id.toUpperCase();if(row.shift_id)row.shift_id=row.shift_id.toUpperCase();if(row.count_id)row.count_id=row.count_id.toUpperCase();}const a=intent(ops);const payload=JSON.parse(a.wire.payloadJson);payload.branchId='A';a.wire.payloadJson=JSON.stringify(payload);a.hash=hash(a.wire.payloadJson);const ack=await push(a);assert.equal(ack.shift_closures[0].intent_hash,a.hash);assert.equal((await graph()).branchId,'a');});
 await test('offline original and two frozen recounts follow predecessor receipts',async()=>{const opsA=await closure();const a=intent(opsA);const b=intent(await closure(110,{tables:structuredClone(opsA)}),{kind:'RECOUNT',predecessor:a});const c=intent(await closure(120,{tables:structuredClone(b.operations)}),{kind:'RECOUNT',predecessor:b});await push(a);await push(b);await push(c);const current=await graph();assert.equal(Number(current.tables[0].rows[0].counted_cash),120);assert.equal(current.tables[1].rows.length,3);assert.match(current.closedAtRaw,/654321/);const replay=await push(a);assert.equal(replay.shift_closures[0].superseded,true);assert.equal(replay.shift_closures[0].current_token,current.graphToken);assert.equal(Number((await graph()).tables[0].rows[0].counted_cash),120);});
 await test('unseen web correction conflicts before any incoming child or receipt write',async()=>{const a=intent(await closure());await push(a);const base=await graph();const b=intent(await closure(110,base),{kind:'RECOUNT',predecessor:a});await db.exec("SET pos.shift_fn='on';UPDATE shifts SET note='web history',counted_cash=105,final_counted_cash=105 WHERE store_id='a';SET pos.shift_fn=''");await assert.rejects(push(b),/SYNC_SHIFT_BASELINE_CONFLICT/);assert.equal(await scalar('SELECT count(*)::int FROM shift_cash_counts'),1);assert.equal(await scalar('SELECT count(*)::int FROM pos_sync_private.shift_intent_receipts'),1);});
 await test('legacy stale CLOSED is rejected before mixed children',async()=>{const a=intent(await closure());await push(a);const old=await closure(110,await graph());old[0].rows[0].row_version=999;await assert.rejects(scalar("SELECT pos_sync_push_aggregate($1::uuid,'default','a','t-a',$2::jsonb)",[randomUUID(),JSON.stringify(old)]),/SYNC_SHIFT_CLOSURE_CONFLICT/);assert.equal(await scalar('SELECT count(*)::int FROM shift_cash_counts'),1);});
 await test('foreign branch and wrong predecessor terminal cannot use a private receipt',async()=>{const a=intent(await closure());await push(a);await assert.rejects(push(a,'b','t-b'),/SYNC_SHIFT_INTENT_INVALID|SYNC_BRANCH_FORBIDDEN/);const b=intent(await closure(110,await graph()),{kind:'RECOUNT',predecessor:a});await assert.rejects(push(b,'a','other-a'),/SYNC_SHIFT_PREDECESSOR_REQUIRED/);});
 await test('raw payload mutation, missing predecessor and self predecessor fail closed',async()=>{const a=intent(await closure());const changed=structuredClone(a);changed.wire.payloadJson+=' ';await push(a);await assert.rejects(push(changed),/SYNC_SHIFT_INTENT_MISMATCH/);const b=intent(await closure(110,await graph()),{kind:'RECOUNT',predecessor:{intentId:randomUUID(),hash:'a'.repeat(64)}});await assert.rejects(push(b),/SYNC_SHIFT_PREDECESSOR_REQUIRED/);const self=intent(await closure(110,await graph()),{kind:'RECOUNT'});const payload=JSON.parse(self.wire.payloadJson);payload.predecessorIntentId=self.intentId;payload.predecessorIntentHash='a'.repeat(64);self.wire.predecessorIntentId=self.intentId;self.wire.predecessorIntentHash=payload.predecessorIntentHash;self.wire.payloadJson=JSON.stringify(payload);await assert.rejects(push(self),/SYNC_SHIFT_INTENT_INVALID/);});
 await test('private receipts are append only and invisible to unprivileged roles',async()=>{await push(intent(await closure()));await assert.rejects(db.exec("UPDATE pos_sync_private.shift_intent_receipts SET payload_hash=repeat('a',64)"),/IMMUTABLE/);await assert.rejects(db.exec('DELETE FROM pos_sync_private.shift_intent_receipts'),/IMMUTABLE/);for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(db.query('SELECT * FROM pos_sync_private.shift_intent_receipts'),/permission denied/);await assert.rejects(db.query("SELECT pos_sync_shift_graph('default','a','t-a',$1::uuid)",[id]),/permission denied/);await db.exec('RESET ROLE');}});
 await test('legacy parent-first table uploads can complete ORIGINAL history without a causal token',async()=>{
  const ops=await closure();const batch=(table,rows,batchId=randomUUID())=>scalar("SELECT pos_sync_push_batch($1::uuid,'default','a','t-a',$2,$3::jsonb,'[]'::jsonb)",[batchId,table,JSON.stringify(rows)]);
  const legacyAck=await batch('shifts',ops[0].rows);assert.equal(legacyAck.shift_closure_ack_version,2,JSON.stringify(legacyAck));await assert.rejects(graph(),/SYNC_SHIFT_GRAPH_CONFLICT/);
  const receipt=randomUUID();await batch('shift_cash_counts',ops[1].rows,receipt);assert.equal((await batch('shift_cash_counts',ops[1].rows,receipt)).replayed,true);
  await batch('shift_close_events',ops[3].rows);await batch('shift_reconciliations',ops[2].rows);assert.match((await graph()).graphToken,/^[a-f0-9]{64}$/);
  const recount=await closure(110,await graph());await assert.rejects(batch('shift_cash_counts',recount[1].rows.slice(-1)),/SYNC_SHIFT_BASELINE_REQUIRED/);assert.equal(await scalar('SELECT count(*)::int FROM shift_cash_counts'),1);
 });
 await test('correction based on an atomic adopted token crosses independent counters and preserves server identity',async()=>{
  await push(intent(await closure()));const base=await graph();const b=intent(await closure(110,base),{kind:'RECOUNT',baseToken:base.graphToken});
  await db.exec("SET pos.shift_fn='on';UPDATE shifts SET note='new web note',overdue=true,row_version=row_version+1 WHERE store_id='a';SET pos.shift_fn=''");
  assert.equal((await graph()).graphToken,base.graphToken);await push(b);const saved=(await graph()).tables[0].rows[0];assert.equal(saved.note,'new web note');assert.equal(saved.overdue,true);assert.equal(saved.terminal_id,'t-a');assert.match(saved.opened_at,/123456/);assert.match(saved.closed_at,/654321/);
 });
 await test('malformed frozen graphs cannot create partial counts or public/private receipts',async()=>{
  for(const corrupt of [ops=>ops.splice(4,1),ops=>ops[2].rows[0].count_id=randomUUID(),ops=>ops[0].rows[0].counted_cash=123,ops=>ops[1].rows.push(structuredClone(ops[1].rows[0]))]){
   const ops=await closure();corrupt(ops);await assert.rejects(push(intent(ops)),/SYNC_SHIFT_(GRAPH|INTENT)/);assert.equal(await scalar('SELECT count(*)::int FROM shift_cash_counts'),0);assert.equal(await scalar('SELECT count(*)::int FROM pos_sync_private.shift_intent_receipts'),0);
  }
 });
 await test('failure after a child insert rolls back all facts, receipts and causal context; exact retry succeeds',async()=>{
  const a=intent(await closure());await db.exec("CREATE FUNCTION fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='57014',MESSAGE='fixture timeout'; END $$;CREATE TRIGGER fixture_failure BEFORE INSERT ON shift_reconciliations FOR EACH ROW EXECUTE FUNCTION fixture_failure();");
  await assert.rejects(push(a),/fixture timeout/);assert.equal(await scalar('SELECT count(*)::int FROM shift_cash_counts'),0);assert.equal(await scalar('SELECT count(*)::int FROM sync_idempotency_receipts'),0);assert.equal(await scalar("SELECT nullif(current_setting('pos.sync_causal_shift',true),'')"),null);
  await db.exec('DROP TRIGGER fixture_failure ON shift_reconciliations;DROP FUNCTION fixture_failure();');assert.equal((await push(a)).shift_closure_ack_version,3);
 });
 await test('nonclosed snapshots have no accepted closing token; missing/foreign/oversized graphs never fabricate one',async()=>{
  const current=await graph();assert.equal(current.graphToken,null);assert.equal(current.closedAtRaw,null);assert.equal(current.tables.length,6);
  await assert.rejects(scalar("SELECT pos_sync_shift_graph('default','a','t-a',$1::uuid)",[randomUUID()]),/SYNC_SHIFT_GRAPH_MISSING/);
  await assert.rejects(scalar("SELECT pos_sync_shift_graph('default','b','t-b',$1::uuid)",[id]),/SYNC_BRANCH_FORBIDDEN/);
  await db.query("INSERT INTO shift_cash_counts(id,shift_id,store_id,kind,counted_cash) SELECT gen_random_uuid(),$1::uuid,'a','RECOUNT',100 FROM generate_series(1,2000)",[id]);await assert.rejects(graph(),/SYNC_SHIFT_GRAPH_TOO_LARGE/);
 });
 await test('private protocol metadata never becomes a public sync table or registered business entity',async()=>{
  const registry=JSON.parse(await read('database/sqlserver/schema-registry.json'));assert(!registry.tables.some(t=>/shift_intent_receipts|pos_sync_private/.test(t.cloudTable)));
  assert.equal(await scalar("SELECT to_regclass('public.shift_intent_receipts')"),null);assert.equal(await scalar("SELECT to_regprocedure('public.sync_apply_shift_intent_receipts(jsonb)')"),null);
 });
 await test('server recognition matches existing ordinary/management download masking and preserves hidden immutable history',async()=>{
  const ops=await closure();ops[3].rows[0].detail={count_id:ops[1].rows[0].id,nested:[{table_name:'terminal_tokens',claim_proof:'synthetic-private',claim_secret_hash:'synthetic-private',claimed_proof_hash:'synthetic-private',name:'Till'},{table_name:'products',ecom_price:25,ecom_enabled:true,retail_price:10},{table_name:'settings_scoped',key:'product_price:x',value:{ecom_price:30,retail_price:10}}]};
  await push(intent(ops));const raw=await graph();for(const management of [false,true])assert.deepEqual(await scalar('SELECT pos_sync_private.download_projection($1::jsonb,$2,$3)',[JSON.stringify(raw.tables),'',management]),redactSyncDownload(raw.tables,'',management));
  const masked=redactSyncDownload(raw,'',false);const b=intent(await closure(110,masked),{kind:'RECOUNT',baseToken:raw.graphToken});await push(b);
  const saved=await graph();assert.equal(saved.tables[3].rows.find(e=>e.id===ops[3].rows[0].id).detail.nested[0].claim_proof,'synthetic-private');
 });
 await test('nullable historical reconciliation survives adoption/correction but never proves the effective closing',async()=>{
  await push(intent(await closure()));await db.query("INSERT INTO shift_reconciliations(id,shift_id,store_id,count_id,expected_cash,expected_card,expected_digital,variance_status) VALUES($1,$2,'a',NULL,0,0,0,'NO_VARIANCE')",[randomUUID(),id]);
  const base=await graph();assert.equal(base.tables[2].rows.length,2);await push(intent(await closure(110,base),{kind:'RECOUNT',baseToken:base.graphToken}));assert.equal((await graph()).tables[2].rows.length,3);
 });
 await test('migration replay preserves receipt facts and aborts unknown private schema/table shapes',async()=>{
  await push(intent(await closure()));const receipt=await scalar('SELECT to_jsonb(r) FROM pos_sync_private.shift_intent_receipts r');await db.exec(migration);assert.deepEqual(await scalar('SELECT to_jsonb(r) FROM pos_sync_private.shift_intent_receipts r'),receipt);
  await db.exec('CREATE FUNCTION pos_sync_private.fixture_sentinel() RETURNS int LANGUAGE sql AS $$ SELECT 7 $$');await assert.rejects(db.exec(migration),/UNEXPECTED_SHIFT_CAUSAL_PRIVATE_SCHEMA/);await db.exec('ROLLBACK');assert.equal(await scalar('SELECT pos_sync_private.fixture_sentinel()'),7);await db.exec('DROP FUNCTION pos_sync_private.fixture_sentinel()');
  await db.exec("CREATE FUNCTION pos_sync_private.graph_token(text) RETURNS text LANGUAGE sql AS $$ SELECT 'unrelated overload'::text $$");await assert.rejects(db.exec(migration),/UNEXPECTED_SHIFT_CAUSAL_PRIVATE_SCHEMA/);await db.exec('ROLLBACK');assert.equal(await scalar("SELECT pos_sync_private.graph_token('sentinel'::text)"),'unrelated overload');await db.exec('DROP FUNCTION pos_sync_private.graph_token(text)');
  await db.exec('ALTER TABLE pos_sync_private.shift_intent_receipts ADD COLUMN fixture_extra int');await assert.rejects(db.exec(migration),/UNEXPECTED_SHIFT_INTENT_RECEIPT_SHAPE/);await db.exec('ROLLBACK');await db.exec('ALTER TABLE pos_sync_private.shift_intent_receipts DROP COLUMN fixture_extra');
  await db.exec('CREATE UNIQUE INDEX fixture_unique ON pos_sync_private.shift_intent_receipts(branch_id)');await assert.rejects(db.exec(migration),/UNEXPECTED_SHIFT_INTENT_RECEIPT_INDEX/);await db.exec('ROLLBACK');await db.exec('DROP INDEX pos_sync_private.fixture_unique');
 });
 await test('direct internal shift helper cannot bypass stale CLOSED protection under verified branch context',async()=>{
  await push(intent(await closure()));const stale=(await closure(110,await graph()))[0].rows[0];stale.row_version=999;
  await db.exec("SET pos.sync_branch='a'");await assert.rejects(scalar('SELECT sync_apply_shifts($1::jsonb)',[JSON.stringify([stale])]),/SYNC_SHIFT_CLOSURE_CONFLICT/);assert.equal(Number((await graph()).tables[0].rows[0].counted_cash),100);
 });
 await test('fresh ORIGINAL and RECOUNT target arithmetic, tender bounds and event links cannot be forged',async()=>{
  for(const corrupt of [ops=>ops[3].rows.splice(0),ops=>{ops[0].rows[0].variance_total=999;ops[2].rows[0].variance_total=999;},ops=>{ops[0].rows[0].counted_cash=-1;ops[0].rows[0].final_counted_cash=-1;ops[1].rows[0].counted_cash=-1;ops[2].rows[0].counted_cash=-1;},ops=>ops[1].rows[0].counted_card='NaN']){
   const ops=await closure();corrupt(ops);await assert.rejects(push(intent(ops)),/SYNC_SHIFT_(GRAPH|TARGET)/);assert.equal(await scalar('SELECT count(*)::int FROM shift_cash_counts'),0);
  }
 });
 await test('VARIANCE approves an existing counted review graph without inventing or changing money',async()=>{
  const counted=await closure(110);Object.assign(counted[0].rows[0],{state:'VARIANCE_REVIEW_REQUIRED',status:'OPEN',closed_at:null});
  await scalar("SELECT pos_sync_push_aggregate($1::uuid,'default','a','t-a',$2::jsonb)",[randomUUID(),JSON.stringify(counted)]);
  const current=await graph();assert.equal(current.graphToken,null);const approval=current.tables.map(part=>({...part,changes:[]}));Object.assign(approval[0].rows[0],{state:'CLOSED',status:'CLOSED',closed_at:closed,closed_by_name:'Approver'});
  approval[3].rows.push(await typed('shift_close_events',{id:randomUUID(),shift_id:id,store_id:'a',terminal_id:'t-a',event:'variance_approved',from_state:'VARIANCE_REVIEW_REQUIRED',to_state:'CLOSED',detail:{note:'Reviewed'},created_at:closed}));
  const bad=structuredClone(approval);bad[0].rows[0].expected_cash=90;await assert.rejects(push(intent(bad,{kind:'VARIANCE'})),/SYNC_SHIFT_GRAPH_CONFLICT/);
  await push(intent(approval,{kind:'VARIANCE'}));assert.equal(await scalar('SELECT count(*)::int FROM shift_cash_counts'),1);assert.equal(Number((await graph()).tables[0].rows[0].counted_cash),110);
 });
 await test('actual sale guard preserves OPEN before unsynced sales before final close and exact receipt replay afterward',async()=>{
  const sale=randomUUID();await db.query("INSERT INTO sales VALUES($1,$2,'a')",[sale,id]);
  const a=intent(await closure());await push(a);const b=intent(await closure(110,await graph()),{kind:'RECOUNT',predecessor:a});await push(b);await push(intent(await closure(120,await graph()),{kind:'RECOUNT',predecessor:b}));
  await assert.rejects(db.query("INSERT INTO sales VALUES($1,$2,'a')",[randomUUID(),id]),/no further transactions/);
  await db.query("INSERT INTO sales VALUES($1,$2,'a') ON CONFLICT DO NOTHING",[sale,id]);assert.equal(await scalar('SELECT count(*)::int FROM sales'),1);
 });
 await test('coverage proves complete matched business fields and preserves pending note/alert metadata mismatches',async()=>{
  const ops=await closure(110),alertId=randomUUID();ops[5].rows.push(await typed('shift_variance_alerts',{id:alertId,shift_id:id,store_id:'a',reconciliation_id:ops[2].rows[0].id,variance_total:10,variance_status:'OVER',severity:'warning',message:'Variance',delivery_status:'pending',attempts:0,created_at:closed,updated_at:closed}));
  const a=intent(ops),accepted=await push(a),coverageA=accepted.shift_closures[0].coverage;assert.equal(coverageA.version,1);assert.equal(coverageA.mode,'matched_request_rows');assert.equal(coverageA.tables.length,6);
  const registry=JSON.parse(await read('database/sqlserver/schema-registry.json'));
  for(const entry of coverageA.tables){const columns=registry.tables.find(t=>t.cloudTable===entry.table).columns.map(c=>c.cloudColumn);assert.deepEqual(entry.fields,[...columns.filter(c=>!['row_version','updated_at'].includes(c))].sort());assert.deepEqual(entry.serverManagedFields,[...columns.filter(c=>['row_version','updated_at'].includes(c))].sort());for(const row of entry.rows)assert.deepEqual(Object.keys(row.serverValues).sort(),entry.serverManagedFields);}
  assert.equal(coverageA.tables[0].rows[0].id,id);assert.equal(coverageA.tables[5].rows[0].id,alertId);
  const base=await graph(),local=structuredClone(base);local.tables[0].rows[0].note='unuploaded local note';local.tables[5].rows[0].acknowledged_by='unuploaded local acknowledgement';
  await db.exec("SET pos.shift_fn='on';UPDATE shifts SET note='new cloud note',overdue=true,row_version=row_version+1;SET pos.shift_fn='';UPDATE shift_variance_alerts SET delivery_status='sent',attempts=3,acknowledged_by='cloud acknowledgement',updated_at=now();");
  assert.equal((await graph()).graphToken,base.graphToken);const b=intent(await closure(120,local),{kind:'RECOUNT',baseToken:base.graphToken});const response=await push(b),coverageB=response.shift_closures[0].coverage;
  assert.deepEqual(coverageB.tables[0].rows,[]);assert.deepEqual(coverageB.tables[5].rows,[]);assert(coverageB.tables[1].rows.some(row=>row.id===b.operations[1].rows.at(-1).id));
  const saved=await graph();assert.equal(saved.tables[0].rows[0].note,'new cloud note');assert.equal(saved.tables[0].rows[0].overdue,true);assert.equal(saved.tables[5].rows[0].delivery_status,'sent');assert.equal(saved.tables[5].rows[0].acknowledged_by,'cloud acknowledgement');
  const replay=await push(a);assert.equal(replay.shift_closures[0].superseded,true);assert.deepEqual(replay.shift_closures[0].coverage,coverageA);assert(Buffer.byteLength(JSON.stringify(coverageB),'utf8')<=512*1024);
 });
 console.log(`${passed} isolated SHIFT-36 PostgreSQL scenarios passed.`);
 const postgresArgument=process.argv.indexOf('--postgres-bin');
 if(postgresArgument>=0)await runRaces(process.argv[postgresArgument+1]);
 async function runRaces(binaryPath){
  assert(binaryPath,'Use --postgres-bin <portable PostgreSQL bin directory>');
  const bin=await realpath(resolve(binaryPath)),executable=name=>join(bin,name+(process.platform==='win32'?'.exe':''));
  const temporaryRoot=await realpath(tmpdir());await mkdir(temporaryRoot,{recursive:true});
  const fixture=await mkdtemp(join(temporaryRoot,'retail-shift-causal-')),data=join(fixture,'data'),log=join(fixture,'postgres.log');
  const environment={...process.env};for(const name of Object.keys(environment))if(/^PG/i.test(name)||name==='DATABASE_URL')delete environment[name];
  const port=await new Promise((accept,reject)=>{const probe=createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const value=probe.address().port;probe.close(()=>accept(value));});});
  const children=new Set();let started=false,succeeded=false,races=0;
  const quote=value=>"'"+String(value).replaceAll("'","''")+"'",pause=()=>new Promise(accept=>setTimeout(accept,20));
  const control=args=>new Promise((accept,reject)=>{const child=spawn(executable('pg_ctl'),args,{env:environment,windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('exit',code=>code===0?accept():reject(new Error('Fixture pg_ctl failed; see '+log)));});
  function session(name='shift-causal-'+randomUUID()){
   const child=spawn(executable('psql'),['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(port),'-U','shift_fixture','-d','postgres'],
    {env:{...environment,PGAPPNAME:name},windowsHide:true,stdio:['pipe','pipe','pipe']});children.add(child);
   const state={output:'',error:'',done:false};child.stdout.on('data',value=>state.output+=value);child.stderr.on('data',value=>state.error+=value);child.stdin.on('error',()=>{});
   const finished=new Promise(accept=>{child.once('error',error=>{state.error+=error.message;state.done=true;children.delete(child);accept({code:-1,...state});});child.once('close',code=>{state.done=true;children.delete(child);accept({code,...state});});});
   child.stdin.write("\\set VERBOSITY verbose\nSET test.auth_role='service_role';SET statement_timeout='15s';\n");return{child,state,finished};
  }
  async function query(sql,name){const current=session(name);current.child.stdin.end(sql+'\n');const result=await current.finished;if(result.code!==0)throw new Error(result.error||'Fixture psql failed');return result.output.trim();}
  async function holder(sql){const current=session();current.child.stdin.write('BEGIN;\n'+sql+"\nSELECT 'FIXTURE_READY';\n");const deadline=Date.now()+5000;
   while(!current.state.output.includes('FIXTURE_READY')){if(current.state.done||Date.now()>deadline)throw new Error('Holder not ready: '+current.state.error);await pause();}
   return async(action='COMMIT')=>{current.child.stdin.end(action+';\n\\q\n');const result=await current.finished;assert.equal(result.code,0,result.error);};}
  async function blocked(name){const deadline=Date.now()+5000;while(Date.now()<deadline){if(await query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(name)} AND cardinality(pg_blocking_pids(pid))>0);`)==='t')return;await pause();}throw new Error('Expected independent fixture session to block');}
  async function contend(sql,finish,action='COMMIT'){const name='shift-contender-'+randomUUID();const pending=query(sql,name).then(value=>({value}),error=>({error}));await blocked(name);await finish(action);return pending;}
  const pushSql=value=>`SELECT pos_sync_push_shift_intent(${quote(value.intentId)}::uuid,'default','a','t-a',NULL::jsonb,${quote(JSON.stringify(value.wire))}::jsonb);`;
  const legacySql=(row,batch=randomUUID())=>`SELECT pos_sync_push_batch(${quote(batch)}::uuid,'default','a','t-a','shifts',${quote(JSON.stringify([row]))}::jsonb,'[]'::jsonb);`;
  const readGraph=async()=>JSON.parse(await query(`SELECT pos_sync_shift_graph('default','a','t-a',${quote(id)}::uuid);`));
  const seedRace=async(empty=false)=>{await query('TRUNCATE shifts CASCADE;TRUNCATE sales,sync_idempotency_receipts,pos_sync_private.shift_intent_receipts;'+(empty?'':
   `SET pos.shift_fn='on';INSERT INTO shifts(id,store_id,terminal_id,terminal_name,opened_by_name,opened_by_staff_id,opened_by_role,opened_at,opening_float,status,state,row_version,created_at,updated_at) VALUES(${quote(id)},'a','t-a','A till','Cashier','cashier','cashier',${quote(opened)},10,'OPEN','ACTIVE',99,${quote(opened)},${quote(opened)});SET pos.shift_fn='';`));};
  async function race(name,work){await seedRace();await seed();await work();races++;console.log('PASS real two-session '+name);}
  try{
   await promisify(execFile)(executable('initdb'),['-D',data,'--auth=trust','--username=shift_fixture','--no-locale','--encoding=UTF8'],{env:environment,windowsHide:true});
   await control(['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port} -F -c max_connections=10 -c shared_buffers=16MB`,'-w','start']);started=true;
   await query(fixtureSql);
   if(capturedArgument>=0){const capture=JSON.parse(await readFile(process.argv[capturedArgument+1],'utf8'));for(const object of capture.rows.filter(value=>value.object_type!=='shift_trigger'))await query(object.definition);
    for(const object of capture.rows.filter(value=>value.object_type==='shift_trigger'))await query(`DROP TRIGGER IF EXISTS "${object.name}" ON public.shifts;${object.definition};`);
    await query((await read('supabase/migrations/20261101052452_prevent_closed_shift_reopening_during_sync.sql')).replaceAll('\r\n','\n'));
   }else for(const name of ['20261030153259_confirm_shift_closure_sync_acknowledgement','20261030164829_bind_shift_closure_proof_to_requested_revision','20261031031945_preserve_validated_branch_context_for_shift_sync','20261101052452_prevent_closed_shift_reopening_during_sync'])await query((await read('supabase/migrations/'+name+'.sql')).replaceAll('\r\n','\n'));
   await query(migration);
   await race('two corrections from one observed token serialize; second cannot overwrite the first',async()=>{const a=intent(await closure());await query(pushSql(a));const base=await readGraph();const b=intent(await closure(110,base),{kind:'RECOUNT',baseToken:base.graphToken}),c=intent(await closure(120,base),{kind:'RECOUNT',baseToken:base.graphToken});
    const result=await contend(pushSql(c),await holder(pushSql(b)));assert.match(result.error?.message??'unexpected success',/SYNC_SHIFT_BASELINE_CONFLICT/);assert.equal(Number((await readGraph()).tables[0].rows[0].counted_cash),110);assert.equal(await query('SELECT count(*) FROM shift_cash_counts;'),'2');});
   await race('rolled-back correction leaves the same baseline usable by the waiting correction',async()=>{const a=intent(await closure());await query(pushSql(a));const base=await readGraph();const b=intent(await closure(110,base),{kind:'RECOUNT',baseToken:base.graphToken}),c=intent(await closure(120,base),{kind:'RECOUNT',baseToken:base.graphToken});
    const result=await contend(pushSql(c),await holder(pushSql(b)),'ROLLBACK');assert.equal(result.error,undefined);assert.equal(Number((await readGraph()).tables[0].rows[0].counted_cash),120);assert.equal(await query('SELECT count(*) FROM pos_sync_private.shift_intent_receipts;'),'2');});
   await race('offline successor waits for its in-flight predecessor receipt',async()=>{const ops=await closure();const a=intent(ops),b=intent(await closure(110,{tables:structuredClone(ops)}),{kind:'RECOUNT',predecessor:a});
    const result=await contend(pushSql(b),await holder(pushSql(a)));assert.equal(result.error,undefined);assert.equal(Number((await readGraph()).tables[0].rows[0].counted_cash),110);});
   await race('superseded receipt replay waits, then acknowledges history without restoring old money',async()=>{const a=intent(await closure());await query(pushSql(a));const b=intent(await closure(110,await readGraph()),{kind:'RECOUNT',predecessor:a});
    const result=await contend(pushSql(a),await holder(pushSql(b)));assert.equal(result.error,undefined);assert.equal(JSON.parse(result.value).shift_closures[0].superseded,true);assert.equal(Number((await readGraph()).tables[0].rows[0].counted_cash),110);});
   await race('absent-parent legacy close wins without children; waiting v3 cannot overwrite it',async()=>{await seedRace(true);const a=intent(await closure(110));const legacy=(await closure())[0].rows[0];
    const result=await contend(pushSql(a),await holder(legacySql(legacy)));assert.match(result.error?.message??'unexpected success',/SYNC_SHIFT_BASELINE_REQUIRED/);assert.equal(await query('SELECT count(*) FROM shift_cash_counts;'),'0');assert.equal(await query('SELECT count(*) FROM pos_sync_private.shift_intent_receipts;'),'0');});
   await race('v3 initial closing wins before a queued higher-counter legacy closing',async()=>{const a=intent(await closure());const stale={...(await closure(110))[0].rows[0],row_version:999};
    const result=await contend(legacySql(stale),await holder(pushSql(a)));assert.match(result.error?.message??'unexpected success',/SYNC_SHIFT_CLOSURE_CONFLICT/);assert.equal(Number((await readGraph()).tables[0].rows[0].counted_cash),100);});
   await race('same batch UUID legacy/protected contention preserves batch-before-shift lock order',async()=>{await seedRace(true);const a=intent(await closure(110));const legacy=(await closure())[0].rows[0];
    const result=await contend(pushSql(a),await holder(legacySql(legacy,a.intentId)));assert.match(result.error?.message??'unexpected success',/SYNC_SHIFT_BASELINE_REQUIRED/);assert.doesNotMatch(result.error?.message??'',/40P01|deadlock detected/);});
   await race('atomic reader sees one committed graph while another session has partial uncommitted children',async()=>{const a=intent(await closure());await query(pushSql(a));const before=await readGraph();const next=await closure(110,before);
    const inserts=next.slice(1,4).map(part=>`INSERT INTO ${part.table} SELECT * FROM jsonb_populate_recordset(NULL::${part.table},${quote(JSON.stringify(part.rows.slice(-1)))}::jsonb);`).join('\n');
    const finish=await holder(inserts);assert.deepEqual(await readGraph(),before);await finish('ROLLBACK');assert.deepEqual(await readGraph(),before);});
   succeeded=true;console.log(`${races} real isolated SHIFT-36 concurrency scenarios passed.`);
  }finally{
   for(const child of children)child.kill();if(started)await control(['-D',data,'-m','fast','-w','stop']);
   const actual=await realpath(fixture);assert(actual.toLowerCase().startsWith((temporaryRoot+sep).toLowerCase())&&basename(actual).startsWith('retail-shift-causal-'),'Refuse unsafe fixture cleanup');
   if(succeeded)await rm(actual,{recursive:true,force:true});else console.error('Stopped fixture retained for inspection: '+actual);
  }
 }
}catch(error){console.error(error.message);if(error.where)console.error(error.where);process.exitCode=1;}finally{await db.close();}
