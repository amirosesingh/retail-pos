import {createRequire} from "node:module";
import {describe,it,expect,vi} from "vitest";
const require=createRequire(import.meta.url);
const {RefundApprovalService}=require("../../../electron/refund-approval-service.cjs");
const saleId="11111111-1111-4111-8111-111111111111",requesterId="22222222-2222-4222-8222-222222222222",managerId="33333333-3333-4333-8333-333333333333";
function fixture(){
 let epoch=1,now=Date.parse("2026-11-18T00:00:00Z");
 const person=(id:string,user_id:string,role:string)=>({id,user_id,role,role_slug:role,is_active:true,permissions:{can_process_refund:true},full_name:user_id});
 const policy={rules:[{action_key:"refund",scope_type:"branch",scope_id:"A",mode:"pin",is_enabled:true,require_reason:false,allowed_roles:["manager","admin"],allowed_user_ids:[],authority_limits:{} as Record<string,number>,extra_authority:{},absolute_ceilings:{}}],settings:[{store_id:"",allow_offline_approvals:true,online_only_refund:false}],requester:person(requesterId,"cashier","staff"),actor:person(managerId,"manager","manager")};
 const sale={id:saleId,store_id:"A",bill_number:"A-1",total_amount:"12.30",row_version:1,is_refunded:false,created_at:new Date(now-3600000)};
 const saved=new Map<string,Record<string,unknown>>();
 const store={request:vi.fn((_tx:unknown)=>({input(){return this;},query:vi.fn(async()=>({recordset:[structuredClone(sale)]}))})),readPolicy:vi.fn(async(_scope:unknown,author:string)=>({...structuredClone(policy),actor:author===requesterId?structuredClone(policy.requester):structuredClone(policy.actor)})),readPrior:vi.fn(async(id:string)=>saved.get(id)),persist:vi.fn(async(scope:unknown,request:{requestId:string},value:{row:{detail:{native_approval:Record<string,unknown>}};verified:{id:string}},check:(current:typeof policy)=>Promise<void>)=>{
  await check(await store.readPolicy(scope,value.verified.id));
  saved.set(request.requestId,{...value.row.detail.native_approval,row:structuredClone(value.row)});
 })};
 const verify=vi.fn(async()=>({ok:true,credentialMethod:"pin",staff:{id:managerId,username:"manager"}}));
 const captureScope=()=>{const expected=epoch;return{branchId:"A",terminalId:"terminal",requesterId,requester:"cashier",epoch,assertCurrent:()=>{if(expected!==epoch)throw Object.assign(Error("operator changed"),{code:"EAPPROVAL_CONTEXT"});}};};
 const service=new RefundApprovalService({captureScope,verify,store,now:()=>now});
 const input=()=>({saleId,branchId:"A",registeredTerminalId:"terminal",requestedAmount:12.30,username:"manager",credential:"fixture-pin",requestId:"44444444-4444-4444-8444-444444444444",reason:"Reviewed"});
 const args={saleId,branchId:"A",refundId:`refund:${saleId}`};
 return{service,input,args,policy,sale,store,verify,saved,now:()=>now,change:()=>epoch++,advance:(ms=120001)=>now+=ms};
}
describe("Main-private purpose-bound refund authorization",()=>{
 it("records a verified approval, rechecks in the actual transaction and replays a proven commit after a lost reply",async()=>{
  const f=fixture(),approved=await f.service.authorize(f.input());
  expect(approved.grantToken).toMatch(/^native-refund-v1:/);expect(f.saved.size).toBe(1);
  const admission=f.service.admission(approved.grantToken,f.args);await admission.verify({tx:true});
  f.sale.is_refunded=true;f.sale.row_version=2;
  // Repository proves stable receipt ownership before asking for replay admission.
  await admission.verify({tx:true},true);admission.complete();
  f.advance();await admission.verify({tx:true},true);
  expect(f.verify).toHaveBeenCalledOnce();expect(f.store.persist).toHaveBeenCalledOnce();
 });
 it("uses the current administrator's configured direct authority without asking for another PIN",async()=>{
  const f=fixture();f.policy.requester.role=f.policy.requester.role_slug="admin";
  const result=await f.service.authorize({...f.input(),credential:undefined,username:undefined});
  expect(result.ok).toBe(true);expect(f.verify).not.toHaveBeenCalled();expect(result.authorizer.id).toBe("cashier");
 });
 it("does not turn a cashier's refund permission into approval authority",async()=>{
  const f=fixture();await expect(f.service.authorize({...f.input(),credential:undefined})).rejects.toMatchObject({code:"EAPPROVAL_REQUIRED"});expect(f.saved.size).toBe(0);
 });
 it("does not ask a direct-authority administrator for a second approval reason",async()=>{
  const f=fixture();f.policy.requester.role=f.policy.requester.role_slug="admin";f.policy.rules[0].require_reason=true;
  await expect(f.service.authorize({...f.input(),credential:undefined,reason:undefined})).resolves.toMatchObject({ok:true});expect(f.verify).not.toHaveBeenCalled();
 });
 it("keeps a hosted approval's reason in its existing authoritative audit",async()=>{
  const f=fixture();f.policy.rules[0].require_reason=true;f.service.verifyHosted=vi.fn(async()=>({expiresAt:f.now()+1000}));
  await expect(f.service.authorize({...f.input(),reason:undefined,grantToken:"hosted",proof:{sessionToken:"person"}})).resolves.toMatchObject({ok:true});expect(f.saved.size).toBe(0);
 });
 it("still requires a reason for a new local PIN override when configured",async()=>{
  const f=fixture();f.policy.rules[0].require_reason=true;await expect(f.service.authorize({...f.input(),reason:""})).rejects.toThrow("reason is required");expect(f.saved.size).toBe(0);
 });
 it("preserves direct authority when offline PIN overrides are disabled",async()=>{
  const f=fixture();f.policy.requester.role=f.policy.requester.role_slug="admin";f.policy.settings[0].allow_offline_approvals=false;
  await expect(f.service.authorize({...f.input(),credential:undefined})).resolves.toMatchObject({ok:true});expect(f.verify).not.toHaveBeenCalled();
  const cashier=fixture();cashier.policy.settings[0].allow_offline_approvals=false;await expect(cashier.service.authorize(cashier.input())).rejects.toMatchObject({code:"EONLINE_REQUIRED"});expect(cashier.saved.size).toBe(0);
 });
 it("blocks unsupported grouped PIN approvals before any local audit or money commit",async()=>{
  const f=fixture();f.service.allowPin=()=>false;await expect(f.service.authorize(f.input())).rejects.toMatchObject({code:"EONLINE_REQUIRED"});expect(f.saved.size).toBe(0);expect(f.verify).not.toHaveBeenCalled();
 });
 it("rejects missing, fake hosted and spoofed native admission tokens",()=>{
  const f=fixture();for(const token of[null,"fake-signed-grant","native-refund-v1:spoof"])expect(()=>f.service.admission(token,f.args)).toThrow();
 });
 it("verifies a hosted grant in Main and retains it privately without fabricating a cashier PIN audit",async()=>{
  const f=fixture();f.service.verifyHosted=vi.fn(async()=>({expiresAt:f.now()+1000}));
  const result=await f.service.authorize({...f.input(),grantToken:"verified-hosted-grant",proof:{sessionToken:"person"}});
  expect(f.service.verifyHosted).toHaveBeenCalledOnce();expect(f.saved.size).toBe(0);expect(result.authorizer).toBeUndefined();
  expect(f.service.admission(result.grantToken,f.args).hostedGrantToken).toBe("verified-hosted-grant");await f.service.admission(result.grantToken,f.args).verify({tx:true});
  f.advance(1001);await expect(f.service.admission(result.grantToken,f.args).verify({tx:true})).rejects.toMatchObject({code:"EAPPROVAL_EXPIRED"});
 });
 it("never falls back to local PIN after a hosted authority denial",async()=>{
  const f=fixture();f.service.verifyHosted=vi.fn(async()=>{throw Object.assign(Error("denied"),{code:"EAPPROVAL_DENIED"});});
  await expect(f.service.authorize({...f.input(),grantToken:"bad-hosted-grant",proof:{sessionToken:"person"}})).rejects.toMatchObject({code:"EAPPROVAL_DENIED"});expect(f.verify).not.toHaveBeenCalled();expect(f.saved.size).toBe(0);
 });
 it("never extends the original verified hosted grant expiry",async()=>{
  const f=fixture();f.service.verifyHosted=vi.fn(async()=>({expiresAt:f.now()+1000}));
  const result=await f.service.authorize({...f.input(),grantToken:"hosted",proof:{sessionToken:"person"}});
  f.advance(1001);await expect(f.service.admission(result.grantToken,f.args).verify({tx:true})).rejects.toMatchObject({code:"EAPPROVAL_EXPIRED"});
 });
 it("accepts SQL decimal padding without rounding non-cent money",async()=>{
  const f=fixture();f.sale.total_amount="12.300000000000";await expect(f.service.authorize(f.input())).resolves.toMatchObject({ok:true});
  f.sale.total_amount="12.300000000001";await expect(f.service.authorize(f.input())).rejects.toMatchObject({code:"EREFUND_AMOUNT"});
 });
 it.each(["branch","terminal","amount","sale"])("refuses a changed %s before any approval audit",async field=>{
  const f=fixture(),input:Record<string,unknown>=f.input();input[field==="branch"?"branchId":field==="terminal"?"registeredTerminalId":field==="amount"?"requestedAmount":"saleId"]=field==="amount"?12.31:field==="sale"?"55555555-5555-4555-8555-555555555555":"other";
  if(field==="sale")f.sale.id="other";
  await expect(f.service.authorize(input)).rejects.toThrow();expect(f.saved.size).toBe(0);
 });
 it.each(["actor","branch","id"])("refuses a token reused by another %s",async field=>{
  const f=fixture(),approved=await f.service.authorize(f.input());
  if(field==="actor")f.change();
  const args={...f.args,...(field==="branch"?{branchId:"B"}:field==="id"?{refundId:"another-refund"}:{})};
  await expect(Promise.resolve().then(()=>f.service.admission(approved.grantToken,args).verify({tx:true}))).rejects.toThrow();
 });
 it("expires only unused grants and leaves rollback retry possible",async()=>{
  const f=fixture(),approved=await f.service.authorize(f.input()),admission=f.service.admission(approved.grantToken,f.args);
  await admission.verify({tx:true});await admission.verify({tx:true}); // failed SQL does not consume it
  f.advance();await expect(admission.verify({tx:true})).rejects.toMatchObject({code:"EAPPROVAL_EXPIRED"});
 });
 it.each(["online-only","disabled-account","changed-policy","changed-receipt"])("rechecks %s in the refund transaction",async kind=>{
  const f=fixture(),approved=await f.service.authorize(f.input()),admission=f.service.admission(approved.grantToken,f.args);
  if(kind==="online-only")f.policy.settings[0].online_only_refund=true;
  if(kind==="disabled-account")f.policy.actor.is_active=false;
  if(kind==="changed-policy")f.policy.rules[0].authority_limits={"role:manager":1};
  if(kind==="changed-receipt")f.sale.row_version++;
  await expect(admission.verify({tx:true})).rejects.toThrow();
 });
 it("keeps central-only policy and an existing hosted grant at the central boundary",async()=>{
  const f=fixture();f.policy.settings[0].online_only_refund=true;
  await expect(f.service.authorize(f.input())).rejects.toMatchObject({code:"EONLINE_REQUIRED"});
  f.policy.settings[0].online_only_refund=false;
  await expect(f.service.authorize({...f.input(),grantToken:"hosted-signed-grant"})).rejects.toMatchObject({code:"EONLINE_REQUIRED"});
  expect(f.saved.size).toBe(0);expect(()=>f.service.admission("hosted-signed-grant",f.args)).toThrow();
 });
 it("never mints a grant on an unreadable database or failed audit commit",async()=>{
  const f=fixture();f.store.readPolicy.mockRejectedValueOnce(Error("SQL unavailable"));
  await expect(f.service.authorize(f.input())).rejects.toThrow("SQL unavailable");
  f.store.persist.mockRejectedValueOnce(Error("audit rollback"));await expect(f.service.authorize(f.input())).rejects.toThrow("audit rollback");expect(f.service.grants.size).toBe(0);
 });
 it("reuses the exact audited approval after the first authorization reply was lost",async()=>{
  const f=fixture();await f.service.authorize(f.input());await f.service.authorize(f.input());expect(f.saved.size).toBe(1);
 });
});
