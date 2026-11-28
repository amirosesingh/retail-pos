import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({rest:vi.fn(),original:vi.fn(),approval:vi.fn(),caller:vi.fn(),scope:vi.fn()}));
vi.mock("@/core/api/pos-relay.server",()=>({serviceRest:mocks.rest,verifyRelayCaller:mocks.caller,hasServiceKey:()=>true,runRelayOp:vi.fn(),runRelayRead:vi.fn()}));
vi.mock("@/core/api/relay-policy.server",()=>({resolveRelayScope:mocks.scope,canCrossBranches:()=>false}));
vi.mock("../management-replica.server",()=>({managementReplicaScope:async()=>null}));
vi.mock("../session-verify.server",()=>({branchExists:async()=>true}));
vi.mock("../shift-author-verification.server",()=>({verifyFinancialAuthorAttestation:mocks.original,ShiftAuthorError:class extends Error{constructor(readonly code:string,message:string,readonly status=403){super(message);}}}));
vi.mock("../refund-approval-receipt.server",()=>({verifyRefundApprovalEvidence:mocks.approval}));
vi.mock("../external-supabase-config",()=>({supabaseConfig:()=>({url:"https://fixture.supabase.co",key:"fixture-public"}),runtimeEnvValue:()=>"fixture"}));
import {verifyFinancialRefundApproval,verifyFinancialRefundProjection,readFinancialRefundEventReceipt} from "../sync-financial-operation.server";
import {syncAggregateSchema} from "../sync-shift-intent.server";
import {handleSyncRequest} from "../sync-endpoint.server";
const terminal="11111111-1111-4111-8111-111111111111",operation="22222222-2222-4222-8222-222222222222",sale="33333333-3333-4333-8333-333333333333",shift="44444444-4444-4444-8444-444444444444",project="https://fixture.supabase.co";
const descriptor={id:terminal,platform:"pc",mode:"operations",branchId:"A"} as const;
const fixture=()=>{
  const before={id:sale,branchId:"A",shiftId:shift,totalAmount:"100.0000",discountAmount:"0.00",paymentType:"cash",paymentsJson:null,isRefunded:false,rowVersion:"9"};
  const event={version:1,operationId:operation,branchId:"A",terminalId:terminal,shiftId:shift,openingOrigin:{localAggregateId:operation,rowHash:"a".repeat(64)},sequence:"1",predecessorOperationId:operation,predecessorHash:"a".repeat(64),action:"REFUND",changes:[{saleId:sale,before,after:{...before,isRefunded:true,rowVersion:"10"}}]};
  const operationJson=JSON.stringify(event),payloadHash=createHash("sha256").update(operationJson).digest("hex");
  const attestation={version:1,algorithm:"Ed25519",keyId:operation,projectOrigin:project,terminalId:terminal,authorId:sale,subject:"original.cashier",branchId:"A",operationId:operation,action:"REFUND",payloadHash,signature:"fixture-signature"};
  const refundApproval={approvalJson:'{"domain":"signed-companion"}',approvalAttestation:{signature:"companion"}};
  const item={operationJson,attestation,refundApproval};
  const row={id:sale,store_id:"A",shift_id:shift,total_amount:"100.00",discount_amount:"0",is_refunded:true,row_version:10,created_at:"2026-11-18T00:00:00.000Z"};
  const ack={status:"financial_metadata_recorded",operationId:operation,payloadHash,sequence:"1",businessUploaded:false,shiftClosed:false};
  return{event,item,row,ack,payloadHash};
};
beforeEach(()=>{vi.resetAllMocks();mocks.original.mockImplementation(async({attestation}:{attestation:unknown})=>attestation);mocks.approval.mockResolvedValue({basis:{saleCreatedAt:"2026-11-18T00:00:00.000Z"}});
  mocks.caller.mockResolvedValue({kind:"terminal",terminal:descriptor});mocks.scope.mockResolvedValue({kind:"terminal",terminalId:terminal,storeId:"A",permissions:{},role:"staff",roleSlug:"staff",stale:false,managementDevice:false,managementReplica:false});});
