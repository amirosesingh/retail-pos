import {createRequire} from 'node:module';
import {afterEach,describe,it,expect,vi} from 'vitest';
const require=createRequire(import.meta.url),c=require('../../../electron/db/stock-history-contract.cjs');
const {stockHistoryUploadRow,assertStockHistoryAcknowledgement}=require('../../../electron/sync/stock-history-ack.cjs');
const {StockHistoryUploader}=require('../../../electron/sync/stock-history-uploader.cjs');
const {PushWorker}=require('../../../electron/sync/push-worker.cjs'),{CloudClient}=require('../../../electron/sync/cloud-client.cjs');
const {SyncCoordinator}=require('../../../electron/sync/coordinator.cjs');
const terminal='11111111-1111-4111-8111-111111111111',operation='22222222-2222-4222-8222-222222222222',product='33333333-3333-4333-8333-333333333333';
const branch='branch-a',at='2026-11-06T00:00:00.1234567Z';
function fixture(){
 const context=c.normalizeContext({operationId:operation,branchId:branch,terminalId:terminal,actorId:'original-cashier',kind:'sale'},at);
 const row=c.changes(context,[{id:product,stock_by_store:{[branch]:2}}],[{id:product,name:'Fixture',stock_by_store:{[branch]:1}}])[0];
 const batch=Object.freeze({version:1,branchId:branch,terminalId:terminal,rows:Object.freeze([stockHistoryUploadRow(row,{branchId:branch,terminalId:terminal})])});
 const aggregateId=c.uploadAggregateId(operation,branch),aggregate={aggregateId,changes:[{entity_type:'stock_history_movements',entity_id:JSON.stringify({id:row.id}),operation:'insert'}]};
 const ack={ok:true,version:1,branchId:branch,terminalId:terminal,receipts:[{id:row.id,payloadHash:row.payload_hash,ingestedCursor:'20',acceptedAt:at,effectIds:[product]}]};
 const outbox={pending:vi.fn(async()=>batch),acknowledge:vi.fn(async(received:unknown,response:unknown)=>{expect(received).toBe(batch);assertStockHistoryAcknowledgement(batch,response);return{acknowledged:1};})};
 const cloud={pushStockHistory:vi.fn(async()=>ack)},adapter=new StockHistoryUploader({outbox,cloud});
 return{batch,aggregate,ack,outbox,cloud,adapter};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('bounded history metadata adapter in the existing durable sync lane',()=>{
 it.each([false,true])('shares one normal metadata quantum across both aggregate passes; final=%s keeps full drain',async final=>{
  const f=fixture(),businessId='44444444-4444-4444-8444-444444444444';let pages=3,ordinary=true,window=true;
  const business={aggregateId:businessId,changes:[{entity_type:'sales',entity_id:JSON.stringify({id:product}),operation:'insert',key:{id:product}}]};
  const fail=vi.fn(),upload=vi.fn(async()=>{pages--;return{acknowledged:8};}),core=vi.fn(async()=>({ok:true}));
  const reader={connectionManager:{pool:{}},pendingAggregates:async(_b:string,_l:number,excluded:string[])=>[...(pages?[f.aggregate]:[]),...(ordinary?[business]:[])].filter(item=>!excluded.includes(item.aggregateId)),
   acknowledgeAggregate:vi.fn(async()=>{ordinary=false;}),failAggregate:fail,rows:async()=>[{id:product,store_id:branch}],
   changedIds:async()=>{if(!window)return[];window=false;return[{operation:'U',key:{id:product},version:2}];},
   acceptedFinancialBusinessChanges:async()=>new Set([product]),
   pendingSummary:async()=>({pending:pages*8+(ordinary?1:0),failed:0,queuedTables:pages?[{table:'stock_history_movements',pending:pages*8,failed:0}]:[]})};
  const table={sqlServerTable:'sales',cloudTable:'sales',scope:'branch',dependencyOrder:1,columns:[{sqlServerColumn:'id',cloudColumn:'id',primaryKey:true}]};
  const worker=new PushWorker({reader,cloud:{terminalId:()=>terminal,pushAggregate:core},checkpoints:{list:async()=>[],save:vi.fn()},registry:{tables:[table]},
   stockHistory:{accepts:(aggregate:typeof f.aggregate)=>aggregate.aggregateId===f.aggregate.aggregateId,upload}});
  const spy=vi.spyOn(worker,'pushAggregates'),pull=vi.fn(async()=>({merged:1})),coordinator=new SyncCoordinator({pushWorker:worker,pullWorker:{run:pull}});
  const result=final?await coordinator.runFinal({branchId:branch}):await coordinator.runNow({branchId:branch});
  expect(result).toMatchObject({ok:true,pending:final?0:16,failed:0});expect(upload).toHaveBeenCalledTimes(final?3:1);
  expect(core).toHaveBeenCalledTimes(1);expect(fail).not.toHaveBeenCalled();expect(spy).toHaveBeenCalledTimes(2);
  const first=spy.mock.calls[0]![5],second=spy.mock.calls[1]![5];expect(first).toBe(second);
  if(final){expect(result).toMatchObject({allUploaded:true});expect(first).toBeNull();expect(pull).not.toHaveBeenCalled();}
  else{
   expect(first).toEqual({remaining:0});expect(pull).toHaveBeenCalledTimes(1);
   expect(await coordinator.runNow({branchId:branch})).toMatchObject({ok:true,pending:8,failed:0});
   expect(await coordinator.runNow({branchId:branch})).toMatchObject({ok:true,pending:0,failed:0});
   expect(upload).toHaveBeenCalledTimes(3);expect(core).toHaveBeenCalledTimes(1);expect(fail).not.toHaveBeenCalled();
  }
 });
 it('holds only explicit source/author review codes with bounded automatic cooldown and no ACK',async()=>{
  const f=fixture();let now=0;
  f.cloud.pushStockHistory.mockRejectedValue(Object.assign(new Error('Unproven source'),{code:'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN',status:409}));
  const uploader=new StockHistoryUploader({outbox:f.outbox,cloud:f.cloud,now:()=>now});
  expect(await uploader.upload(f.aggregate,branch,terminal)).toMatchObject({held:{fresh:true,code:'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN'}});
  expect(await uploader.upload(f.aggregate,branch,terminal)).toMatchObject({held:{fresh:false}});expect(f.cloud.pushStockHistory).toHaveBeenCalledTimes(1);
  now=300001;expect(await uploader.upload(f.aggregate,branch,terminal)).toMatchObject({held:{fresh:true}});expect(f.cloud.pushStockHistory).toHaveBeenCalledTimes(2);expect(f.outbox.acknowledge).not.toHaveBeenCalled();
 });
 it('lets core push/pull complete while exact SQL queue counts still expose held report work',async()=>{
  const f=fixture(),failed=vi.fn(),reader={connectionManager:{pool:{}},pendingAggregates:async(_branch:string,_limit:number,excluded:string[])=>excluded.includes(f.aggregate.aggregateId)?[]:[f.aggregate],
   failAggregate:failed,pendingSummary:async()=>({pending:0,failed:1,queuedTables:[{table:'stock_history_movements',pending:0,failed:1,error:'Source review required'}]})};
  f.cloud.pushStockHistory.mockRejectedValue(Object.assign(new Error('Unproven source'),{code:'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN',status:409}));
  const cloud={...f.cloud,terminalId:()=>terminal},worker=new PushWorker({reader,cloud,checkpoints:{},registry:{tables:[]},stockHistory:new StockHistoryUploader({outbox:f.outbox,cloud})});
  const pull=vi.fn(async()=>({merged:3})),coordinator=new SyncCoordinator({pushWorker:worker,pullWorker:{run:pull}});
  const result=await coordinator.runNow({branchId:branch});expect(result).toMatchObject({ok:true,heldStockHistoryAggregates:1,pending:0,failed:1,lastError:null,credentialsInvalid:false,merged:3});
  expect(pull).toHaveBeenCalledTimes(1);expect(failed).toHaveBeenCalledTimes(1);expect(f.outbox.acknowledge).not.toHaveBeenCalled();
  expect(await coordinator.runNow({branchId:branch})).toMatchObject({ok:true,failed:1});expect(f.cloud.pushStockHistory).toHaveBeenCalledTimes(1);expect(failed).toHaveBeenCalledTimes(1);
 });
 it.each([{code:'SESSION_INVALID',status:401},{code:'SYNC_BRANCH_FORBIDDEN',status:403},{code:'ETIMEDOUT',status:0},{code:'HTTP_503',status:503}])('does not hide terminal/network failures %j as source review',async error=>{
  const f=fixture();f.cloud.pushStockHistory.mockRejectedValue(Object.assign(new Error('Transport failure'),error));
  await expect(f.adapter.upload(f.aggregate,branch,terminal)).rejects.toMatchObject(error);expect(f.outbox.acknowledge).not.toHaveBeenCalled();
 });
 it('keeps original SQL batch ownership through exact acceptance',async()=>{
  const f=fixture();expect(await f.adapter.upload(f.aggregate,branch,terminal)).toEqual({acknowledged:1});
  expect(f.outbox.pending).toHaveBeenCalledWith(f.aggregate.aggregateId,branch,terminal);expect(f.cloud.pushStockHistory).toHaveBeenCalledWith(f.batch);
  expect(f.outbox.acknowledge).toHaveBeenCalledTimes(1);
 });
 it.each(['HTTP only','network','source changed','mixed journal'])(
  'leaves metadata pending for %s rather than using the generic aggregate ACK',async(mode)=>{
   const f=fixture();let current=true;
   const uploader=new StockHistoryUploader({outbox:f.outbox,cloud:f.cloud,assertCurrent:()=>{if(!current)throw Object.assign(new Error('changed'),{code:'CONTEXT'});}});
   if(mode==='HTTP only')f.cloud.pushStockHistory.mockResolvedValue({ok:true} as typeof f.ack);
   if(mode==='network')f.cloud.pushStockHistory.mockRejectedValue(Object.assign(new Error('network'),{code:'ETIMEDOUT'}));
   if(mode==='source changed')f.cloud.pushStockHistory.mockImplementation(async()=>{current=false;return f.ack;});
   const aggregate=mode==='mixed journal'?{...f.aggregate,changes:[...f.aggregate.changes,{entity_type:'sales'}]}:f.aggregate;
   await expect(uploader.upload(aggregate,branch,terminal)).rejects.toMatchObject({table:'stock_history_movements'});
   if(mode!=='HTTP only')expect(f.outbox.acknowledge).not.toHaveBeenCalled();
  });
 it('lets the real PushWorker acknowledge metadata only through its dedicated proof owner',async()=>{
  const f=fixture();let pending=true;const genericAck=vi.fn(),progress=vi.fn();
  f.outbox.acknowledge.mockImplementation(async(batch,response)=>{assertStockHistoryAcknowledgement(batch,response);pending=false;return{acknowledged:1};});
  const reader={pendingAggregates:async()=>pending?[f.aggregate]:[],acknowledgeAggregate:genericAck,failAggregate:vi.fn()};
  const cloud={...f.cloud,terminalId:()=>terminal},uploader=new StockHistoryUploader({outbox:f.outbox,cloud});
  const worker=new PushWorker({reader,cloud,registry:{tables:[]},stockHistory:uploader});
  expect(await worker.pushAggregates(branch,100,true,progress)).toBe(1);expect(genericAck).not.toHaveBeenCalled();
  expect(progress).toHaveBeenCalledWith({direction:'push',table:'stock_history_movements',completed:1});
 });
 it('the real worker retains a failed history aggregate while continuing an ordinary business aggregate',async()=>{
  const f=fixture(),businessId='44444444-4444-4444-8444-444444444444',business={aggregateId:businessId,changes:[{entity_type:'audit_logs',entity_id:JSON.stringify({id:product}),operation:'insert',key:{id:product}}]};
  const ordinaryDone=new Set<string>(),genericAck=vi.fn(async(id:string)=>{ordinaryDone.add(id);});
  const reader={pendingAggregates:async(_b:string,_l:number,excluded:string[])=>[f.aggregate,business].filter(item=>!ordinaryDone.has(item.aggregateId)&&!excluded.includes(item.aggregateId)),
   acknowledgeAggregate:genericAck,failAggregate:vi.fn(),rows:async()=>[{id:product,store_id:branch}]};
  f.cloud.pushStockHistory.mockRejectedValue(Object.assign(new Error('unproven source'),{status:409,code:'STOCK_HISTORY_SOURCE_NOT_ACCEPTED'}));
  const cloud={...f.cloud,terminalId:()=>terminal,pushAggregate:vi.fn(async()=>({ok:true}))};
  const worker=new PushWorker({reader,cloud,registry:{tables:[{sqlServerTable:'audit_logs',cloudTable:'audit_logs',scope:'branch',columns:[{sqlServerColumn:'id',cloudColumn:'id',primaryKey:true}]}]},stockHistory:new StockHistoryUploader({outbox:f.outbox,cloud})});
  expect(await worker.pushAggregates(branch,100,true)).toBe(1);expect(genericAck.mock.calls).toEqual([[businessId]]);
  expect(reader.failAggregate).toHaveBeenCalledWith(f.aggregate.aggregateId,expect.objectContaining({code:'STOCK_HISTORY_SOURCE_NOT_ACCEPTED'}));
  expect(f.outbox.acknowledge).not.toHaveBeenCalled();
 });
 it('uses the actual CloudClient upload turn and preserves immutable payload bytes',async()=>{
  const f=fixture(),requests:{body:Record<string,unknown>;resolve:(value:Response)=>void}[]=[];
  vi.stubGlobal('fetch',vi.fn((_url:string,init:RequestInit)=>new Promise<Response>(resolve=>{requests.push({body:JSON.parse(String(init.body)),resolve});})));
  const saved={tokenId:terminal,locationId:branch,branchId:branch,deviceUse:'operations',deviceBindingProof:'a'.repeat(64)};
  const client=new CloudClient({configStore:{get:()=> 'https://fixture.invalid'},terminalStore:{read:()=>saved}});
  const first=client.counts({branchId:branch}),download=client.pullBatch({branchId:branch,cursor:1,limit:1}),upload=client.pushStockHistory(f.batch);
  expect(requests).toHaveLength(1);requests[0]!.resolve(Response.json({}));await first;await new Promise(resolve=>setTimeout(resolve,0));
  expect(requests[1]!.body).toMatchObject({sqlServerStockHistory:f.batch,deviceBindingProof:saved.deviceBindingProof});
  expect((requests[1]!.body.sqlServerStockHistory as typeof f.batch).rows[0]!.payloadJson).toBe(f.batch.rows[0].payloadJson);
  requests[1]!.resolve(Response.json(f.ack));await upload;await new Promise(resolve=>setTimeout(resolve,0));
  expect(requests[2]!.body).toHaveProperty('sqlServerPull');requests[2]!.resolve(Response.json([]));await download;
 });
 it('does not send a mismatched terminal/branch, changed hash or oversized history page',()=>{
  const f=fixture(),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  const client=new CloudClient({configStore:{get:()=> 'https://fixture.invalid'},terminalStore:{read:()=>({tokenId:terminal,locationId:branch})}});
  expect(()=>client.pushStockHistory({...f.batch,terminalId:'another'})).toThrow();
  expect(()=>client.pushStockHistory({...f.batch,branchId:'other'})).toThrow();
  expect(()=>client.pushStockHistory({...f.batch,rows:[{...f.batch.rows[0],payloadJson:'altered'}]})).toThrow();
  const huge='x'.repeat(127000),hash=require('node:crypto').createHash('sha256').update(huge).digest('hex');
  expect(()=>client.pushStockHistory({...f.batch,rows:[{...f.batch.rows[0],payloadHash:hash,payloadJson:huge}]})).toThrow();
  expect(fetcher).not.toHaveBeenCalled();
 });
});
