import {describe,expect,it,vi} from 'vitest';
const {LocalDataLifecycle}=require('../../../electron/jobs/lifecycle.cjs');
function fixture(table='shifts'){
 const events:string[]=[],gap=Object.assign(Error('original Change Tracking gap'),{code:'ECHANGEGAP',table});let leased=false;
 const recovery=vi.fn(async()=>{expect(leased).toBe(true);events.push('held');return{updated:1,reviewRequired:0,deferred:0};});
 const syncCoordinator={withExclusive:async(work:()=>unknown)=>{expect(leased).toBe(false);leased=true;try{return await work();}finally{leased=false;}},runPush:vi.fn(async():Promise<{ok:boolean}>=>{events.push('push');throw gap;})};
 const databaseService={markReady:vi.fn(),transition:vi.fn()},checkpoints={save:vi.fn()};
 const lifecycle=new LocalDataLifecycle({connectionManager:{},registry:{tables:[]},cloud:{},databaseService,checkpoints,syncCoordinator,recoverHeldStatuses:recovery});
 lifecycle.recoverChangeTrackingGap=vi.fn(async()=>{events.push('shift');throw gap;});
 return{lifecycle,recovery,syncCoordinator,gap,events,databaseService,checkpoints};
}
describe('startup shift guard does not suppress independent confirmed held completions',()=>{
 it('runs the optional bounded callback in the existing exclusive lease before blocked shift recovery',async()=>{
  const f=fixture();await expect(f.lifecycle.pushWithGapRecovery('branch',90)).rejects.toBe(f.gap);
  expect(f.events).toEqual(['push','held','shift']);expect(f.recovery).toHaveBeenCalledExactlyOnceWith({branchId:'branch',onActivity:expect.any(Function)});
  expect(f.databaseService.markReady).not.toHaveBeenCalled();expect(f.databaseService.transition).not.toHaveBeenCalled();expect(f.checkpoints.save).not.toHaveBeenCalled();
 });
 it('keeps the original unresolved shift warning if the status helper fails',async()=>{
  const f=fixture();f.recovery.mockRejectedValue(Error('secondary status failure'));
  await expect(f.lifecycle.pushWithGapRecovery('branch',90)).rejects.toBe(f.gap);expect(f.lifecycle.recoverChangeTrackingGap).toHaveBeenCalledOnce();
 });
 it('does not loop the optional callback when the same expired shift table is seen twice',async()=>{
  const f=fixture();f.lifecycle.recoverChangeTrackingGap.mockResolvedValue({table:'shifts'});
  await expect(f.lifecycle.pushWithGapRecovery('branch',90)).rejects.toBe(f.gap);expect(f.recovery).toHaveBeenCalledOnce();expect(f.syncCoordinator.runPush).toHaveBeenCalledTimes(2);
 });
 it('does not invoke it for an unrelated expired history table',async()=>{
  const f=fixture('change_history');await expect(f.lifecycle.pushWithGapRecovery('branch',90)).rejects.toBe(f.gap);expect(f.recovery).not.toHaveBeenCalled();
 });
 it('does not add a request when ordinary upload already succeeds',async()=>{
  const f=fixture();f.syncCoordinator.runPush.mockResolvedValue({ok:true});await expect(f.lifecycle.pushWithGapRecovery('branch',90)).resolves.toEqual({result:{ok:true},recovered:[]});expect(f.recovery).not.toHaveBeenCalled();
 });
});
