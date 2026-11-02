// Disposable PostgreSQL + actual Main payload/writer/PushWorker integration.
// SQL Server storage is a transactional in-memory fixture; this is not a real
// till or notification-delivery test. Optional captures contain routines only.
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID,createHash } from 'node:crypto';
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
 CREATE TABLE app_users(id uuid PRIMARY KEY,user_id text,auth_user_id uuid,role text,role_slug text,permissions jsonb,is_active boolean,store_id text);
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
await db.exec("ALTER TABLE terminal_tokens ADD platform text DEFAULT 'pc',ADD is_claimed boolean DEFAULT true");
for(const name of ['20261102082439_shift_closing_causal_intents','20261102101610_shift_author_key_registry','20261102103716_enforce_shift_author_uploads','20261102153013_bind_signed_closing_start_evidence'])await db.exec(await read('supabase/migrations/'+name+'.sql'));
await db.query("INSERT INTO app_users(id,user_id,role,role_slug,permissions,is_active,store_id) VALUES($1,'cashier','staff','cashier',$2::jsonb,true,'a')",[operator,JSON.stringify({can_close_shift:true,can_shift_cash_count:true,can_shift_cash_recount:true,can_shift_variance_approve:true})]);
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
const clone = value => structuredClone(value), copy=clone;
const sameId=(a,b)=>String(a??'').toLowerCase()===String(b??'').toLowerCase();
const terminal='t-a';
const materialize=(table,row)=>({...Object.fromEntries(tableMap.get(table).columns.map(column=>[column.sqlServerColumn,null])),...(table==='activity_events'?{whatsapp_status:'skipped',cleared_by:[]}:{}),...clone(row)});
// Transactional storage adapter based on trusted-shift-journal.test.ts. Business
// validation, SQL generation, causal snapshots, authorship and ACKs use real code.
function localStorageFixture() {

    let state = { keys:[], tables: Object.fromEntries(registry.tables.map((table) => [table.sqlServerTable, []])), journal: [], receipts: [], intents: [], baselines: [], openings: [], authors: [], closingStarts: [], intentStarts: [] };
    state.tables.shifts.push(openShift());
    const events = [];
    const faults = {};
    class Transaction {
        image;
        async begin() { this.image = copy(state); events.push("begin"); }
        async commit() { state = copy(this.image); events.push("commit"); }
        async rollback() { events.push("rollback"); }
    }
    class Request {
        transaction;
        inputs = {};
        constructor(transaction) {
            this.transaction = transaction;
        }
        input(name, value, typedValue) { this.inputs[name] = arguments.length === 3 ? typedValue : value; return this; }
        async query(query) {
            const data = this.transaction instanceof Transaction ? this.transaction.image : state;
            faults.onQuery?.(query);
            if (query.startsWith("INSERT dbo.pos_sync_shift_intent_starts")) {
                data.intentStarts.push({ intent_id: this.inputs.intent, proof_json: this.inputs.proof });
                return { recordset: [], rowsAffected: [1] };
            }
            if (query.startsWith("SELECT proof_json FROM dbo.pos_sync_shift_intent_starts"))
                return { recordset: copy(data.intentStarts.filter(row => sameId(row.intent_id, this.inputs.intent))) };
            if (query.startsWith("SELECT proof_json FROM dbo.pos_sync_shift_closing_starts"))
                return { recordset: copy(data.closingStarts.filter(row => sameId(row.shift_id, this.inputs.shift) && sameId(row.branch_id, this.inputs.branch))) };
            if(query.startsWith("SELECT * FROM dbo.pos_sync_shift_author_keys"))return {recordset:copy(data.keys.filter(row=>row.scope_hash===this.inputs.scope))};
      if(query.startsWith("SELECT DISTINCT TOP(2)"))return {recordset:[...new Set([...data.authors.filter(row=>row.scope_hash===this.inputs.scope).map(row=>row.key_id),...data.closingStarts.map(row=>JSON.parse(row.proof_json)).filter(proof=>proof.projectOrigin===this.inputs.project&&proof.terminalId===this.inputs.terminal&&proof.authorId===this.inputs.author).map(proof=>proof.keyId)])].map(key_id=>({key_id}))};
      if(query.startsWith("INSERT dbo.pos_sync_shift_author_keys")){const p=this.inputs;data.keys.push({scope_hash:p.scope,project_origin:p.project,terminal_id:p.terminal,author_id:p.author,key_id:p.key,public_key:p.public});return {recordset:[],rowsAffected:[1]};}
      if(query.startsWith("INSERT dbo.pos_sync_shift_closing_starts")){data.closingStarts.push({shift_id:this.inputs.shift,branch_id:this.inputs.branch,event_id:this.inputs.event,proof_json:this.inputs.proof});return {recordset:[],rowsAffected:[1]};}
      if (query.startsWith("INSERT dbo.pos_sync_shift_authors")) {
                data.authors.push({ intent_id: this.inputs.intent, attestation_json: this.inputs.attestation,scope_hash:this.inputs.scope,key_id:this.inputs.key });
                return { recordset: [], rowsAffected: [1] };
            }
            if (query.includes("pos_sync_shift_authors"))
                return { recordset: copy(data.authors.filter(row => sameId(row.intent_id, this.inputs.intent))) };
            if (query.startsWith("INSERT dbo.pos_sync_shift_openings")) {
                data.openings.push({ aggregate_id: this.inputs.aggregate, shift_id: this.inputs.shift, branch_id: this.inputs.branch, row_json: this.inputs.row, row_hash: this.inputs.hash });
                return { recordset: [], rowsAffected: [1] };
            }
            if (query.includes("pos_sync_shift_openings"))
                return { recordset: copy(data.openings.filter(row => sameId(row.aggregate_id, this.inputs.aggregate) && sameId(row.branch_id, this.inputs.branch))) };
            if (query.includes("pos_sync_shift_baselines"))
                return { recordset: copy(data.baselines.filter(row => sameId(row.shift_id, this.inputs.shift) && sameId(row.branch_id, this.inputs.branch))) };
            if (query.startsWith("INSERT dbo.pos_sync_shift_intents")) {
                data.intents.push({ intent_sequence: data.intents.length + 1, intent_id: this.inputs.intent, branch_id: this.inputs.branch, shift_id: this.inputs.shift,
                    intent_kind: this.inputs.kind, baseline_generation: this.inputs.generation, base_token: this.inputs.base, predecessor_intent_id: this.inputs.predecessor,
                    predecessor_intent_hash: this.inputs.predecessor_hash, payload_json: this.inputs.payload, payload_hash: this.inputs.hash });
                return { recordset: [], rowsAffected: [1] };
            }
            if (query.startsWith("UPDATE dbo.pos_sync_shift_intents")) {
                Object.assign(data.intents.find(row => sameId(row.intent_id, this.inputs.intent)), { accepted_token: this.inputs.accepted, current_token: this.inputs.current,
                    superseded: this.inputs.superseded, acknowledged_at: "acknowledged", ack_coverage_json: this.inputs.coverage });
                return { recordset: [], rowsAffected: [1] };
            }
            if (query.startsWith("UPDATE dbo.sync_change_journal")) {
                data.journal.filter(row => sameId(row.aggregate_id, this.inputs.aggregate)).forEach(row => { row.acknowledged_at = "acknowledged"; });
                return { recordset: [], rowsAffected: [1] };
            }
            if (query.includes("SELECT DISTINCT shift_id FROM dbo.pos_sync_shift_intents"))
                return { recordset: copy(data.intents.filter(row => sameId(row.branch_id, this.inputs.branch) && JSON.parse(String(this.inputs.ids)).some((id) => sameId(id, row.shift_id)))) };
            if (query.includes("pos_sync_shift_intents"))
                return { recordset: copy(data.intents.filter(row => sameId(row.branch_id, this.inputs.branch) &&
                        (!query.includes("acknowledged_at IS NOT NULL") || row.acknowledged_at) &&
                        (!query.includes("ack_coverage_json IS NOT NULL") || row.ack_coverage_json) &&
                        (!this.inputs.before || Number(row.intent_sequence) < Number(this.inputs.before)) &&
                        (this.inputs.intent ? sameId(row.intent_id, this.inputs.intent) : sameId(row.shift_id, this.inputs.shift))).sort((a, b) => Number(b.intent_sequence) - Number(a.intent_sequence)).slice(0, 1)) };
            if (query.startsWith("INSERT dbo.sync_change_journal")) {
                if (faults.journal)
                    throw faults.journal;
                events.push("journal");
                data.journal.push({ ...copy(this.inputs), change_id: data.journal.length + 1, acknowledged_at: null });
                return { rowsAffected: [1], recordset: [] };
            }
            if (query.startsWith("INSERT dbo.local_operation_receipts")) {
                if (faults.receipt)
                    throw faults.receipt;
                events.push("receipt");
                data.receipts.push(copy(this.inputs));
                return { rowsAffected: [1], recordset: [] };
            }
            if (query.includes("SELECT note FROM dbo.local_operation_receipts")) {
                events.push("lock:receipt");
                return { recordset: data.receipts.filter(row => row.operation_id === this.inputs.operation_id) };
            }
            if (query.startsWith("SELECT id FROM dbo.shifts"))
                return { recordset: data.tables.shifts.filter(row => sameId(row.store_id, this.inputs.branch) && !row.closed_at && row.status === "OPEN") };
            if (query.startsWith("SELECT CASE WHEN EXISTS"))
                return { recordset: [{ allowed: data.tables[/dbo\.\[([a-z_]+)\]/.exec(query)?.[1] ?? "shifts"].some(row => sameId(row.id, this.inputs.scope0) && sameId(row.store_id, this.inputs.branch)) ? 1 : 0 }] };
            const table = /dbo\.\[?([a-z_]+)\]?/.exec(query)?.[1];
            if (!table)
                throw new Error(`Unhandled fixture statement: ${query}`);
            if (query.startsWith("MERGE ")) {
                if (faults.business)
                    throw faults.business;
                const row = Object.fromEntries([...query.matchAll(/@v(\d+) AS \[([a-z_]+)\]/g)].map(match => [match[2], this.inputs[`v${match[1]}`]]));
                const exists = data.tables[table].some(saved => sameId(saved.id, row.id));
                if (!exists)
                    data.tables[table].push(materialize(table,row));
                events.push(`write:${table}`);
                return { rowsAffected: [exists ? 0 : 1], recordset: [] };
            }
            if (query.startsWith("UPDATE source SET")) {
                if (faults.business)
                    throw faults.business;
                const row = data.tables[table].find(saved => sameId(saved.id, this.inputs.m0) && sameId(saved.store_id, this.inputs.branch));
                if (row) {
                    for (const match of query.matchAll(/\[([a-z_]+)\]=@v(\d+)/g))
                        row[match[1]] = this.inputs[`v${match[2]}`];
                    if (query.includes("[row_version]=COALESCE"))
                        row.row_version = Number(row.row_version ?? 0) + 1;
                }
                events.push(`write:${table}`);
                return { rowsAffected: [row ? 1 : 0], recordset: [] };
            }
            if (query.startsWith("SELECT ")) {
                events.push(query.startsWith("SELECT id FROM dbo.[shifts]") ? "lock:parent" : `read:${table}`);
                let rows = data.tables[table].filter(row => table === "shifts"
                    ? (this.inputs.ids ? JSON.parse(String(this.inputs.ids)).some((id) => sameId(id, row.id)) : sameId(row.id, this.inputs.shift)) && (this.inputs.branch == null || sameId(row.store_id, this.inputs.branch))
                    : table === "activity_events" ? Object.values(this.inputs).some(value => sameId(row.id, value))
                        : sameId(row.shift_id, this.inputs.shift) && (!this.inputs.branch||sameId(row.store_id,this.inputs.branch)) && (!this.inputs.event||sameId(row.id,this.inputs.event)) && (!this.inputs.client_key||row.client_key===this.inputs.client_key||(this.inputs.kind==='ORIGINAL'&&row.kind==='ORIGINAL')));
                rows = copy(rows);
                if (faults.transform)
                    rows = faults.transform(table, rows);
                return { recordset: rows };
            }
            throw new Error(`Unhandled fixture operation: ${query}`);
        }
    }
    const sql = { Transaction, Request, UniqueIdentifier: "uuid", ISOLATION_LEVEL: { SERIALIZABLE: 4 } };
    const connectionManager = { sql: () => sql, pool: { get image() { return state; } } };
    const repository = new OperationsRepository(connectionManager, registry);
    const writer = new ShiftSyncJournal(repository,{authorRequired:true});
    return { repository, writer, connectionManager, events, faults, data: () => state };
}

