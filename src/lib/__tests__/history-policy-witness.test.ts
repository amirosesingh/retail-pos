import {describe,expect,it,vi} from 'vitest';
const {createHistoryPolicyRun,assertHistoryPolicy}=require('../../../electron/sync/history-read-scope.cjs');
const {PROJECTION}=require('../../../electron/sync/history-index-protocol.cjs');
const id=(n:number)=>'aaaaaaaa-aaaa-4aaa-8aaa-'+String(n).padStart(12,'0'),branch=id(1),terminal=id(2);
function fixture(){
 const cm={pool:{}},state={ordinary:'a'.repeat(64),authority:'b'.repeat(64),mode:'operations',branch,privacy:false};
 const cloud={terminalId:()=>terminal,terminalStore:{read:()=>({tokenId:terminal,deviceUse:state.mode,locationId:state.branch})},requestContext:(governance=false)=>({pool:cm.pool,fingerprint:governance?state.authority:state.ordinary}),
  historyIndex:vi.fn(async()=>({protocol:'history-index-v2',policy:'branch-history-v1',history_scope:'branch',projection:PROJECTION,organization_id:'default',branch_id:branch,terminal_id:terminal,keep_commerce:state.privacy,action:'begin',upper_id:id(3),after_id:null,ids:[id(3)],next_id:null,complete:true,range_count:null}))};
 const run=()=>createHistoryPolicyRun({cloud,connectionManager:cm,branchId:branch});
 return{cm,state,cloud,run};
}
describe('private per-invocation history policy witness',()=>{
 it('makes one bounded admission and retains only scope/privacy, never snapshot IDs/counts or upper bound',async()=>{
  const f=fixture(),run=f.run(),one=await run.get(),two=await run.get();expect(one).toBe(two);expect(f.cloud.historyIndex).toHaveBeenCalledOnce();
  expect(Object.keys(one).sort()).toEqual(['keepCommerce','scope']);expect(one).not.toHaveProperty('upper_id');expect(one).not.toHaveProperty('ids');expect(one).not.toHaveProperty('range_count');
  expect(()=>assertHistoryPolicy(one,f.cloud,f.cm)).not.toThrow();
 });
 it('does not reuse the previous invocation admission or index snapshot',async()=>{
  const f=fixture();await f.run().get();await f.run().get();expect(f.cloud.historyIndex).toHaveBeenCalledTimes(2);
 });
 it.each(['history-index-v1','history-index-v3'])('rejects unsupported %s even if no rows need downloading',async protocol=>{
  const f=fixture(),reply=await f.cloud.historyIndex();f.cloud.historyIndex.mockResolvedValue({...reply,protocol});await expect(f.run().get()).rejects.toMatchObject({code:'EHISTORY_INDEX_PROTOCOL'});
 });
 it.each(['policy','history_scope','organization_id','branch_id','terminal_id','projection'])('rejects an incorrect %s marker',async field=>{
  const f=fixture(),reply=await f.cloud.historyIndex();f.cloud.historyIndex.mockResolvedValue({...reply,[field]:'untrusted'});await expect(f.run().get()).rejects.toMatchObject({code:'EHISTORY_INDEX_PROTOCOL'});
 });
 it('cannot be minted by a renderer-shaped object or copied from a real proof',async()=>{
  const f=fixture(),real=await f.run().get();expect(()=>assertHistoryPolicy({...real},f.cloud,f.cm)).toThrow();expect(()=>assertHistoryPolicy({scope:real.scope,keepCommerce:false},f.cloud,f.cm)).toThrow();
 });
 it.each(['ordinary','authority'] as const)('fails the entire invocation when %s identity changes, even if restored later',async key=>{
  const f=fixture(),run=f.run(),proof=await run.get(),old=f.state[key];f.state[key]='c'.repeat(64);await expect(run.get()).rejects.toMatchObject({code:'ESYNC_REQUEST_CONTEXT_CHANGED'});f.state[key]=old;
  await expect(run.get()).rejects.toMatchObject({code:'ESYNC_REQUEST_CONTEXT_CHANGED'});expect(()=>assertHistoryPolicy(proof,f.cloud,f.cm)).toThrow();expect(f.cloud.historyIndex).toHaveBeenCalledOnce();
 });
 it('invalidates on a failed page before retry admission, without reusing its old privacy proof',async()=>{
  const f=fixture(),run=f.run(),proof=await run.get();run.invalidate();expect(()=>assertHistoryPolicy(proof,f.cloud,f.cm)).toThrow();f.state.privacy=true;const later=await run.get();expect(later.keepCommerce).toBe(true);expect(f.cloud.historyIndex).toHaveBeenCalledTimes(2);
 });
 it('never caches an old-server refusal as successful policy admission',async()=>{
  const f=fixture(),run=f.run();f.cloud.historyIndex.mockRejectedValueOnce(Object.assign(Error('old server'),{status:400,code:'INVALID_REQUEST'}));await expect(run.get()).rejects.toMatchObject({status:400});await expect(run.get()).resolves.toHaveProperty('keepCommerce',false);expect(f.cloud.historyIndex).toHaveBeenCalledTimes(2);
 });
 it('cannot mint a late witness after the in-flight admission was invalidated',async()=>{
  const f=fixture(),reply=await f.cloud.historyIndex();let finish!:(value:typeof reply)=>void;f.cloud.historyIndex.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const run=f.run(),pending=run.get();run.invalidate();finish(reply);await expect(pending).rejects.toMatchObject({code:'EHISTORY_INDEX_SCOPE'});
  await expect(run.get()).resolves.toHaveProperty('keepCommerce',false);
 });
});
