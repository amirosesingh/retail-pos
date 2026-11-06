import { describe, expect, it, vi } from "vitest";
const { LocalDataLifecycle } = require("../../../electron/jobs/lifecycle.cjs");
const { SyncCoordinator } = require("../../../electron/sync/coordinator.cjs");
const { validatedCloudCounts, reconciliationError } = require("../../../electron/sync/reconciliation.cjs");
const { comparisonWhere, scopedWhere, branchPredicate } = require("../../../electron/db/branch-scope.cjs");
const fullRegistry = require("../../../database/sqlserver/schema-registry.json");

type Table = {cloudTable:string;sqlServerTable:string;dependencyOrder:number;columns:Array<{cloudColumn:string;sqlServerColumn:string;primaryKey:boolean}>};
type CountReport = {tables:Array<{status:string}>};
type SnapshotBatch = {rows:Array<{row_data:{id:string}}>};
function fixture() {
  const tables = ["products", "categories"].map((name, index) => ({cloudTable:name,sqlServerTable:name,dependencyOrder:2-index,
    columns:[{cloudColumn:"id",sqlServerColumn:"id",primaryKey:true}]}));
  const local: Record<string, number> = {products:1,categories:1};
  const central: Record<string, number> = {products:2,categories:1};
  const log: string[] = [], reports: CountReport[] = [], pending = new Set<string>();
  const request = {input:vi.fn(() => request),query:vi.fn(async () => ({recordset:tables.map(table=>({table_name:table.cloudTable,row_count:String(local[table.cloudTable])}))}))};
  class Transaction {async begin(){log.push("begin");}async commit(){log.push("commit");}async rollback(){log.push("rollback");}}
  const connectionManager={pool:{request:()=>request},sql:()=>({Transaction,ISOLATION_LEVEL:{SERIALIZABLE:4}})};
  const cloud={backendUrl:()=>"https://fixture.invalid",terminalId:()=>"fixture-terminal",
    counts:vi.fn(async()=>tables.map(table=>({table_name:table.cloudTable,row_count:String(central[table.cloudTable])}))),
    bootstrapPage:vi.fn(async({table}: {table:string})=>{log.push(`download:${table}`);return {rows:Array.from({length:central[table]},(_,id)=>({id:String(id)})),cursor:null};}),
    applyLocalBatch:vi.fn(async(_tx:unknown,table:Table,batch:SnapshotBatch)=>{log.push(`apply:${table.cloudTable}`);local[table.cloudTable]=Math.max(local[table.cloudTable],batch.rows.length);return {applied:batch.rows.length,alreadyMatching:0};})};
  const push=vi.fn(async()=>{log.push("push");return {};});
  const pull=vi.fn(async():Promise<Record<string,unknown>>=>{log.push("pull");return {membershipDeferred:true};});
  const coordinator=new SyncCoordinator({pushWorker:{run:push},pullWorker:{run:pull}});
  vi.spyOn(coordinator,"recordVerification").mockImplementation((report:unknown)=>{const value=report as CountReport;reports.push(value);return value;});
  const profile={database:"isolated"};
  const reader={unacknowledged:vi.fn(async()=>pending)};
  const lifecycle=new LocalDataLifecycle({connectionManager,databaseService:{snapshot:()=>({profile})},registry:{tables},cloud,syncCoordinator:coordinator,reader});
  return {local,central,log,reports,pending,request,cloud,push,pull,coordinator,reader,lifecycle,connectionManager,tables,profile};
}

