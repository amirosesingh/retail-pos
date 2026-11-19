import {createRequire} from "node:module";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
const relay=vi.hoisted(()=>({rest:vi.fn(),caller:vi.fn(),scope:vi.fn()}));
vi.mock("@/core/api/pos-relay.server",()=>({serviceRest:relay.rest,verifyRelayCaller:relay.caller,hasServiceKey:()=>true,runRelayOp:vi.fn(),runRelayRead:vi.fn()}));
vi.mock("@/core/api/relay-policy.server",()=>({resolveRelayScope:relay.scope,canCrossBranches:()=>false}));
vi.mock("../management-replica.server",()=>({managementReplicaScope:async()=>null}));
vi.mock("../session-verify.server",()=>({branchExists:async()=>true}));
vi.mock("../external-supabase-config",()=>({supabaseConfig:()=>({url:"https://fixture.supabase.co",key:"fixture-public"}),runtimeEnvValue:()=>"fixture-service"}));
import {handleSyncRequest} from "../sync-endpoint.server";
const require=createRequire(import.meta.url),{PushWorker}=require("../../../electron/sync/push-worker.cjs"),{CloudClient}=require("../../../electron/sync/cloud-client.cjs");
const {financialOperationMessage}=require("../../../electron/security/financial-author-protocol.cjs"),{buildRefundApprovalEvidence}=require("../../../electron/sync/refund-approval-evidence.cjs"),{stableRefundUuid}=require("../../../electron/sync/refund-command.cjs");
const id=(n:number)=>`${String(n).padStart(8,"0")}-1111-4111-8111-111111111111`,hash=(raw:string)=>createHash("sha256").update(raw).digest("hex");
const terminal=id(1),sale=id(2),shift=id(3),saleOperation=id(4),author=id(5),manager=id(6),key=id(7),opening=id(8);
type Row=Record<string,unknown>;
function fixture({ageDays=0,alterDate=false}={}){
  const createdAt=new Date(Date.now()-ageDays*86400000-3600000).toISOString(),pair=generateKeyPairSync("ed25519"),refundKey=`refund:${sale}`,refundOperation=stableRefundUuid({refundId:refundKey}),origin={localAggregateId:opening,rowHash:"a".repeat(64)};
  const common={version:1,algorithm:"Ed25519",keyId:key,projectOrigin:"https://fixture.supabase.co",terminalId:terminal,authorId:author,subject:"cashier",branchId:"A"};
  const proof=(operationId:string,action:string,raw:string)=>{const fields={...common,operationId,action,payloadHash:hash(raw)};return{...fields,signature:sign(null,Buffer.from(financialOperationMessage(fields)),pair.privateKey).toString("base64url")};};
  const before={id:sale,branchId:"A",shiftId:shift,totalAmount:"100.00",discountAmount:"0.00",paymentType:"cash",paymentsJson:null,isRefunded:false,rowVersion:"1"},after={...before,isRefunded:true,rowVersion:"2"};
  const salePayload=JSON.stringify({version:1,operationId:saleOperation,branchId:"A",terminalId:terminal,shiftId:shift,openingOrigin:origin,sequence:"1",predecessorOperationId:opening,predecessorHash:origin.rowHash,action:"SALE",changes:[{saleId:sale,before:null,after:before}]});
  const refundPayload=JSON.stringify({version:1,operationId:refundOperation,branchId:"A",terminalId:terminal,shiftId:shift,openingOrigin:origin,sequence:"2",predecessorOperationId:saleOperation,predecessorHash:hash(salePayload),action:"REFUND",changes:[{saleId:sale,before,after}]});
  const saleProof=proof(saleOperation,"SALE",salePayload),refundProof=proof(refundOperation,"REFUND",refundPayload);
  const scope={projectOrigin:common.projectOrigin,branchId:"A",terminalId:terminal,databaseGuid:id(9)};
  const basis={operationId:refundOperation,refundKey,saleId:sale,expectedSaleVersion:"1",amountMinor:"10000",saleCreatedAt:createdAt,scope,requester:{authorId:author,subject:"cashier"}};
  const refundApproval=buildRefundApprovalEvidence({anchorKind:"financial",payloadJson:refundPayload,attestation:refundProof,basis,witness:basis.requester,
    approval:{id:id(10),mode:"offline_pin",approver:{authorId:manager,subject:"manager"},credentialMethod:"pin",reason:"Returned item",auditId:id(11),policyHash:"b".repeat(64),hostedReceipt:null},
    author:{assertCurrent(){},signFinancialOperation:({payloadJson}:{payloadJson:string})=>proof(refundOperation,"REFUND",payloadJson)}});
  const saved={operationJson:refundPayload,attestation:refundProof,refundApproval};
  const metadata=[{kind:"MUTATION",branchId:"A",terminalId:terminal,shiftId:shift,operationId:saleOperation,sequence:"1",payloadJson:salePayload,payloadHash:hash(salePayload),proof:saleProof},
    {kind:"MUTATION",branchId:"A",terminalId:terminal,shiftId:shift,operationId:refundOperation,sequence:"2",payloadJson:refundPayload,payloadHash:hash(refundPayload),proof:refundProof,refundApproval}];
  const row={id:sale,store_id:"A",shift_id:shift,bill_number:"OFFLINE-FIRST",total_amount:"100.00",discount_amount:"0.00",payment_type:"cash",payments:null,is_refunded:true,row_version:2,created_at:alterDate?new Date(Date.now()).toISOString():createdAt};
  let cloudSale:Row|null=null,managerActive=true,applies=0,loseBusinessReply=false,localAccepted=false;
  const nodes=new Map<string,{raw:string;proof:unknown;ack:Row}>(),batches=new Map<string,Row>(),acknowledged=new Set<string>(),order:string[]=[];
  relay.caller.mockResolvedValue({kind:"terminal",terminal:{id:terminal,platform:"pc",mode:"operations",branchId:"A"}});
  relay.scope.mockResolvedValue({kind:"terminal",terminalId:terminal,storeId:"A",role:"staff",roleSlug:"staff",permissions:{},stale:false,managementDevice:false,managementReplica:false});
  relay.rest.mockImplementation(async(path:string,init?:{body?:string})=>{
    const url=new URL(path,"https://fixture.invalid"),body=init?.body?JSON.parse(init.body):null;
    if(url.pathname==="/app_users"){
      const who=url.searchParams.get("id")?.slice(3),people=[{id:author,user_id:"cashier",role:"staff",role_slug:"staff",store_id:"A",is_active:true,permissions:{can_process_sale:true,can_process_refund:true}},
        {id:manager,user_id:"manager",role:"manager",role_slug:"manager",store_id:"A",is_active:managerActive,permissions:{can_process_refund:true,approval_pin_enabled:true}}];
      return Response.json(people.filter(p=>p.id===who));
    }
    if(url.pathname==="/authorization_actions")return Response.json([{action_key:"refund",scope_type:"branch",scope_id:"A",mode:"pin",is_enabled:true,allowed_roles:["manager","admin"],allowed_user_ids:[],authority_limits:{},extra_authority:{},absolute_ceilings:{},require_reason:true}]);
    if(url.pathname==="/pos_store_settings")return Response.json([{store_id:"",allow_offline_approvals:true,online_only_refund:false,max_refund_days_limit:30,require_manager_pin_for_refund:true}]);
    if(url.pathname==="/sales")return Response.json(cloudSale?[cloudSale]:[]);
    if(url.pathname==="/rpc/pos_shift_author_key")return Response.json({terminal_enrolled:true,key:{key_id:key,author_id:author,terminal_id:terminal,project_origin:common.projectOrigin,subject:"cashier",public_key:pair.publicKey.export({type:"spki",format:"der"}).toString("base64url"),revoked_at:null}});
    if(url.pathname==="/rpc/pos_sync_read_financial_event_receipt"){
      const event=JSON.parse(body.p_raw),prior=nodes.get(event.operationId);
      if(prior){expect(prior.raw).toBe(body.p_raw);expect(prior.proof).toEqual(body.p_proof);}return Response.json(prior?.ack??null);
    }
    if(url.pathname==="/rpc/pos_sync_register_financial_event"){
      const event=JSON.parse(body.p_raw);expect(cloudSale).toBeNull();
      if(event.action==="REFUND"){expect(nodes.has(saleOperation)).toBe(true);expect(event.changes[0].before).toEqual(before);expect(event.predecessorHash).toBe(hash(salePayload));}
      const ack={status:"financial_metadata_recorded",operationId:event.operationId,payloadHash:hash(body.p_raw),sequence:event.sequence,businessUploaded:false,shiftClosed:false};
      nodes.set(event.operationId,{raw:body.p_raw,proof:body.p_proof,ack});order.push(event.action+" metadata");return Response.json(ack);
    }
    if(url.pathname==="/rpc/pos_sync_push_financial_business_aggregate"){
      expect(nodes.has(saleOperation)&&nodes.has(refundOperation)).toBe(true);expect(body.p_operations[0].rows[0]).toEqual(row);
      if(!batches.has(body.p_batch)){applies++;cloudSale={...row};batches.set(body.p_batch,{ok:true,batch_id:body.p_batch});order.push("business applied");}
      return Response.json(batches.get(body.p_batch));
    }
    throw Error("Unexpected isolated POS endpoint: "+path);
  });
  vi.spyOn(globalThis,"fetch").mockImplementation(async(_url,init)=>{
    const request=new Request("https://fixture-pos.test/api/v1/pos/sync",init),body=JSON.parse(String(init?.body));
    const response=await handleSyncRequest(request);
    if(loseBusinessReply&&body.sqlServerAggregate?.financialLedgerProjection&&response.ok){loseBusinessReply=false;throw new TypeError("fixture lost response after commit");}
    return response;
  });
  const cloud=new CloudClient({terminalStore:{read:()=>({tokenId:terminal,deviceBindingProof:"c".repeat(64)})},configStore:{get:()=>"https://fixture-pos.test"}});
  const reader={financialHistory:vi.fn(async()=>metadata.filter(item=>!acknowledged.has(item.operationId))),acknowledgeFinancialHistory:vi.fn(async(item:{operationId:string})=>{acknowledged.add(item.operationId);}),
    pendingAggregates:vi.fn(async(_branch:string,_limit:number,deferred:string[])=>localAccepted||deferred.includes(saleOperation)?[]:[{aggregateId:saleOperation,changes:[{entity_type:"sales",entity_id:JSON.stringify({id:sale}),key:{id:sale},operation:"update"}]}]),
    financialAggregateRequired:async()=>true,financialHistoryReady:async()=>acknowledged.size===2,financialRefundApprovals:async()=>[saved],rows:async()=>[row],
    acknowledgeAggregate:vi.fn(async()=>{localAccepted=true;}),failAggregate:vi.fn()};
  const registry={tables:[{cloudTable:"sales",sqlServerTable:"sales",scope:"branch",direction:"both",dependencyOrder:1,columns:[{cloudColumn:"id",primaryKey:true},{cloudColumn:"store_id"}]}]};
  const worker=new PushWorker({reader,cloud,registry,checkpoints:{},financialHistoryEnabled:true});worker.retry=async(work:()=>unknown)=>work();
  return{run:()=>worker.pushAggregates("A",100),reader,nodes,order,row,get applies(){return applies;},get cloudSale(){return cloudSale;},get localAccepted(){return localAccepted;},
    revokeManager(){managerActive=false;},loseBusinessResponse(){loseBusinessReply=true;}};
}
afterEach(()=>vi.restoreAllMocks());
describe("offline sale then refund before the first cloud business upload",()=>{
  it("registers original SALE and REFUND metadata, validates fresh approval, then saves only the latest business projection",async()=>{
    const f=fixture();expect(await f.run()).toBe(1);expect(f.order).toEqual(["SALE metadata","REFUND metadata","business applied"]);
    expect(f.applies).toBe(1);expect(f.cloudSale).toEqual(f.row);expect(f.localAccepted).toBe(true);expect(f.reader.acknowledgeFinancialHistory).toHaveBeenCalledTimes(2);
  });
  it("replays a lost business reply without new approval authority or a duplicate application",async()=>{
    const f=fixture();f.loseBusinessResponse();await expect(f.run()).rejects.toThrow("lost response");expect(f.applies).toBe(1);expect(f.localAccepted).toBe(false);
    f.revokeManager();expect(await f.run()).toBe(1);expect(f.applies).toBe(1);expect(f.localAccepted).toBe(true);
  });
  it("keeps age policy when the signed original sale is outside its refund window",async()=>{
    const f=fixture({ageDays:31});await expect(f.run()).rejects.toThrow();expect(f.applies).toBe(0);expect(f.localAccepted).toBe(false);expect(f.nodes.size).toBe(1);
  });
  it("refuses to upload a newer created_at than the signed local sale age witness",async()=>{
    const f=fixture({alterDate:true});expect(await f.run()).toBe(0);expect(f.applies).toBe(0);expect(f.localAccepted).toBe(false);
  });
});
