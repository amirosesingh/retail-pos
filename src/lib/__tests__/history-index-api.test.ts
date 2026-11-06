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
let mode:'operations'|'management',active:boolean,registryStatus:number,unavailable:boolean,omitHeader:boolean;
const calls: Array<{name:string;args:Record<string,unknown>}>=[];
const row=()=>({id,organization_id:'default',entity_type:'products',entity_id:'{"number":9007199254740993}',action:'insert',old_value_json:null,new_value_json:'{"number":9007199254740993}',revision:'9007199254740993',scope_type:'GLOBAL',scope_id:null,changed_by:null,source_application:'fixture',device_id:null,terminal_id:null,server_timestamp:'2026-11-06T01:02:03.1234560Z'});
function protectedResponse(value:unknown,kind:string,count:number){const text=JSON.stringify(value);return new Response(text,{headers:{'content-type':'application/json',...(!omitHeader?{'X-POS-History-Reconcile-Version':'1','X-POS-History-Reconcile-Kind':kind,'X-POS-History-Reconcile-Bytes':String(Buffer.byteLength(text)),'X-POS-History-Reconcile-Rows':String(count)}:{})}});}
function client(proof=binding){return new CloudClient({configStore:{get:()=> 'https://pos.test'},terminalStore:{read:()=>({tokenId:terminal,deviceUse:mode,deviceBindingProof:proof,deviceClaimProof:secret,...(mode==='operations'?{locationId:branch}:{})})}});}
beforeEach(()=>{
 mode='operations';active=true;registryStatus=200;unavailable=false;omitHeader=false;calls.length=0;
 vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
  if(url.startsWith('https://pos.test/'))return handleSyncRequest(new Request(url,options));
  if(url.includes('/terminal_tokens?'))return Response.json([{id:terminal,platform:'pc',location_id:mode==='management'?null:branch,status:active?'used':'revoked',is_claimed:true,revoked_at:null,claimed_proof_hash:binding,claim_proof:binding,management_sync_enabled:mode==='management',management_sync_proof_hash:createHash('sha256').update(secret).digest('hex')}],{status:registryStatus});
  if(url.includes('/stores?'))return Response.json([{id:branch}]);
  if(url.includes('/rpc/')){
   if(unavailable)throw Object.assign(Error('synthetic transport unavailable'),{code:'EAI_AGAIN'});
   const args=JSON.parse(String(options?.body)),name=url.split('/rpc/')[1];calls.push({name,args});
   const common={projection:PROJECTION,organization_id:args.p_organization_id,branch_id:args.p_branch_id,terminal_id:args.p_terminal_id,keep_commerce:args.p_keep_commerce};
   if(name==='pos_sync_history_index_v1')return protectedResponse({...common,protocol:INDEX,action:args.p_action,upper_id:args.p_upper_id??id,after_id:args.p_after_id,ids:args.p_action==='finish'?[]:[id],next_id:null,complete:true,range_count:args.p_action==='finish'?'1':null},'index',args.p_action==='finish'?0:1);
   if(name==='pos_sync_history_rows_v1')return protectedResponse({...common,protocol:ROWS,requested_ids:args.p_ids,rows:[row()],remaining_ids:[]},'rows',1);
  }
  throw Error('Unexpected isolated request');
 }));
});
afterEach(()=>vi.unstubAllGlobals());
describe('actual native history reads through the existing guarded relay',()=>{
 it('uses the sealed activation and trusted server privacy, preserving lossless wire text',async()=>{
  const cloud=client(),p=await cloud.historyIndex({branchId:branch});expect(p.ids).toEqual([id]);expect(p.keep_commerce).toBe(false);
  const b=await cloud.historyMissingRows({branchId:branch,ids:[id],keepCommerce:p.keep_commerce});expect(b.rows[0]).toEqual(row());
  expect(calls.map(x=>x.name)).toEqual(['pos_sync_history_index_v1','pos_sync_history_rows_v1']);expect(calls.every(x=>x.args.p_terminal_id===terminal&&x.args.p_branch_id===branch&&x.args.p_keep_commerce===false)).toBe(true);
 });
 it('denies another branch even on a registered normal terminal',async()=>{await expect(client().historyIndex({branchId:other})).rejects.toMatchObject({status:403,code:'STORE_FORBIDDEN'});expect(calls).toHaveLength(0);});
 it('retains wrong-proof, revoked-terminal and registry-outage denials',async()=>{await expect(client('c'.repeat(64)).historyIndex({branchId:branch})).rejects.toMatchObject({status:401});active=false;await expect(client().historyIndex({branchId:branch})).rejects.toMatchObject({status:401});active=true;registryStatus=503;await expect(client().historyIndex({branchId:branch})).rejects.toMatchObject({status:503,code:'SERVICE_UNAVAILABLE'});expect(calls).toHaveLength(0);});
 it('admits the existing verified Management read scope without staff/write authority',async()=>{mode='management';const p=await client().historyIndex({branchId:other});expect(p.branch_id).toBe(other);expect(p.keep_commerce).toBe(true);expect(calls[0].args.p_keep_commerce).toBe(true);});
 it('rejects a supplied privacy flag or mixed write before any RPC',async()=>{for(const extra of [{sqlServerHistoryReconcile:{action:'begin',organizationId:'default',branchId:branch,keepCommerce:true}},{ops:[{kind:'delete',table:'products',match:{id}}]}]){const response=await handleSyncRequest(new Request('https://pos.test/api/v1/pos/sync',{method:'POST',body:JSON.stringify({terminalToken:terminal,deviceBindingProof:binding,sqlServerHistoryReconcile:{action:'begin',organizationId:'default',branchId:branch},...extra})}));expect(response.status).toBe(400);}expect(calls).toHaveLength(0);});
 it('does not fall back or invent authorization when the RPC transport fails',async()=>{unavailable=true;await expect(client().historyIndex({branchId:branch})).rejects.toMatchObject({status:503,code:'SERVICE_UNAVAILABLE'});expect(calls).toHaveLength(0);});
 it('refuses an unattested success without accepting history progress',async()=>{omitHeader=true;await expect(client().historyIndex({branchId:branch})).rejects.toMatchObject({status:502,code:'EHISTORY_INDEX_PROTOCOL'});});
});
