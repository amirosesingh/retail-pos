// Disposable PostgreSQL + actual Main payload/writer/PushWorker integration.
// SQL Server storage is a transactional in-memory fixture; this is not a real
// till or notification-delivery test. Optional captures contain routines only.
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8');
const schema = await read('supabase/schema.sql');
const mainSource = await read('electron/main.cjs');
const registry = JSON.parse(await read('database/sqlserver/schema-registry.json'));
const { OperationsRepository } = require('../electron/db/repositories/operations.cjs');
const { ShiftSyncJournal } = require('../electron/db/shift-sync-journal.cjs');
const { PushWorker } = require('../electron/sync/push-worker.cjs');
const { ChangeReader } = require('../electron/sync/change-reader.cjs');
const { CloudClient } = require('../electron/sync/cloud-client.cjs');
const { recordId } = require('../electron/sync/uuid-fields.cjs');
const tables = ['shifts','shift_cash_counts','shift_close_events','shift_reconciliations',
  'shift_notifications','shift_variance_alerts','activity_events'];
const tableMap = new Map(registry.tables.map(table => [table.sqlServerTable, table]));
const id = '11111111-1111-4111-8111-111111111111';
const operator = '22222222-2222-4222-8222-222222222222';
const opened = '2026-10-31T00:00:00.000Z';
const sourceFunction = name => {
  const start = schema.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert(start >= 0, name);
  const delimiter = schema.slice(start).match(/\bAS\s+(\$[\w]*\$)/i)?.[1];
  assert(delimiter, name);
  const bodyStart = schema.indexOf(delimiter,start);
  return schema.slice(start,schema.indexOf(`${delimiter};`,bodyStart+delimiter.length)+delimiter.length+1);
};
const sourceTable = name => {
  const start = schema.indexOf(`CREATE TABLE IF NOT EXISTS public.${name} (`);
  assert(start >= 0,name);
  return schema.slice(start,schema.indexOf('\n);',start)+3);
};
const capturedFiles = process.argv.slice(2);
assert(capturedFiles.length === 0 || capturedFiles.length === 3,
  'Supply all three routine/trigger-capture files or none; never a database connection.');
