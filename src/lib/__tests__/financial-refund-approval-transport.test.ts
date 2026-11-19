import { createRequire } from "node:module";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
const require=createRequire(import.meta.url);
const {financialOperationMessage}=require("../../../electron/security/financial-author-protocol.cjs");
const {buildRefundApprovalEvidence}=require("../../../electron/sync/refund-approval-evidence.cjs");
const {stableRefundUuid}=require("../../../electron/sync/refund-command.cjs");
const {prepareFinancialRefundApproval,decodeFinancialRefundReceipt,readFinancialRefundApproval,decodeFinancialRefundOriginal}=require("../../../electron/sync/financial-refund-approval.cjs");
const {CloudClient}=require("../../../electron/sync/cloud-client.cjs"),{PushWorker}=require("../../../electron/sync/push-worker.cjs"),{ChangeReader}=require("../../../electron/sync/change-reader.cjs");
const {loadRegistry}=require("../../../electron/db/schema-registry.cjs");
const branch="A",terminal="11111111-1111-4111-8111-111111111111",sale="22222222-2222-4222-8222-222222222222",shift="33333333-3333-4333-8333-333333333333";
const uuid="44444444-4444-4444-8444-444444444444",hash=(raw:string)=>createHash("sha256").update(raw).digest("hex");
function fixture(){
  const pair=generateKeyPairSync("ed25519"),operationId=stableRefundUuid({refundId:`refund:${sale}`});
  const person={authorId:uuid,subject:"actual.cashier"},scope={projectOrigin:"https://fixture.supabase.co",branchId:branch,terminalId:terminal,databaseGuid:"55555555-5555-4555-8555-555555555555"};
  const common={version:1,algorithm:"Ed25519",keyId:"66666666-6666-4666-8666-666666666666",...person,projectOrigin:scope.projectOrigin,terminalId:terminal};
  const signed=(raw:string)=>{const fields={...common,branchId:branch,operationId,action:"REFUND",payloadHash:hash(raw)};return {...fields,signature:sign(null,Buffer.from(financialOperationMessage(fields)),pair.privateKey).toString("base64url")};};
  const before={id:sale,branchId:branch,shiftId:shift,totalAmount:"100.000000",discountAmount:"0.00",paymentType:"cash",paymentsJson:null,isRefunded:false,rowVersion:"1"};
  const event={version:1,operationId,branchId:branch,terminalId:terminal,shiftId:shift,openingOrigin:{localAggregateId:uuid,rowHash:"a".repeat(64)},sequence:"1",predecessorOperationId:uuid,predecessorHash:"a".repeat(64),action:"REFUND",changes:[{saleId:sale,before,after:{...before,isRefunded:true,rowVersion:"2"}}]};
  const operationJson=JSON.stringify(event),attestation=signed(operationJson);
  const basis={operationId,refundKey:`refund:${sale}`,saleId:sale,expectedSaleVersion:"1",amountMinor:"10000",saleCreatedAt:"2026-11-18T00:00:00.000Z",scope,requester:person};
  const refundApproval=buildRefundApprovalEvidence({anchorKind:"financial",payloadJson:operationJson,attestation,basis,witness:person,
    approval:{id:uuid,mode:"offline_pin",approver:{authorId:"77777777-7777-4777-8777-777777777777",subject:"separate.manager"},credentialMethod:"pin",reason:"Damaged item",auditId:uuid,policyHash:"b".repeat(64),hostedReceipt:null},
    author:{assertCurrent(){},signFinancialOperation:({payloadJson}:{payloadJson:string})=>signed(payloadJson)}});
  const input={operationJson,attestation,refundApproval},envelope={version:2,route:"financial",...input};
  const row={operation_id:operationId,entity_id:sale,refund_branch_id:branch,refund_evidence_json:JSON.stringify(envelope),payload_json:operationJson,proof_json:JSON.stringify(attestation)};
  const history={kind:"MUTATION",branchId:branch,terminalId:terminal,shiftId:shift,operationId,sequence:"1",payloadJson:operationJson,payloadHash:hash(operationJson),proof:attestation,refundApproval};
  return{input,envelope,row,history,event,scope,operationId,signed};
}
afterEach(()=>vi.restoreAllMocks());
describe("durable FIN62 refund approval transport",()=>{
  it("hands SQL Server uppercase operation UUIDs to the sole financial sender without changing signed bytes",async()=>{
    const f=fixture(),saved=f.row.refund_evidence_json;
    const query=vi.fn(async()=>({recordset:[{...f.row,operation_id:f.operationId.toUpperCase()}]}));
    const request={input:vi.fn((_name:string,_value:unknown):unknown=>request),query};
    const reader=new ChangeReader({pool:{request:()=>request}},loadRegistry());
    expect(f.operationId.toUpperCase()).not.toBe(f.operationId);
    await expect(reader.readRefundRoute(branch,f.operationId.toUpperCase())).resolves.toBeNull();
    expect(f.row.refund_evidence_json).toBe(saved);
    await expect(reader.readRefundRoute(branch,uuid)).rejects.toMatchObject({code:"ESYNC_REFUND_APPROVAL_REQUIRED"});
  });
  it("decodes the separate evidence without changing original event/proof or assuming a manager signature",()=>{
    const f=fixture();expect(prepareFinancialRefundApproval(f.input,branch,terminal)).toBe(f.input);
    expect(decodeFinancialRefundReceipt(f.envelope,{operationId:f.operationId,saleId:sale,branchId:branch})).toMatchObject({payloadJson:f.input.operationJson,attestation:f.input.attestation,source:f.scope,basis:{requester:{subject:"actual.cashier"}}});
    expect(readFinancialRefundApproval(f.row,branch,terminal)).toEqual(f.input);
    expect(decodeFinancialRefundOriginal(f.input.operationJson,f.input.attestation,{operationId:f.operationId,saleId:sale,branchId:branch})).toMatchObject({expectedSaleVersion:"1",amountMinor:"10000"});
  });
  it.each(["route","operation","sale","branch","terminal","bytes","amount","unknown"])("holds mismatched %s without discarding old evidence",kind=>{
    const f=fixture();
    if(kind==="route")f.envelope.route="grouped";
    if(kind==="operation")f.row.operation_id=uuid;
    if(kind==="sale")f.row.entity_id=uuid;
    if(kind==="branch")f.row.refund_branch_id="B";
    if(kind==="bytes")f.envelope.operationJson+=" ";
    if(kind==="amount")f.envelope.refundApproval.approvalJson=f.envelope.refundApproval.approvalJson.replace('"10000"','"99999"');
    if(kind==="unknown")Object.assign(f.envelope,{approved:true});
    f.row.refund_evidence_json=JSON.stringify(f.envelope);
    expect(()=>readFinancialRefundApproval(f.row,branch,kind==="terminal"?uuid:terminal)).toThrow();
    expect(f.row.refund_evidence_json).toBeTruthy();
  });
  it("retains legacy rows with no companion rather than fabricating an approval",()=>{
    const f=fixture();expect(readFinancialRefundApproval({...f.row,refund_evidence_json:null},branch,terminal)).toBeNull();
  });
  it("reads the same immutable companion for metadata and final business projection after a new reader instance",async()=>{
    const f=fixture(),reader=new ChangeReader({},loadRegistry(),{financialOperations:{enabled:true}});
    reader.financialTransaction=async(work:(tx:object)=>unknown)=>work({});
    reader.financialQuery=vi.fn(async(_tx:object,sql:string,_inputs?:Record<string,unknown>)=>({recordset:sql.includes('COL_LENGTH')?[{ready:1}]:sql.includes('e.*,')?[{...f.row,branch_id:branch,terminal_id:terminal,shift_id:shift,event_kind:"MUTATION",action:"REFUND",sequence_text:"1",payload_hash:f.history.payloadHash}]:[f.row]}));
    const metadata=await reader.financialHistory(branch,terminal);expect(metadata[0].payloadJson).toBe(f.input.operationJson);expect(metadata[0].refundApproval).toEqual(f.input.refundApproval);
    expect(await reader.financialRefundApprovals(branch,terminal,[sale])).toEqual([f.input]);
    expect(reader.financialQuery.mock.calls.at(-1)![2]).toMatchObject({branch,terminal,sales:JSON.stringify([sale])});
  });
  it("preserves older FIN62 history when optional grouped-refund storage is absent",async()=>{
    const f=fixture(),reader=new ChangeReader({},loadRegistry(),{financialOperations:{enabled:true}});
    reader.financialTransaction=async(work:(tx:object)=>unknown)=>work({});
    reader.financialQuery=vi.fn(async(_tx:object,sql:string)=>{if(sql.includes('COL_LENGTH'))return{recordset:[{ready:0}]};throw Error('Missing optional refund columns must not be selected');});
    expect(await reader.financialRefundApprovals(branch,terminal,[sale])).toEqual([]);expect(reader.financialQuery).toHaveBeenCalledOnce();
    const saleEvent={...f.event,action:"SALE",changes:[{saleId:sale,before:null,after:f.event.changes[0].before}]},raw=JSON.stringify(saleEvent),proof={...f.input.attestation,action:"SALE",payloadHash:hash(raw)};
    reader.financialQuery.mockImplementation(async(_tx:object,sql:string)=>{expect(sql).not.toContain('refund_evidence_json');expect(sql).not.toContain('COL_LENGTH');return{recordset:[{branch_id:branch,terminal_id:terminal,shift_id:shift,event_kind:"MUTATION",action:"SALE",operation_id:f.operationId,sequence_text:"1",payload_json:raw,payload_hash:hash(raw),proof_json:JSON.stringify(proof)}]};});
    expect((await reader.financialHistory(branch,terminal))[0].payloadJson).toBe(raw);
  });
  it("forwards companion with metadata but never converts metadata success into business acceptance",async()=>{
    const f=fixture(),ack={status:"financial_metadata_recorded",operationId:f.operationId,payloadHash:f.history.payloadHash,sequence:"1",businessUploaded:false,shiftClosed:false};
    const reader={financialHistory:vi.fn().mockResolvedValueOnce([f.history]).mockResolvedValue([]),acknowledgeFinancialHistory:vi.fn()},cloud={pushFinancialEvent:vi.fn(async()=>ack)};
    const worker=new PushWorker({reader,cloud,registry:loadRegistry(),financialHistoryEnabled:true});worker.retry=async(work:()=>unknown)=>work();
    await worker.registerFinancialHistory(branch,terminal,()=>{});
    expect(cloud.pushFinancialEvent).toHaveBeenCalledExactlyOnceWith({branchId:branch,operationJson:f.input.operationJson,proof:f.input.attestation,refundApproval:f.input.refundApproval});
    expect(reader.acknowledgeFinancialHistory).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({refundApproval:f.input.refundApproval}),ack);
    cloud.pushFinancialEvent.mockResolvedValue({...ack,businessUploaded:true});reader.financialHistory.mockResolvedValue([f.history]);
    await expect(worker.registerFinancialHistory(branch,terminal,()=>{})).rejects.toMatchObject({code:"EFINANCIAL_HISTORY_UNCONFIRMED"});
    expect(reader.acknowledgeFinancialHistory).toHaveBeenCalledOnce();
  });
  it("keeps raw signed fields unchanged through the real HTTPS metadata and projection bodies",async()=>{
    const f=fixture(),client=new CloudClient({terminalStore:{read:()=>({tokenId:terminal,deviceBindingProof:"a".repeat(64)})},configStore:{get:()=>"https://fixture-pos.test"}}),bodies:Record<string,unknown>[]=[];
    vi.spyOn(globalThis,"fetch").mockImplementation(async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return Response.json({ok:true});});
    await client.pushFinancialEvent({branchId:branch,operationJson:f.input.operationJson,proof:f.input.attestation,refundApproval:f.input.refundApproval});
    await client.pushAggregate({batchId:uuid,branchId:branch,operations:[{table:"sales",rows:[],changes:[]}],financialLedgerProjection:true,financialRefundApprovals:[f.input]});
    expect(bodies[0]).toHaveProperty("sqlServerFinancialEvent.refundApproval",f.input.refundApproval);
    expect(bodies[1]).toHaveProperty("sqlServerAggregate.financialRefundApprovals",[f.input]);
    expect(JSON.stringify(bodies)).not.toMatch(/"credential":|"pin":|grantToken|sessionToken/);
    expect(()=>client.pushAggregate({batchId:uuid,branchId:branch,operations:[],financialRefundApprovals:[f.input]})).toThrow();
  });
});
