import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {describe,it,expect,vi} from "vitest";
const require=createRequire(import.meta.url);
const {readPendingOriginal,publicPendingStatus,attachPendingApproval}=require("../../../electron/sync/refund-recovery-native.cjs");
const {RefundApprovalService}=require("../../../electron/refund-approval-service.cjs");
const {DOMAIN,stableRefundUuid}=require("../../../electron/sync/refund-command.cjs");
const {savedRefund}=require("../../../electron/sync/grouped-refund-native.cjs");
const id=(n:string)=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
function fixture(){
 const saleId=id("1"),itemId=id("2"),productId=id("3"),terminalId=id("4"),requesterId=id("5"),managerId=id("6"),refundId="legacy-custom-refund-id";
 const operationId=stableRefundUuid({refundId}),branchId="A",source:Record<string,string>={branchId,terminalId,databaseGuid:id("7"),feedEpoch:id("8"),installationGeneration:id("9")};
 const payload={domain:DOMAIN,scope:source,command:{branchId,operationId,refundKey:refundId,saleId,expectedSaleVersion:1,
  lines:[{item_id:itemId,qty:1,expected_refunded_qty:0,expected_row_version:1}],reason:"Original reason"},
  items:[{itemId,nativeItemId:itemId,productId,nativeMovementId:stableRefundUuid({refundId,itemId})}]};
 const refundJson=JSON.stringify(payload),projectOrigin="https://isolated-beta.supabase.co";
 const author={assertCurrent:vi.fn(),signFinancialOperation(input:{branchId:string;operationId:string;payloadJson:string}){return{version:1,algorithm:"Ed25519",keyId:id("a"),projectOrigin,terminalId,authorId:requesterId,subject:"cashier",branchId,operationId:input.operationId,action:"REFUND",payloadHash:createHash("sha256").update(input.payloadJson).digest("hex"),signature:"A".repeat(86)};}};
 const attestation=author.signFinancialOperation({branchId,operationId,payloadJson:refundJson});
 const journal=[{change_id:"1",entity_type:"sales",entity_id:JSON.stringify({id:saleId}),operation:"update"},
  {change_id:"2",entity_type:"sale_items",entity_id:JSON.stringify({id:itemId}),operation:"update"},
  {change_id:"3",entity_type:"products",entity_id:JSON.stringify({id:productId}),operation:"update"},
  {change_id:"4",entity_type:"stock_delta_applied",entity_id:JSON.stringify({movement_id:payload.items[0].nativeMovementId}),operation:"insert"}];
 const initial=JSON.stringify({refundJson,attestation,journal});
 let evidence:string|null=initial,db=source.databaseGuid,now=Date.parse("2026-11-18T00:00:00Z"),failWrite=false,financial=false,changeDbAtBegin=false,storage=true;
 let financialEvent:Record<string,unknown>|null=null;
 const calls:string[]=[],scope={branchId,terminalId,requesterId,requester:"cashier",assertCurrent:vi.fn()};
 const sale={id:saleId,store_id:branchId,total_amount:"12.300000000000",bill_number:"A-123",row_version:2,is_refunded:true,created_at:new Date(now-86400000)};
 const row=()=>({operation_id:operationId,entity_id:saleId,note:"Original reason",refund_branch_id:financial&&evidence===null?null:branchId,refund_evidence_json:evidence,
  refund_acceptance_json:null,total_amount:sale.total_amount,row_version:sale.row_version,is_refunded:sale.is_refunded,sale_created_at:sale.created_at,sale_shift_id:financial?id("d"):null,pending_count:4,last_error:null});
 class Transaction {draft:string|null=null;async begin(){calls.push("BEGIN");if(changeDbAtBegin)db=id("b");}request(){return request(this);}async commit(){if(this.draft!==null)evidence=this.draft;calls.push("COMMIT");}async rollback(){this.draft=null;calls.push("ROLLBACK");}}
 function request(tx?:Transaction){const input:Record<string,unknown>={};return{input(key:string,value:unknown){input[key]=value;return this;},async query(sql:string){calls.push(sql.trim());
  if(sql.includes("SELECT TOP(2) r.operation_id"))return{recordset:input.op&&input.op!==operationId||input.branch!==branchId||input.sale!==saleId?[]:[row()]};
  if(sql.includes("SELECT TOP(2) operation_id,refund_evidence_json"))return{recordset:input.op&&input.op!==operationId||input.sale!==saleId?[]:[row()]};
  if(sql.includes("refund_storage_ready"))return{recordset:[{refund_storage_ready:storage?1:0}]};
  if(sql.includes("FROM sys.database_recovery_status"))return{recordset:[{database_guid:db}]};
  if(sql.startsWith("SELECT id,store_id,bill_number"))return{recordset:[structuredClone(sale)]};
  if(sql.includes("SELECT CASE WHEN OBJECT_ID"))return{recordset:[{ready:1}]};
  if(sql.includes("FROM dbo.pos_sync_shift_financial_events e"))return{recordset:financialEvent?[financialEvent]:[]};
  if(sql.includes("UPDATE dbo.local_operation_receipts SET refund_branch_id=@branch,refund_evidence_json=@after")){
   if(failWrite)throw Error("receipt write failed");if(input.before!==evidence||!tx)throw Error("original changed");tx.draft=String(input.after);return{rowsAffected:[1]};
  }
  throw Error("Unexpected SQL");
 }};}
 const manager={pool:{request:()=>request()},sql:()=>({Transaction,ISOLATION_LEVEL:{SERIALIZABLE:4}})};
 const person=(actor:string,user:string,role:string)=>({id:actor,user_id:user,role_slug:role,role,is_active:true,permissions:{can_process_refund:true}});
 const policy={rules:[{action_key:"refund",scope_type:"branch",scope_id:branchId,is_enabled:true,mode:"pin",require_reason:true,allowed_roles:["manager"],allowed_user_ids:[],authority_limits:{},extra_authority:{},absolute_ceilings:{}}],settings:[{store_id:"",allow_offline_approvals:true,online_only_refund:false}],requester:person(requesterId,"cashier","staff"),actor:person(managerId,"manager","manager")};
 const store={request:(_tx:unknown)=>request(),readPolicy:vi.fn(async()=>structuredClone(policy)),readPrior:async()=>null,persist:vi.fn(async(_scope:unknown,_request:unknown,_saved:unknown,check:(p:typeof policy)=>Promise<void>)=>check(structuredClone(policy)))};
 const service=new RefundApprovalService({captureScope:()=>scope,store,verify:vi.fn(async()=>({ok:true,staff:{id:managerId,username:"manager"},credentialMethod:"pin"})),
  captureSource:async()=>({scope:{projectOrigin,...source},anchorKind:financial?"financial":"grouped",assertCurrent:scope.assertCurrent}),readPending:(s:unknown,sale:string,op:string,tx:unknown)=>readPendingOriginal(manager,s,sale,op,tx),now:()=>now});
 function enableFinancial(){
  financial=true;evidence=null;delete source.feedEpoch;delete source.installationGeneration;
  const fact={id:saleId,branchId,shiftId:id("d"),totalAmount:"12.30",paymentType:"cash",paymentsJson:null,discountAmount:"0",isRefunded:false,rowVersion:"1"};
  const event={version:1,operationId,branchId,terminalId,shiftId:id("d"),sequence:"1",openingOrigin:{localAggregateId:id("e"),rowHash:"f".repeat(64)},
   predecessorOperationId:id("e"),predecessorHash:"f".repeat(64),action:"REFUND",changes:[{saleId,before:fact,after:{...fact,isRefunded:true,rowVersion:"2"}}]};
  const raw=JSON.stringify(event),proof=author.signFinancialOperation({branchId,operationId,payloadJson:raw});
  financialEvent={operation_id:operationId,shift_id:event.shiftId,sequence:"1",payload_json:raw,payload_hash:proof.payloadHash,proof_json:JSON.stringify(proof),
   origin_kind:"OPEN",local_aggregate_id:id("e"),row_hash:"f".repeat(64),server_basis_id:null,server_basis_hash:null,head_sequence:"1",head_operation_id:operationId,head_hash:proof.payloadHash};
  return {raw,proof};
 }
 async function approval(){return service.authorize({saleId,branchId,registeredTerminalId:terminalId,requestedAmount:12.3,username:"manager",credential:"fixture-pin",reason:"Renew original upload",recoveryOperationId:operationId});}
 const attach=async(token:string)=>{const pending=await readPendingOriginal(manager,scope,saleId,operationId);return attachPendingApproval(manager,{scope,saleId,operationId,author,admission:service.admission(token,{saleId,branchId,refundId:pending.refundId})});};
 return{manager,scope,saleId,operationId,source,sale,policy,service,author,initial,calls,row,approval,attach,evidence:()=>evidence??"",enableFinancial,
  wrongOrigin:()=>{if(financialEvent)financialEvent.local_aggregate_id=id("b");},
  wrongDb:()=>{changeDbAtBegin=true;},failWrite:()=>{failWrite=true;},missingStorage:()=>{storage=false;},advance:()=>{now+=600000;}};
}
describe("renewal of the exact saved native refund",()=>{
 it("refuses missing optional storage before binding absent SQL columns or changing money",async()=>{
  const f=fixture();f.missingStorage();await expect(readPendingOriginal(f.manager,f.scope,f.saleId)).rejects.toMatchObject({code:"ESYNC_REFUND_STORAGE_REQUIRED"});
  expect(f.evidence()).toBe(f.initial);expect(f.calls).toHaveLength(1);expect(f.calls[0]).toContain("COL_LENGTH");
 });
 it("adds a new current-source review to an old NULL-evidence financial receipt while preserving its event and signature",async()=>{
  const f=fixture(),original=f.enableFinancial();expect(f.row().refund_evidence_json).toBeNull();
  const pending=await readPendingOriginal(f.manager,f.scope,f.saleId);
  expect(publicPendingStatus(pending)).toMatchObject({route:"financial",requiresApproval:true,refundId:`financial-operation:${f.operationId}`,expectedSaleVersion:"1"});
  expect(Object.keys(pending.source)).toHaveLength(4);
  const approved=await f.approval();await f.attach(approved.grantToken);const saved=JSON.parse(f.evidence());
  expect(saved).toMatchObject({version:2,route:"financial",operationJson:original.raw,attestation:original.proof});
  expect(publicPendingStatus(await readPendingOriginal(f.manager,f.scope,f.saleId))).toMatchObject({pending:true,requiresApproval:false});
  expect(f.calls.some(sql=>/UPDATE dbo\.pos_sync_shift_financial|INSERT dbo\.pos_sync_shift_financial|UPDATE dbo\.(sales|products)/i.test(sql))).toBe(false);
 });
 it.each([false,true])("readmits the same UI recovery grant for custom original IDs (financial=%s)",async financial=>{
  const f=fixture();if(financial)f.enableFinancial();const approved=await f.approval();
  await expect(f.service.authorize({saleId:f.saleId,branchId:"A",registeredTerminalId:f.scope.terminalId,requestedAmount:12.3,
   recoveryOperationId:f.operationId,grantToken:approved.grantToken})).resolves.toMatchObject({ok:true,grantToken:approved.grantToken});
  await expect(f.service.authorize({saleId:f.saleId,branchId:"A",registeredTerminalId:f.scope.terminalId,requestedAmount:12.3,
   recoveryOperationId:id("c"),grantToken:approved.grantToken})).rejects.toMatchObject({code:"EAPPROVAL_CONTEXT"});
 });
 it("holds an old financial event with a foreign or changed origin",async()=>{
  const f=fixture();f.enableFinancial();f.wrongOrigin();await expect(f.approval()).rejects.toThrow();expect(f.row().refund_evidence_json).toBeNull();
 });
 it("finds a custom original refund ID and upgrades only its approval companion atomically",async()=>{
  const f=fixture(),pending=await readPendingOriginal(f.manager,f.scope,f.saleId);
  expect(publicPendingStatus(pending)).toMatchObject({ok:true,pending:true,requiresApproval:true,operationId:f.operationId,refundId:"legacy-custom-refund-id",amountMinor:"1230",expectedSaleVersion:"1",route:"grouped"});
  const approved=await f.approval();expect(await f.attach(approved.grantToken)).toEqual({ok:true,operationId:f.operationId});
  const before=JSON.parse(f.initial),after=JSON.parse(f.evidence());expect(after).toMatchObject({version:2,route:"grouped"});
  expect(after.refundJson).toBe(before.refundJson);expect(after.attestation).toEqual(before.attestation);expect(after.journal).toEqual(before.journal);
  expect(savedRefund(f.row(),"A").refundApproval).toEqual(after.refundApproval);
  expect(f.calls.some(sql=>/UPDATE dbo\.(sales|products|sale_items)|INSERT dbo\.(stock_delta_applied|sync_change_journal)/i.test(sql))).toBe(false);
 });
 it("survives expired process grants and reports durable pending work without asking for another PIN",async()=>{
  const f=fixture(),approved=await f.approval();await f.attach(approved.grantToken);f.advance();f.service.grants.clear();
  expect(publicPendingStatus(await readPendingOriginal(f.manager,f.scope,f.saleId))).toMatchObject({pending:true,requiresApproval:false});
  expect(f.evidence()).not.toMatch(/fixture-pin|pin_hash|grantToken|sessionToken/);
 });
 it("accepts a lost-reply replay without another receipt update or stock mutation",async()=>{
  const f=fixture(),approved=await f.approval();await f.attach(approved.grantToken);f.advance();
  const before=f.evidence(),writes=f.calls.filter(sql=>sql.startsWith("UPDATE dbo.local_operation_receipts")).length;
  await expect(f.attach(approved.grantToken)).resolves.toMatchObject({ok:true});expect(f.evidence()).toBe(before);
  expect(f.calls.filter(sql=>sql.startsWith("UPDATE dbo.local_operation_receipts"))).toHaveLength(writes);
 });
 it.each(["database","policy","write"])("preserves all original data after %s failure",async kind=>{
  const f=fixture(),approved=await f.approval();
  if(kind==="database")f.wrongDb();if(kind==="policy")f.policy.actor.is_active=false;if(kind==="write")f.failWrite();
  await expect(f.attach(approved.grantToken)).rejects.toThrow();expect(f.evidence()).toBe(f.initial);expect(f.calls.at(-1)).toBe("ROLLBACK");
 });
 it("refuses another branch, operation, amount or changed saved sale before renewal",async()=>{
  const f=fixture();expect(await readPendingOriginal(f.manager,{...f.scope,branchId:"B"},f.saleId)).toBeNull();
  expect(await readPendingOriginal(f.manager,f.scope,f.saleId,id("c"))).toBeNull();
  f.sale.total_amount="12.31";await expect(f.approval()).rejects.toThrow();expect(f.evidence()).toBe(f.initial);
 });
});

