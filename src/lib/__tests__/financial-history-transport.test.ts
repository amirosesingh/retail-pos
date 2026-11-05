import {createRequire} from 'node:module';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
vi.mock('../external-supabase-config',()=>({runtimeEnvValue:()=> 'fixture-service',supabaseConfig:()=>({url:'https://fixture-server.test',key:'fixture-public'})}));
import {handleSyncRequest} from '../sync-endpoint.server';
const require=createRequire(import.meta.url);
const {CloudClient,readVerifiedFinancialBasis}=require('../../../electron/sync/cloud-client.cjs');
const {PushWorker}=require('../../../electron/sync/push-worker.cjs');
const {prepareFinancialHistory,assertFinancialHistoryAcknowledgement}=require('../../../electron/sync/financial-history-ack.cjs');
const {intentMessage}=require('../../../electron/security/shift-author-protocol.cjs');
const {openingFinancialBasisMessage,financialBasisMessage}=require('../../../electron/security/shift-financial-protocol.cjs');
const {financialOperationMessage}=require('../../../electron/security/financial-author-protocol.cjs');
const {loadRegistry}=require('../../../electron/db/schema-registry.cjs');
const {matchingCoverage}=require('../../../scripts/lib/shift-coverage-fixture.cjs');
const branch='A',terminal='terminal',shift='11111111-1111-4111-8111-111111111111',openId='22222222-2222-4222-8222-222222222222',saleId='33333333-3333-4333-8333-333333333333',saleOp='44444444-4444-4444-8444-444444444444',closeId='55555555-5555-4555-8555-555555555555',refundOp='66666666-6666-4666-8666-666666666666';
const hash=(raw:string)=>createHash('sha256').update(raw).digest('hex');
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical((v as Record<string,unknown>)[k])])):v;
const json=(v:unknown)=>JSON.stringify(canonical(v));
type Row=Record<string,unknown>;
function fixture(){
 const pair=generateKeyPairSync('ed25519'),registry=loadRegistry(),common={version:1,algorithm:'Ed25519',keyId:'77777777-7777-4777-8777-777777777777',projectOrigin:'https://fixture.example',terminalId:terminal,authorId:'88888888-8888-4888-8888-888888888888',subject:'real.author',branchId:branch};
 const signed=(fields:Row,message:(v:Row)=>string):Row&{signature:string}=>({...fields,signature:sign(null,Buffer.from(message(fields)),pair.privateKey).toString('base64url')});
 const openingRow={id:shift,store_id:branch,status:'OPEN',state:'ACTIVE',closed_at:null,row_version:1,opening_float:'20.00'},rowJson=JSON.stringify(openingRow),openingOrigin={localAggregateId:openId,rowHash:hash(rowJson)};
 const openingJson=JSON.stringify({version:1,localAggregateId:openId,branchId:branch,terminalId:terminal,shiftId:shift,rowHash:openingOrigin.rowHash,rowJson});
 const opening={openingJson,proof:signed({...common,operationId:openId,action:'OPEN',payloadHash:hash(openingJson)},financialOperationMessage)};
 const fact={id:saleId,branchId:branch,shiftId:shift,totalAmount:'100.00',paymentType:'cash',paymentsJson:null,discountAmount:'0.00',isRefunded:false,rowVersion:'1'};
 const mutation=(operationId:string,action:string,sequence:string,previousId:string,previousHash:string,before:Row|null,after:Row|null)=>{
  const payloadJson=json({version:1,operationId,branchId:branch,terminalId:terminal,shiftId:shift,openingOrigin,sequence,predecessorOperationId:previousId,predecessorHash:previousHash,action,changes:[{saleId,before,after}]}),payloadHash=hash(payloadJson);
  return {kind:'MUTATION',branchId:branch,terminalId:terminal,shiftId:shift,operationId,sequence,payloadJson,payloadHash,proof:signed({...common,operationId,action,payloadHash},financialOperationMessage)};
 };
 const sale=mutation(saleOp,'SALE','1',openId,openingOrigin.rowHash,null,fact);
 const graphTables=['shifts','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts'];
 const operations=graphTables.map(table=>({table,rows:table==='shifts'?[{id:shift,store_id:branch,status:'CLOSED',state:'CLOSED',closed_at:'2026-11-05T00:00:00Z',row_version:5}]:[],changes:[],deletePhase:false}));
 const frozen={version:1,intentId:closeId,branchId:branch,shiftId:shift,kind:'ORIGINAL',baseToken:null,predecessorIntentId:null,predecessorIntentHash:null,operations};
 const payloadJson=JSON.stringify(frozen),payloadHash=hash(payloadJson),financialFrontier={openingOrigin,sequence:'1',operationId:saleOp,hash:sale.payloadHash,reservedSequence:'2'};
 const basisJson=JSON.stringify({prototypeVersion:2,formula:'canonical-exact-decimal-v2',branchId:branch,shiftId:shift,openingFloat:'20.00',inputs:[fact],financialFrontier});
 const proof=signed({...common,shiftId:shift,intentId:closeId,action:'ORIGINAL',graphPayloadHash:payloadHash,basisHash:hash(basisJson),openingOrigin,formula:'canonical-exact-decimal-v2'},openingFinancialBasisMessage);
 const intent={...frozen,payloadJson,payloadHash,shiftAuthor:signed({...common,shiftId:shift,intentId:closeId,action:'ORIGINAL',payloadHash},intentMessage),financialRequired:true,shiftFinancialBasis:{basisJson,proof}};
 const boundaryJson=json({openingOrigin,sequence:'2',predecessorOperationId:saleOp,predecessorHash:sale.payloadHash,intentId:closeId,graphPayloadHash:payloadHash,basisHash:hash(basisJson)});
 const boundary={kind:'CLOSING',branchId:branch,terminalId:terminal,shiftId:shift,operationId:closeId,sequence:'2',payloadJson:boundaryJson,payloadHash:hash(boundaryJson),proof,intent};
 const refund=mutation(refundOp,'REFUND','3',closeId,boundary.payloadHash,fact,{...fact,isRefunded:true,rowVersion:'2'});
 const history=[sale,boundary,refund],meta=new Set<string>(),business=new Set<string>(),order:string[]=[];let opened=false;
 const groups=[{aggregateId:openId,changes:[{entity_type:'shifts',key:{id:shift},entity_id:JSON.stringify({id:shift}),operation:'insert'}]},...[[saleOp,'sales',saleId],[closeId,'shifts',shift],[refundOp,'sales',saleId]].map(([aggregateId,table,id])=>({aggregateId,changes:[{entity_type:table,key:{id},entity_id:JSON.stringify({id}),operation:'update'}]}))];
 const fullAck={ok:true,shift_closure_ack_version:3,shift_closures:[{id:shift,store_id:branch,row_version:5,requested_row_version:5,intent_id:closeId,intent_hash:payloadHash,accepted_token:'a'.repeat(64),current_token:'a'.repeat(64),superseded:false,coverage:matchingCoverage(registry,operations)}],financial_basis_receipt:{ack_version:2,intentId:closeId,graphPayloadHash:payloadHash,basisHash:hash(basisJson),serverBasisId:'99999999-9999-4999-8999-999999999999',formula:proof.formula,openingOrigin}};
 const ackFor=(item:typeof sale|typeof boundary)=>({status:item.kind==='MUTATION'?'financial_metadata_recorded':'boundary_registered_not_shift_closed',operationId:item.operationId,payloadHash:item.payloadHash,sequence:item.sequence,...(item.kind==='CLOSING'?{graphPayloadHash:payloadHash,basisHash:hash(basisJson)}:{}),businessUploaded:false,shiftClosed:false});
 const reader={pendingAggregates:vi.fn(async(_b:string,_n:number,deferred:string[])=>groups.filter(g=>!business.has(g.aggregateId)&&!deferred.includes(g.aggregateId))),financialAggregateRequired:vi.fn(async(id:string)=>id!==openId),financialOpening:vi.fn(async(id:string)=>id===openId?opening:null),financialHistory:vi.fn(async()=>opened?history.filter(h=>!meta.has(h.operationId)):[]),financialHistoryReady:vi.fn(async()=>meta.size===3),acknowledgeFinancialHistory:vi.fn(async(item:typeof sale|typeof boundary,ack:unknown)=>{assertFinancialHistoryAcknowledgement(item,ack);meta.add(item.operationId);order.push('metadata:'+item.sequence);}),acknowledgeFinancialOpening:vi.fn(async()=>{opened=true;}),protectedIntent:vi.fn(async(id:string)=>id===closeId?intent:null),predecessorAccepted:vi.fn(async()=>true),shiftPrerequisites:vi.fn(async()=>business.has(saleOp)&&business.has(refundOp)),frozenOpeningRows:vi.fn(async(id:string)=>id===openId?[openingRow]:[]),rows:vi.fn(async(table:{cloudTable:string})=>table.cloudTable==='shifts'?[{...openingRow,status:'CLOSED'}]:[{id:saleId,store_id:branch,shift_id:shift,total_amount:'100.00',is_refunded:true,row_version:2}]),acknowledgeAggregate:vi.fn(async(id:string)=>{business.add(id);order.push('business:'+id);}),acknowledgeProtectedIntent:vi.fn(async()=>{business.add(closeId);order.push('real-close');}),failAggregate:vi.fn()};
 const cloud={terminalId:()=>terminal,pushFinancialEvent:vi.fn(async({operationJson}:{operationJson:string})=>ackFor(history.find(h=>h.payloadJson===operationJson)!)),registerFinancialBoundary:vi.fn(async()=>{expect(reader.acknowledgeProtectedIntent).not.toHaveBeenCalled();return ackFor(boundary);}),pushAggregate:vi.fn(async(batch:Row)=>{if(batch.shiftIntent){expect(business.has(saleOp)&&business.has(refundOp)).toBe(true);return fullAck;}if((batch.operations as {table:string}[])[0].table==='shifts'){expect(batch).toHaveProperty('shiftFinancialOpening.openingJson',openingJson);return{ok:true};}expect(meta.size).toBe(3);expect(batch.financialLedgerProjection).toBe(true);return{ok:true};})};
 const worker=new PushWorker({reader,cloud,registry,checkpoints:{},financialHistoryEnabled:true});worker.retry=async(fn:()=>Promise<unknown>)=>fn();
 return{worker,reader,cloud,history,intent,opening,ackFor,order,business,meta,signed,common,run:()=>worker.pushAggregates(branch,100,false)};
}
describe('two-phase exact financial history transport',()=>{
 it('registers frozen SALE→CLOSE boundary→REFUND before latest business and only then real closure',async()=>{
  const f=fixture();expect(await f.run()).toBe(3);expect(await f.run()).toBe(1);expect(f.order.slice(1,4)).toEqual(['metadata:1','metadata:2','metadata:3']);expect(f.order.at(-1)).toBe('real-close');expect(f.reader.acknowledgeProtectedIntent).toHaveBeenCalledOnce();expect(f.cloud.registerFinancialBoundary).toHaveBeenCalledOnce();
  const first=JSON.parse(f.cloud.pushFinancialEvent.mock.calls[0][0].operationJson);expect(first.changes[0].after.isRefunded).toBe(false);const last=JSON.parse(f.cloud.pushFinancialEvent.mock.calls[1][0].operationJson);expect(last.changes[0].after.isRefunded).toBe(true);
 });
 it('does not treat boundary-only success as a closed shift or clear its actual intent',async()=>{
  const f=fixture();f.cloud.pushAggregate.mockImplementation(async(batch:Row)=>{if(batch.shiftIntent)throw Object.assign(new Error('503'),{status:503});return{ok:true};});expect(await f.run()).toBe(3);await expect(f.run()).rejects.toMatchObject({status:503});expect(f.meta.has(closeId)).toBe(true);expect(f.reader.acknowledgeProtectedIntent).not.toHaveBeenCalled();expect(f.business.has(closeId)).toBe(false);
 });
 it('retains metadata and business queues after an invalid metadata ACK',async()=>{const f=fixture();f.cloud.pushFinancialEvent.mockResolvedValue({ok:true} as never);await expect(f.run()).rejects.toMatchObject({code:'EFINANCIAL_HISTORY_UNCONFIRMED'});expect(f.reader.acknowledgeFinancialHistory).not.toHaveBeenCalled();expect(f.reader.acknowledgeProtectedIntent).not.toHaveBeenCalled();});
 it('holds protected work with capability off without a legacy upload',async()=>{const f=fixture();f.worker.financialHistoryEnabled=false;await expect(f.run()).rejects.toMatchObject({code:'EFINANCIAL_PROTOCOL_UNAVAILABLE'});expect(f.cloud.pushAggregate).not.toHaveBeenCalled();});
 it('rejects a changed frozen event before making a metadata request',async()=>{const f=fixture();f.history[0].payloadJson+=' ';await expect(f.run()).rejects.toMatchObject({code:'EFINANCIAL_HISTORY_INVALID'});expect(f.cloud.pushFinancialEvent).not.toHaveBeenCalled();});
 it('retries lost metadata response with identical history and no ordinary fallback',async()=>{
  const f=fixture();f.cloud.pushFinancialEvent.mockRejectedValueOnce(Object.assign(new Error('503'),{status:503}));await expect(f.run()).rejects.toMatchObject({status:503});expect(f.reader.acknowledgeFinancialHistory).not.toHaveBeenCalled();expect(f.cloud.pushAggregate).toHaveBeenCalledOnce();
  expect(await f.run()).toBe(2);expect(await f.run()).toBe(1);expect(f.cloud.pushFinancialEvent.mock.calls[0][0]).toEqual(f.cloud.pushFinancialEvent.mock.calls[1][0]);
 });
 it('refuses an ordinary success object as a boundary metadata ACK',async()=>{const f=fixture();f.cloud.registerFinancialBoundary.mockResolvedValue({ok:true} as never);await expect(f.run()).rejects.toMatchObject({code:'EFINANCIAL_HISTORY_UNCONFIRMED'});expect(f.reader.acknowledgeProtectedIntent).not.toHaveBeenCalled();expect(f.meta.has(closeId)).toBe(false);});
 it('requires exact metadata receipt fields and preserves false business flags',()=>{const f=fixture(),item=prepareFinancialHistory(f.history[0],branch,terminal);for(const patch of [{status:'ok'},{businessUploaded:true},{shiftClosed:true},{sequence:'2'},{extra:true}])expect(()=>assertFinancialHistoryAcknowledgement(item,{...f.ackFor(f.history[0]),...patch})).toThrow();});
});
describe('CloudClient financial wire and opaque verified-basis witness',()=>{
 it('uses existing aggregate guards for metadata boundary, distinct event envelope and exact raw bytes',async()=>{const f=fixture(),client=new CloudClient({}),request=vi.fn(async(_payload:unknown)=>({}));client.request=request;await client.pushFinancialEvent({branchId:branch,operationJson:f.history[0].payloadJson,proof:f.history[0].proof});expect(request.mock.calls[0][0]).toEqual({sqlServerFinancialEvent:{organizationId:'default',branchId:branch,operationJson:f.history[0].payloadJson,proof:f.history[0].proof}});await client.registerFinancialBoundary({batchId:closeId,branchId:branch,shiftIntent:f.intent,shiftAuthor:f.intent.shiftAuthor,shiftFinancialBasis:f.intent.shiftFinancialBasis});expect(request.mock.calls[1][0]).toHaveProperty('sqlServerAggregate.registerFinancialBoundary',true);});
 it('preserves signed UUID-looking labels through the actual request body',async()=>{
  const label='AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',client=new CloudClient({terminalStore:{read:()=>({tokenId:label,deviceBindingProof:'synthetic'})},configStore:{get:()=> 'https://fixture.example'}}),proof={terminalId:label,branchId:label};
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{const body=JSON.parse(String(init?.body));expect(body.sqlServerFinancialEvent.proof).toEqual(proof);expect(body.terminalToken).toBe(label.toLowerCase());return Response.json({status:'synthetic'});});
  try{await client.pushFinancialEvent({branchId:label,operationJson:' exact raw bytes ',proof});}finally{fetch.mockRestore();}
 });
 function witnessFixture(){
  const databaseGuid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',pool={request:()=>({query:vi.fn(async()=>({recordset:[{database_guid:databaseGuid}]}))})},manager={pool,profile:{host:'owned-fixture',database:'isolated'}},context={projectOrigin:'https://fixture.supabase.co',branchId:branch},backend={url:'https://fixture.example'},activation={tokenId:terminal,branchId:branch,deviceBindingProof:'synthetic-proof'};
  const client=new CloudClient({connectionManager:manager,financialBasisContext:()=>context,terminalStore:{read:()=>activation},configStore:{get:()=>backend.url}});
  const basisJson='{"branchId":"A","shiftId":"'+shift+'","parentSnapshot":{"status":"CLOSED","row_version":9007199254740993},"inputs":[]}';
  const response={basisId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',basisHash:hash(basisJson),basisJson,parentSnapshot:{status:'CLOSED'},sourceEvidence:{creatorXid:'100',snapshot:'90:101:95',evidenceOrder:'1'},ownPublishedThrough:{}};
  const expected={connectionManager:manager,branchId:branch,terminalId:terminal,shiftId:shift,projectOrigin:context.projectOrigin};return{client,manager,context,activation,backend,response,expected,databaseGuid};
 }
 it('brands only an actual HTTP read and binds SQL profile/pool, registration and project',async()=>{const f=witnessFixture(),fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{expect(JSON.parse(String(init?.body))).toHaveProperty('sqlServerFinancialBasis.shiftId',shift);return Response.json(f.response);});try{const token=await f.client.readFinancialBasis({branchId:branch,shiftId:shift}),saved=readVerifiedFinancialBasis(token,f.expected);expect(Object.keys(token)).toEqual([]);expect(saved).toMatchObject({serverBasisId:f.response.basisId,serverBasisHash:f.response.basisHash,basisJson:f.response.basisJson,databaseGuid:f.databaseGuid,purpose:'financial_basis_read'});expect(Object.isFrozen(saved.parentSnapshot)).toBe(true);expect(()=>readVerifiedFinancialBasis({...token},f.expected)).toThrow();f.manager.profile.database='changed';expect(()=>readVerifiedFinancialBasis(token,f.expected)).toThrow();}finally{fetch.mockRestore();}});
 it('rejects context changes while the HTTP response is in flight',async()=>{const f=witnessFixture(),fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{f.context.branchId='B';return Response.json(f.response);});try{await expect(f.client.readFinancialBasis({branchId:branch,shiftId:shift})).rejects.toMatchObject({code:'EFINANCIAL_BASIS_SOURCE_CHANGED'});}finally{fetch.mockRestore();}});
 it.each(['pool','profile','project','terminal','backend'])('rejects %s identity changes while awaiting the read',async field=>{
  const f=witnessFixture(),fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{if(field==='pool')f.manager.pool={...f.manager.pool};if(field==='profile')f.manager.profile.database='other';if(field==='project')f.context.projectOrigin='https://other.supabase.co';if(field==='terminal')f.activation.tokenId='other';if(field==='backend')f.backend.url='https://other.example';return Response.json(f.response);});
  try{await expect(f.client.readFinancialBasis({branchId:branch,shiftId:shift})).rejects.toMatchObject({code:'EFINANCIAL_BASIS_SOURCE_CHANGED'});}finally{fetch.mockRestore();}
 });
 it('rejects a malformed/hash-mismatched read without minting a witness',async()=>{const f=witnessFixture(),fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({...f.response,basisHash:'c'.repeat(64)}));try{await expect(f.client.readFinancialBasis({branchId:branch,shiftId:shift})).rejects.toMatchObject({code:'EFINANCIAL_BASIS_SOURCE_CHANGED'});}finally{fetch.mockRestore();}});
});