describe("FIN62 refund approval server boundary",()=>{
  it("binds the current validator to original exact amount/version/op and separate evidence",async()=>{
    const f=fixture();await verifyFinancialRefundApproval({...f.item,terminal:descriptor,branchId:"A"});
    expect(mocks.approval).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({evidence:f.item.refundApproval,terminal:descriptor,anchor:{anchorKind:"financial",payloadJson:f.item.operationJson,attestation:f.item.attestation,operationId:operation,saleId:sale,expectedSaleVersion:"9",amountMinor:"10000"}}));
  });
  it("refuses unrelated event classes and fractional-cent approval bases",async()=>{
    const f=fixture();f.event.changes[0].before.totalAmount="100.001";
    await expect(verifyFinancialRefundApproval({...f.item,operationJson:JSON.stringify(f.event),terminal:descriptor,branchId:"A"})).rejects.toThrow();
    f.event.action="SALE";await expect(verifyFinancialRefundApproval({...f.item,operationJson:JSON.stringify(f.event),terminal:descriptor,branchId:"A"})).rejects.toThrow();expect(mocks.approval).not.toHaveBeenCalled();
  });
  it("returns only exact stored metadata ACK and distinguishes validated absence",async()=>{
    const f=fixture(),read={organizationId:"default",branchId:"A",terminalId:terminal,operationJson:f.item.operationJson,proof:f.item.attestation};
    mocks.rest.mockResolvedValueOnce(Response.json(null)).mockResolvedValueOnce(Response.json(f.ack));
    expect(await readFinancialRefundEventReceipt(read)).toBeNull();expect(await readFinancialRefundEventReceipt(read)).toEqual(f.ack);
    expect(JSON.parse(mocks.rest.mock.calls[0][1].body)).toEqual({p_org:"default",p_branch:"A",p_terminal:terminal,p_project_origin:project,p_raw:f.item.operationJson,p_proof:f.item.attestation});expect(mocks.approval).not.toHaveBeenCalled();
  });
  it.each(["business","shift","hash","extra","unavailable"])("does not invent acceptance for %s probe results",async kind=>{
    const f=fixture(),bad={...f.ack,...(kind==="business"?{businessUploaded:true}:kind==="shift"?{shiftClosed:true}:kind==="hash"?{payloadHash:"a".repeat(64)}:kind==="extra"?{authorized:true}:{})};
    mocks.rest.mockResolvedValue(kind==="unavailable"?new Response("unavailable",{status:503}):Response.json(bad));
    await expect(readFinancialRefundEventReceipt({organizationId:"default",branchId:"A",terminalId:terminal,operationJson:f.item.operationJson,proof:f.item.attestation})).rejects.toMatchObject({status:503});
  });
  it("checks fresh approval again before actual new business projection",async()=>{
    const f=fixture();mocks.rest.mockImplementation(async()=>Response.json([{...f.row,is_refunded:false,row_version:9}]));
    await verifyFinancialRefundProjection({items:[f.item],operations:[{table:"sales",rows:[f.row]}],terminal:descriptor,branchId:"A"});expect(mocks.approval).toHaveBeenCalledOnce();
    mocks.approval.mockRejectedValue(Object.assign(new Error("Current manager is inactive"),{status:403}));
    await expect(verifyFinancialRefundProjection({items:[f.item],operations:[{table:"sales",rows:[f.row]}],terminal:descriptor,branchId:"A"})).rejects.toMatchObject({status:403});
  });
  it("holds missing proof for a new refund instead of treating metadata as business acceptance",async()=>{
    const f=fixture();mocks.rest.mockResolvedValue(Response.json([{...f.row,is_refunded:false}]));
    await expect(verifyFinancialRefundProjection({operations:[{table:"sales",rows:[f.row]}],terminal:descriptor,branchId:"A"})).rejects.toMatchObject({status:403});expect(mocks.approval).not.toHaveBeenCalled();
  });
  it("allows exact canonical refunded history even after the transient grant expires, without reviving authority",async()=>{
    const f=fixture();mocks.rest.mockImplementation(async()=>Response.json([f.row]));mocks.approval.mockRejectedValue(new Error("Expired renderer grant"));
    await verifyFinancialRefundProjection({items:[f.item],operations:[{table:"sales",rows:[f.row]}],terminal:descriptor,branchId:"A"});expect(mocks.approval).not.toHaveBeenCalled();expect(mocks.original).toHaveBeenCalledOnce();
    await verifyFinancialRefundProjection({operations:[{table:"sales",rows:[f.row]}],terminal:descriptor,branchId:"A"});
  });
  it("compares canonical history with exact decimals and refuses mismatches or unavailable reads",async()=>{
    const f=fixture(),row={...f.row,total_amount:"9007199254740993.01"};
    mocks.rest.mockImplementation(async()=>new Response('[{"id":"'+sale+'","store_id":"A","shift_id":"'+shift+'","total_amount":9007199254740993.01,"discount_amount":0,"is_refunded":true,"row_version":10}]'));
    await verifyFinancialRefundProjection({operations:[{table:"sales",rows:[row]}],terminal:descriptor,branchId:"A"});
    await expect(verifyFinancialRefundProjection({operations:[{table:"sales",rows:[{...row,total_amount:"9007199254740993.02"}]}],terminal:descriptor,branchId:"A"})).rejects.toMatchObject({status:403});
    mocks.rest.mockResolvedValue(new Response("unavailable",{status:503}));await expect(verifyFinancialRefundProjection({operations:[{table:"sales",rows:[row]}],terminal:descriptor,branchId:"A"})).rejects.toMatchObject({status:503});
  });
  it("bounds companions to financial projections and rejects unknown flags",()=>{
    const f=fixture(),base={batchId:operation,organizationId:"default",branchId:"A",operations:[{table:"sales",rows:[f.row],changes:[]}]};
    expect(syncAggregateSchema.safeParse({...base,financialRefundApprovals:[f.item]}).success).toBe(false);
    expect(syncAggregateSchema.safeParse({...base,financialLedgerProjection:true,financialRefundApprovals:[f.item]}).success).toBe(true);
    expect(syncAggregateSchema.safeParse({...base,financialLedgerProjection:true,financialRefundApprovals:[{...f.item,approved:true}]}).success).toBe(false);
  });
  it.each(["amount","version","date"])("cannot borrow a valid companion for an altered %s projection",async kind=>{
    const f=fixture();mocks.rest.mockImplementation(async()=>Response.json([{...f.row,is_refunded:false,row_version:9}]));
    const row={...f.row,...(kind==="amount"?{total_amount:"101.00"}:kind==="version"?{row_version:11}:{created_at:"2026-11-18T01:00:00.000Z"})};
    await expect(verifyFinancialRefundProjection({items:[f.item],operations:[{table:"sales",rows:[row]}],terminal:descriptor,branchId:"A"})).rejects.toMatchObject({status:403});
    if(kind!=="date")expect(mocks.approval).not.toHaveBeenCalled();
  });
});
describe("actual FIN62 handler preflight ordering",()=>{
  const request=(f:ReturnType<typeof fixture>,approval=true)=>new Request("https://fixture-pos.test/api/v1/pos/sync",{method:"POST",body:JSON.stringify({terminalToken:terminal,deviceBindingProof:"a".repeat(64),sqlServerFinancialEvent:{organizationId:"default",branchId:"A",operationJson:f.item.operationJson,proof:f.item.attestation,...(approval?{refundApproval:f.item.refundApproval}:{})}})});
  it("returns exact accepted metadata before current approval and never invokes mutation RPC",async()=>{
    const f=fixture();mocks.rest.mockImplementation(async(path:string)=>{expect(path).toBe("rpc/pos_sync_read_financial_event_receipt");return Response.json(f.ack);});mocks.approval.mockRejectedValue(new Error("Revoked now"));
    const response=await handleSyncRequest(request(f,false));expect(response.status).toBe(200);expect(await response.json()).toEqual(f.ack);expect(mocks.approval).not.toHaveBeenCalled();expect(mocks.rest).toHaveBeenCalledOnce();
  });
  it("validates new approval after absent receipt and before registering the unchanged event",async()=>{
    const f=fixture(),order:string[]=[];mocks.rest.mockImplementation(async(path:string,init:{body:string})=>{order.push(path);if(path.endsWith("read_financial_event_receipt"))return Response.json(null);expect(path).toBe("rpc/pos_sync_register_financial_event");expect(JSON.parse(init.body)).toMatchObject({p_raw:f.item.operationJson,p_proof:f.item.attestation});return Response.json(f.ack);});mocks.approval.mockImplementation(async()=>{order.push("approval");return{};});
    const response=await handleSyncRequest(request(f));expect(response.status).toBe(200);expect(order).toEqual(["rpc/pos_sync_read_financial_event_receipt","approval","rpc/pos_sync_register_financial_event"]);
  });
  it("does not register new metadata when approval is denied or absent",async()=>{
    const f=fixture();mocks.rest.mockResolvedValue(Response.json(null));mocks.approval.mockRejectedValue(Object.assign(new Error("Denied"),{status:403,code:"REFUND_APPROVAL_REQUIRED"}));
    const response=await handleSyncRequest(request(f,false));expect(response.status).toBe(403);expect(mocks.rest).toHaveBeenCalledOnce();
  });
});
