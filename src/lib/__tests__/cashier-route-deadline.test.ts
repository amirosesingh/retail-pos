import { afterEach,beforeEach,expect,it,vi } from "vitest";
const h=vi.hoisted(()=>({status:vi.fn(),fail:vi.fn(),reset:vi.fn(),login:vi.fn()}));
vi.mock("@/lib/public-api-guard.server",()=>({callerVerifiedDownstream:()=>null}));
vi.mock("@/core/api/pos-relay.server",()=>({hasServiceKey:()=>true}));
vi.mock("@/lib/pin-throttle.server",()=>({throttleStatus:h.status,throttleFail:h.fail,throttleReset:h.reset,minutesLeft:()=>1}));
vi.mock("@/lib/cashier-login.server",()=>({cashierLoginServer:h.login}));
import { handleCashierLogin } from "@/routes/api/public/cashier-login";
const request=()=>new Request("https://pos.test/api/public/cashier-login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"cashier",pin:"test-pin"})});
function stalled(signal:AbortSignal):Promise<never>{return new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(signal.reason),{once:true}));}
beforeEach(()=>{vi.resetAllMocks();vi.useFakeTimers();h.status.mockResolvedValue({locked:false});h.login.mockResolvedValue({ok:true});});
afterEach(()=>vi.useRealTimers());
it("bounds the account throttle and does not attempt verification when protection is unavailable",async()=>{
 h.status.mockImplementation((_key,signal)=>stalled(signal));
 const pending=handleCashierLogin(request());await vi.advanceTimersByTimeAsync(25_000);
 const response=await pending;expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:"central_unavailable"});
 expect(h.login).not.toHaveBeenCalled();expect(h.fail).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it("bounds throttle reset after verification and never resubmits credentials",async()=>{
 h.reset.mockImplementation((_key,signal)=>stalled(signal));
 const pending=handleCashierLogin(request());await vi.advanceTimersByTimeAsync(25_000);
 const response=await pending;expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:"central_unavailable"});
 expect(h.login).toHaveBeenCalledOnce();expect(h.fail).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it("shares one route deadline with account and login checks then clears it after success",async()=>{
 expect((await handleCashierLogin(request())).status).toBe(200);
 const signal=h.status.mock.calls[0][1];expect(h.login.mock.calls[0][1].signal).toBe(signal);expect(h.reset.mock.calls[0][1]).toBe(signal);
 expect(vi.getTimerCount()).toBe(0);
});
