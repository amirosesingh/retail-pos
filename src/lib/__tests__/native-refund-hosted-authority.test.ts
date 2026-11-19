import {createRequire} from "node:module";
import {describe,it,expect,vi} from "vitest";
const {createHostedRefundVerifier}=createRequire(import.meta.url)("../../../electron/refund-hosted-authority.cjs");
const now=1805500800000,author="11111111-1111-4111-8111-111111111111";
function fixture(){
 const send=vi.fn(),scope={requester:"cashier",requesterId:author,branchId:"A",amount:1230,assertCurrent:vi.fn()};
 const identity={ok:true,subject:"cashier",authorId:author,permissions:{can_process_refund:true},branchId:"A"};
 const approval={ok:true,required:true,grant:{action:"refund",storeId:"A",exp:now+1000,approvedBy:"manager"}};
 const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
 send.mockResolvedValueOnce(json(identity)).mockResolvedValueOnce(json(approval));
 const verify=createHostedRefundVerifier({backend:()=>"https://owned-beta.example",terminal:()=>({tokenId:"sealed-terminal",deviceBindingProof:"sealed-binding"}),fetch:send,now:()=>now});
 const input={saleId:"saved-sale",grantToken:"signed-grant",proof:{sessionToken:"current-person",terminalToken:"forged"}};
 return{send,scope,identity,approval,json,run:(basis:unknown=null,bill="A-123")=>verify({scope,input,sale:{bill_number:bill},basis})};
}
describe("Main verifies hosted refund authority",()=>{
 it("binds the current Main actor then verifies the exact saved receipt with sealed activation proof",async()=>{
  const f=fixture();expect(await f.run()).toEqual({expiresAt:now+1000});
  const[adopt,mutation]=f.send.mock.calls;
  expect(adopt[0]).toContain("/ipc-adopt");expect(JSON.parse(adopt[1].body)).toEqual({sessionToken:"current-person",terminalToken:"sealed-terminal",deviceBindingProof:"sealed-binding"});
  expect(JSON.parse(mutation[1].body)).toEqual({action:"verify_mutation",data:{sessionToken:"current-person",terminalToken:"sealed-terminal",deviceBindingProof:"sealed-binding",actionKey:"refund",storeId:"A",requestedAmount:12.30,grantToken:"signed-grant",payload:{sale_id:"saved-sale",receipt_no:"A-123",total:12.30}}});
  expect(mutation[1].redirect).toBe("error");
 });
 it.each(["authorId","subject","branchId","permissions"])("refuses mismatched verified %s without checking the grant",async field=>{
  const f=fixture();f.send.mockReset().mockResolvedValueOnce(f.json({...f.identity,[field]:field==="permissions"?{}:"other"}));
  await expect(f.run()).rejects.toMatchObject({code:"EAPPROVAL_DENIED"});expect(f.send).toHaveBeenCalledOnce();
 });
 it("preserves an explicit hosted denial without any local authorization fallback",async()=>{
  const f=fixture();f.send.mockReset().mockResolvedValueOnce(f.json(f.identity)).mockResolvedValueOnce(f.json({ok:false,error:"denied"}));await expect(f.run()).rejects.toMatchObject({code:"EAPPROVAL_DENIED"});expect(f.send).toHaveBeenCalledTimes(2);
 });
 it.each([now-1,now,undefined])("rejects expired or incomplete trusted grant expiry %s",async exp=>{
  const f=fixture();f.send.mockReset().mockResolvedValueOnce(f.json(f.identity)).mockResolvedValueOnce(f.json({...f.approval,grant:{...f.approval.grant,exp}}));await expect(f.run()).rejects.toMatchObject({code:"EAPPROVAL_DENIED"});
 });
 it("does not turn a transport failure into PIN permission",async()=>{
  const f=fixture();f.send.mockReset().mockRejectedValueOnce(Error("offline"));await expect(f.run()).rejects.toMatchObject({code:"EONLINE_REQUIRED"});expect(f.send).toHaveBeenCalledOnce();
 });
 it("requests a durable exact-basis receipt and preserves an empty legacy bill number",async()=>{
  const f=fixture(),basis={operationId:"exact-saved-operation",amountMinor:"1230"};
  f.send.mockReset().mockResolvedValueOnce(f.json(f.identity)).mockResolvedValueOnce(f.json({...f.approval,refundApprovalReceipt:"purpose-bound-certificate"}));
  expect(await f.run(basis,"")).toEqual({expiresAt:now+1000,refundApprovalReceipt:"purpose-bound-certificate"});
  const body=JSON.parse(f.send.mock.calls[1][1].body);
  expect(body.data.refundApprovalBasis).toEqual(basis);expect(body.data.refundApprovalWitness).toEqual({authorId:author,subject:"cashier"});expect(body.data.payload.receipt_no).toBe("");
 });
 it("requires the durable receipt when Main requested one",async()=>{
  const f=fixture();await expect(f.run({operationId:"exact-saved-operation"})).rejects.toMatchObject({code:"EAPPROVAL_DENIED"});
 });
});
