import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {describe,it,expect,vi} from 'vitest';
const fixture=JSON.parse(readFileSync('src/lib/__tests__/fixtures/history-scope-legacy-1.4.82.json','utf8'));
const hashes:Record<string,string>={
 'electron/jobs/lifecycle.cjs':'b552e2775f1d007558b199d5b1de6fdc20ffcb0dff24d377e480161e7a8cd811',
 'electron/sync/reconciliation.cjs':'59c6314092933ec7eeceff8486e23d61a966d4ae963ad8f72850a9b1e54f0dc6',
 'electron/db/branch-scope.cjs':'c8a80e31039d927826408c3dec8dc6981e75a883441561c771db0f29b9276717',
 'electron/main.cjs:prepareLocalData':'cf7a8735814c0a6332a606f0911c07d3dc99e0e5d383e41b716254ce99c07cc2',
};
const modules=new Map<string,any>();
function legacy(path:string):any{
 if(modules.has(path))return modules.get(path);
 const input=fixture.sources[path];expect(fixture.revision).toBe('980d6b2f1c18867518b08243c7eb72083230f53a');expect(createHash('sha256').update(input.source).digest('hex')).toBe(hashes[path]);
 const module={exports:{}},filename=resolve(path),nativeRequire=createRequire(filename);
 const require=(name:string)=>name==='../sync/reconciliation.cjs'?legacy('electron/sync/reconciliation.cjs'):name==='../db/branch-scope.cjs'?legacy('electron/db/branch-scope.cjs'):nativeRequire(name);
 runInNewContext('(function(require,module,exports){'+input.source+'\n})',{Buffer,URL,setTimeout,clearTimeout})(require,module,module.exports);
 modules.set(path,module.exports);return module.exports;
}
const id=(n:number)=>'aaaaaaaa-aaaa-4aaa-8aaa-'+String(n).padStart(12,'0'),branch=id(1),terminal=id(2);
function scenario(Controller:any,qualified=true){
 const queries:string[]=[],physical=[{organization_id:'default',scope_type:'BRANCH',scope_id:branch},{organization_id:'default',scope_type:'GLOBAL',scope_id:null},{organization_id:'default',scope_type:'BRANCH',scope_id:id(3)}];
 const request={input(){return this;},query:async(sql:string):Promise<{recordset:Array<Record<string,unknown>>}>=>{queries.push(sql);return{recordset:sql.includes('COUNT_BIG')?[{table_name:'change_history',row_count:sql.includes('source.[scope_type]')?'1':'3'}]:[{id:branch}]};}};
 const cm={pool:{request:()=>request}},state={enabled:true,configured:true,connected:true,tradingReady:true,profile:{database:'owned-readiness'},state:'enabled_connecting'};
 const service={snapshot:()=>state,markReady:vi.fn(()=>{state.state='enabled_ready';}),transition:vi.fn((next:string)=>{state.state=next;})};
 const repository={startupSnapshot:async()=>qualified?{job_id:'prior-complete-snapshot'}:null,hasOtherActiveJobs:async()=>false,active:async()=>null,completed:async()=>({status:'completed'})};
 const cloud={terminalId:()=>terminal,backendUrl:()=> 'https://owned.invalid',terminalStore:{read:()=>({tokenId:terminal,deviceUse:'operations',locationId:branch})},requestContext:()=>({pool:cm.pool,fingerprint:'a'.repeat(64)}),counts:async()=>[{table_name:'change_history',row_count:'1'}]};
 const registry={tables:[{cloudTable:'change_history',sqlServerTable:'change_history',direction:'bidirectional',columns:[{cloudColumn:'id',sqlServerColumn:'id',primaryKey:true}]}]},coordinator={runNow:async()=>({ok:true}),recordVerification:vi.fn(),withExclusive:(work:()=>unknown)=>work()};
 const lifecycle=new Controller({connectionManager:cm,databaseService:service,jobRepository:repository,registry,cloud,syncCoordinator:coordinator});
 // This fixture isolates only history selection/readiness compatibility. No
 // sale, shift, upload or financial write is simulated as accepted.
 lifecycle.pushWithGapRecovery=async()=>({result:{ok:true},recovered:[]});lifecycle.retain=async()=>({skipped:true});
 const main=fixture.sources['electron/main.cjs:prepareLocalData'];expect(createHash('sha256').update(main.source).digest('hex')).toBe(hashes['electron/main.cjs:prepareLocalData']);
 const context={isManagementDevice:()=>false,databaseConfig:{profile:()=>({retentionDays:7300})},localBranchId:()=>branch,localDataLifecycle:lifecycle,databaseService:service,diagnostics:{logConnection:vi.fn(),bootstrapDiagnostic:()=>({})},syncRegistry:registry,prepare:undefined as undefined|(()=>Promise<unknown>)};
 runInNewContext('let localDataPreparePromise=null;'+main.source+';globalThis.prepare=prepareLocalData;',context);
 return{context,lifecycle,service,state,physical,queries,request,repository,cloud,registry,coordinator};
}
describe('captured Retail1.4.82 compatibility with narrowed cloud history',()=>{
 it('truthfully reports the old broad-count difference while preserving its already qualified checkout cache',async()=>{const h=scenario(legacy('electron/jobs/lifecycle.cjs').LocalDataLifecycle);const before=structuredClone(h.physical);await expect(h.context.prepare!()).rejects.toMatchObject({code:'ERECONCILE'});expect(h.lifecycle.preserveCachedReady()).toBe(true);expect(h.state.state).toBe('enabled_ready');expect(h.service.markReady).toHaveBeenLastCalledWith(expect.objectContaining({code:'ERECONCILE',syncReady:false}));expect(h.physical).toEqual(before);expect(h.queries.every(sql=>!/(?:UPDATE|INSERT|MERGE|DELETE)/.test(sql))).toBe(true);});
 it('does not use that compatibility path to qualify incomplete or mismatched local snapshots',async()=>{const h=scenario(legacy('electron/jobs/lifecycle.cjs').LocalDataLifecycle,false);await expect(h.context.prepare!()).rejects.toMatchObject({code:'ERECONCILE'});expect(h.state.state).toBe('enabled_bootstrapping');expect(h.service.markReady).not.toHaveBeenCalled();});
 it('new native selection converges the same retained rows without deleting global or other-branch history',async()=>{const {LocalDataLifecycle}=createRequire(import.meta.url)('../../../electron/jobs/lifecycle.cjs'),h=scenario(LocalDataLifecycle);const before=structuredClone(h.physical);await expect(h.context.prepare!()).resolves.toMatchObject({ok:true,differences:[]});expect(h.state.state).toBe('enabled_ready');expect(h.physical).toEqual(before);expect(h.physical).toHaveLength(3);expect(h.queries.some(sql=>sql.includes('source.[scope_type]'))).toBe(true);});
});

