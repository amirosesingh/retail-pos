import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
const h=vi.hoisted(()=>({status:vi.fn(),fail:vi.fn(),reset:vi.fn(),login:vi.fn()}));
vi.mock("@/lib/public-api-guard.server",()=>({callerVerifiedDownstream:()=>null}));
vi.mock("@/core/api/pos-relay.server",()=>({hasServiceKey:()=>true}));
vi.mock("@/lib/pin-throttle.server",()=>({throttleStatus:h.status,throttleFail:h.fail,throttleReset:h.reset,minutesLeft:()=>1}));
vi.mock("@/lib/cashier-login.server",()=>({cashierLoginServer:h.login}));
import { handleCashierLogin } from "@/routes/api/public/cashier-login";
import { handleCashierLogin as directHandler } from "../cashier-login-endpoint.server";
import server from "../../server";
const request=()=>new Request("https://pos.test/api/public/cashier-login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"cashier",pin:"test-pin"})});
function stalled(signal:AbortSignal):Promise<never>{return new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(signal.reason),{once:true}));}
beforeEach(()=>{vi.resetAllMocks();vi.useFakeTimers();h.status.mockResolvedValue({locked:false});h.login.mockResolvedValue({ok:true});});
afterEach(()=>vi.useRealTimers());
describe.each([
 {name:"framework route",run:handleCashierLogin},
 {name:"direct Worker",run:(request:Request)=>{Object.defineProperty(request,"cf",{value:{colo:"SYN"}});return server.fetch(request,{},{});}},
])("cashier deadline and response parity: $name",({run})=>{
it("bounds the account throttle and does not attempt verification when protection is unavailable",async()=>{
 h.status.mockImplementation((_key,signal)=>stalled(signal));
 const pending=run(request());await vi.advanceTimersByTimeAsync(25_000);
 const response=await pending;expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:"central_unavailable"});
 expect(h.login).not.toHaveBeenCalled();expect(h.fail).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it("bounds throttle reset after verification and never resubmits credentials",async()=>{
 h.reset.mockImplementation((_key,signal)=>stalled(signal));
 const pending=run(request());await vi.advanceTimersByTimeAsync(25_000);
 const response=await pending;expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:"central_unavailable"});
 expect(h.login).toHaveBeenCalledOnce();expect(h.fail).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it("shares one route deadline with account and login checks then clears it after success",async()=>{
 expect((await run(request())).status).toBe(200);
 const signal=h.status.mock.calls[0][1];expect(h.login.mock.calls[0][1].signal).toBe(signal);expect(h.reset.mock.calls[0][1]).toBe(signal);
 expect(vi.getTimerCount()).toBe(0);
});
it("keeps unexpected handler errors and attempt counters unchanged",async()=>{
 h.login.mockRejectedValueOnce(new Error("synthetic verifier error"));
 const response=await run(request());expect(response.status).toBe(500);expect(await response.json()).toEqual({ok:false,error:"synthetic verifier error"});
 expect(h.fail).not.toHaveBeenCalled();expect(h.reset).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it("rejects an invalid payload before account or address protection",async()=>{
 const response=await run(new Request("https://pos.test/api/public/cashier-login",{method:"POST",body:"{}"}));
 expect(response.status).toBe(400);expect(await response.json()).toEqual({ok:false,error:"Invalid payload"});
 expect(h.status).not.toHaveBeenCalled();expect(h.login).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
});
it("exports the same credential handler through the original route",()=>expect(handleCashierLogin).toBe(directHandler));
