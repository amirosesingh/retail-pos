import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ rest:vi.fn(), mint:vi.fn(), start:vi.fn(), audit:vi.fn(), sign:vi.fn(), finish:vi.fn(), begin:vi.fn() }));
vi.mock("@/core/api/pos-relay.server",()=>({serviceRest:h.rest}));
vi.mock("../staff-admin.server",()=>({createVerifiedPinSignInToken:h.mint}));
vi.mock("../session-guard.server",()=>({startSession:h.start}));
vi.mock("../system-audit.server",()=>({writeSystemAudit:h.audit}));
vi.mock("../pos-session.server",()=>({signCashierSession:h.sign}));
vi.mock("../pin-request-throttle.server",()=>({beginPinRequest:h.begin,finishPinRequest:h.finish}));
import { cashierLoginServer } from "../cashier-login.server";
const input={username:"cashier",pin:"test-only-pin"};
function stalled(signal:AbortSignal):Promise<never>{
  return new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(signal.reason),{once:true}));
}
beforeEach(()=>{
  vi.resetAllMocks();vi.useFakeTimers();
  h.begin.mockResolvedValue({locked:false,key:"test"});
  h.rest.mockImplementation(async(path:string)=>path.startsWith("rpc/") ? Response.json({status:"verified",account:{user_id:"cashier"}}) : Response.json([{id:"person",user_id:"cashier",full_name:"Cashier",email:"person@example.test",auth_user_id:"auth",is_active:true,role:"staff",store_id:null}]));
  h.mint.mockResolvedValue("auth-proof");h.start.mockResolvedValue({token:"device-session",idleMinutes:30});h.sign.mockReturnValue("cashier-proof");
});
afterEach(()=>vi.useRealTimers());
it.each(["pin","profile","auth"])("bounds a stalled %s operation without consuming an outer wrong-PIN attempt",async stage=>{
  const rest=h.rest.getMockImplementation()!;
  if(stage==="auth")h.mint.mockImplementation((_email,_id,signal)=>stalled(signal));
  else h.rest.mockImplementation((path:string,options:{signal:AbortSignal})=>
    (stage==="pin"?path.startsWith("rpc/"):path.startsWith("app_users?")) ? stalled(options.signal) : rest(path,options));
  const pending=cashierLoginServer(input);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(await pending).toMatchObject({ok:false,code:"central_unavailable"});
  expect(h.start).not.toHaveBeenCalled();expect(h.finish).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("awaits the audit within the same budget and does not return a successful token after expiry",async()=>{
  h.audit.mockImplementation((_entry,options)=>stalled(options.signal));
  const pending=cashierLoginServer(input);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(await pending).toMatchObject({ok:false,code:"central_unavailable"});
  expect(h.start).toHaveBeenCalledOnce();expect(h.sign).not.toHaveBeenCalled();
  expect(h.finish).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it("shares one live signal across proof, session and awaited audit and clears its timer on success",async()=>{
  expect(await cashierLoginServer(input)).toMatchObject({ok:true,sessionToken:"device-session"});
  const signal=h.rest.mock.calls[0][1].signal;
  expect(h.mint.mock.calls[0][2]).toBe(signal);
  expect(h.start.mock.calls[0][1].signal).toBe(signal);
  expect(h.audit.mock.calls[0][1].signal).toBe(signal);
  expect(vi.getTimerCount()).toBe(0);
});
it("bounds address protection before attempting the PIN and does not skip it",async()=>{
  h.begin.mockImplementation((_request,signal)=>stalled(signal));
  const pending=cashierLoginServer(input);
  await vi.advanceTimersByTimeAsync(25_000);
  expect(await pending).toMatchObject({ok:false,code:"central_unavailable"});
  expect(h.rest).not.toHaveBeenCalled();expect(h.finish).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("bounds recording a real wrong-PIN outcome without automatically repeating it",async()=>{
  h.rest.mockResolvedValue(Response.json({status:"invalid"}));
  h.finish.mockImplementation((_key,_valid,signal)=>stalled(signal));
  const pending=cashierLoginServer(input);
  await vi.advanceTimersByTimeAsync(25_000);
  expect(await pending).toMatchObject({ok:false,code:"central_unavailable"});
  expect(h.rest).toHaveBeenCalledOnce();expect(h.finish).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