function bridge({qualified=true,checkpoint=40 as number|null,central='1',sync={ok:true} as Record<string,unknown>}={}){
 const {LocalDataLifecycle}=createRequire(import.meta.url)('../../../electron/jobs/lifecycle.cjs');
 const h=scenario(LocalDataLifecycle,qualified),error=Object.assign(new Error('Scoped reader absent'),{code:'EHISTORY_POLICY_UNAVAILABLE',table:'change_history'});
 const baseQuery=h.request.query;
 h.request.query=async(sql:string)=>{
  if(sql.includes('minimum_version'))return{recordset:[{table_name:'stores',minimum_version:20,current_version:60,checkpoint_version:checkpoint,checkpoint_organization_id:'default'}]};
  const result=await baseQuery(sql);
  if(sql.includes('COUNT_BIG'))result.recordset.push({table_name:'stores',row_count:'1'});
  return result;
 };
 h.registry.tables.push({cloudTable:'stores',sqlServerTable:'stores',direction:'bidirectional',columns:[{cloudColumn:'id',sqlServerColumn:'id',primaryKey:true}]});
 const historyIndex=vi.fn(async():Promise<unknown>=>{throw error;});
 Object.assign(h.cloud,{historyIndex,historyMissingRows:vi.fn(),isHistoryPolicyUnavailable:(failure:unknown,scope:string)=>failure===error&&scope===branch,
  counts:async()=>[{table_name:'change_history',row_count:'3'},{table_name:'stores',row_count:central}]});
 Object.assign(h.repository,{recovery:async()=>null});
 const recordHistoryRecovery=vi.fn();Object.assign(h.coordinator,{runNow:vi.fn(async()=>sync),recordHistoryRecovery});
 h.lifecycle.jobManager={paused:false};
 h.lifecycle.bootstrap=vi.fn(async()=>{throw Error('unavailable history must not start a full bootstrap');});
 return{...h,error,historyIndex,recordHistoryRecovery};
}
describe('scoped reader compatibility bridge before the cloud upgrade',()=>{
 it('keeps only the verified operating snapshot available and reports history pending regardless of legacy totals',async()=>{
  const h=bridge(),before=structuredClone(h.physical);
  const result=await h.lifecycle.ensure({branchId:branch,historyDays:7300,force:true});
  expect(result).toMatchObject({ok:true,phase:'history_recovery',historyPending:true,syncReady:false,code:'EHISTORY_POLICY_UNAVAILABLE',branchId:branch,differences:[]});
  expect(h.service.markReady).toHaveBeenLastCalledWith(expect.objectContaining({syncReady:false,historyPending:true,branchId:branch}));
  expect(h.recordHistoryRecovery).toHaveBeenLastCalledWith(expect.objectContaining({pending:true,code:'EHISTORY_POLICY_UNAVAILABLE',status:'retrying',branchId:branch}));
  expect(h.coordinator.recordVerification).toHaveBeenLastCalledWith(expect.objectContaining({verified:false,historyPending:true,tables:[expect.objectContaining({table:'stores'})]}));
  expect(h.lifecycle.bootstrap).not.toHaveBeenCalled();expect(h.physical).toEqual(before);
  expect(h.queries.every(sql=>!/(?:UPDATE|INSERT|MERGE|DELETE)/.test(sql))).toBe(true);
 });
 it.each([{qualified:false},{checkpoint:null},{checkpoint:10}])('blocks absent, missing or expired operational proof %j',async options=>{
  const h=bridge(options);await expect(h.lifecycle.ensure({branchId:branch,historyDays:7300,force:true})).rejects.toBe(h.error);
  expect(h.service.markReady).not.toHaveBeenCalled();expect(h.lifecycle.preserveCachedReady()).toBe(false);
 });
 it('keeps ordinary record differences and observed synchronization errors blocking',async()=>{
  const difference=bridge({central:'2'});
  await expect(difference.lifecycle.ensure({branchId:branch,force:true})).rejects.toMatchObject({code:'ERECONCILE'});
  const auth=bridge({sync:{ok:false,credentialsInvalid:true,code:'HTTP_403',table:'stores'}});
  await expect(auth.lifecycle.ensure({branchId:branch,force:true})).rejects.toMatchObject({code:'HTTP_403'});
  expect(difference.recordHistoryRecovery).not.toHaveBeenCalled();expect(auth.recordHistoryRecovery).not.toHaveBeenCalled();
 });
 it('does not qualify checkout when unavailable history blocked an entire mixed feed page',async()=>{
  const h=bridge({sync:{ok:false,code:'EHISTORY_POLICY_UNAVAILABLE',table:'change_history',error:'Mixed feed page remains pending'}});
  await expect(h.lifecycle.ensure({branchId:branch,force:true})).rejects.toMatchObject({code:'EHISTORY_POLICY_UNAVAILABLE'});
  expect(h.service.markReady).not.toHaveBeenCalled();
  expect(h.recordHistoryRecovery).not.toHaveBeenCalled();
  expect(h.coordinator.recordVerification).not.toHaveBeenCalled();
 });
 it('keeps transient or unverified capability errors distinct from compatibility',async()=>{
  const h=bridge();const transient=Object.assign(new Error('transport'),{code:'HTTP_503'});h.historyIndex.mockRejectedValue(transient);
  await expect(h.lifecycle.ensure({branchId:branch,force:true})).rejects.toBe(transient);
  expect(h.recordHistoryRecovery).not.toHaveBeenCalled();
 });
 it('retries the same scoped capability and resumes normal recovery after deployment',async()=>{
  const h=bridge();await h.lifecycle.ensure({branchId:branch,force:true});
  expect(await h.lifecycle.historyStep(branch)).toMatchObject({pending:true,status:'retrying',code:'EHISTORY_POLICY_UNAVAILABLE',next_retry_at:expect.any(String)});
  const {PROJECTION}=createRequire(import.meta.url)('../../../electron/sync/history-index-protocol.cjs');
  h.historyIndex.mockResolvedValue({protocol:'history-index-v2',policy:'branch-history-v1',history_scope:'branch',projection:PROJECTION,
   action:'begin',organization_id:'default',branch_id:branch,terminal_id:terminal,keep_commerce:false,upper_id:null,after_id:null,ids:[],next_id:null,complete:true,range_count:null});
  const step=vi.fn(async()=>({completed:true}));h.lifecycle.historyIndexRecovery.step=step;
  expect(await h.lifecycle.historyStep(branch)).toMatchObject({completed:true});
  expect(step).toHaveBeenCalledWith(expect.objectContaining({branchId:branch,force:true}));expect(h.lifecycle.historyPending(branch)).toBe(false);
 });
});

