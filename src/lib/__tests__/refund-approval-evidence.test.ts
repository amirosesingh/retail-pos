import {createHash,generateKeyPairSync,sign,verify} from "node:crypto";
import {createRequire} from "node:module";
import {describe,it,expect} from "vitest";
const require=createRequire(import.meta.url);
const protocol=require("../../../electron/sync/refund-approval-evidence.cjs");
const {financialOperationMessage}=require("../../../electron/security/financial-author-protocol.cjs");
const {stableRefundUuid}=require("../../../electron/sync/refund-command.cjs");
const uuid=(digit:string)=>`${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const digest=(raw:string)=>createHash("sha256").update(raw).digest("hex");
function fixture(anchorKind:"grouped"|"financial"="grouped"){
 const operator=uuid("1"),keyId=uuid("2"),terminalId=uuid("3"),saleId=uuid("4");
 const projectOrigin="https://isolated-beta.supabase.co",refundKey=`refund:${saleId}`,operationId=stableRefundUuid({refundId:refundKey});
 const source={projectOrigin,branchId:"A",terminalId,databaseGuid:uuid("5"),...(anchorKind==="grouped"?{feedEpoch:uuid("6"),installationGeneration:uuid("7")}: {})};
 const keys=generateKeyPairSync("ed25519");
 function author(authorId=operator,subject="cashier",id=keyId){return{assertCurrent(){},signFinancialOperation(input:{branchId:string;operationId:string;action:string;payloadJson:string}){
  const fields={version:1,algorithm:"Ed25519",keyId:id,projectOrigin,terminalId,authorId,subject,branchId:input.branchId,operationId:input.operationId,action:input.action,payloadHash:digest(input.payloadJson)};
  return{...fields,signature:sign(null,Buffer.from(financialOperationMessage(fields)),keys.privateKey).toString("base64url")};
 }};}
 const signer=author(),payloadJson='{"original":"financial bytes remain unchanged"}';
 const attestation=signer.signFinancialOperation({branchId:"A",operationId,action:"REFUND",payloadJson});
 const basis={operationId,refundKey,saleId,expectedSaleVersion:"1",amountMinor:"1230",saleCreatedAt:"2026-11-18T00:00:00.000Z",scope:source,requester:{authorId:operator,subject:"cashier"}};
 const approval={id:uuid("8"),mode:"offline_pin",approver:{authorId:uuid("9"),subject:"manager"},credentialMethod:"pin",reason:"Reviewed",auditId:uuid("8"),policyHash:"a".repeat(64),hostedReceipt:null};
 const input={anchorKind,payloadJson,attestation,basis,witness:basis.requester,approval,author:signer};
 const build=(changes:Record<string,unknown>={})=>protocol.buildRefundApprovalEvidence({...input,...changes});
 const anchor={anchorKind,payloadJson,attestation,scope:source,operationId,saleId,expectedSaleVersion:"1",amountMinor:"1230"};
 return{input,build,anchor,keys,author,source};
}
describe("durable native refund approval companion",()=>{
 it.each(["grouped","financial"] as const)("survives serialization/restart for %s without replacing the monetary signature",kind=>{
  const f=fixture(kind),original=JSON.stringify(f.input.attestation),evidence=JSON.parse(JSON.stringify(f.build()));
  const decoded=protocol.decodeRefundApprovalEvidence(evidence,f.anchor);
  expect(decoded.basis).toEqual(f.input.basis);expect(decoded.approval.mode).toBe("offline_pin");
  const {signature,...unsigned}=evidence.approvalAttestation;
  expect(verify(null,Buffer.from(financialOperationMessage(unsigned)),f.keys.publicKey,Buffer.from(signature,"base64url"))).toBe(true);
  expect(evidence.approvalAttestation.payloadHash).not.toBe(f.input.attestation.payloadHash);
  expect(JSON.stringify(f.input.attestation)).toBe(original);
  expect(evidence.approvalJson).not.toMatch(/fixture-pin|pin_hash|accessToken|sessionToken|grantToken/);
 });
 it("attributes a fresh recovery reviewer separately from the original financial author",()=>{
  const f=fixture(),witness={authorId:uuid("a"),subject:"reviewer"};
  const evidence=f.build({witness,author:f.author(witness.authorId,witness.subject,uuid("b"))});
  const parsed=protocol.decodeRefundApprovalEvidence(evidence,f.anchor);
  expect(parsed.witness).toEqual(witness);expect(parsed.basis.requester).toEqual(f.input.basis.requester);
  expect(parsed.approvalAttestation.authorId).toBe(witness.authorId);
 });
 it.each(["operationId","saleId","expectedSaleVersion","amountMinor"])("rejects another exact %s",key=>{
  const f=fixture(),evidence=f.build();expect(()=>protocol.decodeRefundApprovalEvidence(evidence,{...f.anchor,[key]:key==="amountMinor"?"1231":key==="expectedSaleVersion"?"2":uuid("c")})).toThrow();
 });
 it.each(["branchId","terminalId","databaseGuid","feedEpoch","installationGeneration"])("rejects a changed %s",key=>{
  const f=fixture();expect(()=>protocol.decodeRefundApprovalEvidence(f.build(),{...f.anchor,scope:{...f.source,[key]:key==="branchId"?"B":uuid("c")}})).toThrow();
 });
 it("rejects another original payload, signer identity, domain, duplicate key or unrecognized field",()=>{
  const f=fixture(),evidence=f.build();
  expect(()=>protocol.decodeRefundApprovalEvidence(evidence,{...f.anchor,payloadJson:f.anchor.payloadJson+" "})).toThrow();
  expect(()=>protocol.decodeRefundApprovalEvidence(evidence,{...f.anchor,attestation:{...f.input.attestation,authorId:uuid("b")}})).toThrow();
  const raw=evidence.approvalJson;
  for(const changed of[raw.replace(protocol.DOMAIN,"other-domain"),raw.replace('"version":1','"version":1,"version":1'),raw.replace('"version":1','"version":1,"credential":"secret"')])expect(()=>protocol.parseRefundApprovalJson(changed)).toThrow();
 });
 it("requires real source shapes rather than invented financial generation/epoch defaults",()=>{
  const f=fixture("financial");expect(()=>f.build({anchorKind:"grouped"})).toThrow();
  expect(()=>protocol.normalizeRefundApprovalBasis({...f.input.basis,scope:{...f.source,feedEpoch:uuid("6")}})).toThrow();
 });
 it.each(["01230","12.30","1e3",1230,"9007199254740992"])("rejects rounded/noncanonical minor money %s",amountMinor=>{
  const f=fixture();expect(()=>f.build({basis:{...f.input.basis,amountMinor}})).toThrow();
 });
 it("never turns a direct mode into a PIN assertion or stores a raw hosted grant",()=>{
  const f=fixture();
  expect(()=>f.build({approval:{...f.input.approval,mode:"direct"}})).toThrow();
  const hosted={...f.input.approval,mode:"hosted",approver:null,credentialMethod:null,auditId:null,hostedReceipt:"purpose-bound-receipt"};
  expect(protocol.decodeRefundApprovalEvidence(f.build({approval:hosted}),f.anchor).approval.hostedReceipt).toBe("purpose-bound-receipt");
  expect(()=>f.build({approval:{...hosted,grantToken:"bearer"}})).toThrow();
 });
 it.each(["2026-11-18T00:00:00Z","2026-11-18T08:00:00.000+08:00","2026-02-30T00:00:00.000Z","invalid",null])("rejects a noncanonical saved sale date %s",saleCreatedAt=>{
  const f=fixture();expect(()=>f.build({basis:{...f.input.basis,saleCreatedAt}})).toThrow();
 });
});
