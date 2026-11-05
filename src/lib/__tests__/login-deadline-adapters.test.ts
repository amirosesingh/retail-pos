import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h=vi.hoisted(()=>({rest:vi.fn()}));
vi.mock("@/core/api/pos-relay.server",()=>({serviceRest:h.rest,serviceKey:()=>"test-service-key"}));
vi.mock("../external-supabase-config",()=>({supabaseConfig:()=>({url:"https://project.test",key:"test-publishable"})}));
import { startSession } from "../session-guard.server";
import { readVerifiedTerminal } from "../terminal-binding.server";
import { writeSystemAudit } from "../system-audit.server";
import { createVerifiedPinSignInToken } from "../staff-admin.server";
beforeEach(()=>vi.resetAllMocks());
afterEach(()=>vi.restoreAllMocks());
function stalled(signal:AbortSignal):Promise<never>{return new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(signal.reason),{once:true}));}
it("does not fall back to permissive idle defaults or insert a session after its login deadline",async()=>{
 const abort=new AbortController();
 h.rest.mockImplementation((_path,options)=>stalled(options.signal));
 const pending=startSession({kind:"cashier",staffUserId:"cashier",branchId:"A"},{signal:abort.signal});
 const assertion=expect(pending).rejects.toMatchObject({name:"AbortError"});
 abort.abort();await assertion;
 expect(h.rest).toHaveBeenCalledOnce();
 expect(h.rest.mock.calls[0][0]).toContain("pos_store_settings?");
 expect(h.rest.mock.calls.some(([path])=>path==="user_sessions")).toBe(false);
});
it("preserves existing default session settings behavior for callers without a deadline",async()=>{
 h.rest.mockImplementation(async path=>path==="user_sessions"?new Response(null,{status:201}):Response.json([]));
 expect(await startSession({kind:"staff",staffUserId:"staff"})).toMatchObject({idleMinutes:30});
 expect(h.rest.mock.calls.at(-1)?.[0]).toBe("user_sessions");
 expect(h.rest.mock.calls.at(-1)?.[1]).not.toHaveProperty("signal");
});
it("maps a cancelled terminal lookup to unavailable rather than activation denial",async()=>{
 const abort=new AbortController();h.rest.mockImplementation((_path,options)=>stalled(options.signal));
 const pending=readVerifiedTerminal("device",undefined,true,abort.signal);
 const assertion=expect(pending).rejects.toMatchObject({status:503});abort.abort();await assertion;
});
it("passes cancellation through one-use Auth proof generation without changing passwords",async()=>{
 const abort=new AbortController();const fetch=vi.spyOn(globalThis,"fetch").mockImplementation((_input,options)=>stalled(options!.signal!));
 const pending=createVerifiedPinSignInToken("operator@example.test","auth-id",abort.signal);
 const assertion=expect(pending).rejects.toMatchObject({name:"AbortError"});abort.abort();await assertion;
 expect(fetch).toHaveBeenCalledWith("https://project.test/auth/v1/admin/generate_link",expect.objectContaining({signal:abort.signal}));
 expect(fetch).toHaveBeenCalledOnce();
});
it("awaits audit delivery and passes the caller's login cancellation",async()=>{
 const abort=new AbortController();h.rest.mockImplementation((_path,options)=>stalled(options.signal));
 let settled=false;const pending=writeSystemAudit({actionType:"auth.sign_in"},{signal:abort.signal}).then(()=>{settled=true;});
 await Promise.resolve();expect(settled).toBe(false);
 abort.abort();await pending;
 expect(h.rest).toHaveBeenCalledWith("system_audit_logs",expect.objectContaining({signal:abort.signal}));
});
