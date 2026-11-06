import { createRequire } from 'node:module';
import { generateKeyPairSync, sign } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({rest:vi.fn(),authority:vi.fn(),caller:vi.fn()}));
vi.mock('@/core/api/pos-relay.server',()=>({serviceRest:h.rest,verifyRelayCaller:h.caller,hasServiceKey:()=>true,runRelayOp:vi.fn(),runRelayRead:vi.fn()}));
vi.mock('@/core/api/relay-policy.server',()=>({canCrossBranches:()=>false,resolveRelayScope:async()=>({kind:'terminal',storeId:'a',terminalId:'terminal-a',permissions:{},role:'terminal'})}));
vi.mock('../management-replica.server',()=>({managementReplicaScope:async()=>null}));
vi.mock('../session-verify.server',()=>({branchExists:async()=>true}));
vi.mock('../desktop-database-authority.server',()=>({databaseAuthority:h.authority}));
vi.mock('../external-supabase-config',()=>({supabaseConfig:()=>({url:'https://stock.fixture',key:'fixture'}),runtimeEnvValue:()=>undefined}));
import { handleSyncRequest } from '../sync-endpoint.server';
const require=createRequire(import.meta.url),contract=require('../../../electron/db/stock-history-contract.cjs'),protocol=require('../../../electron/security/stock-event-author-protocol.cjs');
const author='10000000-0000-4000-8000-000000000001',keyId='10000000-0000-4000-8000-000000000002',product='20000000-0000-4000-8000-000000000001';
const pair=generateKeyPairSync('ed25519'),descriptor={id:'terminal-a',branchId:'a',mode:'operations',platform:'pc'};
const at='2026-11-06T00:00:00.1234567Z';
function row(index=1){
 const operation=`30000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
 const movement=contract.changes(contract.normalizeContext({operationId:operation,branchId:'a',terminalId:'terminal-a',actorId:author,kind:'sale'},at),[{id:product,name:'Fixture',stock_by_store:{a:3}}],[{id:product,name:'Fixture',stock_by_store:{a:2}}])[0];
 const facts={version:1,algorithm:'Ed25519',keyId,projectOrigin:'https://stock.fixture',terminalId:'terminal-a',authorId:author,subject:'original-a',branchId:'a',operationId:operation,movementId:movement.id,action:'SALE',payloadHash:movement.payload_hash};
 return{id:movement.id,payloadHash:movement.payload_hash,payloadJson:movement.payload_json,authorProofJson:JSON.stringify({...facts,signature:sign(null,Buffer.from(protocol.stockEventMessage(facts)),pair.privateKey).toString('base64url')})};
}
const upload=(rows=[row()])=>({version:1,branchId:'a',terminalId:'terminal-a',rows});
const call=(batch=upload(),extra={})=>handleSyncRequest(new Request('https://pos.fixture/api/v1/pos/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({terminalToken:'terminal-a',deviceBindingProof:'a'.repeat(64),sqlServerStockHistory:batch,...extra})}));
beforeEach(()=>{
 h.caller.mockReset().mockResolvedValue({kind:'terminal',storeId:'a',terminal:descriptor});
 h.authority.mockReset().mockResolvedValue({authorId:author,subject:'original-a',branchId:'a',level:'staff',permissions:{can_process_sale:true}});
 h.rest.mockReset().mockImplementation(async(path:string,options:RequestInit)=>{
  if(path==='rpc/pos_shift_author_key')return Response.json({terminal_enrolled:true,key:{key_id:keyId,author_id:author,terminal_id:'terminal-a',project_origin:'https://stock.fixture',public_key:pair.publicKey.export({type:'spki',format:'der'}).toString('base64url'),subject:'original-a',revoked_at:null}});
  if(path==='rpc/pos_stock_history_accept_claims'){
   const input=JSON.parse(String(options.body));return Response.json({ok:true,version:1,branchId:input.p_branch,terminalId:input.p_terminal,receipts:input.p_rows.map((r:{id:string;payloadHash:string},index:number)=>({id:r.id,payloadHash:r.payloadHash,ingestedCursor:String(index+1),acceptedAt:at,effectIds:[`40000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`]}))});
  }
  throw new Error('Unexpected fixture service operation '+path);
 });
});
describe('shared authenticated relay stock-history admission composition',()=>{
 it('uses the original signed author under terminal-only background transport and deduplicates identical request reads',async()=>{
  const response=await call(upload([row(1),row(2)]));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({ok:true,receipts:[{ingestedCursor:'1'},{ingestedCursor:'2'}]});
  expect(h.authority).toHaveBeenCalledTimes(1);expect(h.authority).toHaveBeenCalledWith({appUserId:author},{strictAvailability:true});
  expect(h.rest.mock.calls.filter(([path])=>path==='rpc/pos_shift_author_key')).toHaveLength(1);
  const saved=JSON.parse(String(h.rest.mock.calls.find(([path])=>path==='rpc/pos_stock_history_accept_claims')![1].body));
  expect(saved).toMatchObject({p_project:'https://stock.fixture',p_branch:'a',p_terminal:'terminal-a',p_rows:[{authorState:{allowed:true}},{authorState:{allowed:true}}]});
  expect(saved.p_rows[0].payloadJson).toBe(row().payloadJson);
 });
 it.each(['unsigned','forged signature','Management','foreign branch','mixed business','invented authority','over row bound'])(
  'holds %s without reaching the metadata writer',async mode=>{
   const batch=upload();let extra={};
   if(mode==='unsigned')delete(batch.rows[0] as Partial<ReturnType<typeof row>>).authorProofJson;
   if(mode==='forged signature'){const proof=JSON.parse(batch.rows[0]!.authorProofJson);proof.signature='A'.repeat(86);batch.rows[0]!.authorProofJson=JSON.stringify(proof);}
   if(mode==='Management')h.caller.mockResolvedValue({kind:'terminal',storeId:null,terminal:{...descriptor,mode:'management',branchId:null}});
   if(mode==='foreign branch')batch.branchId='b';if(mode==='mixed business')extra={ops:[{kind:'insert',table:'audit_logs',rows:[]}]};
   if(mode==='invented authority')(batch.rows[0] as unknown as Record<string,unknown>).authorState={allowed:true};
   if(mode==='over row bound')batch.rows=Array.from({length:9},(_,n)=>row(n+1));
   const response=await call(batch,extra);expect(response.status).toBeGreaterThanOrEqual(400);expect(h.rest.mock.calls.some(([path])=>path==='rpc/pos_stock_history_accept_claims')).toBe(false);
  });
 it('sends false current authority only for SQL to decide exact accepted-receipt replay; never substitutes the uploader',async()=>{
  h.authority.mockResolvedValue({authorId:author,subject:'original-a',branchId:'a',level:'staff',permissions:{}});
  expect((await call()).status).toBe(200);
  const input=JSON.parse(String(h.rest.mock.calls.find(([path])=>path==='rpc/pos_stock_history_accept_claims')![1].body));expect(input.p_rows[0].authorState.allowed).toBe(false);
 });
 it('reports unsupported source-origin evidence as retained work, not an accepted HTTP success',async()=>{
  const delegate=h.rest.getMockImplementation()!;h.rest.mockImplementation(async(path:string,options:RequestInit)=>path==='rpc/pos_stock_history_accept_claims'?Response.json({message:'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN'},{status:409}):delegate(path,options));
  const response=await call();expect(response.status).toBe(409);expect(await response.json()).toMatchObject({ok:false,code:'STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN'});
 });
 it('requires complete exact receipts instead of accepting a generic HTTP200',async()=>{
  const delegate=h.rest.getMockImplementation()!;h.rest.mockImplementation(async(path:string,options:RequestInit)=>path==='rpc/pos_stock_history_accept_claims'?Response.json({ok:true}):delegate(path,options));
  const response=await call();expect(response.status).toBe(503);expect(await response.json()).toMatchObject({ok:false,code:'ESTOCK_HISTORY_ACK_UNCONFIRMED'});
 });
});
