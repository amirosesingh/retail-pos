const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSyncScheduler } = require("../electron/sync/scheduler.cjs");
const { PushWorker, batchAuditAggregates } = require("../electron/sync/push-worker.cjs");
const { PullWorker } = require("../electron/sync/pull-worker.cjs");
const { SyncCoordinator } = require("../electron/sync/coordinator.cjs");
const { ChangeReader } = require("../electron/sync/change-reader.cjs");

const audit = id => ({ aggregateId:id, changes:[{ entity_type:"audit_logs", entity_id:JSON.stringify({id}), key:{id}, operation:"insert" }] });
const table = { cloudTable:"audit_logs", sqlServerTable:"audit_logs", scope:"branch", dependencyOrder:1, columns:[{cloudColumn:"id", sqlServerColumn:"id", primaryKey:true}, {cloudColumn:"store_id"}] };

test("continuous writes preserve the earliest sync deadline; stop cancels it", () => {
  let now=0, runs=0, nextId=0;
  const timers=new Map();
  const scheduler=createSyncScheduler(()=>runs++, {now:()=>now, set:(fn,delay)=>{const id=++nextId;timers.set(id,{fn,at:now+delay});return id;}, clear:id=>timers.delete(id)});
  scheduler.schedule(15000);
  scheduler.schedule(250);
  now=100; scheduler.schedule(250);
  scheduler.schedule(60000);
  assert.equal(timers.size,1);
  assert.equal([...timers.values()][0].at,250);
  const timer=[...timers.values()][0];timers.clear();timer.fn();
  assert.equal(runs,1);
  scheduler.schedule(15000);scheduler.stop();assert.equal(timers.size,0);
});

test("audit batching preserves mixed transaction boundaries and bounded rows", () => {
  const sale={aggregateId:"sale",changes:[{entity_type:"sales",operation:"insert"},...audit("s-log").changes]};
  const groups=batchAuditAggregates([audit("1"),audit("2"),sale,audit("3"),audit("4"),audit("5")],2);
  assert.equal(groups.length,4);
  assert.equal(groups[1],sale);
  assert.equal(groups[0].changes.length,2);
  assert.equal(groups[0].aggregateId,batchAuditAggregates([audit("1"),audit("2")],2)[0].aggregateId);
  assert.notEqual(groups[0].aggregateId,groups[2].aggregateId);
});

function pushFixture(rejectCombined=false) {
  const pending=new Map(["a","b","c"].map(id=>[id,audit(id)]));
  const calls=[];const progress=[];
  const reader={
    pendingAggregates:async(_branch,_limit,excluded=[])=>[...pending.values()].filter(row=>!excluded.includes(row.aggregateId)),
    rows:async(_table,changes)=>changes.map(change=>({id:change.key.id,store_id:"B1"})),
    acknowledgeAggregate:async id=>pending.delete(id),
    failAggregate:async()=>{},
  };
  const worker=new PushWorker({reader,registry:{tables:[table]},cloud:{pushAggregate:async batch=>{
    calls.push(batch);
    if(rejectCombined && batch.operations[0].rows.length>1)throw Object.assign(new Error("Payload rejected"),{status:413});
    return {ok:true};
  }}});
  return {worker,pending,calls,progress};
}

test("three log transactions use one request, acknowledge originals, and do not resend", async () => {
  const f=pushFixture();
  assert.equal(await f.worker.pushAggregates("B1",100,true,p=>f.progress.push(p)),3);
  assert.equal(f.calls.length,1);assert.equal(f.pending.size,0);
  assert.equal(f.progress[0].completed,3);
  assert.equal(await f.worker.pushAggregates("B1",100,true),0);
  assert.equal(f.calls.length,1);
});

test("oversized combined logs retry with their original transaction boundaries", async () => {
  const f=pushFixture(true);
  assert.equal(await f.worker.pushAggregates("B1",100,true),3);
  assert.equal(f.calls.length,4);assert.equal(f.pending.size,0);
  assert.deepEqual(f.calls.slice(1).map(row=>row.batchId),["a","b","c"]);
});

test("a rejected upload remains pending and produces no completed progress", async () => {
  const f=pushFixture();f.worker.cloud.pushAggregate=async()=>{throw Object.assign(new Error("Denied"),{status:403});};
  await assert.rejects(f.worker.pushAggregates("B1",100,true,p=>f.progress.push(p)),/Denied/);
  assert.equal(f.pending.size,3);assert.equal(f.progress.length,0);
});

