import {createRequire} from 'node:module';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
const require=createRequire(import.meta.url);
const {CloudClient}=require('../../../electron/sync/cloud-client.cjs');
const {PushWorker}=require('../../../electron/sync/push-worker.cjs');
const {prepareShiftFinancialBasis,assertShiftFinancialAcknowledgement}=require('../../../electron/sync/shift-financial-ack.cjs');
const {financialBasisMessage}=require('../../../electron/security/shift-financial-protocol.cjs');
const {intentMessage}=require('../../../electron/security/shift-author-protocol.cjs');
const {loadRegistry}=require('../../../electron/db/schema-registry.cjs');
const {matchingCoverage}=require('../../../scripts/lib/shift-coverage-fixture.cjs');
const registry=loadRegistry(),branch='branch-a',shift='11111111-1111-4111-8111-111111111111',intentId='22222222-2222-4222-8222-222222222222',basisId='33333333-3333-4333-8333-333333333333';
const hash=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
type Sidecar={basisJson:string;proof:Record<string,unknown>};
type Intent={version:number;intentId:string;branchId:string;shiftId:string;kind:string;baseToken:null;predecessorIntentId:null;predecessorIntentHash:null;operations:{table:string;rows:Record<string,unknown>[];changes:never[];deletePhase:boolean}[];payloadJson:string;payloadHash:string;shiftAuthor:Record<string,unknown>;financialRequired?:boolean;shiftFinancialBasis?:Sidecar|null};
function fixture(financial=true){
 const tables=['shifts','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts'];
 const operations=tables.map(table=>({table,rows:table==='shifts'?[{id:shift,store_id:branch,status:'CLOSED',state:'CLOSED',closed_at:'2026-11-04T00:00:00.000Z',row_version:5}]:[],changes:[] as never[],deletePhase:false}));
 const frozen={version:1,intentId,branchId:branch,shiftId:shift,kind:'ORIGINAL',baseToken:null,predecessorIntentId:null,predecessorIntentHash:null,operations};
 const payloadJson=JSON.stringify(frozen),payloadHash=hash(payloadJson),pair=generateKeyPairSync('ed25519');
 const common={version:1,algorithm:'Ed25519',keyId:'44444444-4444-4444-8444-444444444444',projectOrigin:'https://fixture.example',terminalId:'fixture-terminal',authorId:'55555555-5555-4555-8555-555555555555',subject:'actual.author',branchId:branch,shiftId:shift,intentId,action:'ORIGINAL'};
 const unsignedAuthor={...common,payloadHash},shiftAuthor={...unsignedAuthor,signature:sign(null,Buffer.from(intentMessage(unsignedAuthor)),pair.privateKey).toString('base64url')};
 const basisJson=' {"prototypeVersion":2,"formula":"canonical-exact-decimal-v2","branchId":"branch-a","shiftId":"'+shift+'","openingFloat":"0","inputs":[],"rawNote":"exact bytes"} ';
 const unsignedBasis={...common,graphPayloadHash:payloadHash,basisHash:hash(basisJson),serverBasisId:basisId,formula:'canonical-exact-decimal-v2'};
 const proof={...unsignedBasis,signature:sign(null,Buffer.from(financialBasisMessage(unsignedBasis)),pair.privateKey).toString('base64url')};
 const intent:Intent={...frozen,payloadJson,payloadHash,shiftAuthor,...(financial?{financialRequired:true,shiftFinancialBasis:{basisJson,proof}}:{})};
 const ack:Record<string,unknown>={ok:true,shift_closure_ack_version:3,shift_closures:[{id:shift,store_id:branch,row_version:5,requested_row_version:5,intent_id:intentId,intent_hash:payloadHash,accepted_token:'a'.repeat(64),current_token:'a'.repeat(64),superseded:false,coverage:matchingCoverage(registry,operations)}],...(financial?{financial_basis_receipt:{ack_version:1,intentId,graphPayloadHash:payloadHash,basisHash:proof.basisHash,serverBasisId:basisId,formula:proof.formula}}:{})};
 let acknowledged=false;
 const group={aggregateId:intentId,changes:[{entity_type:'shifts',entity_id:JSON.stringify({id:shift}),key:{id:shift},operation:'update'}]};
 const reader={pendingAggregates:vi.fn(async()=>acknowledged?[]:[group]),protectedIntent:vi.fn(async()=>intent),predecessorAccepted:vi.fn(async()=>true),shiftPrerequisites:vi.fn(async()=>true),acknowledgeProtectedIntent:vi.fn(async()=>{acknowledged=true;}),acknowledgeAggregate:vi.fn(),failAggregate:vi.fn()};
 const cloud={terminalId:()=>common.terminalId,pushAggregate:vi.fn(async(_payload:unknown)=>ack)};
 const worker=new PushWorker({reader,cloud,registry,checkpoints:{}});
 return {intent,ack,reader,cloud,worker,sidecar:intent.shiftFinancialBasis as Sidecar,run:()=>worker.pushAggregates(branch,500,false)};
}
describe('optional native financial sidecar guard',()=>{
 it('preserves exact raw basis bytes and verifies both ordinary and financial ACK before clearing',async()=>{
  const f=fixture();expect(await f.run()).toBe(1);expect(f.reader.acknowledgeProtectedIntent).toHaveBeenCalledOnce();
  const sent=f.cloud.pushAggregate.mock.calls[0][0] as {shiftFinancialBasis:Sidecar};expect(sent.shiftFinancialBasis).toEqual(f.sidecar);expect(sent.shiftFinancialBasis.basisJson).toBe(f.sidecar.basisJson);
 });
 it('holds required proof absence before unrelated prerequisites or any request',async()=>{
  for(const value of [undefined,null]){const f=fixture();f.intent.shiftFinancialBasis=value;f.reader.predecessorAccepted.mockResolvedValue(false);
   await expect(f.run()).rejects.toMatchObject({code:'ESHIFT_FINANCIAL_PROOF_REQUIRED'});expect(f.cloud.pushAggregate).not.toHaveBeenCalled();expect(f.reader.acknowledgeProtectedIntent).not.toHaveBeenCalled();expect(f.reader.predecessorAccepted).not.toHaveBeenCalled();}
 });
 it.each(['basisJson','basisHash','graphPayloadHash','serverBasisId','branchId','shiftId','intentId','action','authorId','keyId','subject','projectOrigin','terminalId'])('holds a changed %s before upload',async field=>{
  const f=fixture();
  if(field==='basisJson')f.sidecar.basisJson+=' ';
  else if(field==='serverBasisId')f.sidecar.proof[field]='not-a-uuid';
  else if(field==='basisHash'||field==='graphPayloadHash')f.sidecar.proof[field]='c'.repeat(64);
  else f.sidecar.proof[field]=field==='action'?'RECOUNT':field.endsWith('Id')?'66666666-6666-4666-8666-666666666666':'different';
  await expect(f.run()).rejects.toMatchObject({code:'ESHIFT_FINANCIAL_PROOF_INVALID'});expect(f.cloud.pushAggregate).not.toHaveBeenCalled();expect(f.reader.acknowledgeProtectedIntent).not.toHaveBeenCalled();
 });
 it('holds changed raw graph bytes and refuses a local signature-validation failure',async()=>{
  const f=fixture();f.intent.payloadJson+=' ';await expect(f.run()).rejects.toMatchObject({code:'ESHIFT_FINANCIAL_PROOF_INVALID'});expect(f.cloud.pushAggregate).not.toHaveBeenCalled();
  const valid=fixture();valid.worker.validateFinancialBasis=()=>{throw Object.assign(new Error('saved author unavailable'),{code:'ESYNC_SHIFT_AUTHOR_KEY_MISSING'});};await expect(valid.run()).rejects.toMatchObject({code:'ESYNC_SHIFT_AUTHOR_KEY_MISSING'});expect(valid.reader.acknowledgeProtectedIntent).not.toHaveBeenCalled();
 });
 it.each(['missing','ack_version','intentId','graphPayloadHash','basisHash','serverBasisId','formula','extra'])('keeps the queue when HTTP success has invalid financial receipt %s',async field=>{
  const f=fixture();if(field==='missing')delete f.ack.financial_basis_receipt;else{const receipt=f.ack.financial_basis_receipt as Record<string,unknown>;receipt[field]=field==='ack_version'?2:'wrong';}
  await expect(f.run()).rejects.toMatchObject({code:'ESHIFT_FINANCIAL_UNCONFIRMED'});expect(f.cloud.pushAggregate).toHaveBeenCalledOnce();expect(f.reader.acknowledgeProtectedIntent).not.toHaveBeenCalled();expect(f.reader.failAggregate).toHaveBeenCalledOnce();
 });
 it('requires the ordinary closing proof even when financial receipt matches',async()=>{
  const f=fixture();delete f.ack.shift_closures;await expect(f.run()).rejects.toMatchObject({code:'ESHIFT_CLOSURE_UNCONFIRMED'});expect(f.reader.acknowledgeProtectedIntent).not.toHaveBeenCalled();
 });
 it('replays a lost response without clearing early or falling back to legacy',async()=>{
  const f=fixture();const unavailable=Object.assign(new Error('HTTP 503'),{status:503,code:'HTTP_503'});
  f.worker.retry=async(work:()=>Promise<unknown>)=>work();f.cloud.pushAggregate.mockRejectedValueOnce(unavailable);
  await expect(f.run()).rejects.toMatchObject({status:503});expect(f.reader.acknowledgeProtectedIntent).not.toHaveBeenCalled();
  expect(await f.run()).toBe(1);expect(f.reader.acknowledgeProtectedIntent).toHaveBeenCalledOnce();expect(f.cloud.pushAggregate).toHaveBeenCalledTimes(2);
  const sent=f.cloud.pushAggregate.mock.calls.map(call=>call[0]);expect(sent[1]).toEqual(sent[0]);expect(sent.every(value=>Object.hasOwn(value as object,'shiftFinancialBasis'))).toBe(true);
 });
 it('leaves legacy wire and ordinary ACK behavior unchanged',async()=>{
  const f=fixture(false);expect(await f.run()).toBe(1);expect(f.reader.acknowledgeProtectedIntent).toHaveBeenCalledOnce();
  expect(f.cloud.pushAggregate.mock.calls[0][0]).not.toHaveProperty('shiftFinancialBasis');
  expect(prepareShiftFinancialBasis(f.intent,branch)).toBeUndefined();expect(assertShiftFinancialAcknowledgement(f.ack,f.intent)).toBeUndefined();
 });
 it('does not accept an arbitrary prevalidated-object flag or a changed intent after preparation',()=>{
  const f=fixture(),saved=prepareShiftFinancialBasis(f.intent,branch);expect(()=>assertShiftFinancialAcknowledgement(f.ack,f.intent,{...saved})).toThrow();
  f.intent.payloadJson+=' ';expect(()=>assertShiftFinancialAcknowledgement(f.ack,f.intent,saved)).toThrow();
 });
});
describe('CloudClient optional financial transport',()=>{
 it('forwards the exact companion without outer operations or local activation markers',async()=>{
  const f=fixture(),client=new CloudClient({}),request=vi.fn(async(_value:unknown)=>({ok:true}));client.request=request;
  await client.pushAggregate({batchId:intentId,branchId:branch,shiftIntent:f.intent,shiftAuthor:f.intent.shiftAuthor,shiftFinancialBasis:f.sidecar,financialRequired:true});
  const body=(request.mock.calls[0][0] as {sqlServerAggregate:Record<string,unknown>}).sqlServerAggregate;
  expect(body.shiftFinancialBasis).toBe(f.sidecar);expect((body.shiftFinancialBasis as Sidecar).basisJson).toBe(f.sidecar.basisJson);expect(body).not.toHaveProperty('operations');expect(body).not.toHaveProperty('financialRequired');
 });
 it('preserves raw companion bytes through the actual request JSON with the saved native device identity',async()=>{
  const f=fixture(),client=new CloudClient({configStore:{get:()=> 'https://fixture.example'},terminalStore:{read:()=>({tokenId:'fixture-terminal',deviceBindingProof:'synthetic-device-proof'})}});
  const transport=vi.spyOn(globalThis,'fetch').mockImplementation(async(url,options)=>{
    expect(String(url)).toBe('https://fixture.example/api/v1/pos/sync');
    const sent=JSON.parse(String(options?.body));
    expect(sent.terminalToken).toBe('fixture-terminal');expect(sent.deviceBindingProof).toBe('synthetic-device-proof');
    expect(sent.sqlServerAggregate.shiftFinancialBasis).toEqual(f.sidecar);
    expect(sent.sqlServerAggregate.shiftFinancialBasis.basisJson).toBe(f.sidecar.basisJson);
    return Response.json(f.ack);
  });
  try{expect(await client.pushAggregate({batchId:intentId,branchId:branch,shiftIntent:f.intent,shiftAuthor:f.intent.shiftAuthor,shiftFinancialBasis:f.sidecar})).toMatchObject({ok:true});expect(transport).toHaveBeenCalledOnce();}
  finally{transport.mockRestore();}
 });
 it('does not downgrade on absent backend protocol or a 503',async()=>{
  for(const error of [Object.assign(new Error('missing'),{code:'PGRST202',status:404}),Object.assign(new Error('HTTP 503'),{code:'HTTP_503',status:503})]){
   const f=fixture(),client=new CloudClient({}),request=vi.fn(async(_value:unknown)=>{throw error;});client.request=request;
   await expect(client.pushAggregate({batchId:intentId,branchId:branch,shiftIntent:f.intent,shiftAuthor:f.intent.shiftAuthor,shiftFinancialBasis:f.sidecar})).rejects.toBeDefined();
   expect(request).toHaveBeenCalledOnce();expect(request.mock.calls[0][0]).toHaveProperty('sqlServerAggregate.shiftFinancialBasis',f.sidecar);
  }
 });
 it('rejects a financial sidecar without an intent and required proof absence before network',()=>{
  const client=new CloudClient({}),request=vi.fn();client.request=request;
  expect(()=>client.pushAggregate({batchId:intentId,branchId:branch,operations:[],shiftFinancialBasis:{}})).toThrow(expect.objectContaining({code:'ESHIFT_FINANCIAL_PROOF_INVALID'}));
  for(const shiftFinancialBasis of [undefined,null])expect(()=>client.pushAggregate({batchId:intentId,branchId:branch,shiftIntent:{},shiftFinancialBasis,financialRequired:true})).toThrow(expect.objectContaining({code:'ESHIFT_FINANCIAL_PROOF_REQUIRED'}));
  expect(()=>client.pushAggregate({batchId:intentId,branchId:branch,shiftIntent:{},shiftFinancialBasis:null})).toThrow(expect.objectContaining({code:'ESHIFT_FINANCIAL_PROOF_INVALID'}));expect(request).not.toHaveBeenCalled();
 });
});

