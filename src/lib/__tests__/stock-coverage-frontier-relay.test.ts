import{createRequire}from'node:module';
import{createHash,generateKeyPairSync,sign}from'node:crypto';
import{beforeEach,describe,it,expect,vi}from'vitest';
import{stockCoverageFrontierJson}from'../../../electron/shared/stock-coverage-frontier.mjs';
const h=vi.hoisted(()=>({rest:vi.fn(),authority:vi.fn(),caller:vi.fn()}));
vi.mock('@/core/api/pos-relay.server',()=>({serviceRest:h.rest,verifyRelayCaller:h.caller,hasServiceKey:()=>true,runRelayOp:vi.fn(),runRelayRead:vi.fn()}));
vi.mock('@/core/api/relay-policy.server',()=>({canCrossBranches:()=>false,resolveRelayScope:async()=>({kind:'terminal',storeId:'a',terminalId:'t',permissions:{},role:'terminal'})}));
vi.mock('../management-replica.server',()=>({managementReplicaScope:async()=>null}));
vi.mock('../session-verify.server',()=>({branchExists:async()=>true}));
vi.mock('../desktop-database-authority.server',()=>({databaseAuthority:h.authority}));
vi.mock('../external-supabase-config',()=>({supabaseConfig:()=>({url:'https://stock.fixture',key:'fixture'}),runtimeEnvValue:()=>undefined}));
import{handleSyncRequest}from'../sync-endpoint.server';
const require=createRequire(import.meta.url),protocol=require('../../../electron/security/stock-event-author-protocol.cjs'),pair=generateKeyPairSync('ed25519');
const author='11111111-1111-4111-8111-111111111111',key='22222222-2222-4222-8222-222222222222',challenge='33333333-3333-4333-8333-333333333333',database='44444444-4444-4444-8444-444444444444';
const issued='2026-11-06T00:00:00.1234567Z',expires='2026-11-06T00:05:00.1234567Z',descriptor={id:'t',branchId:'a',mode:'operations',platform:'pc'};
function accepted(unknown='0'){
 const frontierJson=stockCoverageFrontierJson({version:1,projectOrigin:'https://stock.fixture',branchId:'a',terminalId:'t',authorId:author,databaseId:database,challengeId:challenge,
  nonce:'A'.repeat(43),cohortHash:'b'.repeat(64),writerRevision:'stock-history-source.v1',sourceSequence:'0',sourceRoot:null,sourceGeneration:'c'.repeat(64),gapHash:'d'.repeat(64),
  pending:{business:'0',metadata:'0',unsigned:'0',unknown},observedAt:issued});
 const fields={version:1,algorithm:'Ed25519',keyId:key,projectOrigin:'https://stock.fixture',terminalId:'t',authorId:author,subject:'cashier',branchId:'a',challengeId:challenge,
  frontierHash:createHash('sha256').update(frontierJson).digest('hex')};
 return{version:1,action:'accept',branchId:'a',terminalId:'t',frontierJson,proofJson:JSON.stringify({...fields,signature:sign(null,Buffer.from(protocol.stockCoverageFrontierMessage(fields)),pair.privateKey).toString('base64url')})};
}
const requestChallenge=()=>({version:1,action:'challenge',branchId:'a',terminalId:'t',challengeId:challenge,authorId:author,keyId:key});
const call=(operation:unknown=accepted(),extra={})=>handleSyncRequest(new Request('https://pos.fixture/api/v1/pos/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({terminalToken:'t',deviceBindingProof:'a'.repeat(64),sqlServerStockFrontier:operation,...extra})}));
beforeEach(()=>{
 h.caller.mockReset().mockResolvedValue({kind:'terminal',storeId:'a',terminal:descriptor});
 h.authority.mockReset().mockResolvedValue({authorId:author,subject:'cashier',branchId:'a',level:'staff',permissions:{can_process_sale:true}});
 h.rest.mockReset().mockImplementation(async(path:string,options:RequestInit)=>{
  if(path==='rpc/pos_shift_author_key')return Response.json({terminal_enrolled:true,key:{key_id:key,author_id:author,terminal_id:'t',project_origin:'https://stock.fixture',subject:'cashier',public_key:pair.publicKey.export({type:'spki',format:'der'}).toString('base64url'),revoked_at:null}});
  const input=JSON.parse(String(options.body));
  if(path==='rpc/pos_stock_history_frontier_challenge')return Response.json({challengeId:input.p_id,nonce:'A'.repeat(43),cohortHash:'b'.repeat(64),issuedAt:issued,expiresAt:expires});
  if(path==='rpc/pos_stock_history_accept_frontier')return Response.json({challengeId:JSON.parse(input.p_frontier_json).challengeId,frontierHash:createHash('sha256').update(input.p_frontier_json).digest('hex'),state:'accepted',reasons:[],acceptedAt:issued,observationGrade:'author_claimed'});
  throw Error('Unexpected service route');
 });
});
describe('same authenticated native relay for stock frontier metadata',()=>{
 it('routes a bounded challenge without adding a report/stock write entitlement',async()=>{
  const result=await call(requestChallenge());expect(result.status).toBe(200);expect(await result.json()).toMatchObject({ok:true,challenge:{challengeId:challenge,nonce:'A'.repeat(43)}});
  expect(h.authority).not.toHaveBeenCalled();expect(h.rest).toHaveBeenCalledTimes(1);
 });
 it('verifies a real original enrolled signature/current account before sending exact bytes to service SQL',async()=>{
  const input=accepted(),result=await call(input);expect(result.status).toBe(200);expect(await result.json()).toMatchObject({ok:true,receipt:{state:'accepted',observationGrade:'author_claimed'}});
  const operation=h.rest.mock.calls.find(([path])=>path==='rpc/pos_stock_history_accept_frontier')!;expect(JSON.parse(operation[1].body)).toMatchObject({p_frontier_json:input.frontierJson,p_proof_json:input.proofJson,p_author_verified:true,p_branch:'a',p_terminal:'t'});
 });
 it.each(['branch','terminal','hash','signature','noncanonical','author'])('rejects substituted %s before source receipt creation',async mode=>{
  const input=accepted();if(mode==='branch')input.branchId='A';if(mode==='terminal')input.terminalId='T';
  if(mode==='hash')input.frontierJson=input.frontierJson.replace('"business":"0"','"business":"1"');
  if(mode==='signature'){const proof=JSON.parse(input.proofJson);proof.signature='A'.repeat(86);input.proofJson=JSON.stringify(proof);}
  if(mode==='noncanonical')input.frontierJson=' '+input.frontierJson;if(mode==='author')h.authority.mockResolvedValue({authorId:author,subject:'other',branchId:'a',permissions:{}});
  expect((await call(input)).status).toBeGreaterThanOrEqual(400);expect(h.rest.mock.calls.some(([path])=>path==='rpc/pos_stock_history_accept_frontier')).toBe(false);
 });
 it('refuses management/mobile/browser callers and mixed or unknown transport fields',async()=>{
  for(const terminal of[{...descriptor,mode:'management'},{...descriptor,platform:'mobile'},null]){
   h.caller.mockResolvedValue({kind:terminal?'terminal':'session',storeId:'a',terminal});expect((await call()).status).toBeGreaterThanOrEqual(400);
  }
  h.caller.mockResolvedValue({kind:'terminal',storeId:'a',terminal:descriptor});expect((await call(accepted(),{sqlServerCounts:{branchId:'a'}})).status).toBe(400);
  expect((await call({...accepted(),authorVerified:true})).status).toBe(400);
 });
 it('preserves a registry/network503 and rejects a substituted receipt instead of claiming coverage',async()=>{
  h.rest.mockRejectedValueOnce(Error('Unavailable registry'));expect((await call()).status).toBe(503);
  h.rest.mockResolvedValue(Response.json({challengeId:database,nonce:'A'.repeat(43),cohortHash:'b'.repeat(64),issuedAt:issued,expiresAt:expires}));
  expect((await call(requestChallenge())).status).toBe(503);
 });
 it('refuses an accepted response that contradicts the original pending observation',async()=>{expect((await call(accepted('1'))).status).toBe(503);});
});