const captures = await Promise.all(capturedFiles.map(async file => JSON.parse(await readFile(file,'utf8'))));
const lifecycleMigration = await read('supabase/migrations/20261101052452_prevent_closed_shift_reopening_during_sync.sql');
const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.auth_role',true) $$;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${operator}'::uuid $$;
 CREATE TABLE app_users(id text,auth_user_id uuid,role text,permissions jsonb,is_active boolean,store_id text);
 CREATE TABLE terminal_tokens(id text PRIMARY KEY,location_id text,status text,revoked_at timestamptz);
 CREATE TABLE pos_settings(id integer PRIMARY KEY,notification_settings jsonb);
 CREATE TABLE stores(id text PRIMARY KEY,name text);
 CREATE TABLE authorization_requests(id uuid PRIMARY KEY,store_id text,status text,consumed_at timestamptz);
 CREATE TABLE audit_logs(id uuid PRIMARY KEY,store_id text);
 CREATE TABLE sync_idempotency_receipts(batch_id uuid PRIMARY KEY,organization_id text,branch_id text,
   table_name text,payload_hash text,applied_count int);
 CREATE TABLE sync_change_feed(cursor bigint GENERATED ALWAYS AS IDENTITY,organization_id text,branch_id text,
   terminal_id text,table_name text,entity_id text,operation text,row_version bigint,tombstone boolean,changed_at timestamptz DEFAULT now());
 CREATE TABLE held_orders(store_id text,shift_id text,status text);
 ${sourceTable('shifts')}
 ALTER TABLE shifts ADD PRIMARY KEY(id),ADD COLUMN state text,ADD COLUMN close_reason text,
   ADD COLUMN closing_started_at timestamptz,ADD COLUMN closing_started_by text,
   ADD COLUMN final_counted_cash numeric,ADD COLUMN variance_status text;
 ${tables.slice(1).map(sourceTable).join('\n')}
 ALTER TABLE activity_events ADD PRIMARY KEY(id),ADD COLUMN previous_state text,ADD COLUMN new_state text,
   ADD COLUMN cleared_by text[],ADD COLUMN branch_id text;
 ${sourceTable('notification_deliveries')}
 CREATE UNIQUE INDEX shift_cash_counts_original_uidx ON shift_cash_counts(shift_id) WHERE kind='ORIGINAL';
 CREATE UNIQUE INDEX shift_cash_counts_client_key_uidx ON shift_cash_counts(client_key) WHERE client_key IS NOT NULL;
 CREATE UNIQUE INDEX activity_events_client_event_id_key ON activity_events(client_event_id);
 ${sourceFunction('pos_sync_validate_scope')}
 ${tables.flatMap(table => [sourceFunction('sync_apply_'+table),sourceFunction('sync_delete_'+table)]).join('\n')}
 ${['pos_sync_push_batch','pos_sync_push_aggregate','skip_stale_update','bump_row_version',
   'shifts_guard_client_writes','update_updated_at_column','shifts_sync_status',
   'guard_shift_unfinished_tickets','shift_records_immutable','activity_events_immutable',
   'apply_in_app_notification_preference','pos_resolve_late_approval_notification',
   'queue_notification_rule_deliveries','queue_shift_summary_rule_event',
   ...tables.map(table => 'sync_feed_'+table)].map(sourceFunction).join('\n')}
 CREATE TRIGGER shifts_aa_stale_guard BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION skip_stale_update();
 CREATE TRIGGER shifts_bump_row_version BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION bump_row_version();
 CREATE TRIGGER shifts_guard_client_writes BEFORE INSERT OR UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION shifts_guard_client_writes();
 CREATE TRIGGER shifts_set_updated_at BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
 CREATE TRIGGER shifts_sync_status_trg BEFORE INSERT OR UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION shifts_sync_status();
 CREATE TRIGGER shifts_unfinished_tickets BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION guard_shift_unfinished_tickets();
 ${['shift_cash_counts','shift_close_events','shift_reconciliations'].map(table =>
   `CREATE TRIGGER ${table}_immutable BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION shift_records_immutable();`).join('\n')}
 CREATE TRIGGER activity_events_no_update BEFORE UPDATE OR DELETE ON activity_events FOR EACH ROW EXECUTE FUNCTION activity_events_immutable();
 CREATE TRIGGER apply_in_app_notification_preference BEFORE INSERT ON activity_events FOR EACH ROW EXECUTE FUNCTION apply_in_app_notification_preference();
 CREATE TRIGGER pos_resolve_late_approval_notification BEFORE INSERT ON activity_events FOR EACH ROW EXECUTE FUNCTION pos_resolve_late_approval_notification();
 CREATE TRIGGER queue_notification_rule_deliveries AFTER INSERT ON activity_events FOR EACH ROW EXECUTE FUNCTION queue_notification_rule_deliveries();
 CREATE TRIGGER queue_shift_summary_rule_event AFTER INSERT OR UPDATE ON shift_notifications FOR EACH ROW EXECUTE FUNCTION queue_shift_summary_rule_event();
 ${tables.map(table => `CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION sync_feed_${table}();`).join('\n')}
 INSERT INTO terminal_tokens VALUES('t-a','a','active',NULL),('t-handover','a','active',NULL),('t-b','b','active',NULL);
 INSERT INTO pos_settings VALUES(1,'{}'); INSERT INTO stores VALUES('a','Branch A');
 SELECT set_config('test.auth_role','service_role',false);`);
await db.exec(await read('supabase/migrations/20261030153259_confirm_shift_closure_sync_acknowledgement.sql'));
await db.exec(await read('supabase/migrations/20261030164829_bind_shift_closure_proof_to_requested_revision.sql'));
await db.exec(await read('supabase/migrations/20261031031945_preserve_validated_branch_context_for_shift_sync.sql'));
await db.exec(`REVOKE ALL ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,text,jsonb),
  public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION public.pos_sync_push_aggregate(uuid,text,text,text,jsonb),
  public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb) TO service_role;`);
for (const capture of captures) for (const routine of capture.routines) await db.exec(routine.definition);
for (const capture of captures) {
  for (const trigger of capture.triggers ?? []) {
    const table=trigger.table ?? 'shifts';
    assert(tables.includes(table) && /^[a-z_]+$/.test(trigger.name));
    await db.exec(`DROP TRIGGER IF EXISTS "${trigger.name}" ON public."${table}";${trigger.definition};`);
  }
  for (const constraint of capture.constraints ?? []) {
    assert(tables.includes(constraint.table) && /^[a-z_]+$/.test(constraint.name));
    const found=await db.query('SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2',
      ['public.'+constraint.table,constraint.name]);
    if(!found.rows.length)await db.exec(`ALTER TABLE public."${constraint.table}" ADD CONSTRAINT "${constraint.name}" ${constraint.definition};`);
    else assert.equal(found.rows[0].definition.replace(/\s+/g,' '),constraint.definition.replace(/\s+/g,' '),constraint.name);
  }
}
await db.exec(lifecycleMigration);
// All captured callbacks execute with legacy/no rules or an empty enabled-rule
// list. Rule-recipient matching, external delivery and nonempty rule sets are
// separate workflows; this fixture neither sends notifications nor stubs them.

const openShift = () => ({id,store_id:'a',terminal_id:'t-a',terminal_name:'Till A',
 opened_by_name:'Cashier',opened_by_staff_id:'cashier',opened_by_role:'cashier',
 closed_by_name:null,closed_by_staff_id:null,closed_by_role:null,opened_at:opened,closed_at:null,
 opening_float:10,counted_cash:null,expected_cash:null,note:'',overdue:false,created_at:opened,
 updated_at:opened,status:'OPEN',closing_float:null,user_id:operator,row_version:1,
 counted_card:null,counted_digital:null,expected_card:null,expected_digital:null,
 variance_cash:null,variance_card:null,variance_digital:null,variance_total:null,state:'ACTIVE',
 close_reason:null,closing_started_at:null,closing_started_by:null,final_counted_cash:null,variance_status:null});
const expected = {expected_cash:110,expected_card:20,expected_digital:0,total_sales:120,
 transactions:2,discounts:0,refunds:0};
const clone = value => structuredClone(value);
function localFixture() {
  const model = new Map(tables.map(table => [table,[]])); model.set('shifts',[openShift()]);
  const journal = [], receipts = new Map(), writerCalls = [], snapshotCalls=[];
  const materialize = (table,row) => ({...Object.fromEntries(tableMap.get(table).columns.map(column => [column.sqlServerColumn,null])),
    ...(table === 'activity_events' ? {whatsapp_status:'skipped',cleared_by:[]} : {}),...clone(row)});
  class Request {
    constructor(transaction) { this.transaction=transaction;this.inputs={}; }
    input(name,...values) { this.inputs[name]=values.at(-1);return this; }
    async query(statement) {
      const p=this.inputs;
      if(statement.startsWith('INSERT dbo.sync_change_journal')) {
        journal.push({...clone(p),change_id:journal.length+1,acknowledged_at:null});return {rowsAffected:[1]};
      }
      if(statement.startsWith('INSERT dbo.local_operation_receipts')) {
        receipts.set(p.operation_id,{note:p.note});return {rowsAffected:[1]};
      }
      if(statement.startsWith('SELECT note FROM dbo.local_operation_receipts'))
        return {recordset:receipts.has(p.operation_id) ? [receipts.get(p.operation_id)] : []};
      const table=statement.match(/FROM dbo\.\[?(\w+)\]?/)?.[1];
      assert(model.has(table),'Unexpected fixture read: '+statement);
      const eventIds=Object.entries(p).filter(([key])=>key.startsWith('event')).map(([,value])=>value);
      return {recordset:clone(model.get(table).filter(row => table==='shifts'
        ? row.id===p.shift && row.store_id===p.branch
        : table==='activity_events' ? eventIds.includes(row.id) : row.shift_id===p.shift &&
          (!Object.hasOwn(p,'client_key') || row.store_id===p.branch && row.client_key===p.client_key)))};
    }
  }
  class Transaction {async begin() {} async commit() {} async rollback() {}}
  const connectionManager={pool:{},sql:()=>({Request,Transaction,UniqueIdentifier:'uuid',ISOLATION_LEVEL:{SERIALIZABLE:4}})};
  const repository=Object.create(OperationsRepository.prototype);
  Object.assign(repository,{registry,tables:tableMap,connectionManager});
  repository.query=async (_branch,table,options={}) => ({rows:table==='pos_settings'
    ? [{id:1,integration_settings:{allowAnyStaffCloseShift:true}}]
    : table==='stores' ? [{id:'a',name:'Branch A'}]
    : clone((model.get(table) ?? []).filter(row => Object.entries(options.match ?? {}).every(([key,value])=>row[key]===value)))});
  repository.shiftExpectedTotals=async()=>clone(expected);
  repository.apply=async (_context,operations,_scope,beforeCommit,beforeWrite) => {
    const ops=repository.validate(operations), savedModel=clone(model),savedJournal=clone(journal),savedReceipts=clone(receipts);
    try {
      // Model both internal OperationsRepository hooks in their real order.
      // SQL locking/commit semantics still require a separate real SQL Server
      // test; this fixture verifies the cross-engine payload/rollback contract.
      if(beforeWrite) await beforeWrite({},ops);
      for(const operation of ops) {
        const rows=model.get(operation.table);assert(rows);
        if(operation.kind==='insert') rows.push(...operation.rows.map(row=>materialize(operation.table,row)));
        else {
          assert.equal(operation.kind,'update');
          const row=rows.find(row=>Object.entries(operation.match).every(([key,value])=>row[key]===value));assert(row);
          Object.assign(row,clone(operation.values));
          if(operation.table==='shifts') row.row_version++;
        }
      }
      if(beforeCommit) await beforeCommit({},ops);
      return {ok:true};
    } catch(error) {
      model.clear();for(const entry of savedModel)model.set(...entry);
      journal.splice(0,journal.length,...savedJournal);receipts.clear();for(const entry of savedReceipts)receipts.set(...entry);
      throw error;
    }
  };
  const actualWriter=new ShiftSyncJournal(repository);
  const start=mainSource.indexOf('async function startLocalShiftClose('),end=mainSource.indexOf('\nfunction redactShiftRow(',start);
  assert(start>=0 && end>start);
  const context={require:name=>name.startsWith('./') ? require('../electron/'+name.slice(2)) : require(name),
    localBranchId:()=> 'a',operationsRepository:repository,
    shiftSyncJournal:{recountReplay:(...args)=>actualWriter.recountReplay(...args),apply:(...args)=>{writerCalls.push(args[0]);return actualWriter.apply(...args);}},
    guard:require('../electron/ipc-guard.cjs'),recordId,randomUUID,Date,
    shiftMoney:value=>Math.round(Number(value ?? 0)*100)/100,
    adminSession:{identity:()=>({subject:'cashier'}),hasLevel:()=>false,hasPermission:()=>true},
    terminalStore:{read:()=>({tokenId:'t-a'})},pendingShiftCloseSync:new Set(),
    publishBusinessChange(){},scheduleAutomaticSync(){}};
  runInNewContext(mainSource.slice(start,end)+'\nthis.calls={startLocalShiftClose,commitLocalShiftCashCount,commitLocalShiftRecount,approveLocalShiftVariance};',context);
  const reader=Object.assign(new ChangeReader(connectionManager,registry),{
    pendingAggregates:async (_branch,_limit,excluded=[]) => [...new Set(journal.filter(row=>!row.acknowledged_at).map(row=>row.aggregate_id))]
      .filter(aggregateId=>!excluded.includes(aggregateId)).map(aggregateId=>({aggregateId,changes:journal.filter(row=>row.aggregate_id===aggregateId&&!row.acknowledged_at)
        .map(row=>({...Object.fromEntries(['change_id','entity_type','entity_id','operation','entity_version','aggregate_id'].map(key=>[key,row[key]])),key:JSON.parse(row.entity_id)}))})),
    rows:async(table,changes)=>clone(model.get(table.sqlServerTable).filter(row=>changes.some(change=>change.key.id===row.id))),
    acknowledgeAggregate:async aggregateId=>journal.filter(row=>row.aggregate_id===aggregateId).forEach(row=>{row.acknowledged_at='confirmed';}),
    failAggregate:async(aggregateId,error)=>journal.filter(row=>row.aggregate_id===aggregateId).forEach(row=>{row.last_error=error.code||error.message;})});
  assert.equal(typeof reader.closedShiftGraphs,'function');
  const currentGraph=reader.closedShiftGraphs.bind(reader);
  reader.closedShiftGraphs=(...args)=>{snapshotCalls.push(clone(args));return currentGraph(...args);};
  const sent=[];
  const upload=async payload => {
    sent.push(clone(payload));
    return (await db.query('SELECT pos_sync_push_aggregate($1::uuid,\'default\',$2,$3,$4::jsonb) result',
      [payload.batchId,payload.branchId,cloud.terminalId(),JSON.stringify(payload.operations)])).rows[0].result;
  };
  const cloud={terminalId:()=> 't-a',pushAggregate:upload};
  const worker=new PushWorker({registry,reader,cloud,checkpoints:{save(){throw new Error('Graph journal upload must not move CT checkpoints');}}});
  return {model,journal,receipts,writerCalls,snapshotCalls,calls:context.calls,worker,cloud,upload,sent,reader};
}
async function seedCloud() {
  await db.exec(`TRUNCATE ${[...tables].reverse().join(',')},sync_idempotency_receipts,sync_change_feed,held_orders CASCADE;
    UPDATE pos_settings SET notification_settings='{}' WHERE id=1;
    SELECT set_config('test.auth_role','service_role',false);SELECT set_config('pos.shift_fn','on',false);`);
  await db.query('INSERT INTO shifts SELECT * FROM jsonb_populate_record(NULL::shifts,$1::jsonb)',[JSON.stringify(openShift())]);
  await db.exec("SELECT set_config('pos.shift_fn','',false)");
}
const cloudRows=async table => (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
const pending=fixture=>fixture.journal.filter(row=>!row.acknowledged_at);
async function close(fixture,cash=110,card=20,digital=0,terminalId='t-a') {
  await fixture.calls.startLocalShiftClose({shiftId:id,reason:'END_OF_DAY',terminalId});
  const response=await fixture.calls.commitLocalShiftCashCount({shiftId:id,cash,card,digital,terminalId});
  assert.equal(response.state,'CLOSED');assert(fixture.writerCalls.includes('Closing shift cash count'));
}
async function verifyGraph(fixture) {
  const remote=(await cloudRows('shifts'))[0],local=fixture.model.get('shifts')[0];
  assert.equal(remote.status,'CLOSED');assert.equal(remote.state,'CLOSED');
  assert.equal(new Date(remote.closed_at).toISOString(),local.closed_at);
  assert.equal(Number(remote.counted_cash),local.counted_cash);assert.equal(remote.terminal_id,'t-a');
  for(const table of tables.slice(1)) {
    const actual=(await cloudRows(table)).filter(row=>table!=='activity_events'||row.client_event_id!==`shift-summary-rules:${id}`),expectedRows=fixture.model.get(table);
    assert.deepEqual(actual.map(row=>row.id).sort(),expectedRows.map(row=>row.id).sort(),table);
    for(const row of actual) assert.equal(row.store_id,'a',table);
  }
  assert.equal(pending(fixture).length,0);
}
let passed=0;
const test=async(name,work)=>{await seedCloud();await work();passed++;console.log('PASS '+name);};
try {
  await test('actual Main count journals and atomically persists the full original graph',async()=>{
    const f=localFixture();await close(f);assert(f.journal.length>=6);
    await f.worker.pushAggregates('a',100,true);await verifyGraph(f);
    assert(f.snapshotCalls.length>0,'Actual current-graph enrichment must run before upload');
    assert.equal((await cloudRows('shift_cash_counts'))[0].kind,'ORIGINAL');
    const recon=(await cloudRows('shift_reconciliations'))[0];assert.equal(recon.count_id,(await cloudRows('shift_cash_counts'))[0].id);
  });
  await test('nullable card/digital counts survive the Main to cloud graph unchanged',async()=>{
    const f=localFixture();await close(f,110,null,null);await f.worker.pushAggregates('a',100,true);await verifyGraph(f);
    const count=(await cloudRows('shift_cash_counts'))[0];assert.equal(count.counted_card,null);assert.equal(count.counted_digital,null);
  });
  await test('actual short-count graph preserves variance alert, activity and original linked IDs',async()=>{
    const f=localFixture();await close(f,105);await f.worker.pushAggregates('a',100,true);await verifyGraph(f);
    assert.equal((await cloudRows('shift_variance_alerts')).length,1);
    assert.equal((await cloudRows('activity_events'))[0].event_type,'shift_cash_variance');
    assert.equal(Number((await cloudRows('shift_variance_alerts'))[0].variance_total),-5);
  });
  await test('authorized handover preserves the original shift terminal while the count records its acting terminal',async()=>{
    const f=localFixture();f.cloud.terminalId=()=> 't-handover';await close(f,110,20,0,'t-handover');await f.worker.pushAggregates('a',100,true);await verifyGraph(f);
    assert.equal((await cloudRows('shift_cash_counts'))[0].terminal_id,'t-handover');
  });
  await test('recount publishes its complete history without replacing original count or summary',async()=>{
    const f=localFixture();await close(f,105);await f.worker.pushAggregates('a',100,true);
    const original=(await cloudRows('shift_cash_counts'))[0],summary=(await cloudRows('shift_notifications'))[0];
    await f.calls.commitLocalShiftRecount({shiftId:id,cash:110,card:20,digital:0,reason:'Rechecked drawer',terminalId:'t-a'});
    assert(f.writerCalls.includes('Saving shift recount'));await f.worker.pushAggregates('a',100,true);await verifyGraph(f);
    const counts=await cloudRows('shift_cash_counts');assert.equal(counts.length,2);
    assert.deepEqual(counts.find(row=>row.id===original.id),original);assert.deepEqual((await cloudRows('shift_notifications'))[0],summary);
  });
  await test('legacy variance approval preserves saved counts and publishes its original approval event',async()=>{
    const f=localFixture();await close(f,105);
    f.model.get('shifts')[0].state='VARIANCE_REVIEW_REQUIRED';f.model.get('shifts')[0].status='OPEN';f.model.get('shifts')[0].closed_at=null;
    f.journal.splice(0);f.receipts.clear();
    await f.calls.approveLocalShiftVariance({shiftId:id,note:'Reviewed original shortage'});
    assert(f.writerCalls.includes('Approving shift variance'));await f.worker.pushAggregates('a',100,true);
    const remote=(await cloudRows('shifts'))[0];assert.equal(remote.status,'CLOSED');assert.equal(remote.closed_by_name,'cashier');
    assert.equal((await cloudRows('shift_cash_counts')).length,1);assert.equal((await cloudRows('shift_reconciliations')).length,1);
    assert((await cloudRows('shift_close_events')).some(row=>row.event==='variance_approved'));assert.equal(pending(f).length,0);
  });
  await test('lost acknowledgement retains the journal then replays the same full graph exactly once',async()=>{
    const f=localFixture();await close(f,105);let first=true;
    f.cloud.pushAggregate=async payload=>{const result=await f.upload(payload);if(first){first=false;throw Object.assign(new Error('response lost'),{code:'ETIMEDOUT'});}return result;};
    await f.worker.pushAggregates('a',100,true);assert(pending(f).length>0);
    const ids=Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await cloudRows(table)).map(row=>row.id)])));
    await f.worker.pushAggregates('a',100,true);await verifyGraph(f);assert.equal(f.sent[0].batchId,f.sent[1].batchId);
    for(const table of tables)assert.deepEqual((await cloudRows(table)).map(row=>row.id),ids[table]);
  });
  await test('a recount after an ambiguous original upload rebinds the older journal to the complete current graph',async()=>{
    const f=localFixture();await close(f,105);let first=true;
    f.cloud.pushAggregate=async payload=>{const result=await f.upload(payload);if(first){first=false;throw Object.assign(new Error('response lost'),{code:'ETIMEDOUT'});}return result;};
    await f.worker.pushAggregates('a',100,true);assert(pending(f).length>0);
    await f.calls.commitLocalShiftRecount({shiftId:id,cash:110,card:20,digital:0,reason:'Rechecked after connection interruption',terminalId:'t-a'});
    await f.worker.pushAggregates('a',100,true);await verifyGraph(f);
    assert.notEqual(f.sent[0].batchId,f.sent[1].batchId,'The changed saved snapshot needs its own payload-bound receipt');
    const counts=await cloudRows('shift_cash_counts');assert.equal(counts.length,2);
    assert.deepEqual(counts.map(row=>row.kind).sort(),['ORIGINAL','RECOUNT']);
    assert.equal(Number((await cloudRows('shifts'))[0].counted_cash),110);
  });
  await test('foreign branch denial cannot acknowledge or partially persist a closing graph',async()=>{
    const f=localFixture();await close(f);
    f.cloud.pushAggregate=async payload=>(await db.query('SELECT pos_sync_push_aggregate($1::uuid,\'default\',\'b\',\'t-a\',$2::jsonb) result',
      [payload.batchId,JSON.stringify(payload.operations)])).rows[0].result;
    await f.worker.pushAggregates('a',100,true);assert(pending(f).length>0);
    assert.equal((await cloudRows('shifts'))[0].status,'OPEN');assert.equal((await cloudRows('shift_cash_counts')).length,0);
    assert.equal((await db.query('SELECT count(*)::int n FROM sync_idempotency_receipts')).rows[0].n,0);
  });
  await test('a foreign child on an otherwise authorized terminal rolls back the entire graph',async()=>{
    const f=localFixture();await close(f);
    f.cloud.pushAggregate=async payload=>{
      const changed=clone(payload);changed.operations.find(op=>op.table==='shift_cash_counts').rows[0].store_id='b';
      return f.upload(changed);
    };
    await f.worker.pushAggregates('a',100,true);assert(pending(f).length>0);
    assert.equal((await cloudRows('shifts'))[0].status,'OPEN');
    for(const table of tables.slice(1))assert.equal((await cloudRows(table)).length,0,table);
    assert.equal((await db.query('SELECT count(*)::int n FROM sync_idempotency_receipts')).rows[0].n,0);
  });
  await test('ordinary SQL roles cannot invoke the service-only closing-graph upload',async()=>{
    const f=localFixture();await close(f);
    await db.exec('SET ROLE authenticated');
    try {await assert.rejects(f.upload({batchId:randomUUID(),branchId:'a',operations:[]}),/permission denied for function/);}
    finally {await db.exec('RESET ROLE');}
    assert(pending(f).length>0);assert.equal((await cloudRows('shifts'))[0].status,'OPEN');
  });
  await test('bad reconciliation FK rolls the parent and every preceding child back',async()=>{
    const f=localFixture();await close(f);
    f.cloud.pushAggregate=async payload=>{
      const changed=clone(payload);changed.operations.find(op=>op.table==='shift_reconciliations').rows[0].count_id=randomUUID();
      return f.upload(changed);
    };
    await f.worker.pushAggregates('a',100,true);assert(pending(f).length>0);
    assert.equal((await cloudRows('shifts'))[0].status,'OPEN');
    for(const table of tables.slice(1))assert.equal((await cloudRows(table)).length,0,table);
    assert.equal((await db.query('SELECT count(*)::int n FROM sync_idempotency_receipts')).rows[0].n,0);
  });
  await test('unfinished cloud tickets retain the entire graph pending until the ordinary dependency resolves',async()=>{
    const f=localFixture();await close(f);await db.query("INSERT INTO held_orders VALUES('a',$1,'draft')",[id]);
    await f.worker.pushAggregates('a',100,true);assert(pending(f).length>0);
    assert.equal((await cloudRows('shifts'))[0].status,'OPEN');assert.equal((await cloudRows('shift_cash_counts')).length,0);
    await db.exec('DELETE FROM held_orders');await f.worker.pushAggregates('a',100,true);await verifyGraph(f);
  });
  await test('missing per-shift proof keeps the journal pending even after a successful server transaction',async()=>{
    const f=localFixture();await close(f);let first=true;
    f.cloud.pushAggregate=async payload=>{const result=await f.upload(payload);if(first){first=false;return {ok:true};}return result;};
    await f.worker.pushAggregates('a',100,true);assert(pending(f).length>0);
    await f.worker.pushAggregates('a',100,true);await verifyGraph(f);
  });
  await test('enabled empty rules execute summary and notification callbacks without breaking the closing graph',async()=>{
    await db.exec(`UPDATE pos_settings SET notification_settings='{"rules":[]}' WHERE id=1;`);
    const f=localFixture();await close(f,105);await f.worker.pushAggregates('a',100,true);await verifyGraph(f);
    const summaries=(await cloudRows('activity_events')).filter(row=>row.client_event_id===`shift-summary-rules:${id}`);
    assert.equal(summaries.length,1);assert.equal(summaries[0].event_type,'shift_summary');
    const deliveries=(await db.query('SELECT event_id,status FROM notification_deliveries')).rows;
    assert(deliveries.length>=2);assert(deliveries.every(row=>row.status==='skipped'));
    const originalGraph=clone(f.sent[0]);
    const replay=(await db.query('SELECT pos_sync_push_aggregate($1::uuid,\'default\',\'a\',\'t-a\',$2::jsonb) result',
      [originalGraph.batchId,JSON.stringify(originalGraph.operations)])).rows[0].result;
    assert.equal(replay.replayed,true);assert.equal((await db.query('SELECT count(*)::int n FROM notification_deliveries')).rows[0].n,deliveries.length);
  });
  await test('a delayed clean server packet and receipt replay cannot reopen an acknowledged full closing graph',async()=>{
    const f=localFixture(),opening=clone(f.model.get('shifts')[0]);
    await close(f,105);await f.worker.pushAggregates('a',100,true);await verifyGraph(f);
    const before=Object.fromEntries(await Promise.all(tables.map(async table=>[table,await cloudRows(table)])));
    const payload={batchId:randomUUID(),branchId:'a',operations:[{table:'shifts',rows:[{...opening,row_version:99}],changes:[]}]};
    const first=await f.upload(payload);assert.equal(first.ok,true);assert.equal(first.applied,0);
    const replay=await f.upload(payload);assert.equal(replay.replayed,true);
    for(const table of tables)assert.deepEqual(await cloudRows(table),before[table],table);
    await verifyGraph(f);
  });
  await test('new metadata on a nonfinal opening is retained as a conflict rather than silently lost',async()=>{
    const f=localFixture(),opening=clone(f.model.get('shifts')[0]);
    await close(f,105);await f.worker.pushAggregates('a',100,true);await verifyGraph(f);
    const before=await cloudRows('shifts'),receipts=(await db.query('SELECT count(*)::int n FROM sync_idempotency_receipts')).rows[0].n;
    await assert.rejects(f.upload({batchId:randomUUID(),branchId:'a',operations:[{table:'shifts',
      rows:[{...opening,row_version:99,note:'Do not silently discard this correction'}],changes:[]}]}),/SYNC_SHIFT_CLOSURE_CONFLICT/);
    assert.deepEqual(await cloudRows('shifts'),before);
    assert.equal((await db.query('SELECT count(*)::int n FROM sync_idempotency_receipts')).rows[0].n,receipts);
  });
  await test('a later authorized recount still synchronizes after an obsolete opening was ignored',async()=>{
    const f=localFixture(),opening=clone(f.model.get('shifts')[0]);
    await close(f,105);await f.worker.pushAggregates('a',100,true);
    await f.upload({batchId:randomUUID(),branchId:'a',operations:[{table:'shifts',rows:[{...opening,row_version:99}],changes:[]}]});
    await f.calls.commitLocalShiftRecount({shiftId:id,cash:110,card:20,digital:0,reason:'A genuine recount',terminalId:'t-a'});
    await f.worker.pushAggregates('a',100,true);await verifyGraph(f);
    assert.equal((await cloudRows('shift_cash_counts')).length,2);
    assert.equal(Number((await cloudRows('shifts'))[0].counted_cash),110);
  });
  await test('known boundary: server acknowledgement does not establish higher-revision local OPEN convergence',async()=>{
    const f=localFixture(),opening={...clone(f.model.get('shifts')[0]),row_version:99};
    await close(f,105);await f.worker.pushAggregates('a',100,true);
    for(const cash of [106,107,108]) {
      await f.calls.commitLocalShiftRecount({shiftId:id,cash,card:20,digital:0,reason:'Fixture recount '+cash,terminalId:'t-a'});
      await f.worker.pushAggregates('a',100,true);
    }
    await verifyGraph(f);const remote=(await cloudRows('shifts'))[0];assert.equal(Number(remote.row_version),5);
    const acknowledged=await f.upload({batchId:randomUUID(),branchId:'a',operations:[{table:'shifts',rows:[opening],changes:[]}]});
    assert.equal(acknowledged.ok,true);assert.equal(acknowledged.applied,0);assert.equal((await cloudRows('shifts'))[0].status,'CLOSED');
    for(const initial of [clone(f.model.get('shifts')[0]),opening]) {
      let local=clone(initial);const statements=[];
      class Request {
        values={};
        input(name,value){this.values[name]=value;return this;}
        async query(sql){
          statements.push(sql);
          // Characterize the actual writer's SQL with a deliberately thin
          // version-gate model. This is not physical SQL Server verification.
          assert(sql.includes('WHEN MATCHED AND source.[row_version]>=target.[row_version]'));
          const source=Object.fromEntries([...sql.matchAll(/@(v\d+) AS \[([a-z_]+)\]/g)].map(match=>[match[2],this.values[match[1]]]));
          if(Number(source.row_version)>=Number(local.row_version))local={...local,...source};
          return {rowsAffected:[0]};
        }
      }
      const client=new CloudClient({connectionManager:{sql:()=>({Request})}});
      await client.applyLocalBatch({},tableMap.get('shifts'),{rows:[{row_data:remote}],tombstones:[]});
      assert.equal(statements.length,1);assert.equal(local.status,initial.status);assert.equal(local.row_version,initial.row_version);
      if(initial.status==='CLOSED')assert.equal(new Date(local.closed_at).toISOString(),new Date(remote.closed_at).toISOString());
      else {assert.equal(local.status,'OPEN');assert.equal(local.row_version,99);}
    }
  });
  console.log(`${passed} native Main / full closure graph scenarios passed (${captures.length ? 'captured deployed routines' : 'canonical routines'}).`);
} finally {await db.close();}