function mainHandlers(f:ReturnType<typeof fixture>){
 const text=readFileSync(new URL("../../../electron/main.cjs",import.meta.url),"utf8");
 const start=text.indexOf('  ipcMain.handle("receipts:refund-approval-status"'),end=text.indexOf('  const transferCentralHandoff',start);
 expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
 const handlers=new Map<string,(event:unknown,input:unknown)=>Promise<Record<string,unknown>>>();
 const frame={},webContents={mainFrame:frame},sender={sender:webContents,senderFrame:frame};
 const scope=vi.fn(()=>f.scope),schedule=vi.fn();
 runInNewContext(text.slice(start,end),{ipcMain:{handle:(channel:string,handler:(event:unknown,input:unknown)=>Promise<Record<string,unknown>>)=>handlers.set(channel,handler)},
  guard:require("../../../electron/ipc-guard.cjs"),mainWindow:{webContents},captureOfflineApprovalScope:scope,recordId:(v:string)=>v,
  databaseManager:f.manager,refundApprovalService:f.service,syncCoordinator:{withExclusive:(work:()=>unknown)=>work()},
  shiftAuthority:{captureFinancial:()=>({}),prepare:async()=>f.author},scheduleAutomaticSync:schedule,
  require:(name:string)=>require("../../../electron/"+name.replace(/^\.\//,""))});
 return{handlers,sender,scope,schedule};
}
describe("Main fixed saved-refund IPC admission",()=>{
 it.each(["receipts:refund-approval-status","receipts:recover-refund-approval"])("refuses foreign frames before reading SQL/session on %s",async channel=>{
  const f=fixture(),h=mainHandlers(f);const result=await h.handlers.get(channel)!({...h.sender,senderFrame:{}},{saleId:f.saleId,branchId:"A"});
  expect(result).toMatchObject({ok:false,code:"EPRIVILEGE"});expect(h.scope).not.toHaveBeenCalled();expect(f.calls).toHaveLength(0);
 });
 it("requires the current ordinary refund account and exact branch for status",async()=>{
  const f=fixture(),h=mainHandlers(f),handler=h.handlers.get("receipts:refund-approval-status")!;
  h.scope.mockImplementationOnce(()=>{throw Object.assign(Error("current refund authority required"),{code:"EPRIVILEGE"});});
  await expect(handler(h.sender,{saleId:f.saleId,branchId:"A"})).rejects.toMatchObject({code:"EPRIVILEGE"});expect(f.calls).toHaveLength(0);
  expect(await handler(h.sender,{saleId:f.saleId,branchId:"B"})).toMatchObject({ok:false,code:"SYNC_BRANCH_FORBIDDEN"});expect(f.calls).toHaveLength(0);
 });
 it("routes fresh approval to the retained operation and rechecks current policy without rerunning money",async()=>{
  const f=fixture(),approved=await f.approval(),h=mainHandlers(f),handler=h.handlers.get("receipts:recover-refund-approval")!;
  f.policy.actor.is_active=false;await expect(handler(h.sender,{saleId:f.saleId,branchId:"A",operationId:f.operationId,grantToken:approved.grantToken})).rejects.toMatchObject({code:"EAPPROVAL_POLICY"});
  expect(f.evidence()).toBe(f.initial);expect(h.schedule).not.toHaveBeenCalled();
  f.policy.actor.is_active=true;expect(await handler(h.sender,{saleId:f.saleId,branchId:"A",operationId:f.operationId,grantToken:approved.grantToken})).toMatchObject({ok:true,operationId:f.operationId});
  expect(h.schedule).toHaveBeenCalledExactlyOnceWith(250);
 });
});