test("download uses saved cursor, commits before reporting progress, then resumes there", async () => {
  let saved=40;const order=[];const cursors=[];
  class Transaction { async begin(){} async commit(){order.push("commit");} async rollback(){order.push("rollback");} }
  const worker=new PullWorker({registry:{tables:[table]},connectionManager:{pool:{},sql:()=>({Transaction})},
    reader:{unacknowledged:async()=>new Set()}, conflicts:{},
    checkpoints:{get:async(_b,entity)=>({committed_cursor:entity==="__feed__"?saved:0}),save:async(_b,_e,_d,patch)=>{saved=patch.committed_cursor;}},
    cloud:{pullBatch:async({cursor})=>{cursors.push(cursor);return cursor===40?{count:1,cursor:41,rows:[{table_name:"audit_logs",entity_id:'{"id":"r"}',row_data:{id:"r"}}],tombstones:[]}:{count:0,rows:[],tombstones:[]};}, applyLocalBatch:async()=>{}, membershipDirectory:async()=>({ok:true,nextRevision:0,hasMore:false})}
  });
  assert.equal((await worker.run({branchId:"B1",onProgress:()=>order.push("progress")})).merged,1);
  assert.deepEqual(order,["commit","progress"]);
  await worker.run({branchId:"B1"});assert.deepEqual(cursors,[40,41]);
});

test("non-advancing feed fails instead of replaying indefinitely", async () => {
  const worker=new PullWorker({checkpoints:{get:async()=>({committed_cursor:40})},cloud:{pullBatch:async()=>({count:1,cursor:40,rows:[],tombstones:[]})}});
  await assert.rejects(worker.run({branchId:"B1"}),{code:"ESYNC_CURSOR"});
});

test("status publishes committed row counts and preserves upload failures after download", async () => {
  const states=[];
  const coordinator=new SyncCoordinator({publish:state=>states.push(state),pushWorker:{run:async({onProgress})=>{
    onProgress({direction:"push",table:"audit_logs",completed:3});throw Object.assign(new Error("Bad sale"),{table:"sales"});
  }},pullWorker:{run:async({onProgress})=>{onProgress({direction:"pull",table:"products",completed:2});return {merged:2};}}});
  const result=await coordinator.runNow({branchId:"B1"});
  assert.equal(result.ok,false);assert.equal(result.pushed,3);assert.equal(result.merged,2);
  assert.match(result.lastError,/Bad sale/);assert.equal(result.running,false);
  assert.ok(states.some(state=>state.currentTable==="audit_logs"&&state.pushed===3));
});

test("pending summary includes per-table failures and totals", async () => {
  const request={input(){return this;},async query(){return {recordset:[{entity_type:"sales",pending:2,failed:1,last_error:"Rejected"},{entity_type:"audit_logs",pending:8,failed:0}]};}};
  const reader=new ChangeReader({pool:{request:()=>request}});
  const result=await reader.pendingSummary("B1");
  assert.equal(result.pending,10);assert.equal(result.failed,1);assert.equal(result.queuedTables[0].error,"Rejected");
});

test("incremental scans load checkpoints once and skip centrally managed uploads", async () => {
  let lists=0;const scanned=[];
  const worker=new PushWorker({
    registry:{tables:[table,{...table,cloudTable:"products",sqlServerTable:"products"},{...table,cloudTable:"app_users",sqlServerTable:"app_users",direction:"pull"}]},
    reader:{pendingAggregates:async()=>[],changedIds:async(t,version)=>{scanned.push([t.sqlServerTable,version]);return [];}},
    cloud:{},checkpoints:{list:async()=>{lists++;return [{entity_type:"audit_logs",change_tracking_version:42},{entity_type:"products",change_tracking_version:77}];},get:()=>{throw Error("Per-table lookup must not run");}}
  });
  await worker.run({branchId:"B1"});
  assert.equal(lists,1);assert.deepEqual(scanned,[["audit_logs",42],["products",77]]);
});

test("local log upserts batch while deletes retain their boundary", () => {
  const upsert=audit("updated");upsert.changes[0].operation="update";
  const deletion=audit("deleted");deletion.changes[0].operation="delete";
  const groups=batchAuditAggregates([audit("new"),upsert,deletion]);
  assert.equal(groups.length,2);assert.equal(groups[0].changes.length,2);assert.equal(groups[1],deletion);
});

test("failed local download rolls back without saving the cursor or reporting progress", async () => {
  const order=[];
  class Transaction {async begin(){} async commit(){order.push("commit");} async rollback(){order.push("rollback");}}
  const worker=new PullWorker({registry:{tables:[table]},connectionManager:{pool:{},sql:()=>({Transaction})},
    reader:{unacknowledged:async()=>new Set()},conflicts:{},
    checkpoints:{get:async()=>({committed_cursor:40}),save:async()=>order.push("save")},
    cloud:{pullBatch:async()=>({count:1,cursor:41,rows:[{table_name:"audit_logs",entity_id:'{"id":"r"}'}],tombstones:[]}),applyLocalBatch:async()=>{throw Error("Local write failed");}}
  });
  await assert.rejects(worker.run({branchId:"B1",onProgress:()=>order.push("progress")}),/Local write failed/);
  assert.deepEqual(order,["rollback"]);
});