describe('pending opening-origin financial ACK2',()=>{
 function originFixture(){
  const f=fixture();const {serverBasisId:_id,signature:_sig,...common}=f.sidecar.proof;
  const openingOrigin={localAggregateId:basisId,rowHash:'f'.repeat(64)};
  // Transport guard checks binding; cryptographic verification remains the Main/server validator.
  f.sidecar.proof={...common,openingOrigin,signature:_sig};
  f.ack.financial_basis_receipt={ack_version:2,intentId,graphPayloadHash:f.intent.payloadHash,basisHash:f.sidecar.proof.basisHash,serverBasisId:basisId,formula:f.sidecar.proof.formula,openingOrigin:{...openingOrigin}};
  return f;
 }
 it('accepts the exact origin and resolved baseline without rewriting the saved proof',async()=>{
  const f=originFixture(),before=JSON.stringify(f.sidecar);expect(await f.run()).toBe(1);expect(JSON.stringify(f.sidecar)).toBe(before);expect(f.sidecar.proof).not.toHaveProperty('serverBasisId');
 });
 it.each(['ack1','origin','aggregate','hash','extra','baseline'])('retains pending work for invalid ACK2 %s',async field=>{
  const f=originFixture(),r=f.ack.financial_basis_receipt as Record<string,unknown>;
  if(field==='ack1')r.ack_version=1;if(field==='origin')delete r.openingOrigin;
  if(field==='aggregate')(r.openingOrigin as Record<string,unknown>).localAggregateId=intentId;
  if(field==='hash')(r.openingOrigin as Record<string,unknown>).rowHash='a'.repeat(64);
  if(field==='extra')(r.openingOrigin as Record<string,unknown>).extra=true;if(field==='baseline')r.serverBasisId='invented';
  await expect(f.run()).rejects.toMatchObject({code:'ESHIFT_FINANCIAL_UNCONFIRMED'});expect(f.reader.acknowledgeProtectedIntent).not.toHaveBeenCalled();
 });
 it('rejects mixed baseline/origin proofs before upload',async()=>{
  const f=originFixture();f.sidecar.proof.serverBasisId=null;await expect(f.run()).rejects.toMatchObject({code:'ESHIFT_FINANCIAL_PROOF_INVALID'});expect(f.cloud.pushAggregate).not.toHaveBeenCalled();
 });
 it('retries a lost response with the identical origin proof',async()=>{
  const f=originFixture();f.worker.retry=async(work:()=>Promise<unknown>)=>work();f.cloud.pushAggregate.mockRejectedValueOnce(Object.assign(new Error('503'),{status:503}));
  await expect(f.run()).rejects.toMatchObject({status:503});expect(f.reader.acknowledgeProtectedIntent).not.toHaveBeenCalled();expect(await f.run()).toBe(1);expect(f.cloud.pushAggregate.mock.calls[0][0]).toEqual(f.cloud.pushAggregate.mock.calls[1][0]);
 });
});
