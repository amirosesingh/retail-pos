import {beforeEach,describe,expect,it,vi} from "vitest";
const h=vi.hoisted(()=>({rest:vi.fn(),start:vi.fn(),sign:vi.fn(),mint:vi.fn(),audit:vi.fn()}));
vi.mock("@/core/api/pos-relay.server",()=>({serviceRest:h.rest}));
vi.mock("../session-guard.server",()=>({startSession:h.start}));
vi.mock("../pos-session.server",()=>({signCashierSession:h.sign}));
vi.mock("../staff-admin.server",()=>({createVerifiedPinSignInToken:h.mint}));
vi.mock("../system-audit.server",()=>({writeSystemAudit:h.audit}));
vi.mock("../pin-request-throttle.server",()=>({beginPinRequest:async()=>({locked:false,key:"test"}),finishPinRequest:async()=>{}}));
import {cashierServiceFailure} from "../cashier-login-failure";
import {cashierLoginServer} from "../cashier-login.server";
const proof="a".repeat(64);
let activation:Record<string,unknown>,profile:Record<string,unknown>;
beforeEach(()=>{
 vi.clearAllMocks();h.start.mockResolvedValue({token:"session",idleMinutes:30});h.sign.mockReturnValue("signed");h.mint.mockResolvedValue("auth-proof");
 activation={id:"terminal",platform:"pc",status:"used",location_id:"A",is_claimed:true,claim_proof:proof,management_registration:false};
 profile={id:"person",user_id:"cashier",full_name:"Cashier",email:"person@example.test",auth_user_id:"auth",role:"staff",role_slug:"cashier",store_id:null,is_active:true,permissions:{can_process_sale:true}};
 h.rest.mockImplementation(async(path:string)=>path==="rpc/verify_terminal_pin_result" ? Response.json({status:"verified",account:{user_id:"cashier",store_id:null}})
  :path.startsWith("app_users?")?Response.json([profile]):path.startsWith("terminal_tokens?")?Response.json([activation]):Response.json([]));
});
describe("native PIN session issuance",()=>{
 it("never falls back locally after an authoritative activation denial",async()=>{
  activation.revoked_at="now";
  const result=await cashierLoginServer({username:"cashier",pin:"1234",terminalId:"terminal",deviceBindingProof:proof});
  expect(result).toMatchObject({ok:false,code:"activation_denied"});
  if(!result.ok) expect(cashierServiceFailure(503,result)).toMatchObject({useLocal:false,code:"permission-denied"});
  expect(h.start).not.toHaveBeenCalled();
 });
 it("reports registry transport failure as unavailable rather than incorrect PIN",async()=>{
  h.rest.mockImplementation(async(path:string)=>path==="rpc/verify_terminal_pin_result" ? Response.json({status:"verified",account:{user_id:"cashier"}}):path.startsWith("app_users?")?Response.json([profile]):new Response(null,{status:503}));
  expect(await cashierLoginServer({username:"cashier",pin:"1234",terminalId:"terminal",deviceBindingProof:proof})).toMatchObject({ok:false,code:"central_unavailable"});
  expect(h.start).not.toHaveBeenCalled();
 });
 it("keeps authorized cashier branch and ignores a renderer branch suggestion",async()=>{
  const result=await cashierLoginServer({username:"cashier",pin:"1234",platform:"electron",terminalId:"terminal",deviceBindingProof:proof,branchId:"B"});
  expect(result).toMatchObject({ok:true,cashier:{store_id:"A",permissions:{can_process_sale:true}}});
  expect(h.start).toHaveBeenCalledWith(expect.objectContaining({branchId:"A",terminalId:"terminal"}),expect.objectContaining({signal:expect.any(AbortSignal)}));
 });
 it.each([undefined,"b".repeat(64)])("does not mint a session or Auth handoff with invalid device proof",async(deviceBindingProof)=>{
  expect(await cashierLoginServer({username:"cashier",pin:"1234",platform:"electron",terminalId:"terminal",deviceBindingProof})).toMatchObject({ok:false,code:"activation_denied"});
  expect(h.start).not.toHaveBeenCalled();expect(h.mint).not.toHaveBeenCalled();
 });
 it("rejects assigned-account and bound-terminal disagreement without changing grants",async()=>{
  profile.store_id="B";
  expect(await cashierLoginServer({username:"cashier",pin:"1234",terminalId:"terminal",deviceBindingProof:proof})).toMatchObject({ok:false});
  expect(h.start).not.toHaveBeenCalled();
 });
 it.each(["pc","mobile"])("retains explicit %s management admission and all-store identity",async(platform)=>{
  activation={...activation,platform,location_id:null,management_registration:true};
  profile.permissions={can_process_sale:true,can_use_management_pc:true,can_use_management_mobile:true};
  expect(await cashierLoginServer({username:"cashier",pin:"1234",terminalId:"terminal",deviceBindingProof:proof,branchId:"B"})).toMatchObject({ok:true,cashier:{store_id:null}});
  expect(h.start).toHaveBeenCalledWith(expect.objectContaining({branchId:null,terminalId:"terminal"}),expect.objectContaining({signal:expect.any(AbortSignal)}));
  expect(h.sign).toHaveBeenCalledWith(expect.objectContaining({storeId:null}));
 });
 it("refuses management sign-in when its admission flag is denied",async()=>{
  activation={...activation,location_id:null,management_registration:true};
  profile.permissions={can_process_sale:true,can_use_management_pc:false};
  expect(await cashierLoginServer({username:"cashier",pin:"1234",terminalId:"terminal",deviceBindingProof:proof})).toMatchObject({ok:false});
  expect(h.start).not.toHaveBeenCalled();
 });
});