describe("automatic reconciliation uses the existing guarded sync lane",()=>{
  it("catches up, downloads only the missing table and recounts before publishing success",async()=>{
    const f=fixture();const activity=vi.fn();
    expect(await f.lifecycle.reconcileAndRecover("branch",90,activity)).toEqual([]);
    expect(f.log).toEqual(["push","pull","download:products","begin","apply:products","commit","push","pull"]);
    expect(f.reports).toHaveLength(1);expect(f.reports[0].tables.every((row:{status:string})=>row.status==="SYNCED")).toBe(true);
    expect(activity).toHaveBeenCalledWith(expect.objectContaining({phase:"downloading",table:"products"}));
    expect(f.cloud.counts).toHaveBeenCalledTimes(3);
    expect(await f.lifecycle.reconcileAndRecover("branch",90)).toEqual([]);
    expect(f.cloud.bootstrapPage).toHaveBeenCalledTimes(1);
  });
  it("uses ordinary incremental synchronization first and avoids a snapshot if it resolves the mismatch",async()=>{
    const f=fixture();f.push.mockImplementation(async()=>{f.log.push("push");f.local.products=2;return {};});
    expect(await f.lifecycle.reconcileAndRecover("branch",90)).toEqual([]);
    expect(f.cloud.bootstrapPage).not.toHaveBeenCalled();expect(f.reports).toHaveLength(1);
  });
  it("keeps local-greater rows, attempts ordinary upload and surfaces exact remaining counts",async()=>{
    const f=fixture();f.local.products=3;
    const differences=await f.lifecycle.reconcileAndRecover("branch",90);
    expect(differences).toMatchObject([{table:"products",local:"3",cloud:"2"}]);
    expect(f.local.products).toBe(3);expect(f.push).toHaveBeenCalledTimes(1);expect(f.cloud.bootstrapPage).not.toHaveBeenCalled();
    expect(reconciliationError(differences)).toMatchObject({code:"ERECONCILE",differences});
    expect(reconciliationError(differences).message).toContain("products (local 3, cloud 2)");
    await f.lifecycle.reconcileAndRecover("branch",90);expect(f.push).toHaveBeenCalledTimes(1);
  });
  it("does not reuse a recovery cooldown for another history range",async()=>{
    const f=fixture();f.local.products=3;
    Object.assign(f.cloud,{requestContext:()=>({fingerprint:"same-device-and-project",pool:f.connectionManager.pool})});
    await f.lifecycle.reconcileAndRecover("branch",90);
    await f.lifecycle.reconcileAndRecover("branch",7300);
    expect(f.push).toHaveBeenCalledTimes(2);
  });
  it("preserves unacknowledged rows and never reports their incomplete snapshot as matched",async()=>{
    const f=fixture();f.pending.add('["unused"]');
    // Pending evidence uses the real entity-key shape constructed by refreshTable.
    f.reader.unacknowledged.mockResolvedValue(new Set(['{"id":"1"}']));
    const result=await f.lifecycle.reconcileAndRecover("branch",90);
    expect(result).toMatchObject([{table:"products",local:"1",cloud:"2"}]);
    expect(f.cloud.applyLocalBatch.mock.calls[0][2].rows.map((row:{row_data:{id:string}})=>row.row_data.id)).toEqual(["0"]);
  });
  it("refreshes missing dependency tables in registered order",async()=>{
    const f=fixture();f.central.categories=2;
    expect(await f.lifecycle.reconcileAndRecover("branch",90)).toEqual([]);
    expect(f.log.filter(value=>value.startsWith("download:"))).toEqual(["download:categories","download:products"]);
  });
  it("tries incremental catch-up but does not restart a large history/catalogue download",async()=>{
    const f=fixture();f.central.products=2400;
    expect(await f.lifecycle.reconcileAndRecover("branch",90)).toMatchObject([{table:"products",local:"1",cloud:"2400"}]);
    expect(f.push).toHaveBeenCalledTimes(1);expect(f.cloud.bootstrapPage).not.toHaveBeenCalled();
  });
  it("gives normal sync a turn after four tables and automatically handles the fifth",async()=>{
    const f=fixture();
    for(let index=0;index<5;index++){
      const name=`reference_${index}`;f.tables.push({...f.tables[0],cloudTable:name,sqlServerTable:name,dependencyOrder:index+3});f.local[name]=0;f.central[name]=1;
    }
    expect(await f.lifecycle.reconcileAndRecover("branch",90)).toEqual([]);
    const downloads=f.log.map((entry,index)=>entry.startsWith("download:")?index:-1).filter(index=>index>=0);
    expect(downloads).toHaveLength(6);expect(f.push).toHaveBeenCalledTimes(3);
    expect(f.log.slice(downloads[3]+1,downloads[4])).toContain("push");
  });
  it("stops before downloading an eleventh page and retains the unresolved table",async()=>{
    const f=fixture();f.cloud.bootstrapPage.mockImplementation(async()=>({rows:[],cursor:"still-more"} as never));
    await expect(f.lifecycle.reconcileAndRecover("branch",90)).rejects.toMatchObject({code:"EHISTORY_PROGRESS"});
    // A nonadvancing cursor is rejected even earlier than the hard page budget.
    expect(f.cloud.bootstrapPage).toHaveBeenCalledTimes(2);expect(f.local.products).toBe(1);
    const g=fixture();let cursor=0;
    g.cloud.bootstrapPage.mockImplementation(async()=>({rows:[],cursor:String(++cursor)} as never));
    await expect(g.lifecycle.reconcileAndRecover("branch",90)).rejects.toMatchObject({code:"ERECONCILE_BUDGET"});
    expect(g.cloud.bootstrapPage).toHaveBeenCalledTimes(10);expect(g.local.products).toBe(1);
  });
  it.each(["deferredLocalChanges","deferredHeldDeletion","pending","failed","conflicts"])("waits without a snapshot when %s blocks ordinary synchronization",async field=>{
    const f=fixture();f.pull.mockResolvedValue({[field]:1});
    if(field==="pending"||field==="failed")f.coordinator.status[field]=1;
    await expect(f.lifecycle.reconcileAndRecover("branch",90)).rejects.toMatchObject({code:"ESYNC_PENDING"});
    expect(f.cloud.bootstrapPage).not.toHaveBeenCalled();expect(f.reports).toHaveLength(0);
  });
  it("retains transport errors and permits a real later recovery instead of caching a failed attempt",async()=>{
    const f=fixture();f.cloud.bootstrapPage.mockRejectedValue(Object.assign(new Error("network timeout"),{code:"ETIMEDOUT"}));
    await expect(f.lifecycle.reconcileAndRecover("branch",90)).rejects.toMatchObject({code:"ETIMEDOUT"});
    expect(f.reports).toHaveLength(0);
    f.cloud.bootstrapPage.mockResolvedValue({rows:[{id:"0"},{id:"1"}],cursor:null});
    expect(await f.lifecycle.reconcileAndRecover("branch",90)).toEqual([]);
  });
  it("does not refresh data after permission denial",async()=>{
    const f=fixture();f.push.mockRejectedValueOnce(Object.assign(new Error("denied"),{status:403,code:"HTTP_403"}));
    await expect(f.lifecycle.reconcileAndRecover("branch",90)).rejects.toMatchObject({code:"HTTP_403"});
    expect(f.cloud.bootstrapPage).not.toHaveBeenCalled();expect(f.local.products).toBe(1);
  });
  it("rechecks connection identity before any recovery write",async()=>{
    const f=fixture();f.push.mockImplementationOnce(async()=>{f.profile.database="another-database";return {};});
    await expect(f.lifecycle.reconcileAndRecover("branch",90)).rejects.toMatchObject({code:"ERECONCILE_SCOPE"});
    expect(f.cloud.bootstrapPage).not.toHaveBeenCalled();
  });
  it("rejects a connection switch during even an initially matched count read",async()=>{
    const f=fixture();f.local.products=2;
    const counts=f.cloud.counts.getMockImplementation()!;
    f.cloud.counts.mockImplementationOnce(async()=>{const rows=await counts();f.connectionManager.pool={request:()=>f.request};return rows;});
    await expect(f.lifecycle.reconcileAndRecover("branch",90)).rejects.toMatchObject({code:"ERECONCILE_SCOPE"});
    expect(f.reports).toHaveLength(0);expect(f.cloud.applyLocalBatch).not.toHaveBeenCalled();
  });
  it("rejects an old-scope page before it can write into another database",async()=>{
    const f=fixture();f.cloud.bootstrapPage.mockImplementationOnce(async()=>{f.profile.database="changed";return {rows:[{id:"0"},{id:"1"}],cursor:null};});
    await expect(f.lifecycle.reconcileAndRecover("branch",90)).rejects.toMatchObject({code:"ERECONCILE_SCOPE"});
    expect(f.cloud.applyLocalBatch).not.toHaveBeenCalled();expect(f.log).toContain("rollback");expect(f.log).not.toContain("commit");
  });
  it("rolls back rather than committing a page if scope changes during its SQL work",async()=>{
    const f=fixture();f.cloud.applyLocalBatch.mockImplementationOnce(async()=>{f.profile.database="changed";return {applied:2,alreadyMatching:0};});
    await expect(f.lifecycle.reconcileAndRecover("branch",90)).rejects.toMatchObject({code:"ERECONCILE_SCOPE"});
    expect(f.log).toContain("rollback");expect(f.log).not.toContain("commit");expect(f.reports).toHaveLength(0);
  });
  it("binds reconciliation to the trusted project/device-proof fingerprint without exposing it",async()=>{
    const f=fixture();let fingerprint="first-project-and-proof";
    Object.assign(f.cloud,{requestContext:()=>({fingerprint,pool:f.connectionManager.pool})});
    f.push.mockImplementationOnce(async()=>{fingerprint="another-proof";return {};});
    await expect(f.lifecycle.reconcileAndRecover("branch",90)).rejects.toMatchObject({code:"ERECONCILE_SCOPE"});
    expect(f.cloud.applyLocalBatch).not.toHaveBeenCalled();expect(f.reports).toHaveLength(0);
  });
  it("serializes concurrent recovery callers and does not redownload a completed table",async()=>{
    const f=fixture();await Promise.all([f.lifecycle.reconcileAndRecover("branch",90),f.lifecycle.reconcileAndRecover("branch",90)]);
    expect(f.cloud.bootstrapPage).toHaveBeenCalledTimes(1);expect(f.local.products).toBe(2);
  });
  it("leaves Membership-only differences and its existing read path unchanged",async()=>{
    const f=fixture();f.tables.splice(0,f.tables.length,{cloudTable:"members",sqlServerTable:"members",dependencyOrder:0,columns:[]});
    f.local.members=1;f.central.members=2;
    expect(await f.lifecycle.reconcileAndRecover("branch",90)).toMatchObject([{table:"members"}]);
    expect(f.push).not.toHaveBeenCalled();expect(f.cloud.bootstrapPage).not.toHaveBeenCalled();
  });
});

