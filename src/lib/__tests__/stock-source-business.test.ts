import {createRequire} from 'node:module';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {syncAggregateSchema} from '../sync-shift-intent.server';
import {fallbackUnavailableStockSource} from '../stock-source-business-transport.server';
const require=createRequire(import.meta.url),{CloudClient}=require('../../../electron/sync/cloud-client.cjs'),{StockHistoryUploader}=require('../../../electron/sync/stock-history-uploader.cjs');
const terminal='11111111-1111-4111-8111-111111111111',operation='22222222-2222-4222-8222-222222222222',author='33333333-3333-4333-8333-333333333333';
const proof={version:1,algorithm:'Ed25519',keyId:operation,projectOrigin:'https://stock.fixture',terminalId:terminal,authorId:author,subject:'cashier-a',branchId:'a',operationId:operation,
 sourceDatabaseId:author,sourceSequence:'1',sourcePredecessorRoot:null,action:'ADJUST',sourceRoot:'a'.repeat(64),sourceCount:10,signature:'A'.repeat(86)};
const raw=JSON.stringify(proof),headers=[{proofJson:raw}],operations=[{table:'stock_adjustments',rows:[{id:operation,store_id:'a',delta:-1}],changes:[]}];
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('optional original source business metadata',()=>{
 it('falls back only when the optional wrapper provably did not execute, using the unchanged original business batch/payload',async()=>{
  const rawBody=JSON.stringify({p_batch_id:operation,p_organization_id:'default',p_branch_id:'a',p_terminal_id:terminal,p_operations:operations,p_project:'https://stock.fixture',p_cohorts:headers});
  const accepted=Response.json({ok:true}),send=vi.fn(async()=>accepted);
  const response=Response.json({code:'PGRST202',message:'Could not find function public.pos_sync_push_stock_source_aggregate'},{status:404});
  expect(await fallbackUnavailableStockSource(response,rawBody,send)).toBe(accepted);
  expect(send).toHaveBeenCalledWith('rpc/pos_sync_push_aggregate',{method:'POST',body:JSON.stringify({p_batch_id:operation,p_organization_id:'default',p_branch_id:'a',p_terminal_id:terminal,p_operations:operations})});
 });
 it.each([403,409,408,429,500,503])('does not change admission/retry after source-wrapper HTTP%s',async(status)=>{
  const response=Response.json({code:'PGRST202',message:'pos_sync_push_stock_source_aggregate'},{status}),send=vi.fn();
  expect(await fallbackUnavailableStockSource(response,'{}',send)).toBe(response);expect(send).not.toHaveBeenCalled();
 });
 it('does not reinterpret an unrelated 404 or unknown payload as safe missing-wrapper evidence',async()=>{
  const send=vi.fn();for(const [error,body]of [[{code:'42883',message:'pos_sync_push_stock_source_aggregate'},'{}'],[{code:'PGRST202',message:'another function'},'{}'],
   [{code:'PGRST202',message:'pos_sync_push_stock_source_aggregate'},'{"unexpected":true}']] as const){
   const response=Response.json(error,{status:404});expect(await fallbackUnavailableStockSource(response,body,send)).toBe(response);
  }expect(send).not.toHaveBeenCalled();
 });
 it('preserves ordinary and source-bearing aggregate operations without touching financial domain bytes',()=>{
  const plain={batchId:operation,organizationId:'default',branchId:'a',operations};
  expect(syncAggregateSchema.parse(plain)).toEqual(plain);
  expect(syncAggregateSchema.parse({...plain,stockSourceCohorts:headers})).toEqual({...plain,stockSourceCohorts:headers});
  for(const extra of [{financialLedgerProjection:true},{shiftFinancialOpening:{openingJson:'{}',proof:{}}},{registerFinancialBoundary:true},
   {shiftIntent:{version:1,intentId:operation,shiftId:author,kind:'ORIGINAL',baseToken:null,predecessorIntentId:null,predecessorIntentHash:null,payloadJson:'{}'},shiftAuthor:{}}])
   expect(syncAggregateSchema.safeParse({...plain,...extra,stockSourceCohorts:headers}).success).toBe(false);
 });
 it('uses the existing HTTP upload lane and exact business/sidecar bytes',async()=>{
  const seen:Record<string,unknown>[]=[],fetcher=vi.fn(async(_url:string,init:RequestInit)=>{seen.push(JSON.parse(String(init.body)));return Response.json({ok:true});});
  vi.stubGlobal('fetch',fetcher);
  const client=new CloudClient({configStore:{get:()=> 'https://stock.fixture'},terminalStore:{read:()=>({tokenId:terminal,locationId:'a',deviceBindingProof:'b'.repeat(64)})}});
  await client.pushAggregate({batchId:operation,branchId:'a',operations,stockSourceCohorts:headers});
  expect(seen[0]).toMatchObject({sqlServerAggregate:{batchId:operation,organizationId:'default',branchId:'a',operations,stockSourceCohorts:headers}});
  expect((seen[0]!.sqlServerAggregate as {stockSourceCohorts:{proofJson:string}[]}).stockSourceCohorts[0]!.proofJson).toBe(raw);
 });
 it('never starts another metadata network request or acknowledges ordinary work through the metadata reader',async()=>{
  const batch={cohorts:headers},outbox={sourceForBusiness:vi.fn(async()=>batch),acknowledgeSource:vi.fn(async()=>({acknowledged:1}))},cloud={pushStockHistory:vi.fn()};
  const uploader=new StockHistoryUploader({outbox,cloud});expect(await uploader.prepareBusiness(operation,'a',terminal)).toBe(batch);
  await uploader.acknowledgeBusiness(batch,{ok:true,stockSourceStatus:'accepted'});expect(cloud.pushStockHistory).not.toHaveBeenCalled();
  expect(outbox.acknowledgeSource).toHaveBeenCalledWith(batch,{ok:true,stockSourceStatus:'accepted'});
 });
 it.each(['read','ACK'])('keeps %s-only metadata failures separate from valid core business acceptance',async(mode)=>{
  const outbox={sourceForBusiness:vi.fn(async()=>{if(mode==='read')throw Error('optional schema unavailable');return{cohorts:headers};}),
   acknowledgeSource:vi.fn(async()=>{throw Error('source ACK not confirmed');})};
  const uploader=new StockHistoryUploader({outbox,cloud:{}}),batch=await uploader.prepareBusiness(operation,'a',terminal);
  expect(mode==='read'?batch===null:!!batch).toBe(true);await expect(uploader.acknowledgeBusiness(batch,{ok:true})).resolves.toBeUndefined();
 });
});
