import {describe,it,expect,vi,afterEach} from 'vitest';
const {runBootstrap,refreshTable}=require('../../../electron/jobs/bootstrap.cjs');
const {HistoryIndexStore}=require('../../../electron/sync/history-index-recovery.cjs');
const {CloudClient}=require('../../../electron/sync/cloud-client.cjs');
const {PROJECTION}=require('../../../electron/sync/history-index-protocol.cjs');
const {createHash}=require('node:crypto');
const id=(n:number)=>'aaaaaaaa-aaaa-4aaa-8aaa-'+String(n).padStart(12,'0'),branch=id(9000),terminal=id(9001);
function fixture(){
 let state={rows:new Map<string,any>(),pending:new Set<string>(),job:{dependency_index:0,last_committed_cursor:null,completed_rows:0,batch_number:0}},inTransaction=false,failCheckpoint=false;
 const table={cloudTable:'change_history',sqlServerTable:'change_history',dependencyOrder:0,columns:[{cloudColumn:'id',sqlServerColumn:'id',primaryKey:true}]},registry={tables:[table]};
 const exact={id:id(1),organization_id:'default',entity_type:'fixture',entity_id:'1',action:'insert',old_value_json:null,new_value_json:'{"exact":9007199254740993.1234567}',revision:'9007199254740993',scope_type:'BRANCH',scope_id:branch,changed_by:null,source_application:'fixture',device_id:null,terminal_id:null,server_timestamp:'2026-11-06T01:02:03.1234567Z'};
 const raw={...exact,revision:9007199254740992,new_value:{exact:9007199254740994},old_value:null};
 const cm:any={pool:{request:()=>({query:async()=>({recordset:[{current_version:12}]})})}};
 class Transaction{state:any;async begin(){inTransaction=true;this.state=structuredClone(state);}async commit(){state=this.state;inTransaction=false;}async rollback(){inTransaction=false;}}
 cm.sql=()=>({Transaction,ISOLATION_LEVEL:{SERIALIZABLE:4}});
 const store={guid:async()=>id(9999),present:async(ids:string[],tx?:any)=>new Set(ids.filter(value=>(tx?.state??state).rows.has(value))),pending:async(tx:any)=>new Set(tx.state.pending),insert:async(tx:any,row:any)=>tx.state.rows.set(row.id,structuredClone(row))};
 for(const key of ['guid','present','pending','insert'] as const)vi.spyOn(HistoryIndexStore.prototype,key).mockImplementation((...args:any[])=>Reflect.apply(store[key],store,args));
 const common={projection:PROJECTION,policy:'branch-history-v1',history_scope:'branch',organization_id:'default',branch_id:branch,terminal_id:terminal,keep_commerce:false};
 const cloud={terminalId:()=>terminal,terminalStore:{read:()=>({tokenId:terminal,deviceUse:'operations',locationId:branch})},requestContext:()=>({pool:cm.pool,fingerprint:createHash('sha256').update('scope').digest('hex')}),
  bootstrapPage:vi.fn(async()=>{expect(inTransaction).toBe(false);return{rows:[raw],cursor:null as string|null};}),
  historyIndex:vi.fn(async()=>{expect(inTransaction).toBe(false);return{...common,protocol:'history-index-v2',action:'begin',upper_id:exact.id,after_id:null,ids:[exact.id],next_id:null,complete:true,range_count:null};}),
  historyMissingRows:vi.fn(async()=>{expect(inTransaction).toBe(false);return{...common,protocol:'history-rows-v2',requested_ids:[exact.id],rows:[exact],remaining_ids:[]};}),
  applyLocalBatch:vi.fn(async()=>{throw Error('generic MERGE must not receive history');})};
 const checkpoints={save:vi.fn()},context=()=>({job:structuredClone(state.job),waitWhilePaused:async()=>{},checkpoint:async(patch:any,tx?:any)=>{if(tx&&failCheckpoint)throw Error('owned checkpoint failure');Object.assign((tx?.state??state).job,patch);}});
 return{cm,cloud,registry,table,exact,raw,checkpoints,get state(){return state;},failCheckpoint:()=>failCheckpoint=true,
  run:()=>runBootstrap({cloud,connectionManager:cm,registry,branchId:branch,checkpoints,context:context(),reader:{unacknowledged:async()=>[]}}),
  refresh:()=>refreshTable({cloud,connectionManager:cm,registry,branchId:branch,tableName:'change_history',reader:{unacknowledged:async()=>[]}})};
}
afterEach(()=>vi.restoreAllMocks());
describe('raw bootstrap uses the same scoped exact absent-only history writer',()=>{
 it('fetches exact rows outside SQL and never reaches generic highest-version MERGE or advances a push proof',async()=>{const f=fixture();await f.run();expect(f.state.rows.get(f.exact.id)).toEqual(f.exact);expect(f.cloud.applyLocalBatch).not.toHaveBeenCalled();expect(f.checkpoints.save).not.toHaveBeenCalled();expect(f.state.job.dependency_index).toBe(1);});
 it('also protects targeted history refresh without replacing an already retained immutable fact',async()=>{const f=fixture(),retained={...f.exact,new_value_json:'{"local":"keep"}',scope_type:'GLOBAL',scope_id:null};f.state.rows.set(f.exact.id,retained);await f.refresh();expect(f.state.rows.get(f.exact.id)).toEqual(retained);expect(f.cloud.historyMissingRows).not.toHaveBeenCalled();expect(f.cloud.applyLocalBatch).not.toHaveBeenCalled();});
 it.each(['GLOBAL','PRIVATE','TERMINAL','CLUSTER','BRANCH '])('rejects bootstrap attribution %s before changing rows or cursor',async type=>{const f=fixture();f.raw.scope_type=type;await expect(f.run()).rejects.toMatchObject({code:'EHISTORY_INDEX_SCOPE'});expect(f.state.rows.size).toBe(0);expect(f.state.job.last_committed_cursor).toBe(null);expect(f.checkpoints.save).not.toHaveBeenCalled();});
 it('retains pending local work and rolls the whole page back',async()=>{const f=fixture();f.state.pending.add(f.exact.id);await expect(f.run()).rejects.toMatchObject({code:'ELOCAL_UPLOAD_PENDING'});expect(f.state.rows.size).toBe(0);expect(f.state.pending.has(f.exact.id)).toBe(true);expect(f.state.job.dependency_index).toBe(0);expect(f.checkpoints.save).not.toHaveBeenCalled();});
 it('preserves a present pending immutable fact while advancing only snapshot membership, never upload proof',async()=>{const f=fixture(),saved={...f.exact,new_value_json:'{"unuploaded":"keep"}'};f.state.rows.set(f.exact.id,saved);f.state.pending.add(f.exact.id);await f.run();expect(f.state.rows.get(f.exact.id)).toEqual(saved);expect(f.state.pending.has(f.exact.id)).toBe(true);expect(f.cloud.historyMissingRows).not.toHaveBeenCalled();expect(f.checkpoints.save).not.toHaveBeenCalled();});
 it('does not commit a row when saving the same page progress fails',async()=>{const f=fixture();f.failCheckpoint();await expect(f.run()).rejects.toThrow('owned checkpoint');expect(f.state.rows.size).toBe(0);expect(f.state.job.last_committed_cursor).toBe(null);expect(f.checkpoints.save).not.toHaveBeenCalled();});
 it('denies a direct generic history application before SQL or network work',async()=>{const client=new CloudClient({configStore:{get:()=>null},terminalStore:{read:()=>null}});await expect(client.applyLocalBatch({}, {cloudTable:'change_history'}, {rows:[]})).rejects.toMatchObject({code:'EHISTORY_EXACT_REQUIRED'});});
 it.each([['all-present','old'],['empty','old'],['all-present','wrong-policy'],['empty','wrong-policy']])('cannot complete an %s history page using %s admission',async(kind,admission)=>{
  const f=fixture();if(kind==='all-present')f.state.rows.set(f.exact.id,f.exact);else f.cloud.bootstrapPage.mockResolvedValue({rows:[],cursor:null});
  const reply=await f.cloud.historyIndex();f.cloud.historyIndex.mockResolvedValue(admission==='old'?{...reply,protocol:'history-index-v1'}:{...reply,policy:'wrong-policy'});
  await expect(f.run()).rejects.toMatchObject({code:'EHISTORY_INDEX_PROTOCOL'});expect(f.state.job.dependency_index).toBe(0);expect(f.cloud.historyMissingRows).not.toHaveBeenCalled();expect(f.checkpoints.save).not.toHaveBeenCalled();expect(f.state.rows.size).toBe(kind==='all-present'?1:0);
 });
 it('requires policy admission for an empty final page but does not fetch a payload or advance upload proof',async()=>{
  const f=fixture();f.cloud.bootstrapPage.mockResolvedValue({rows:[],cursor:null});await f.run();expect(f.state.job.dependency_index).toBe(1);expect(f.cloud.historyIndex).toHaveBeenCalledOnce();expect(f.cloud.historyMissingRows).not.toHaveBeenCalled();expect(f.checkpoints.save).not.toHaveBeenCalled();
 });
 it('reuses one private attestation across same-run all-present and empty-final snapshot pages',async()=>{
  const f=fixture();f.state.rows.set(f.exact.id,f.exact);f.cloud.bootstrapPage.mockResolvedValueOnce({rows:[f.raw],cursor:'next'}).mockResolvedValueOnce({rows:[],cursor:null});
  await f.run();expect(f.cloud.bootstrapPage).toHaveBeenCalledTimes(2);expect(f.cloud.historyIndex).toHaveBeenCalledOnce();expect(f.cloud.historyMissingRows).not.toHaveBeenCalled();expect(f.state.job.dependency_index).toBe(1);expect(f.state.rows.get(f.exact.id)).toEqual(f.exact);
 });
});