type TrackingBound={table_name:string;minimum_version:number|null;current_version:number;checkpoint_version:number|null;checkpoint_organization_id:string};
function shiftBridge(qualified=true){
 const h=bridge({qualified}),events:string[]=[];
 const bounds:TrackingBound[]=[
  {table_name:'shifts',minimum_version:20,current_version:60,checkpoint_version:10,checkpoint_organization_id:'default'},
  {table_name:'shift_cash_counts',minimum_version:20,current_version:60,checkpoint_version:15,checkpoint_organization_id:'default'},
  {table_name:'stores',minimum_version:20,current_version:60,checkpoint_version:40,checkpoint_organization_id:'default'},
 ];
 const shiftTables=bounds.slice(0,2).map(row=>row.table_name);
 h.registry.tables.push(...shiftTables.map(name=>({cloudTable:name,sqlServerTable:name,direction:'bidirectional',columns:[{cloudColumn:'id',sqlServerColumn:'id',primaryKey:true}]})));
 const query=h.request.query,counts=h.cloud.counts;
 const readBounds=vi.fn(async()=>({recordset:bounds}));
 h.request.query=async(sql:string)=>{
  if(sql.includes('minimum_version'))return readBounds();
  const result=await query(sql);
  if(sql.includes('COUNT_BIG'))result.recordset.push(...shiftTables.map(table_name=>({table_name,row_count:'1'})));
  return result;
 };
 h.cloud.counts=async()=>[...await counts(),...shiftTables.map(table_name=>({table_name,row_count:'1'}))];
 const runPush=vi.fn(async()=>{events.push('push');return{ok:true};});
 Object.assign(h.coordinator,{runPush});
 delete h.lifecycle.pushWithGapRecovery; // exercise the real gate before normal upload
 const recover=vi.fn(async(_branch:string,_days:number,table:string)=>{
  expect(h.service.markReady).not.toHaveBeenCalled();
  expect(runPush).not.toHaveBeenCalled();
  events.push(table);
  bounds.find(row=>row.table_name===table)!.checkpoint_version=60;
  return{table,completed:0};
 });
 h.lifecycle.recoverChangeTrackingGap=recover;
 return{...h,bounds,events,readBounds,recover,runPush,ensure:()=>h.lifecycle.ensure({branchId:branch,historyDays:7300,force:true})};
}