describe('strict cloud-basis history union',()=>{
 it('accepts v2 metadata only with exclusive cloud origin',()=>{
  const f=fixture(),old=f.history[0],payload=JSON.parse(old.payloadJson),cloudOrigin={serverBasisId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',serverBasisHash:'d'.repeat(64)};
  delete payload.openingOrigin;payload.version=2;payload.cloudOrigin=cloudOrigin;payload.predecessorOperationId=cloudOrigin.serverBasisId;payload.predecessorHash=cloudOrigin.serverBasisHash;
  const payloadJson=json(payload),item={...old,payloadJson,payloadHash:hash(payloadJson),proof:{...old.proof,payloadHash:hash(payloadJson)}};
  expect(prepareFinancialHistory(item,branch,terminal)).toMatchObject({payloadJson});
  const mixed=JSON.parse(payloadJson);mixed.openingOrigin={localAggregateId:openId,rowHash:'e'.repeat(64)};const badJson=json(mixed);expect(()=>prepareFinancialHistory({...item,payloadJson:badJson,payloadHash:hash(badJson),proof:{...item.proof,payloadHash:hash(badJson)}},branch,terminal)).toThrow();
 });
 it('binds v2 closing metadata to its actual server-basis companion and frontier',()=>{
  const f=fixture(),cloudOrigin={serverBasisId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',serverBasisHash:'d'.repeat(64)},basis=JSON.parse(f.intent.shiftFinancialBasis.basisJson);
  basis.financialFrontier={cloudOrigin,sequence:'1',operationId:saleOp,hash:f.history[0].payloadHash,reservedSequence:'2'};const basisJson=JSON.stringify(basis);
  const proof=f.signed({...f.common,shiftId:shift,intentId:closeId,action:'ORIGINAL',graphPayloadHash:f.intent.payloadHash,basisHash:hash(basisJson),serverBasisId:cloudOrigin.serverBasisId,formula:'canonical-exact-decimal-v2'},financialBasisMessage);
  const payloadJson=json({cloudOrigin,sequence:'2',predecessorOperationId:saleOp,predecessorHash:f.history[0].payloadHash,intentId:closeId,graphPayloadHash:f.intent.payloadHash,basisHash:hash(basisJson)});
  const item={...f.history[1],payloadJson,payloadHash:hash(payloadJson),proof,intent:{...f.intent,shiftFinancialBasis:{basisJson,proof}}};expect(prepareFinancialHistory(item,branch,terminal)).toMatchObject({payloadHash:hash(payloadJson)});
  const badProof={...proof,serverBasisId:openId};expect(()=>prepareFinancialHistory({...item,proof:badProof,intent:{...item.intent,shiftFinancialBasis:{basisJson,proof:badProof}}},branch,terminal)).toThrow();
 });
 it('rejects mismatched version/genesis union and duplicate raw keys',()=>{
  const f=fixture(),item=f.history[0];for(const raw of [item.payloadJson.replace('"version":1','"version":2'),item.payloadJson.replace('{','{"version":1,')])expect(()=>prepareFinancialHistory({...item,payloadJson:raw,payloadHash:hash(raw),proof:{...item.proof,payloadHash:hash(raw)}},branch,terminal)).toThrow();
 });
});


describe('verified observation metadata transport',()=>{
 const item=()=>{const payloadJson=json({version:2,operationId:refundOp,branchId:branch,terminalId:terminal,shiftId:shift,cloudOrigin:{serverBasisId:openId,serverBasisHash:'a'.repeat(64)},sequence:'1',predecessorOperationId:openId,predecessorHash:'a'.repeat(64),action:'OBSERVE',observedBasis:{serverBasisId:saleId,serverBasisHash:'b'.repeat(64)}});return {kind:'OBSERVE',branchId:branch,terminalId:terminal,shiftId:shift,operationId:refundOp,sequence:'1',payloadJson,payloadHash:hash(payloadJson),proof:{serverBasisId:saleId,serverBasisHash:'b'.repeat(64)},computedMergedHash:'c'.repeat(64),pendingFromHash:'d'.repeat(64)};};
 const ack=(v:ReturnType<typeof item>)=>({status:'financial_metadata_observed',operationId:v.operationId,payloadHash:v.payloadHash,sequence:v.sequence,computedMergedHash:v.computedMergedHash,pendingFromHash:v.pendingFromHash,businessUploaded:false,shiftClosed:false});
 it('requires exact independent merged and pending hashes, never ordinary success',()=>{const v=prepareFinancialHistory(item(),branch,terminal);expect(assertFinancialHistoryAcknowledgement(v,ack(v))).toEqual(ack(v));for(const bad of [{ok:true},{...ack(v),pendingFromHash:'e'.repeat(64)},{...ack(v),computedMergedHash:'e'.repeat(64)},{...ack(v),businessUploaded:true}])expect(()=>assertFinancialHistoryAcknowledgement(v,bad)).toThrow();});
 it('drains observations with no business journals and retains failed metadata',async()=>{const v=item(),done=vi.fn(),cloud={terminalId:()=>terminal,pushFinancialObservation:vi.fn(async()=>ack(v))},reader={financialHistory:vi.fn().mockResolvedValueOnce([v]).mockResolvedValue([]),acknowledgeFinancialHistory:done,pendingAggregates:vi.fn(async()=>[])};const worker=new PushWorker({reader,cloud,registry:loadRegistry(),checkpoints:{},financialHistoryEnabled:true});worker.retry=async(fn:()=>Promise<unknown>)=>fn();expect(await worker.pushAggregates(branch,100)).toBe(0);expect(done).toHaveBeenCalledOnce();expect(cloud.pushFinancialObservation).toHaveBeenCalledWith({branchId:branch,operationJson:v.payloadJson});reader.financialHistory.mockResolvedValue([v]);cloud.pushFinancialObservation.mockResolvedValue({...ack(v),pendingFromHash:'e'.repeat(64)});await expect(worker.pushAggregates(branch,100)).rejects.toHaveProperty('code','EFINANCIAL_HISTORY_UNCONFIRMED');expect(done).toHaveBeenCalledOnce();});
});

describe('actual guarded financial business handler preserves nested precision',()=>{
 const device='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',batch='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',claim='a'.repeat(64);
 const requestRaw=()=>'{"terminalToken":"'+device+'","deviceBindingProof":"'+claim+'","sqlServerAggregate":{"batchId":"'+batch+'","organizationId":"default","branchId":"A","financialLedgerProjection":true,"operations":[{"table":"sales","dependencyOrder":999,"rows":[{"id":"'+saleId+'","store_id":"A","shift_id":"'+shift+'","total_amount":"9007199254740993.010000000001","payments":[{"method":"cash","amount":9007199254740993.010000000001,"extra":{"tiny":0.000000000001,"integer":9007199254740993,"label":"日本語"}}]}],"changes":[{"op":"U","version":9007199254740993,"key":{"id":"'+saleId+'"}}]}]}}';
 const run=async(raw:string,{revoked=false}={})=>{
  const rpcBodies:string[]=[];const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
   const url=String(input);if(url.includes('/terminal_tokens?'))return Response.json([{id:device,platform:'pc',status:revoked?'revoked':'used',location_id:'A',is_claimed:true,claim_proof:claim}]);
   if(url.includes('/stores?'))return Response.json([{id:'A'}]);
   if(url.includes('/rpc/')){expect(url).toContain(raw.includes('financialLedgerProjection')?'/rpc/pos_sync_push_financial_business_aggregate':'/rpc/pos_sync_push_aggregate');rpcBodies.push(String(init?.body));return Response.json({ok:true,batch_id:batch});}
   throw new Error('Unexpected isolated request: '+url);
  });
  try{return{response:await handleSyncRequest(new Request('https://fixture-pos.test/api/v1/pos/sync',{method:'POST',body:raw})),rpcBodies};}finally{fetch.mockRestore();}
 };
 it('keeps >2^53 and twelve-place nested amounts through the real handler RPC body',async()=>{
  const result=await run(requestRaw());expect(result.response.status).toBe(200);expect(result.rpcBodies).toHaveLength(1);
  const raw=result.rpcBodies[0];expect(raw).toContain('"amount":9007199254740993.010000000001');expect(raw).toContain('"tiny":0.000000000001');expect(raw).toContain('"integer":9007199254740993');expect(raw).toContain('"version":9007199254740993');expect(raw).toContain('日本語');expect(raw).not.toContain('dependencyOrder');expect(raw).not.toContain('"raw"');
  expect(JSON.parse(raw)).toMatchObject({p_org:'default',p_branch:'A',p_terminal:device,p_operations:[{table:'sales'}]});
 });
 it('leaves the legacy aggregate serialization unchanged',async()=>{
  const raw=requestRaw().replace('"financialLedgerProjection":true,',''),result=await run(raw);expect(result.response.status).toBe(200);expect(result.rpcBodies).toHaveLength(1);expect(result.rpcBodies[0]).not.toContain('"amount":9007199254740993.010000000001');
 });
 it('still denies a revoked terminal and a foreign requested branch before any RPC',async()=>{
  const revoked=await run(requestRaw(),{revoked:true});expect(revoked.response.status).toBe(401);expect(revoked.rpcBodies).toHaveLength(0);
  const foreign=await run(requestRaw().replace('"branchId":"A"','"branchId":"B"'));expect(foreign.response.status).toBe(403);expect(foreign.rpcBodies).toHaveLength(0);
 });
 it.each([
  ()=>requestRaw().replace('"amount":9007199254740993.010000000001','"amount":1,"amount":2'),
  ()=>requestRaw().replace('"label":"日本語"','"label":'+('['.repeat(130))+'0'+(']'.repeat(130))),
  ()=>requestRaw().replace('"sqlServerAggregate":','"read":{"kind":"stores"},"sqlServerAggregate":'),
 ])('rejects duplicate, excessive-depth and mixed protected requests without an RPC',async(make)=>{const result=await run(make());expect(result.response.status).toBe(400);expect(result.rpcBodies).toHaveLength(0);});
 it('retains the existing eight-MiB request limit',async()=>{const result=await run(requestRaw()+' '.repeat(8*1024*1024));expect(result.response.status).toBe(413);expect(result.rpcBodies).toHaveLength(0);});
});
