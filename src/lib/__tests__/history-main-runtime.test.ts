import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe,it,expect,vi} from 'vitest';
const {HistoryCadence}=require('../../../electron/sync/history-cadence.cjs');
const {shouldRetryRecoveryMetadata}=require('../../../electron/db/shift-recovery-metadata.cjs');
const text=readFileSync('electron/main.cjs','utf8'),start=text.indexOf('function scheduleAutomaticSync('),end=text.indexOf('function stopAutomaticSync(',start);
function fixture(){
 let clock=1_000_000;const historyCadence=new HistoryCadence({now:()=>clock,jitter:()=>0}),scheduled:number[]=[];
 const runNow=vi.fn(async()=>({ok:true})),historyStep=vi.fn(async()=>({pending:true,status:'queued'})),managementRun=vi.fn(async():Promise<{ok:boolean;history?:{pending:boolean;status:string}} >=>({ok:true,history:{pending:true,status:'queued'}})),fault=vi.fn();
 const context={Date:{now:()=>clock},historyCadence,quitting:false,automaticSyncQueued:false,automaticSyncScheduler:{schedule:(delay:number)=>scheduled.push(delay)},isManagementDevice:()=>false,
  managementReplica:{run:managementRun},terminalStore:{read:()=>({tokenId:'registered'})},terminalIdentityPausedSync:false,databaseService:{snapshot:()=>({enabled:true,configured:true,connected:true})},databaseManager:{isConnected:()=>true},
  recoverLocalDatabase:vi.fn(),shouldRetryRecoveryMetadata,recoveryMetadataInstaller:{approvedArtifactHash:null},recordFault:fault,localBranchId:()=> 'A',jobManager:{running:false},localDataPreparePromise:null,syncCoordinator:{paused:false,running:false,runNow},
  approvalTokenVerifier:{refresh:vi.fn(async()=>{})},lastActivityFlush:clock,ACTIVITY_INTERVAL_MS:120000,AUTO_SYNC_OK_MS:120000,AUTO_SYNC_RETRY_MS:60000,AUTO_VERIFY_MS:900000,lastAutomaticVerification:clock,
  localDataLifecycle:{historyStep,reconcileAndRecover:vi.fn(async()=>[]),historyPending:()=>true},databaseConfig:{profile:()=>({retentionDays:90})},diagnostics:{logConnection:vi.fn(),bootstrapDiagnostic:()=>({})},syncRegistry:{tables:[]},prepareLocalData:vi.fn(),MEMBERSHIP_TABLES:new Set(['members']),reconciliationError:()=>Error('count review'),
 };
 runInNewContext(text.slice(start,end),context);
 const api=context as typeof context&{runAutomaticSync:()=>Promise<void>;scheduleAutomaticSync:(delay?:number)=>void};
 return{context:api,runNow,historyStep,managementRun,fault,scheduled,advance:(ms:number)=>clock+=ms};
}
describe('actual Main automatic sync function uses one scheduler with fair history quanta',()=>{
 it('performs one normal pass then history-only continuations without rechecking all tables each second',async()=>{const f=fixture();await f.context.runAutomaticSync();expect(f.runNow).toHaveBeenCalledTimes(1);expect(f.historyStep).toHaveBeenCalledTimes(1);f.advance(1000);await f.context.runAutomaticSync();expect(f.runNow).toHaveBeenCalledTimes(1);expect(f.historyStep).toHaveBeenCalledTimes(2);f.advance(119000);await f.context.runAutomaticSync();expect(f.runNow).toHaveBeenCalledTimes(2);});
 it('ordinary write/unknown notifications immediately request core work ahead of a continuation',async()=>{const f=fixture();await f.context.runAutomaticSync();f.context.scheduleAutomaticSync(250);f.advance(250);await f.context.runAutomaticSync();expect(f.runNow).toHaveBeenCalledTimes(2);});
 it('preserves core hints arriving while an awaited history request is running',async()=>{const f=fixture();await f.context.runAutomaticSync();let release!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>entered=r);f.historyStep.mockImplementationOnce(async()=>{entered();await new Promise<void>(r=>release=r);return{pending:true,status:'queued'};});f.advance(1000);const running=f.context.runAutomaticSync();await started;f.context.scheduleAutomaticSync(250);release();await running;expect(f.scheduled.at(-1)).toBe(250);f.advance(250);await f.context.runAutomaticSync();expect(f.runNow).toHaveBeenCalledTimes(2);});
 it('does not run history when core authorization failed, or while paused/disconnected',async()=>{const f=fixture();f.runNow.mockResolvedValue({ok:false});await f.context.runAutomaticSync();expect(f.historyStep).not.toHaveBeenCalled();f.context.syncCoordinator.paused=true;f.advance(60000);await f.context.runAutomaticSync();expect(f.historyStep).not.toHaveBeenCalled();expect(f.runNow).toHaveBeenCalledTimes(1);});
 it('waits on the existing operational job/gate instead of overlapping a restore or first setup',async()=>{const f=fixture();f.context.jobManager.running=true;await f.context.runAutomaticSync();expect(f.runNow).not.toHaveBeenCalled();expect(f.historyStep).not.toHaveBeenCalled();});
 it('a history failure retains the normal reconnection cadence and records its actual failure',async()=>{const f=fixture();await f.context.runAutomaticSync();f.historyStep.mockRejectedValueOnce(Object.assign(new Error('offline'),{code:'EAI_AGAIN'}));f.advance(1000);await f.context.runAutomaticSync();expect(f.fault).toHaveBeenCalledWith('sync.history-recovery',expect.objectContaining({code:'EAI_AGAIN'}));expect(f.scheduled.at(-1)).toBe(60000);f.advance(60000);await f.context.runAutomaticSync();expect(f.runNow).toHaveBeenCalledTimes(2);});
 it('Management continuations invoke the read-only history entry rather than every branch download',async()=>{const f=fixture();f.context.isManagementDevice=()=>true;await f.context.runAutomaticSync();expect(f.managementRun).toHaveBeenLastCalledWith({historyOnly:false});f.advance(1000);await f.context.runAutomaticSync();expect(f.managementRun).toHaveBeenLastCalledWith({historyOnly:true});expect(f.runNow).not.toHaveBeenCalled();expect(f.historyStep).not.toHaveBeenCalled();});
 it('a paused/deferred Management continuation cannot become a hot250ms loop',async()=>{const f=fixture();f.context.isManagementDevice=()=>true;await f.context.runAutomaticSync();f.managementRun.mockResolvedValueOnce({ok:false});f.advance(1000);await f.context.runAutomaticSync();expect(f.scheduled.at(-1)).toBe(59000);});
 it('a short early core pass preserves the original activity-flush deadline',async()=>{const f=fixture();await f.context.runAutomaticSync();f.advance(110000);f.context.scheduleAutomaticSync(250);await f.context.runAutomaticSync();expect(f.context.historyCadence.coreDue).toBe(1120000);});
});
describe('actual Main private persisted-history ownership callback',()=>{
 const start=text.indexOf('async function ownsHistoryRecoveryExecution('),end=text.indexOf('const localDataLifecycle =',start);
 const terminal='aaaaaaaa-aaaa-4aaa-8aaa-000000009001',guid='aaaaaaaa-aaaa-4aaa-8aaa-000000009002',job='aaaaaaaa-aaaa-4aaa-8aaa-000000009003';
 function proofFixture(){
  let locked=true,lease=true,fingerprint='current',databaseGuid=guid,after=()=>{};
  const pool={request:()=>({query:async()=>{after();return{recordset:[{database_guid:databaseGuid}]};}})},manager={running:null as null|{job_id:string;job_type:string}};
  const context={app:{hasSingleInstanceLock:()=>locked},syncCoordinator:{ownsExclusive:()=>lease},databaseManager:{pool},syncCloud:{requestContext:()=>({pool,fingerprint}),terminalId:()=>terminal},jobManager:manager,recordId:(v:unknown)=>typeof v==='string'?v.toLowerCase():null};
  runInNewContext(text.slice(start,end),context);const run=(context as typeof context&{ownsHistoryRecoveryExecution:(request:unknown)=>Promise<boolean>}).ownsHistoryRecoveryExecution;
  const source={pool,fingerprint,databaseGuid:guid,terminalId:terminal};
  return{run:()=>run({source,jobId:job}),source,manager,setLocked:(v:boolean)=>locked=v,setLease:(v:boolean)=>lease=v,setFingerprint:(v:string)=>fingerprint=v,setGuid:(v:string)=>databaseGuid=v,setAfter:(v:()=>void)=>after=v};
 }
 it('requires combined single-instance, actual lease, current secure source and DB GUID evidence',async()=>{const f=proofFixture();expect(await f.run()).toBe(true);f.setLocked(false);expect(await f.run()).toBe(false);f.setLocked(true);f.setLease(false);expect(await f.run()).toBe(false);f.setLease(true);f.setGuid('different');expect(await f.run()).toBe(false);f.setGuid(guid);f.setFingerprint('changed');expect(await f.run()).toBe(false);});
 it('accepts only idle ownership or the exact current index-job ID, never an executing old handler',async()=>{const f=proofFixture();f.manager.running={job_id:job,job_type:'history_index_recovery_v1'};expect(await f.run()).toBe(true);f.manager.running={job_id:'other',job_type:'history_index_recovery_v1'};expect(await f.run()).toBe(false);f.manager.running={job_id:job,job_type:'history_gap_recovery_v1'};expect(await f.run()).toBe(false);});
 it('rechecks the proof after the awaited DB read rather than blessing a changed profile/lease',async()=>{const f=proofFixture();f.setAfter(()=>f.setLease(false));expect(await f.run()).toBe(false);const other=proofFixture();other.setAfter(()=>other.setFingerprint('changed'));expect(await other.run()).toBe(false);});
});