test("new PCs bootstrap while registered PCs reuse their completed bootstrap", async () => {
  const { LocalDataLifecycle }=require("../electron/jobs/lifecycle.cjs");
  for(const completed of [false,true]) {
    let bootstraps=0;
    const lifecycle=new LocalDataLifecycle({registry:{tables:[]},cloud:{},jobRepository:{active:async()=>null,completed:async()=>completed},databaseService:{transition(){},markReady(){}},syncCoordinator:{runNow:async()=>({ok:true})}});
    lifecycle.pushWithGapRecovery=async()=>({recovered:[]});
    lifecycle.bootstrap=async()=>{bootstraps++;};lifecycle.retain=async()=>{};lifecycle.reconcile=async()=>[];
    await lifecycle.ensure({branchId:"B1"});assert.equal(bootstraps,completed?0:1);
  }
});

test("completed draft upload carries its saved sale before the draft", async () => {
  let pending=true; let sent;
  const tables=[{...table,cloudTable:"sales",sqlServerTable:"sales",dependencyOrder:1},{...table,cloudTable:"held_orders",sqlServerTable:"held_orders",dependencyOrder:4}];
  const worker=new PushWorker({registry:{tables},reader:{
    pendingAggregates:async()=>pending?[{aggregateId:"draft",changes:[{entity_type:"held_orders",entity_id:'{"id":"draft"}',key:{id:"draft"},operation:"update"}]}]:[],
    rows:async()=>[{id:"draft",store_id:"B1",bill_no:"BILL-1",status:"completed"}],
    ticketCompletionParents:async(rows,branch)=>{assert.equal(branch,"B1");assert.equal(rows[0].bill_no,"BILL-1");return [{table:"sales",rows:[{id:"sale",store_id:"B1",bill_number:"BILL-1"}]}];},
    acknowledgeAggregate:async()=>{pending=false;},failAggregate:async()=>{},
  },cloud:{pushAggregate:async batch=>{sent=batch;return {ok:true};}}});
  await worker.pushAggregates("B1",100);
  assert.deepEqual(sent.operations.map(op=>op.table),["sales","held_orders"]);
  assert.equal(pending,false);
});

test("completed draft download fetches its missing sale once before applying the draft", async()=>{
  const events=[];let present=false;
  class Transaction {async begin(){} async commit(){} async rollback(){}}
  const request={input(){return this;},async query(){return {recordset:present?[{id:"sale"}]:[]};}};
  const sales={...table,cloudTable:"sales",sqlServerTable:"sales"};
  const worker=new PullWorker({registry:{tables:[sales]},connectionManager:{pool:{request:()=>request},sql:()=>({Transaction})},reader:{unacknowledged:async()=>new Set()},
    cloud:{bootstrapPage:async({table:target,branchId})=>{assert.equal(branchId,"B1");events.push(target);return {rows:[{id:"sale",store_id:"B1",bill_number:"BILL-1"}],cursor:null};},applyLocalBatch:async()=>{present=true;events.push("saved");}}});
  const batch={rows:[{table_name:"held_orders",row_data:{id:"draft",store_id:"B1",bill_no:"BILL-1",status:"completed"}}]};
  await worker.ensureTicketDependencies(batch,"B1");
  await worker.ensureTicketDependencies(batch,"B1");
  assert.deepEqual(events,["sales","saved"]);
});

test("held cleanup waits for pending uploads without losing its pull cursor", async()=>{
  let pending=true,saved=0;const applied=[];const events=[];
  class Transaction {async begin(){} async commit(){events.push("commit");} async rollback(){events.push("rollback");}}
  const held={...table,cloudTable:"held_orders",sqlServerTable:"held_orders"};
  const worker=new PullWorker({registry:{tables:[held]},connectionManager:{pool:{},sql:()=>({Transaction})},
    reader:{unacknowledged:async()=>pending?new Set(['{"id":"draft"}']):new Set()},conflicts:{record:async()=>{}},
    checkpoints:{get:async()=>({committed_cursor:saved}),save:async(_b,_t,_d,patch)=>{saved=patch.committed_cursor;}},
    cloud:{pullBatch:async()=>({count:1,cursor:1,rows:[],tombstones:[{table_name:"held_orders",entity_id:'{"id":"draft"}',tombstone:true}]}),
      applyLocalBatch:async(_tx,_table,batch)=>{applied.push(...batch.tombstones);},membershipDirectory:async()=>({ok:true,nextRevision:0,hasMore:false})}});
  const deferred=await worker.run({branchId:"B1"});
  assert.equal(deferred.deferredHeldDeletion,true);assert.equal(saved,0);assert.equal(applied.length,0);
  pending=false;
  const done=await worker.run({branchId:"B1"});
  assert.equal(done.deferredHeldDeletion,false);assert.equal(saved,1);assert.equal(applied.length,1);
  assert.deepEqual(events,["rollback","commit"]);
});
