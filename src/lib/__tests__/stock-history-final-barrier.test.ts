import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {describe,it,expect,vi,beforeEach} from 'vitest';
import {closedShiftEffects} from '../closed-shift-effects';
const mocks=vi.hoisted(()=>({finalize:vi.fn()}));
vi.mock('@/core/local-db/local-db',()=>({localDb:()=>({sync:{finalizeShiftClose:mocks.finalize}})}));
vi.mock('../session-draft',()=>({flushTicketDrafts:vi.fn()}));
vi.mock('@/integrations/supabase/external-client',()=>({supabaseExternal:{}}));
vi.mock('@/core/api/db-query',()=>({routedQuery:vi.fn()}));
import {synchronizeShiftClose} from '../shift-closing';
const require=createRequire(import.meta.url),{SyncCoordinator}=require('../../../electron/sync/coordinator.cjs');
const {finishShutdownSync,runShutdownSync}=require('../../../electron/sync/shutdown-sync.cjs');
function fixture({pending=0,failed=1,held=1}={}){
 const summary={pending,failed,queuedTables:[{table:'stock_history_movements',pending,failed}]};
 const stockHistory={reviewHeldCount:vi.fn(async()=>held)},reader={connectionManager:{pool:{}},pendingSummary:vi.fn(async()=>summary)};
 const push=vi.fn(async()=>({pushed:1})),pull=vi.fn(async()=>({merged:1}));
 const coordinator=new SyncCoordinator({pushWorker:{run:push,reader,stockHistory,cloud:{terminalId:()=> 't'}},pullWorker:{run:pull}});
 return {summary,stockHistory,reader,push,pull,coordinator};
}
beforeEach(()=>mocks.finalize.mockReset());
describe('optional report review never changes the core final acknowledgement barrier',()=>{
 it('returns honest counts and allUploaded false only for durably classified report rows',async()=>{
  const f=fixture();expect(await f.coordinator.runFinal({branchId:'a'})).toMatchObject({ok:true,final:true,allUploaded:false,reportHistoryPending:1,pending:0,failed:1});
  expect(f.stockHistory.reviewHeldCount).toHaveBeenCalledWith(f.summary,'a','t');expect(f.pull).not.toHaveBeenCalled();
  expect(f.coordinator.snapshot()).toMatchObject({failed:1,lastError:null});
 });
 it.each(['sale','shift','audit','unknown','legacy','mixed'])('keeps an additional %s row critical even if the report rows are held',async()=>{
  const f=fixture({pending:1,failed:1,held:1});expect(await f.coordinator.runFinal({branchId:'a'})).toMatchObject({ok:false,code:'ESYNC_PENDING',pending:1,failed:1});
 });
 it.each([0,-1,2,1.5,NaN])('does not exempt unknown or invalid classifier count %s',async held=>{
  const f=fixture({held});expect(await f.coordinator.runFinal({branchId:'a'})).toMatchObject({ok:false,code:'ESYNC_PENDING',failed:1});
 });
 it('keeps schema/context errors critical and never modifies the queue',async()=>{
  const f=fixture();f.stockHistory.reviewHeldCount.mockRejectedValue(Object.assign(new Error('Changed context'),{code:'CONTEXT'}));
  expect(await f.coordinator.runFinal({branchId:'a'})).toMatchObject({ok:false,code:'ESYNC_PENDING'});expect(f.summary.failed).toBe(1);
 });
 it.each(['HTTP_401','HTTP_403','HTTP_503','ETIMEDOUT','ECHANGEGAP'])('preserves %s rather than manufacturing a critical acknowledgement',async code=>{
  const f=fixture();f.push.mockRejectedValue(Object.assign(new Error('Unavailable'),{code}));
  expect(await f.coordinator.runFinal({branchId:'a'})).toMatchObject({ok:false,code});expect(f.stockHistory.reviewHeldCount).not.toHaveBeenCalled();
 });
 it('does not waive paused sync or deferred authorized settings',async()=>{
  const f=fixture();f.coordinator.pause();expect(await f.coordinator.runFinal({branchId:'a'})).toMatchObject({ok:false,code:'ESYNC_PAUSED'});
  f.coordinator.resume();f.push.mockResolvedValue({deferredTables:['settings']} as never);
  expect(await f.coordinator.runFinal({branchId:'a'})).toMatchObject({ok:false,code:'ESYNC_AUTH_PENDING'});expect(f.stockHistory.reviewHeldCount).not.toHaveBeenCalled();
 });
 it('reports allUploaded true only when the actual queue is empty',async()=>{
  const f=fixture({pending:0,failed:0,held:0});expect(await f.coordinator.runFinal({branchId:'a'})).toMatchObject({ok:true,allUploaded:true,failed:0,pending:0});
  expect(f.stockHistory.reviewHeldCount).not.toHaveBeenCalled();
 });
 it.each([NaN,-1,Infinity,0.5])('fails closed on malformed pending count %s',async pending=>{
  const f=fixture({pending});expect(await f.coordinator.runFinal({branchId:'a'})).toMatchObject({ok:false,code:'ESYNC_PENDING'});
 });
});
describe('final-barrier callers preserve the distinction between shift acceptance and all uploads',()=>{
 it('passes the actual result unchanged through shutdown and does not retry a review-only hold',async()=>{
  const f=fixture(),run=vi.fn(()=>runShutdownSync({health:async()=>({online:true,ready:true}),pendingSummary:()=>f.reader.pendingSummary(),run:()=>f.coordinator.runFinal({branchId:'a'})}));
  expect(await finishShutdownSync({run,sleep:vi.fn()})).toMatchObject({ok:true,allUploaded:false,reportHistoryPending:1,pending:0,failed:1});
  expect(run).toHaveBeenCalledTimes(1);
 });
 it('never calls offline or signed-out shutdown synchronized',async()=>{
  const f=fixture(),run=vi.fn();
  expect(await runShutdownSync({health:async()=>({online:false,code:'EOFFLINE'}),pendingSummary:()=>f.reader.pendingSummary(),run})).toMatchObject({ok:true,offline:true,synchronized:false,failed:1});
  expect(await runShutdownSync({signedOut:true,allowSignedOutExit:true,pendingSummary:()=>f.reader.pendingSummary(),run})).toMatchObject({ok:true,authenticationRequired:true,synchronized:false,failed:1});
  expect(run).not.toHaveBeenCalled();
 });
 it('preserves review counts through the actual renderer shift-close adapter and print lifecycle',async()=>{
  const f=fixture();mocks.finalize.mockImplementation(()=>f.coordinator.runFinal({branchId:'a'}));
  const result=await closedShiftEffects({print:async()=>({ok:true}),synchronize:()=>synchronizeShiftClose('shift')});
  expect(result.synchronized).toMatchObject({ok:true,allUploaded:false,reportHistoryPending:1,pending:0,failed:1});
 });
 it('does not turn a rejected closing graph into renderer success',async()=>{
  mocks.finalize.mockResolvedValue({ok:false,code:'SYNC_SHIFT_GRAPH_CONFLICT',error:'Closing graph is not acknowledged.'});
  expect(await synchronizeShiftClose('shift')).toEqual({ok:false,code:'SYNC_SHIFT_GRAPH_CONFLICT',error:'Closing graph is not acknowledged.'});
 });
 it('actual Main closing caller clears only its closed-shift barrier, retaining metadata and counts',async()=>{
  const source=readFileSync(new URL('../../../electron/main.cjs',import.meta.url),'utf8');
  const start=source.indexOf('async function synchronizeClosingShifts('),end=source.indexOf('\nasync function restoreShiftCloseGuard',start);
  const f=fixture(),pending=new Set(['closed-shift']);
  const invoke=new Function('pendingShiftCloseSync','syncCoordinator','databaseManager','localBranchId','syncCloud','SHUTDOWN_SYNC_TIMEOUT_MS','legacyRecoveryRuntime','require','prepareLocalData',
   'let mandatoryShiftSyncRun=null;'+source.slice(start,end)+';return synchronizeClosingShifts;');
  const close=invoke(pending,f.coordinator,{isConnected:()=>true},()=> 'a',{health:async()=>({online:true,ready:true})},1000,{reader:f.reader},()=>({finishShutdownSync}),vi.fn());
  expect(await close('closed-shift')).toMatchObject({ok:true,allUploaded:false,reportHistoryPending:1,failed:1});
  expect(pending.size).toBe(0);expect(f.summary.failed).toBe(1);
  f.summary.pending=1;pending.add('another-close');expect(await close()).toMatchObject({ok:false,code:'ESYNC_PENDING'});expect(pending.has('another-close')).toBe(true);
 });
 it('the actual dialog notification branch never says all uploads finished for review-only data',()=>{
  const source=readFileSync(new URL('../../platforms/web/components/pos/ShiftCloseDialog.tsx',import.meta.url),'utf8');
  const start=source.indexOf('    if (!printed.ok) toast.warning('),end=source.indexOf('    setStep("done");',start);
  expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
  const notify=new Function('printed','synchronized','toast',source.slice(start,end)),toast={warning:vi.fn(),info:vi.fn(),success:vi.fn()};
  notify({ok:true},{ok:true,allUploaded:false,reportHistoryPending:1,failed:1},toast);
  expect(toast.info).toHaveBeenCalledWith('Shift synchronized · stock history needs review',expect.objectContaining({description:expect.stringContaining('not all uploads are complete')}));expect(toast.success).not.toHaveBeenCalled();
  notify({ok:true},{ok:false,error:'Closing graph conflict'},toast);expect(toast.warning).toHaveBeenCalledWith('Shift closed locally · synchronization pending',expect.any(Object));
 });
});
