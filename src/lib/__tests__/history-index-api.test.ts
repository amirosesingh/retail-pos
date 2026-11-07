import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
vi.mock('../external-supabase-config',()=>({runtimeEnvValue:()=> 'test-service',supabaseConfig:()=>({url:'https://cloud.test',key:'test-public'})}));
vi.mock('../commerce-sync-readiness.server',()=>({commerceSyncIsolationReady:async()=>true}));
import {handleSyncRequest} from '../sync-endpoint.server';
const require=createRequire(import.meta.url),{CloudClient}=require('../../../electron/sync/cloud-client.cjs');
const {INDEX,ROWS,PROJECTION}=require('../../../electron/sync/history-index-protocol.cjs');
const terminal='00000000-0000-4000-8000-000000000001',branch='00000000-0000-4000-8000-00000000000a',other='00000000-0000-4000-8000-00000000000b';
const id='aaaaaaaa-aaaa-4aaa-8aaa-000000000001',binding='a'.repeat(64),secret='b'.repeat(64);
let mode:'operations'|'management',active:boolean,registryStatus:number,unavailable:boolean,omitHeader:boolean,wrongScope:boolean,unscopedRow:boolean,wrongVersion:boolean;
let historyFailure:(()=>Response)|null;
const missingIndex={code:'PGRST202',message:'Could not find the function public.pos_sync_history_index_v3(p_action, p_after_id, p_branch_id, p_keep_commerce, p_limit, p_organization_id, p_terminal_id, p_upper_id) in the schema cache',details:null,hint:'Perhaps you meant to call the function public.pos_sync_history_index_v1'};
const calls: Array<{name:string;args:Record<string,unknown>}>=[];
const row=()=>({id,organization_id:'default',entity_type:'products',entity_id:'{"number":9007199254740993}',action:'insert',old_value_json:null,new_value_json:'{"number":9007199254740993}',revision:'9007199254740993',scope_type:mode==='management'||unscopedRow?'GLOBAL':'BRANCH',scope_id:mode==='management'||unscopedRow?null:branch,changed_by:null,source_application:'fixture',device_id:null,terminal_id:null,server_timestamp:'2026-11-06T01:02:03.1234560Z'});
function protectedResponse(value:unknown,kind:string,count:number,version='2'){const text=JSON.stringify(value);return new Response(text,{headers:{'content-type':'application/json',...(!omitHeader?{'X-POS-History-Reconcile-Version':wrongVersion?'1':version,'X-POS-History-Reconcile-Kind':kind,'X-POS-History-Reconcile-Bytes':String(Buffer.byteLength(text)),'X-POS-History-Reconcile-Rows':String(count)}:{})}});}
function client(proof=binding){return new CloudClient({connectionManager:{pool:{},profile:{database:'isolated_api_fixture'}},configStore:{get:()=> 'https://pos.test'},terminalStore:{read:()=>({tokenId:terminal,deviceUse:mode,deviceBindingProof:proof,deviceClaimProof:secret,...(mode==='operations'?{locationId:branch}:{})})}});}
beforeEach(()=>{
 mode='operations';active=true;registryStatus=200;unavailable=false;omitHeader=false;wrongScope=false;unscopedRow=false;wrongVersion=false;historyFailure=null;calls.length=0;
 vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
  if(url.startsWith('https://pos.test/'))return handleSyncRequest(new Request(url,options));
  if(url.includes('/terminal_tokens?'))return Response.json([{id:terminal,platform:'pc',location_id:mode==='management'?null:branch,status:active?'used':'revoked',is_claimed:true,revoked_at:null,claimed_proof_hash:binding,claim_proof:binding,management_sync_enabled:mode==='management',management_sync_proof_hash:createHash('sha256').update(secret).digest('hex')}],{status:registryStatus});
  if(url.includes('/stores?'))return Response.json([{id:branch},{id:other}]);
  if(url.includes('/rpc/')){
   if(unavailable)throw Object.assign(Error('synthetic transport unavailable'),{code:'EAI_AGAIN'});
   const args=JSON.parse(String(options?.body)),name=url.split('/rpc/')[1];calls.push({name,args});
   if(name==='pos_sync_history_index_v2')return Response.json({...missingIndex,message:missingIndex.message.replace('index_v3','index_v2')},{status:404});
   if(name==='pos_sync_history_index_v3'&&historyFailure)return historyFailure();
   const version=name.endsWith('_v1')?'1':'2';
   const common={projection:PROJECTION,...(version==='2'?{policy:'branch-history-v1',history_scope:wrongScope?'company':mode==='management'?'company':'branch'}:{}),organization_id:args.p_organization_id,branch_id:args.p_branch_id,terminal_id:args.p_terminal_id,keep_commerce:args.p_keep_commerce};
   if(name.startsWith('pos_sync_history_index_v'))return protectedResponse({...common,protocol:version==='2'?INDEX:'history-index-v1',action:args.p_action,upper_id:args.p_upper_id??id,after_id:args.p_after_id,ids:args.p_action==='finish'?[]:[id],next_id:null,complete:true,range_count:args.p_action==='finish'?'1':null},'index',args.p_action==='finish'?0:1,version);
   if(name.startsWith('pos_sync_history_rows_v'))return protectedResponse({...common,protocol:version==='2'?ROWS:'history-rows-v1',requested_ids:args.p_ids,rows:[row()],remaining_ids:[]},'rows',1,version);
  }
  throw Error('Unexpected isolated request');
 }));
});
afterEach(()=>vi.unstubAllGlobals());
describe('actual native history reads through the existing guarded relay',()=>{
 it('uses the sealed activation and trusted server privacy, preserving lossless wire text',async()=>{
  const cloud=client(),p=await cloud.historyIndex({branchId:branch});expect(p.ids).toEqual([id]);expect(p.keep_commerce).toBe(false);
  const b=await cloud.historyMissingRows({branchId:branch,ids:[id],keepCommerce:p.keep_commerce});expect(b.rows[0]).toEqual(row());
  expect(calls.map(x=>x.name)).toEqual(['pos_sync_history_index_v3','pos_sync_history_rows_v3']);expect(calls.every(x=>x.args.p_terminal_id===terminal&&x.args.p_branch_id===branch&&x.args.p_keep_commerce===false)).toBe(true);
 });
 it('denies another branch in Main and in a direct signed request',async()=>{
  await expect(client().historyIndex({branchId:other})).rejects.toMatchObject({code:'EHISTORY_INDEX_SCOPE'});expect(calls).toHaveLength(0);
  const response=await handleSyncRequest(new Request('https://pos.test/api/v1/pos/sync',{method:'POST',body:JSON.stringify({terminalToken:terminal,deviceBindingProof:binding,sqlServerScopedHistory:{action:'begin',organizationId:'default',branchId:other}})}));
  expect(response.status).toBe(403);expect(await response.json()).toMatchObject({code:'STORE_FORBIDDEN'});expect(calls).toHaveLength(0);
 });
 it('retains wrong-proof, revoked-terminal and registry-outage denials',async()=>{await expect(client('c'.repeat(64)).historyIndex({branchId:branch})).rejects.toMatchObject({status:401});active=false;await expect(client().historyIndex({branchId:branch})).rejects.toMatchObject({status:401});active=true;registryStatus=503;await expect(client().historyIndex({branchId:branch})).rejects.toMatchObject({status:503,code:'SERVICE_UNAVAILABLE'});expect(calls).toHaveLength(0);});
 it('admits the existing verified Management read scope without staff/write authority',async()=>{mode='management';const cloud=client();await cloud.managementBranches();const p=await cloud.historyIndex({branchId:other});expect(p.branch_id).toBe(other);expect(p.keep_commerce).toBe(true);expect(calls[0].args.p_keep_commerce).toBe(true);});
 it('rejects a supplied privacy flag or mixed write before any RPC',async()=>{for(const extra of [{sqlServerHistoryReconcile:{action:'begin',organizationId:'default',branchId:branch,keepCommerce:true}},{ops:[{kind:'delete',table:'products',match:{id}}]}]){const response=await handleSyncRequest(new Request('https://pos.test/api/v1/pos/sync',{method:'POST',body:JSON.stringify({terminalToken:terminal,deviceBindingProof:binding,sqlServerHistoryReconcile:{action:'begin',organizationId:'default',branchId:branch},...extra})}));expect(response.status).toBe(400);}expect(calls).toHaveLength(0);});
 it('does not fall back or invent authorization when the RPC transport fails',async()=>{unavailable=true;await expect(client().historyIndex({branchId:branch})).rejects.toMatchObject({status:503,code:'SERVICE_UNAVAILABLE'});expect(calls).toHaveLength(0);});
 it('recognizes only the scoped begin absence and never requests the old raw snapshot',async()=>{
  historyFailure=()=>Response.json(missingIndex,{status:404});const cloud=client();
  const failure=await cloud.bootstrapPage({branchId:branch,table:'change_history',historyDays:90,cursor:null,limit:10}).catch((error:unknown)=>error);
  expect(failure).toMatchObject({code:'EHISTORY_POLICY_UNAVAILABLE',status:409,table:'change_history'});
  expect(cloud.isHistoryPolicyUnavailable(failure,branch)).toBe(true);
  expect(cloud.isHistoryPolicyUnavailable(failure,other)).toBe(false);
  expect(cloud.isHistoryPolicyUnavailable({...failure},branch)).toBe(false);
  cloud.setAuthorizationProof({staffSessionToken:'changed-fixture-operator'});
  expect(cloud.isHistoryPolicyUnavailable(failure,branch)).toBe(false);
  await expect(cloud.historyIndex({branchId:branch,action:'page',afterId:id,upperId:id})).rejects.toMatchObject({status:404,code:'PGRST202'});
  expect(calls.map(call=>[call.name,call.args.p_action])).toEqual([['pos_sync_history_index_v3','begin'],['pos_sync_history_index_v3','page']]);
  historyFailure=null;expect((await cloud.historyIndex({branchId:branch})).ids).toEqual([id]);
 });
 it.each([
  [404,{...missingIndex,message:'Could not find the function public.pos_sync_history_rows_v3 in the schema cache'},'PGRST202'],
  [404,{...missingIndex,hint:'Perhaps you meant to call the function public.pos_sync_history_index_v3'},'PGRST202'],
  [503,missingIndex,'PGRST202'],[403,{code:'42501'},'42501'],[409,{code:'EHISTORY_POLICY_UNAVAILABLE'},'EHISTORY_INDEX_PROTOCOL'],
 ] as const)('preserves unrelated or ambiguous refusal %s with code %s',async(status,value,code)=>{
  historyFailure=()=>Response.json(value,{status});const cloud=client(),error=await cloud.historyIndex({branchId:branch}).catch((failure:unknown)=>failure);
  expect(error).toMatchObject({status,code});expect(cloud.isHistoryPolicyUnavailable(error,branch)).toBe(false);
 });
 it('refuses an unattested success without accepting history progress',async()=>{omitHeader=true;await expect(client().historyIndex({branchId:branch})).rejects.toMatchObject({status:502,code:'EHISTORY_INDEX_PROTOCOL'});});
 it('keeps legacy v1 request/response shape while routing updated clients to the separate scoped RPC',async()=>{
  const response=await handleSyncRequest(new Request('https://pos.test/api/v1/pos/sync',{method:'POST',body:JSON.stringify({terminalToken:terminal,deviceBindingProof:binding,sqlServerHistoryReconcile:{action:'begin',organizationId:'default',branchId:branch}})}));
  expect(response.status).toBe(200);const legacy=await response.json();expect(legacy.protocol).toBe('history-index-v1');expect(legacy).not.toHaveProperty('policy');expect(calls[0].name).toBe('pos_sync_history_index_v1');
  await client().historyIndex({branchId:branch});expect(calls[1].name).toBe('pos_sync_history_index_v3');
 });
 it('keeps an unchanged 1.4.83 admission pending while the separate scoped transport succeeds',async()=>{
  const response=await handleSyncRequest(new Request('https://pos.test/api/v1/pos/sync',{method:'POST',body:JSON.stringify({terminalToken:terminal,deviceBindingProof:binding,sqlServerHistoryReconcile:{action:'begin',accessPolicy:'branch-history-v1',organizationId:'default',branchId:branch}})}));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({code:'EHISTORY_POLICY_UNAVAILABLE',terminal_id:terminal});
  expect((await client().historyIndex({branchId:branch})).ids).toEqual([id]);
  expect(calls.map(call=>call.name)).toEqual(['pos_sync_history_index_v2','pos_sync_history_index_v3']);
 });
 it('rejects policy forgery, wrong attestation version and company-scope substitution without fallback',async()=>{
  const forged=await handleSyncRequest(new Request('https://pos.test/api/v1/pos/sync',{method:'POST',body:JSON.stringify({terminalToken:terminal,deviceBindingProof:binding,sqlServerHistoryReconcile:{action:'begin',accessPolicy:'all-company',organizationId:'default',branchId:branch}})}));
  expect(forged.status).toBe(400);expect(calls).toHaveLength(0);
  wrongVersion=true;await expect(client().historyIndex({branchId:branch})).rejects.toMatchObject({status:502,code:'EHISTORY_INDEX_PROTOCOL'});
  wrongVersion=false;wrongScope=true;await expect(client().historyIndex({branchId:branch})).rejects.toMatchObject({code:'EHISTORY_INDEX_PROTOCOL'});
  expect(calls.every(call=>call.name==='pos_sync_history_index_v3')).toBe(true);
 });
 it('refuses out-of-branch row payloads even with a valid branch v2 envelope',async()=>{
  unscopedRow=true;await expect(client().historyMissingRows({branchId:branch,ids:[id],keepCommerce:false})).rejects.toMatchObject({code:'EHISTORY_INDEX_PROTOCOL'});
 });
});