describe('scoped startup recovery with expired shift Change Tracking',()=>{
 it('uses the existing narrow recovery for each positive expired shift checkpoint before any push or checkout-ready state',async()=>{
  const h=shiftBridge(),retained=structuredClone(h.physical);
  await expect(h.ensure()).resolves.toMatchObject({ok:true,historyPending:true,syncReady:false,code:'EHISTORY_POLICY_UNAVAILABLE',branchId:branch});
  expect(h.recover.mock.calls.map(([selectedBranch,days,table])=>[selectedBranch,days,table])).toEqual(expect.arrayContaining([
   [branch,7300,'shifts'],[branch,7300,'shift_cash_counts'],
  ]));
  expect(h.recover).toHaveBeenCalledTimes(2);
  expect(h.events.at(-1)).toBe('push');
  expect(h.service.markReady).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({phase:'history_recovery',branchId:branch,historyPending:true,syncReady:false}));
  expect(h.physical).toEqual(retained);
  expect(h.lifecycle.bootstrap).not.toHaveBeenCalled();
 });
 it.each(['fresh snapshot','active job','other branch','other organization','ordinary expiry','missing checkpoint','zero checkpoint','future checkpoint','missing bounds','duplicate bounds','malformed bounds'])('denies partial proof from %s before attempting any recovery or upload',async reason=>{
  const h=shiftBridge(reason!=='fresh snapshot');
  if(reason==='active job')h.repository.hasOtherActiveJobs=async()=>true;
  if(reason==='other branch')h.cloud.terminalStore.read=()=>({tokenId:terminal,deviceUse:'operations',locationId:id(3)});
  if(reason==='other organization')h.bounds[1].checkpoint_organization_id='other';
  if(reason==='ordinary expiry')h.bounds[2].checkpoint_version=5;
  if(reason==='missing checkpoint')h.bounds[1].checkpoint_version=null;
  if(reason==='zero checkpoint')h.bounds[1].checkpoint_version=0;
  if(reason==='future checkpoint')h.bounds[1].checkpoint_version=61;
  if(reason==='missing bounds')h.bounds.splice(1,1);
  if(reason==='duplicate bounds')h.bounds[1]={...h.bounds[0]};
  if(reason==='malformed bounds')h.bounds[1].minimum_version=null;
  await expect(h.ensure()).rejects.toMatchObject({code:expect.any(String)});
  expect(h.recover).not.toHaveBeenCalled();expect(h.runPush).not.toHaveBeenCalled();expect(h.service.markReady).not.toHaveBeenCalled();
  expect(h.lifecycle.preserveCachedReady()).toBe(false);
 });
 it.each(['jobs','sync'])('does not begin shift recovery while %s is paused',async scope=>{
  const h=shiftBridge();
  if(scope==='jobs')h.lifecycle.jobManager.paused=true;else Object.assign(h.coordinator,{paused:true});
  await expect(h.ensure()).rejects.toMatchObject({code:expect.any(String)});
  expect(h.recover).not.toHaveBeenCalled();expect(h.runPush).not.toHaveBeenCalled();expect(h.service.markReady).not.toHaveBeenCalled();
 });
 it('does not use an unavailable-policy response after its verified source changes during bounds inspection',async()=>{
  const h=shiftBridge();
  h.readBounds.mockImplementation(async()=>{
   Object.assign(h.cloud,{isHistoryPolicyUnavailable:()=>false});
   return{recordset:h.bounds};
  });
  await expect(h.ensure()).rejects.toMatchObject({code:expect.any(String)});
  expect(h.recover).not.toHaveBeenCalled();expect(h.runPush).not.toHaveBeenCalled();expect(h.service.markReady).not.toHaveBeenCalled();
 });
 it('does not attempt a second recovery or declare readiness after the source changes during the first',async()=>{
  const h=shiftBridge();
  h.recover.mockImplementationOnce(async(_branch,_days,table)=>{
   h.bounds.find(row=>row.table_name===table)!.checkpoint_version=60;
   Object.assign(h.cloud,{isHistoryPolicyUnavailable:()=>false});
   return{table,completed:0};
  });
  await expect(h.ensure()).rejects.toMatchObject({code:expect.any(String)});
  expect(h.recover).toHaveBeenCalledTimes(1);expect(h.runPush).not.toHaveBeenCalled();expect(h.service.markReady).not.toHaveBeenCalled();
 });
 it.each([false,true])('rechecks source after the last awaited bounds read before ordinary upload (recovered=%s)',async recovered=>{
  const h=shiftBridge();
  if(recovered)h.readBounds.mockResolvedValueOnce({recordset:h.bounds});
  else for(const row of h.bounds)row.checkpoint_version=60;
  h.readBounds.mockImplementationOnce(async()=>{
   Object.assign(h.cloud,{isHistoryPolicyUnavailable:()=>false});
   return{recordset:h.bounds};
  });
  await expect(h.ensure()).rejects.toMatchObject({code:expect.any(String)});
  expect(h.recover).toHaveBeenCalledTimes(recovered?2:0);
  expect(h.runPush).not.toHaveBeenCalled();expect(h.service.markReady).not.toHaveBeenCalled();
 });
 it.each(['ELOCAL_PENDING_UNVERIFIED','ELOCAL_UPLOAD_PENDING','ESYNC_APPLY_CONFLICT'])('preserves the actual recovery refusal %s and leaves other work pending',async code=>{
  const h=shiftBridge(),refused=Object.assign(Error('Retained closing needs verification'),{code,table:'shifts'});
  const prior=structuredClone(h.bounds);
  h.recover.mockRejectedValueOnce(refused);
  await expect(h.ensure()).rejects.toBe(refused);
  expect(h.recover).toHaveBeenCalledOnce();expect(h.runPush).not.toHaveBeenCalled();expect(h.service.markReady).not.toHaveBeenCalled();
  expect(h.bounds).toEqual(prior);
 });
 it('requires strict healthy bounds after a reported successful recovery before starting ordinary upload',async()=>{
  const h=shiftBridge();
  h.recover.mockImplementation(async(_branch,_days,table)=>({table,completed:0}));
  await expect(h.ensure()).rejects.toMatchObject({code:expect.any(String)});
  expect(h.recover).toHaveBeenCalled();expect(h.runPush).not.toHaveBeenCalled();expect(h.service.markReady).not.toHaveBeenCalled();
 });
});