describe("comparison scope and complete count evidence",()=>{
  it.each([null,{},[],[{table_name:"products",row_count:"0"}],[{table_name:"products",row_count:"1"},{table_name:"products",row_count:"2"}]])("does not turn missing/duplicate count coverage into a match (%j)",rows=>{
    const registry={tables:[{cloudTable:"products"},{cloudTable:"sales"}]};
    expect(()=>validatedCloudCounts(registry,rows)).toThrow();
  });
  it.each([null,undefined,"-1","1.5","NaN",9007199254740992])("rejects invalid or imprecise counts (%s)",value=>{
    expect(()=>validatedCloudCounts({tables:[{cloudTable:"products"}]},[{table_name:"products",row_count:value}])).toThrow();
  });
  it("preserves exact big counts and does not require new Membership calls",()=>{
    expect(validatedCloudCounts({tables:[{cloudTable:"products"},{cloudTable:"members"}]},[{table_name:"products",row_count:"9007199254740993"}])).toEqual({products:"9007199254740993"});
  });
  it("uses catalogue scope only for product comparisons, preserving writes and legacy receiving constraints",()=>{
    for(const name of ["products","product_barcodes","promotions"]){
      const table=fullRegistry.tables.find((row:{cloudTable:string})=>row.cloudTable===name);
      expect(comparisonWhere(fullRegistry,table)).toContain("co.[group_id]");
      expect(scopedWhere(fullRegistry,table)).not.toContain("co.[group_id]");
    }
    const products=fullRegistry.tables.find((row:{cloudTable:string})=>row.cloudTable==="products");
    expect(branchPredicate(fullRegistry,products)).toBe("(NULLIF(source.[owner_store_id],N'') IS NULL OR source.[owner_store_id]=@branch)");
    const receiving=fullRegistry.tables.find((row:{cloudTable:string})=>row.cloudTable==="purchase_orders");
    expect(comparisonWhere(fullRegistry,receiving)).toBe(scopedWhere(fullRegistry,receiving));
    expect(comparisonWhere(fullRegistry,receiving)).not.toContain("IS NULL");
  });
});
