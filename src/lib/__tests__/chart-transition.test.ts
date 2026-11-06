import { beforeEach, afterEach, expect, it, vi } from "vitest";
const h=vi.hoisted(()=>({values:[] as unknown[],cursor:0,effect:undefined as undefined|{deps:unknown[];cleanup?:()=>void},pending:[] as (()=>void)[],reduced:false}));
vi.mock("react",()=>({
  useRef:(value:unknown)=>{const i=h.cursor++;return h.values[i]??=( {current:value});},
  useState:(initial:unknown)=>{const i=h.cursor++;if(!(i in h.values))h.values[i]=typeof initial==="function"?initial():initial;return[h.values[i],(next:unknown)=>{h.values[i]=next;}];},
  useLayoutEffect:(fn:()=>void|(()=>void),deps:unknown[])=>{if(h.effect&&deps.every((value,i)=>Object.is(value,h.effect!.deps[i])))return;h.pending.push(()=>{h.effect?.cleanup?.();h.effect={deps,cleanup:fn()||undefined};});},
}));
import {useChartTransition}from"../use-chart-transition";
type Data={amount:number};
const fact=(key:string,amount:number)=>({key,value:{amount},signature:JSON.stringify({amount})});
let authority:string|null="person/db/branch/cost",target="A",confirmed:{key:string;value:Data;signature:string}|null;
function render(flush=true){h.cursor=0;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Deterministic render/effect boundary.
  const result=useChartTransition(authority,target,confirmed);if(flush)h.pending.splice(0).forEach(fn=>fn());return result;
}
beforeEach(()=>{vi.useFakeTimers();h.values=[];h.cursor=0;h.effect=undefined;h.pending=[];h.reduced=false;authority="person/db/branch/cost";target="A";confirmed=fact("A",90);vi.stubGlobal("window",{matchMedia:()=>({matches:h.reduced})});});
afterEach(()=>{h.effect?.cleanup?.();vi.useRealTimers();vi.unstubAllGlobals();});
it("holds exact prior data only for bounded exit, then waits, then enters confirmed data",async()=>{
  render();await vi.advanceTimersByTimeAsync(300);expect(render()).toMatchObject({data:{amount:90},phase:"ready"});
  target="B";confirmed=null;render();expect(render()).toMatchObject({data:{amount:90},phase:"exit"});
  await vi.advanceTimersByTimeAsync(119);expect(render().data?.amount).toBe(90);await vi.advanceTimersByTimeAsync(1);expect(render()).toMatchObject({data:null,phase:"waiting"});
  confirmed=fact("B",-12);render();expect(render()).toMatchObject({data:{amount:-12},phase:"enter"});await vi.advanceTimersByTimeAsync(300);expect(render().phase).toBe("ready");
});
it("ignores stale bound B data after rapid A→B→C and cancels older timers",async()=>{
  render();target="B";confirmed=null;render();await vi.advanceTimersByTimeAsync(60);target="C";render();
  confirmed=fact("B",999);render();await vi.advanceTimersByTimeAsync(180);expect(render().data).toBeNull();
  confirmed=fact("C",7);render();await vi.advanceTimersByTimeAsync(500);expect(render()).toMatchObject({data:{amount:7},phase:"ready"});
});
it("drops prior protected data synchronously before effects on authority changes or sign-out",()=>{
  render();authority="different/branch/no-cost";confirmed=null;expect(render(false).data).toBeNull();h.pending.splice(0).forEach(fn=>fn());
  authority=null;confirmed=fact("A",999);expect(render(false).data).toBeNull();
});
it("keeps failed targets empty, handles retry and cancels on unmount",async()=>{
  render();target="B";confirmed=null;render();await vi.advanceTimersByTimeAsync(1000);expect(render().data).toBeNull();
  confirmed=fact("B",3);render();expect(render().phase).toBe("enter");h.effect?.cleanup?.();expect(vi.getTimerCount()).toBe(0);
});
it("respects reduced motion without an exit hold or delayed numeric updates",()=>{
  h.reduced=true;render();target="B";confirmed=fact("B",4);render();expect(render()).toMatchObject({data:{amount:4},phase:"ready"});expect(vi.getTimerCount()).toBe(0);
});

it("does not animate an identical new reference, but animates real changed content and finishes rapid enter updates",async()=>{
  render();await vi.advanceTimersByTimeAsync(300);const initial=render();confirmed=fact("A",90);render();expect(render()).toEqual(initial);expect(vi.getTimerCount()).toBe(0);
  confirmed=fact("A",91);render();expect(render().phase).toBe("exit");await vi.advanceTimersByTimeAsync(120);expect(render().phase).toBe("enter");confirmed=fact("A",92);render();await vi.advanceTimersByTimeAsync(500);expect(render()).toMatchObject({data:{amount:92},phase:"ready"});expect(vi.getTimerCount()).toBe(0);
});