const fixtureVaults=[];
function localFixture() {
  const h=localStorageFixture(), {repository,connectionManager}=h, actualWriter=h.writer;
  const model={get:table=>h.data().tables[table]};
  const writerCalls=[],snapshotCalls=[],vault=require('./lib/shift-protocol-integration-fixture.cjs').createAuthorKeys();
  fixtureVaults.push(vault);
  const permissions={can_close_shift:true,can_shift_cash_count:true,can_shift_cash_recount:true,can_shift_variance_approve:true,can_manage_other_shifts:true};
  const identity={source:'pos',authorId:operator,canonicalSubject:'cashier',subject:'cashier',branchId:'a'};
  let epoch=1;
  const session={identity:()=>identity,epoch:()=>epoch,hasLevel:()=>false,hasPermission:key=>permissions[key]===true};
  const shiftAuthority=new (require('../electron/shift-authority.cjs').ShiftAuthorAuthority)({keys:vault.keys,session,connectionManager,terminal:()=>({tokenId:cloud.terminalId(),deviceUse:'operations',branchId:'a'}),project:()=> 'https://fixture.supabase.co',branch:()=> 'a'});
  repository.query=async (_branch,table,options={})=>({rows:table==='pos_settings'?[{id:1,integration_settings:{allowAnyStaffCloseShift:true}}]:table==='stores'?[{id:'a',name:'Branch A'}]:clone((model.get(table)??[]).filter(row=>Object.entries(options.match??{}).every(([key,value])=>row[key]===value)))});
  repository.shiftExpectedTotals=async()=>clone(expected);
  const apply=actualWriter.apply.bind(actualWriter);
  actualWriter.apply=(...args)=>{writerCalls.push(args[0]);return apply(...args);};
  const start=mainSource.indexOf('async function startLocalShiftClose('),end=mainSource.indexOf('\nfunction redactShiftRow(',start);
  assert(start>=0 && end>start);
  const context={require:name=>name.startsWith('./') ? require('../electron/'+name.slice(2)) : require(name),
    localBranchId:()=> 'a',operationsRepository:repository,
    shiftSyncJournal:actualWriter,shiftAuthority,
    guard:require('../electron/ipc-guard.cjs'),recordId,randomUUID,Date,
    shiftMoney:value=>Math.round(Number(value ?? 0)*100)/100,
    adminSession:session,
    terminalStore:{read:()=>({tokenId:'t-a'})},pendingShiftCloseSync:new Set(),
    publishBusinessChange(){},scheduleAutomaticSync(){}};
  runInNewContext(mainSource.slice(start,end)+'\nthis.calls={startLocalShiftClose,commitLocalShiftCashCount,commitLocalShiftRecount,approveLocalShiftVariance};',context);
  const reader=Object.assign(new ChangeReader(connectionManager,registry),{
    pendingAggregates:async (_branch,_limit,excluded=[]) => [...new Set(h.data().journal.filter(row=>!row.acknowledged_at).map(row=>row.aggregate_id))]
      .filter(aggregateId=>!excluded.includes(aggregateId)).map(aggregateId=>({aggregateId,changes:h.data().journal.filter(row=>row.aggregate_id===aggregateId&&!row.acknowledged_at)
        .map(row=>({...Object.fromEntries(['change_id','entity_type','entity_id','operation','entity_version','aggregate_id'].map(key=>[key,row[key]])),key:JSON.parse(row.entity_id)}))})),
    rows:async(table,changes)=>clone(model.get(table.sqlServerTable).filter(row=>changes.some(change=>change.key.id===row.id))),
    acknowledgeAggregate:async aggregateId=>h.data().journal.filter(row=>row.aggregate_id===aggregateId).forEach(row=>{row.acknowledged_at='confirmed';}),
    failAggregate:async(aggregateId,error)=>h.data().journal.filter(row=>row.aggregate_id===aggregateId).forEach(row=>{row.last_error=error.message;})});
  assert.equal(typeof reader.closedShiftGraphs,'function');
  const protectedIntent=reader.protectedIntent.bind(reader);
  reader.protectedIntent=async(...args)=>{const intent=await protectedIntent(...args);if(intent)snapshotCalls.push(clone(intent));return intent;};
  // No sale/financial CT is represented in this graph-only fixture. The real
  // LocalDB integration separately exercises the financial prerequisite gate.
  reader.shiftPrerequisites=async()=>true;
  const sent=[];
  const upload=async payload => {
    sent.push(clone(payload));
    if(!payload.shiftIntent)return (await db.query("SELECT pos_sync_push_aggregate($1::uuid,'default',$2,$3,$4::jsonb) result",[payload.batchId,payload.branchId,cloud.terminalId(),JSON.stringify(payload.operations)])).rows[0].result;
    const proof=shiftAuthority.validatePending(payload.shiftAuthor);
    const authorization={allowed:true,authority:{authorId:proof.authorId}};
    if(payload.shiftClosingStart){
      const start=shiftAuthority.validatePendingClosingStart(payload.shiftClosingStart);
      return (await db.query("SELECT pos_sync_push_started_shift_intent($1::uuid,'default',$2,$3,NULL,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb) result",[payload.batchId,payload.branchId,cloud.terminalId(),JSON.stringify(payload.shiftIntent),JSON.stringify(proof),JSON.stringify(authorization),JSON.stringify(start),JSON.stringify({allowed:true,authority:{authorId:start.authorId}})])).rows[0].result;
    }
    return (await db.query("SELECT pos_sync_push_author_shift_intent($1::uuid,'default',$2,$3,NULL,$4::jsonb,$5::jsonb,$6::jsonb) result",[payload.batchId,payload.branchId,cloud.terminalId(),JSON.stringify(payload.shiftIntent),JSON.stringify(proof),JSON.stringify(authorization)])).rows[0].result;
  };
  const enroll=async()=>{const binding=shiftAuthority.binding(identity.authorId),info=vault.keys.prepare(binding);await db.query('SELECT pos_shift_author_enroll($1::jsonb,$2)',[JSON.stringify((({signature,...enrollment})=>enrollment)(vault.keys.enrollment(binding,{expectedKeyId:info.keyId}))),identity.canonicalSubject]);vault.keys.markEnrolled(binding,{keyId:info.keyId,publicKey:info.publicKey});};
  const cloud={terminalId:()=> 't-a',pushAggregate:upload};
  const rewrite=async(payload,mutate)=>{const changed=clone(payload),body=JSON.parse(changed.shiftIntent.payloadJson);mutate(body.operations);changed.shiftIntent.payloadJson=JSON.stringify(body);const author=await shiftAuthority.prepare(shiftAuthority.capture(body.kind));changed.shiftAuthor=author.sign({branchId:changed.branchId,shiftId:body.shiftId,intentId:body.intentId,action:body.kind,payloadHash:createHash('sha256').update(changed.shiftIntent.payloadJson).digest('hex')});return changed;};
  const worker=new PushWorker({registry,reader,cloud,validateAuthor:proof=>shiftAuthority.validatePending(proof),validateClosingStart:proof=>shiftAuthority.validatePendingClosingStart(proof),checkpoints:{save(){throw new Error('Graph journal upload must not move CT checkpoints');}}});
  return {model,enroll,rewrite,get journal(){return h.data().journal;},receipts:{clear(){h.data().receipts.splice(0);h.data().intents.splice(0);h.data().authors.splice(0);h.data().intentStarts.splice(0);}},writerCalls,snapshotCalls,calls:context.calls,worker,cloud,upload,sent,reader,h,shiftAuthority,permissions,session,switchAuthor(authorId,subject){Object.assign(identity,{authorId,subject,canonicalSubject:subject});epoch++;},bumpEpoch(){epoch++;}};
}
async function seedCloud() {
  await db.exec(`TRUNCATE ${[...tables].reverse().join(',')},sync_idempotency_receipts,sync_change_feed,held_orders,pos_sync_private.shift_closing_start_receipts,pos_sync_private.shift_author_receipts,pos_sync_private.shift_author_keys,pos_sync_private.shift_intent_receipts CASCADE;
    UPDATE pos_settings SET notification_settings='{}' WHERE id=1;
    SELECT set_config('test.auth_role','service_role',false);SELECT set_config('pos.shift_fn','on',false);`);
  await db.query('INSERT INTO shifts SELECT * FROM jsonb_populate_record(NULL::shifts,$1::jsonb)',[JSON.stringify(openShift())]);
  await db.exec("SELECT set_config('pos.shift_fn','',false)");
}
const cloudRows=async table => (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
const pending=fixture=>fixture.h.data().journal.filter(row=>!row.acknowledged_at);
async function close(fixture,cash=110,card=20,digital=0,terminalId='t-a') {
  await fixture.enroll();
  await fixture.calls.startLocalShiftClose({shiftId:id,reason:'END_OF_DAY',terminalId});
  const response=await fixture.calls.commitLocalShiftCashCount({shiftId:id,cash,card,digital,terminalId});
  assert.equal(response.state,'CLOSED');assert(fixture.writerCalls.includes('Closing shift cash count'));
}
async function verifyGraph(fixture) {
  const remote=(await cloudRows('shifts'))[0],local=fixture.model.get('shifts')[0];
  assert.equal(remote.status,'CLOSED',JSON.stringify(fixture.journal.map(row=>row.last_error)));assert.equal(remote.state,'CLOSED');
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
  await test('same-terminal A start and B count preserve both verified authors, with start proof on ORIGINAL only',async()=>{
    const f=localFixture();await f.enroll();await f.calls.startLocalShiftClose({shiftId:id,reason:'Handover',terminalId:'t-a'});
    const starter=clone(f.h.data().closingStarts[0]);
    const counter='33333333-3333-4333-8333-333333333333';
    await db.query("INSERT INTO app_users(id,user_id,role,role_slug,permissions,is_active,store_id) VALUES($1,'counter','staff','cashier',$2::jsonb,true,'a')",[counter,JSON.stringify(f.permissions)]);
    f.switchAuthor(counter,'counter');await f.enroll();
    await f.calls.commitLocalShiftCashCount({shiftId:id,cash:105,card:20,digital:0,terminalId:'t-a'});
    await f.worker.pushAggregates('a',100,true);await verifyGraph(f);
    assert.equal(f.sent[0].shiftClosingStart.authorId,operator);assert.equal(f.sent[0].shiftAuthor.authorId,counter);
    assert.deepEqual(f.h.data().closingStarts[0],starter);assert.equal((await cloudRows('shifts'))[0].closing_started_by,'cashier');
    assert.equal((await cloudRows('shift_cash_counts'))[0].counted_by_staff_id,'counter');
    const originalBytes=f.sent[0].shiftIntent.payloadJson;
    await f.calls.commitLocalShiftRecount({shiftId:id,cash:110,card:20,digital:0,reason:'Rechecked',terminalId:'t-a'});
    await f.worker.pushAggregates('a',100,true);await verifyGraph(f);
    assert.equal(f.sent[1].shiftClosingStart,undefined);assert.equal(f.sent[1].shiftAuthor.authorId,counter);
    assert.equal(f.h.data().intents[0].payload_json,originalBytes);assert.equal(f.h.data().intentStarts.length,1);
  });
  await test('actual author permission and epoch guards reject start, original and recount without business writes',async()=>{
    const f=localFixture();await f.enroll();f.permissions.can_close_shift=false;const initial=clone(f.h.data());
    await assert.rejects(f.calls.startLocalShiftClose({shiftId:id,reason:'Denied',terminalId:'t-a'}),{code:'PERMISSION_DENIED'});assert.deepEqual(f.h.data(),initial);
    f.permissions.can_close_shift=true;
    const query=f.h.repository.query;f.h.repository.query=async(...args)=>{const result=await query(...args);f.bumpEpoch();return result;};
    await assert.rejects(f.calls.startLocalShiftClose({shiftId:id,reason:'Changed author',terminalId:'t-a'}),{code:'ESYNC_SHIFT_AUTHOR_CHANGED'});assert.deepEqual(f.h.data(),initial);f.h.repository.query=query;
    await f.calls.startLocalShiftClose({shiftId:id,reason:'Allowed',terminalId:'t-a'});
    const started=clone(f.h.data());f.permissions.can_close_shift=false;f.permissions.can_shift_cash_count=false;
    await assert.rejects(f.calls.commitLocalShiftCashCount({shiftId:id,cash:110,terminalId:'t-a'}),{code:'PERMISSION_DENIED'});assert.deepEqual(f.h.data(),started);
    f.permissions.can_shift_cash_count=true;
    let changed=false;f.h.faults.onQuery=()=>{if(!changed){changed=true;f.bumpEpoch();}};
    await assert.rejects(f.calls.commitLocalShiftCashCount({shiftId:id,cash:110,terminalId:'t-a'}),{code:'ESYNC_SHIFT_AUTHOR_CHANGED'});assert.deepEqual(f.h.data(),started);delete f.h.faults.onQuery;
    await f.calls.commitLocalShiftCashCount({shiftId:id,cash:110,terminalId:'t-a'});
    const closed=clone(f.h.data());f.permissions.can_shift_cash_recount=false;
    await assert.rejects(f.calls.commitLocalShiftRecount({shiftId:id,cash:111,reason:'Denied',terminalId:'t-a'}),{code:'PERMISSION_DENIED'});assert.deepEqual(f.h.data(),closed);
  });
  await test('a journal failure rolls back actual Main money, intent and author metadata together',async()=>{
    const f=localFixture();await f.enroll();await f.calls.startLocalShiftClose({shiftId:id,reason:'Rollback',terminalId:'t-a'});const before=clone(f.h.data());
    f.h.faults.journal=Object.assign(new Error('fixture journal failure'),{code:'EFIXTURE'});
    await assert.rejects(f.calls.commitLocalShiftCashCount({shiftId:id,cash:105,terminalId:'t-a'}),{code:'EFIXTURE'});assert.deepEqual(f.h.data(),before);
    delete f.h.faults.journal;await f.calls.commitLocalShiftCashCount({shiftId:id,cash:105,terminalId:'t-a'});await f.worker.pushAggregates('a',100,true);await verifyGraph(f);
  });
  await test('forged saved author signature keeps the real protected intent pending without any cloud writes',async()=>{
    const f=localFixture();await close(f);const saved=JSON.parse(f.h.data().authors[0].attestation_json);saved.signature=(saved.signature[0]==='A'?'B':'A')+saved.signature.slice(1);f.h.data().authors[0].attestation_json=JSON.stringify(saved);
    await f.worker.pushAggregates('a',100,true);assert(pending(f).length>0);assert(pending(f).every(row=>row.last_error.includes('author')));assert.equal(f.sent.length,0);
    assert.equal((await cloudRows('shifts'))[0].status,'OPEN');for(const table of tables.slice(1))assert.equal((await cloudRows(table)).length,0);
  });
  await test('actual Main count journals and atomically persists the full original graph',async()=>{
    const f=localFixture();await close(f);assert(f.journal.length>=6);
    await f.worker.pushAggregates('a',100,true);await verifyGraph(f);
    assert(f.snapshotCalls.length>0,'The actual saved protected graph must be loaded before upload');
    assert(f.sent[0].shiftAuthor);assert(f.sent[0].shiftClosingStart);assert.equal(f.sent[0].operations,undefined);
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
    // Seed a legacy review graph, which predates any protected receipt. This
    // represents saved history, not an accepted CLOSED intent reopened later.
    await db.exec("SELECT set_config('pos.shift_fn','on',false)");
    await db.query('DELETE FROM shifts WHERE id=$1',[id]);
    for(const table of tables)for(const row of f.model.get(table))await db.query('INSERT INTO '+table+' SELECT * FROM jsonb_populate_record(NULL::'+table+',$1::jsonb)',[JSON.stringify(require('../electron/sync/row-codec.cjs').toCloudRow(tableMap.get(table),row))]);
    await db.exec("SELECT set_config('pos.shift_fn','',false)");
    f.journal.splice(0);f.receipts.clear();

    await f.calls.approveLocalShiftVariance({shiftId:id,note:'Reviewed original shortage'});
    assert(f.writerCalls.includes('Approving shift variance'));await f.worker.pushAggregates('a',100,true);
    const remote=(await cloudRows('shifts'))[0];assert.equal(remote.status,'CLOSED',JSON.stringify(f.journal.map(row=>row.last_error)));assert.equal(remote.closed_by_name,'cashier');
    assert.equal((await cloudRows('shift_cash_counts')).length,1);assert.equal((await cloudRows('shift_reconciliations')).length,1);
    assert((await cloudRows('shift_close_events')).some(row=>row.event==='variance_approved'),JSON.stringify(f.journal.map(row=>row.last_error)));assert.equal(pending(f).length,0);
  });
  await test('lost acknowledgement retains the journal then replays the same full graph exactly once',async()=>{
    const f=localFixture();await close(f,105);let first=true;
    f.cloud.pushAggregate=async payload=>{const result=await f.upload(payload);if(first){first=false;throw Object.assign(new Error('response lost'),{code:'ETIMEDOUT'});}return result;};
    await f.worker.pushAggregates('a',100,true);assert(pending(f).length>0);
    const ids=Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await cloudRows(table)).map(row=>row.id)])));
    await f.worker.pushAggregates('a',100,true);await verifyGraph(f);assert.equal(f.sent[0].batchId,f.sent[1].batchId);
    for(const table of tables)assert.deepEqual((await cloudRows(table)).map(row=>row.id),ids[table]);
  });
  await test('a recount after an ambiguous original upload preserves its frozen predecessor and publishes the new graph',async()=>{
    const f=localFixture();await close(f,105);let first=true;
    f.cloud.pushAggregate=async payload=>{const result=await f.upload(payload);if(first){first=false;throw Object.assign(new Error('response lost'),{code:'ETIMEDOUT'});}return result;};
    await f.worker.pushAggregates('a',100,true);assert(pending(f).length>0);
    await f.calls.commitLocalShiftRecount({shiftId:id,cash:110,card:20,digital:0,reason:'Rechecked after connection interruption',terminalId:'t-a'});
    await f.worker.pushAggregates('a',100,true);await verifyGraph(f);
    assert.equal(f.sent[0].batchId,f.sent[1].batchId,'The original retry keeps its frozen receipt');
    assert.equal(f.sent[0].shiftIntent.payloadJson,f.sent[1].shiftIntent.payloadJson);
    assert.notEqual(f.sent[0].batchId,f.sent[2].batchId,'The recount has its own payload-bound receipt');
    const counts=await cloudRows('shift_cash_counts');assert.equal(counts.length,2);
    assert.deepEqual(counts.map(row=>row.kind).sort(),['ORIGINAL','RECOUNT']);
    assert.equal(Number((await cloudRows('shifts'))[0].counted_cash),110);
  });
  await test('foreign branch denial cannot acknowledge or partially persist a closing graph',async()=>{
    const f=localFixture();await close(f);
    f.cloud.pushAggregate=async payload=>f.upload({...payload,branchId:'b'});
    await f.worker.pushAggregates('a',100,true);assert(pending(f).length>0);
    assert.equal((await cloudRows('shifts'))[0].status,'OPEN');assert.equal((await cloudRows('shift_cash_counts')).length,0);
    assert.equal((await db.query('SELECT count(*)::int n FROM sync_idempotency_receipts')).rows[0].n,0);
  });
  await test('a foreign child on an otherwise authorized terminal rolls back the entire graph',async()=>{
    const f=localFixture();await close(f);
    f.cloud.pushAggregate=async payload=>{
      const changed=await f.rewrite(payload,ops=>{ops.find(op=>op.table==='shift_cash_counts').rows[0].store_id='b';});
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
      const changed=await f.rewrite(payload,ops=>{ops.find(op=>op.table==='shift_reconciliations').rows[0].count_id=randomUUID();});
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
    const replay=await f.upload(originalGraph);
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
  await test('known boundary: higher-revision local OPEN retains an explicit deferred download',async()=>{
    const f=localFixture(),opening={...clone(f.model.get('shifts')[0]),row_version:99};
    await close(f,105);await f.worker.pushAggregates('a',100,true);
    for(const cash of [106,107,108]) {
      await f.calls.commitLocalShiftRecount({shiftId:id,cash,card:20,digital:0,reason:'Fixture recount '+cash,terminalId:'t-a'});
      await f.worker.pushAggregates('a',100,true);
    }
    await verifyGraph(f);const remote=(await cloudRows('shifts'))[0];assert.equal(Number(remote.row_version),5);
    const acknowledged=await f.upload({batchId:randomUUID(),branchId:'a',operations:[{table:'shifts',rows:[opening],changes:[]}]});
    assert.equal(acknowledged.ok,true);assert.equal(acknowledged.applied,0);assert.equal((await cloudRows('shifts'))[0].status,'CLOSED');
    for(const [initial,expectedOutcome] of [
      [clone(f.model.get('shifts')[0]),'deferred'],
      [{...clone(remote),row_version:99},'alreadyMatching'],
      [opening,'deferred'],
    ]) {
      let local=clone(initial);const statements=[];
      class Request {
        values={};
        input(name,value){this.values[name]=value;return this;}
        async query(sql){
          statements.push(sql);
          if(sql.startsWith('SELECT TOP (1)'))return {recordset:[clone(local)]};
          // Characterize the actual writer's SQL with a deliberately thin
          // version-gate model. This is not physical SQL Server verification.
          assert(sql.includes('WHEN MATCHED AND source.[row_version]>=target.[row_version]'));
          const source=Object.fromEntries([...sql.matchAll(/@(v\d+) AS \[([a-z_]+)\]/g)].map(match=>[match[2],this.values[match[1]]]));
          if(Number(source.row_version)>=Number(local.row_version))local={...local,...source};
          return {rowsAffected:[0]};
        }
      }
      const client=new CloudClient({connectionManager:{sql:()=>({Request})}});
      const result=await client.applyLocalBatch({},tableMap.get('shifts'),{branchId:'a',rows:[{row_data:remote}],tombstones:[]});
      assert.equal(statements.length,1);assert.equal(local.status,initial.status);assert.equal(local.row_version,initial.row_version);
      assert.equal(result.applied,0);assert.equal(result[expectedOutcome],1);
      if(initial.status==='CLOSED'){
        assert.equal(new Date(local.closed_at).toISOString(),new Date(remote.closed_at).toISOString());
      }else {assert.equal(local.status,'OPEN');assert.equal(local.row_version,99);assert.equal(result.deferred,1);}
    }
  });
  console.log(`${passed} native Main / full closure graph scenarios passed (${captures.length ? 'captured deployed routines' : 'canonical routines'}).`);
} finally {await db.close();for(const vault of fixtureVaults)vault.close();}
