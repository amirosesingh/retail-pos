import { beforeEach,describe,expect,it,vi } from "vitest";
const h=vi.hoisted(()=>({fetch:vi.fn(),touch:vi.fn(),cashier:vi.fn()}));
vi.stubGlobal("fetch",h.fetch);
vi.mock("../external-supabase-config",()=>({runtimeEnvValue:()=>"service-key",supabaseConfig:()=>({url:"https://example.test",key:"public-key"})}));
vi.mock("../session-guard.server",()=>({touchSession:h.touch}));
vi.mock("../pos-session.server",()=>({verifyCashierSession:h.cashier}));
import { verifyRelayCaller,runRelayRpc } from "@/core/api/pos-relay.server";
import { resolveRelayScope } from "@/core/api/relay-policy.server";
const proof="a".repeat(64);
const activation={id:"terminal-a",platform:"pc",status:"used",location_id:"A",revoked_at:null,is_claimed:true,claimed_at:"2026-10-27",claimed_proof_hash:proof,claim_proof:proof,management_registration:false};
const session={kind:"cashier",label:"Cashier",staff_user_id:"cashier",branch_id:"A",terminal_id:"terminal-a"};
const json=(body:unknown,status=200)=>Response.json(body,{status});
beforeEach(()=>{
 vi.clearAllMocks();
 h.touch.mockResolvedValue({ok:true,session:{...session}});
 h.cashier.mockResolvedValue(null);
 h.fetch.mockImplementation(async(url:string)=>{
  if(url.includes("terminal_tokens?"))return json([activation]);
  if(url.includes("app_users?"))return json([{user_id:"cashier",role:"manager",role_slug:"supervisor",store_id:null,is_active:true,permissions:{can_process_refund:true,can_process_sale:true}}]);
  if(url.includes("sales?"))return json([{store_id:"B"}]);
  if(url.includes("/auth/v1/user"))return json({id:"auth-user",email:"person@example.test"});
  return json({});
 });
});
describe("persisted hosted terminal authority",()=>{
 it("retains a raw session's bound terminal when request token is omitted",async()=>{
  expect(await verifyRelayCaller({sessionToken:"verified"})).toMatchObject({terminalId:"terminal-a",storeId:"A",terminal:{id:"terminal-a",mode:"operations",branchId:"A",platform:"pc"}});
  expect(h.fetch.mock.calls[0][0]).toContain("terminal_tokens?id=eq.terminal-a");
 });
 it("retains a cashier proof's revocable backing-session terminal",async()=>{
  h.cashier.mockResolvedValue({id:"person",username:"cashier",storeId:"A",sessionToken:"backing",terminalId:"terminal-a"});
  expect(await verifyRelayCaller({cashierToken:"signed"})).toMatchObject({terminalId:"terminal-a",storeId:"A"});
 });
 it("rejects an alternative token rather than replacing the stored device",async()=>{
  await expect(verifyRelayCaller({sessionToken:"verified",terminalToken:"terminal-b"})).rejects.toThrow();
 });
 it.each(["revoked","missing","unavailable","reassigned"])("fails closed on %s stored activation without falling back to Auth",async(kind)=>{
  h.fetch.mockResolvedValueOnce(kind==="unavailable" ? json({message:"offline"},503)
   :json(kind==="missing" ? [] : [{...activation,...(kind==="revoked"?{revoked_at:"now"}:{location_id:"B"})}]));
  await expect(verifyRelayCaller({sessionToken:"verified",accessToken:"valid-auth"})).rejects.toThrow();
  expect(h.fetch.mock.calls.some(([url])=>url.includes("/auth/v1/user"))).toBe(false);
 });
 it("requires existing device proof to attach a terminal to an unbound Auth login",async()=>{
  await expect(verifyRelayCaller({accessToken:"auth",terminalToken:"terminal-a"})).rejects.toThrow();
  expect(await verifyRelayCaller({accessToken:"auth",terminalToken:"terminal-a",deviceBindingProof:proof})).toMatchObject({terminalId:"terminal-a",storeId:"A"});
 });
 it("keeps browser Auth unregistered and does not require a device proof",async()=>{
  expect(await verifyRelayCaller({accessToken:"auth"})).toMatchObject({kind:"staff",authUserId:"auth-user"});
  expect(h.fetch.mock.calls.some(([url])=>url.includes("terminal_tokens?"))).toBe(false);
 });
 it("keeps a wider manager pinned through an actual relay RPC",async()=>{
  const scope=await resolveRelayScope(await verifyRelayCaller({sessionToken:"verified"}));
  expect(scope).toMatchObject({storeId:"A",branchRestricted:true,isSupervisor:true});
  expect(await runRelayRpc({kind:"rpc",table:"sales",fn:"sale_refund",args:{_sale_id:"foreign-sale"}},scope)).toMatchObject({ok:false,code:"STORE_FORBIDDEN"});
 });
});
