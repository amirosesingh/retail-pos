import { describe, expect, it, vi } from "vitest";
import { nativeSyncSummary } from "../sync-status-summary";
const {SyncCoordinator}=require("../../../electron/sync/coordinator.cjs");
const gap=()=>Object.assign(new Error("Change Tracking history for shifts has expired"),{code:"ECHANGEGAP",table:"shifts"});
function fixture(){
  const events: {lastError:string|null;running:boolean;phase:string;credentialsInvalid:boolean}[]=[];
  const push=vi.fn(async()=>({})),pull=vi.fn(async()=>({}));
  const coordinator=new SyncCoordinator({pushWorker:{run:push},pullWorker:{run:pull},publish:(state:typeof events[number])=>events.push(state)});
  return {coordinator,push,pull,events};
}
describe("truthful native retry status",()=>{
  it("displays identical failures once while retaining each unresolved work scope",async()=>{
    const h=fixture();
    h.push.mockRejectedValueOnce(gap()).mockRejectedValueOnce(gap());
    await h.coordinator.runNow({branchId:"A",includeActivity:true});
    await h.coordinator.runNow({branchId:"A",includeActivity:false});
    const message="Change Tracking history for shifts has expired";
    expect(h.coordinator.snapshot().lastError).toBe(message);
    await h.coordinator.runNow({branchId:"A",includeActivity:false});
    expect(h.coordinator.snapshot().lastError).toBe(message);
    await h.coordinator.runNow({branchId:"A",includeActivity:true});
    expect(h.coordinator.snapshot().lastError).toBeNull();
  });
  it("keeps the warning through a failed retry and clears it only after successful matching work",async()=>{
    const h=fixture();h.push.mockRejectedValueOnce(gap()).mockRejectedValueOnce(gap());
    await h.coordinator.runNow({branchId:"A"});h.events.length=0;
    await h.coordinator.runNow({branchId:"A"});
    expect(h.events.length).toBeGreaterThan(1);expect(h.events.every(s=>s.lastError?.includes("shifts"))).toBe(true);
    expect(h.events[0]).toMatchObject({phase:"pushing",running:true});
    h.events.length=0;await h.coordinator.runNow({branchId:"A"});
    expect(h.events[0].lastError).toContain("shifts");expect(h.events.at(-1)).toMatchObject({lastError:null,running:false,credentialsInvalid:false});
  });
  it("does not clear a push failure with pull-only work or display it on another branch",async()=>{
    const h=fixture();h.push.mockRejectedValueOnce(gap());await h.coordinator.runNow({branchId:"A"});
    await h.coordinator.runNow({branchId:"A",pullOnly:true});expect(h.coordinator.snapshot().lastError).toContain("shifts");
    await h.coordinator.runNow({branchId:"B"});expect(h.coordinator.snapshot().lastError).toBeNull();
    await h.coordinator.runNow({branchId:"A",pullOnly:true});expect(h.coordinator.snapshot().lastError).toContain("shifts");
  });
  it("does not clear a download failure with runFinal push-only success",async()=>{
    const h=fixture();h.pull.mockRejectedValueOnce(new Error("download failed"));await h.coordinator.runNow({branchId:"A"});
    expect(await h.coordinator.runFinal({branchId:"A"})).toMatchObject({ok:true});
    expect(h.coordinator.snapshot().lastError).toBe("download failed");
    await h.coordinator.runNow({branchId:"A",pullOnly:true});expect(h.coordinator.snapshot().lastError).toBeNull();
  });
  it("preserves activity-required errors until an activity-inclusive pass succeeds",async()=>{
    const h=fixture();h.push.mockRejectedValueOnce(gap());await h.coordinator.runNow({branchId:"A",includeActivity:true});
    await h.coordinator.runNow({branchId:"A",includeActivity:false});expect(h.coordinator.snapshot().lastError).toContain("shifts");
    await h.coordinator.runNow({branchId:"A",includeActivity:true});expect(h.coordinator.snapshot().lastError).toBeNull();
  });
  it("preserves unresolved authentication status across unrelated work",async()=>{
    const h=fixture();h.push.mockRejectedValueOnce(Object.assign(new Error("authorization denied"),{status:403}));await h.coordinator.runNow({branchId:"A"});
    await h.coordinator.runNow({branchId:"A",pullOnly:true});expect(h.coordinator.snapshot().credentialsInvalid).toBe(true);
    await h.coordinator.runNow({branchId:"B"});expect(h.coordinator.snapshot().credentialsInvalid).toBe(false);
    await h.coordinator.runNow({branchId:"A",pullOnly:true});expect(h.coordinator.snapshot().credentialsInvalid).toBe(true);
    await h.coordinator.runNow({branchId:"A"});expect(h.coordinator.snapshot().credentialsInvalid).toBe(false);
  });
  it("does not hide errors when paused, resumed, or an offline retry fails",async()=>{
    const h=fixture();h.push.mockRejectedValueOnce(gap());await h.coordinator.runNow({branchId:"A"});
    h.coordinator.pause();expect(await h.coordinator.runNow({branchId:"A"})).toMatchObject({paused:true});expect(h.coordinator.snapshot().lastError).toContain("shifts");
    h.coordinator.resume();h.push.mockRejectedValueOnce(Object.assign(new Error("offline"),{code:"EOFFLINE"}));await h.coordinator.runNow({branchId:"A"});
    expect(h.coordinator.snapshot().lastError).toContain("offline");
  });
  it("retains both failed directions and clears only the one later verified",async()=>{
    const h=fixture();h.push.mockRejectedValueOnce(Object.assign(new Error("push unavailable"),{status:503}));h.pull.mockRejectedValueOnce(new Error("pull unavailable"));
    await h.coordinator.runNow({branchId:"A"});expect(h.coordinator.snapshot().lastError).toContain("push unavailable");expect(h.coordinator.snapshot().lastError).toContain("pull unavailable");
    await h.coordinator.runNow({branchId:"A",pullOnly:true});expect(h.coordinator.snapshot().lastError).toBe("push unavailable");
    await h.coordinator.runNow({branchId:"A",pushOnly:true});expect(h.coordinator.snapshot().lastError).toBeNull();
  });
  it("retains credential denial through an unavailable retry until matching success",async()=>{
    const h=fixture();h.push.mockRejectedValueOnce(Object.assign(new Error("denied"),{status:403})).mockRejectedValueOnce(Object.assign(new Error("unavailable"),{status:503}));
    await h.coordinator.runNow({branchId:"A"});await h.coordinator.runNow({branchId:"A"});expect(h.coordinator.snapshot().credentialsInvalid).toBe(true);
    await h.coordinator.runNow({branchId:"A"});expect(h.coordinator.snapshot().credentialsInvalid).toBe(false);
  });
  it("does not treat deferred uploads or runFinal's deferred response as recovery",async()=>{
    const h=fixture();h.push.mockRejectedValueOnce(gap());await h.coordinator.runNow({branchId:"A"});
    h.push.mockResolvedValueOnce({deferredTables:["settings"]});await h.coordinator.runNow({branchId:"A"});expect(h.coordinator.snapshot().lastError).toContain("shifts");
    h.push.mockResolvedValueOnce({deferredTables:["settings"]});expect(await h.coordinator.runFinal({branchId:"A"})).toMatchObject({ok:false,code:"ESYNC_AUTH_PENDING"});expect(h.coordinator.snapshot().lastError).toContain("shifts");
  });
  it("does not treat a restricted or deferred download as a successful full download",async()=>{
    const h=fixture();h.pull.mockRejectedValueOnce(new Error("download failed"));await h.coordinator.runNow({branchId:"A"});
    await h.coordinator.runNow({branchId:"A",skipMembership:true});expect(h.coordinator.snapshot().lastError).toBe("download failed");
    h.pull.mockResolvedValueOnce({membershipDeferred:true});await h.coordinator.runNow({branchId:"A"});expect(h.coordinator.snapshot().lastError).toBe("download failed");
    await h.coordinator.runNow({branchId:"A"});expect(h.coordinator.snapshot().lastError).toBeNull();
  });
  it("keeps the warning visible while the presentation reports retry progress",()=>{
    const summary=nativeSyncSummary({lastError:"shifts gap",running:true,phase:"pushing",pending:0,failed:0,conflicts:0},{enabled:true,connected:true,tradingReady:true});
    expect(summary.state).toBe("degraded");expect(summary.label).toBe("Needs attention");expect(summary.detail).toContain("shifts gap");expect(summary.detail).toContain("Retrying synchronization");
  });
});
