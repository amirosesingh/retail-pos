import {z} from 'zod';
import {parseExactJson} from '../../electron/sync/shift-recovery-exact.mjs';
import {sameBranchId} from './branch-id';

// An authenticated event is still subject to cloud lineage/write admission.
// Parsing never issues a financial receipt or claims that its facts were saved.
const uuid=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const text=z.string().min(1).max(128);
const decimal=z.string().max(128).regex(/^-?\d+(?:\.\d+)?$/).nullable();
const fact=z.object({id:uuid,branchId:text,shiftId:uuid,totalAmount:decimal,
  paymentType:z.string().max(128).nullable(),paymentsJson:z.string().max(2*1024*1024).nullable(),
  discountAmount:decimal,isRefunded:z.boolean().nullable(),rowVersion:z.string().regex(/^\d{1,76}$/).nullable(),
}).strict();
const origin=z.object({localAggregateId:uuid,rowHash:hash}).strict();
const cloudOrigin=z.object({serverBasisId:uuid,serverBasisHash:hash}).strict();
const common={operationId:uuid,branchId:text,terminalId:uuid,shiftId:uuid,
  sequence:z.string().regex(/^[1-9]\d{0,18}$/),predecessorOperationId:uuid,predecessorHash:hash,
  action:z.enum(['SALE','REFUND','TENDER','VOID']),
  changes:z.array(z.object({saleId:uuid,before:fact.nullable(),after:fact.nullable()}).strict()).min(1).max(500),
};
const event=z.discriminatedUnion('version',[
 z.object({...common,version:z.literal(1),openingOrigin:origin}).strict(),
 z.object({...common,version:z.literal(2),cloudOrigin}).strict(),
]);
const observationCommon={operationId:uuid,branchId:text,terminalId:uuid,shiftId:uuid,
 sequence:z.string().regex(/^[1-9]\d{0,18}$/),predecessorOperationId:uuid,predecessorHash:hash,
 action:z.literal('OBSERVE'),observedBasis:cloudOrigin};
const observation=z.discriminatedUnion('version',[
 z.object({...observationCommon,version:z.literal(1),openingOrigin:origin}).strict(),
 z.object({...observationCommon,version:z.literal(2),cloudOrigin}).strict(),
]);
export function parseFinancialObservation(raw:string){
 parseExactJson(raw,{maxBytes:16384,maxDepth:8});
 return observation.parse(JSON.parse(raw));
}
export const refundApprovalEvidenceSchema=z.object({approvalJson:z.string().min(2).max(48*1024),approvalAttestation:z.unknown()}).strict();
export const financialRefundApprovalSchema=z.object({operationJson:z.string().min(2).max(6*1024*1024),attestation:z.unknown(),refundApproval:refundApprovalEvidenceSchema}).strict();
export const financialOperationEnvelopeSchema=z.object({organizationId:text,operationJson:z.string().min(2).max(6*1024*1024),proof:z.unknown(),refundApproval:refundApprovalEvidenceSchema.optional()}).strict();
const opening=z.object({version:z.literal(1),localAggregateId:uuid,branchId:text,terminalId:uuid,shiftId:uuid,rowHash:hash,rowJson:z.string().min(2).max(6*1024*1024)}).strict();
export function parseFinancialOpening(raw:string){
  parseExactJson(raw,{maxBytes:6*1024*1024,maxDepth:16});
  const value=opening.parse(JSON.parse(raw));
  parseExactJson(value.rowJson,{maxBytes:6*1024*1024,maxDepth:16});
  const row=JSON.parse(value.rowJson);
  if(!row||typeof row!=='object'||Array.isArray(row)||row.id!==value.shiftId||row.store_id!==value.branchId||row.terminal_id!==value.terminalId||row.status!=='OPEN'||row.closed_at!==null||(row.state!==null&&row.state!=='ACTIVE'))throw new Error('Invalid opening scope');
  return value;
}
export async function verifyFinancialOpeningEnvelope(input:{openingJson:string;proof:unknown;terminal:Parameters<typeof import('./shift-author-verification.server').verifyFinancialAuthorAttestation>[0]['terminal'];branchId:string}){
  const parsed=parseFinancialOpening(input.openingJson);
  const {verifyFinancialAuthorAttestation,ShiftAuthorError}=await import('./shift-author-verification.server');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(parsed.rowJson));
  if(!sameBranchId(parsed.branchId,input.branchId)||parsed.terminalId!==input.terminal.id.toLowerCase()||parsed.rowHash!==Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join(''))throw new ShiftAuthorError('EFINANCIAL_AUTHOR_INVALID','The saved opening could not be verified.');
  const proof=await verifyFinancialAuthorAttestation({attestation:input.proof,payloadJson:input.openingJson,terminal:input.terminal,branchId:input.branchId,operationId:parsed.localAggregateId,action:'OPEN'});
  return {proof,opening:parsed};
}

export function parseFinancialOperation(raw:string){
  // Audit duplicates and bounded depth before ordinary parsing. All financial
  // values and sequence counters below must remain strings, never JS numbers.
  parseExactJson(raw,{maxBytes:6*1024*1024,maxDepth:16});
  const value=event.parse(JSON.parse(raw)),seen=new Set<string>();
  for(const change of value.changes){
    if(seen.has(change.saleId)||(!change.before&&!change.after))throw new Error('Invalid financial change');
    seen.add(change.saleId);
    for(const row of [change.before,change.after])if(row&&(row.id!==change.saleId||row.branchId!==value.branchId||row.shiftId!==value.shiftId))throw new Error('Invalid financial change scope');
    if(value.action==='SALE'&&(change.before!==null||change.after===null))throw new Error('Invalid financial sale');
    if(value.action==='VOID'&&(change.before===null||change.after!==null))throw new Error('Invalid financial deletion');
    if(['REFUND','TENDER'].includes(value.action)&&(!change.before||!change.after))throw new Error('Invalid financial update');
  }
  return value;
}

export async function verifyFinancialOperationEnvelope(input:{
  envelope:z.infer<typeof financialOperationEnvelopeSchema>;
  terminal:Parameters<typeof import('./shift-author-verification.server').verifyFinancialAuthorAttestation>[0]['terminal'];
  branchId:string;
}){
  const envelope=financialOperationEnvelopeSchema.parse(input.envelope),parsed=parseFinancialOperation(envelope.operationJson);
  const {verifyFinancialAuthorAttestation,ShiftAuthorError}=await import('./shift-author-verification.server');
  if(!sameBranchId(parsed.branchId,input.branchId)||parsed.terminalId!==input.terminal.id.toLowerCase())throw new ShiftAuthorError('EFINANCIAL_AUTHOR_INVALID','The financial terminal scope could not be verified.');
  const proof=await verifyFinancialAuthorAttestation({attestation:envelope.proof,payloadJson:envelope.operationJson,terminal:input.terminal,branchId:input.branchId,operationId:parsed.operationId,action:parsed.action});
  return {...envelope,proof,event:parsed};
}

type Terminal=Parameters<typeof verifyFinancialOperationEnvelope>[0]['terminal'];
const approvalFailure=(status=403):never=>{throw Object.assign(new Error('The saved refund is waiting for verified authorization.'),{code:'ESYNC_REFUND_APPROVAL_REQUIRED',status});};

/** Approval companion validation never changes the original ledger event. */
export async function verifyFinancialRefundApproval(input:{operationJson:string;attestation:unknown;refundApproval:unknown;terminal:Terminal;branchId:string;signal?:AbortSignal}){
  const event=parseFinancialOperation(input.operationJson),change=event.changes[0];
  if(event.action!=='REFUND'||event.changes.length!==1||!change.before||!change.after||
      change.before.isRefunded===true||change.after.isRefunded!==true||change.before.rowVersion===null||change.before.totalAmount===null)approvalFailure();
  const {amountMinor}=await import('../../electron/sync/financial-refund-approval.cjs');
  const {verifyRefundApprovalEvidence}=await import('./refund-approval-receipt.server');
  return verifyRefundApprovalEvidence({evidence:input.refundApproval,terminal:input.terminal,signal:input.signal,
    anchor:{anchorKind:'financial',payloadJson:input.operationJson,attestation:input.attestation,
      operationId:event.operationId,saleId:change.saleId,expectedSaleVersion:change.before!.rowVersion!,amountMinor:amountMinor(change.before!.totalAmount!)}});
}

/** Exact prior metadata is history, never proof of a business refund. */
export async function readFinancialRefundEventReceipt(input:{organizationId:string;branchId:string;terminalId:string;operationJson:string;proof:unknown;signal?:AbortSignal}){
  const event=parseFinancialOperation(input.operationJson);
  if(event.action!=='REFUND')return null;
  const {serviceRest}=await import('@/core/api/pos-relay.server');
  const {supabaseConfig}=await import('./external-supabase-config');
  const {boundedText}=await import('../../electron/sync/shift-recovery-exact.mjs');
  let response:Response;
  try{response=await serviceRest('rpc/pos_sync_read_financial_event_receipt',{method:'POST',signal:input.signal,
    body:JSON.stringify({p_org:input.organizationId,p_branch:input.branchId,p_terminal:input.terminalId,p_project_origin:new URL(supabaseConfig().url).origin,p_raw:input.operationJson,p_proof:input.proof})});}
  catch{return approvalFailure(503);}
  if(!response.ok)return approvalFailure(503);
  let data:unknown;try{data=JSON.parse(await boundedText(response,4096));}catch{return approvalFailure(503);}
  if(data===null)return null;
  const schema=z.object({status:z.literal('financial_metadata_recorded'),operationId:uuid,payloadHash:hash,sequence:z.string().regex(/^[1-9]\d{0,18}$/),businessUploaded:z.literal(false),shiftClosed:z.literal(false)}).strict();
  const parsed=schema.safeParse(data);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input.operationJson)));
  if(!parsed.success||parsed.data.operationId!==event.operationId||parsed.data.sequence!==event.sequence||
      parsed.data.payloadHash!==Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join(''))return approvalFailure(503);
  return parsed.data;
}

/** Existing canonical refunded facts need no new approval. A new transition does. */
export async function verifyFinancialRefundProjection(input:{items?:z.infer<typeof financialRefundApprovalSchema>[];operations:Array<{table:string;deletePhase?:boolean;rows:Record<string,unknown>[]} >;terminal:Terminal;branchId:string;signal?:AbortSignal}){
  const targets=input.operations.filter(op=>op.table==='sales'&&!op.deletePhase).flatMap(op=>op.rows).filter(row=>row.is_refunded===true);
  if(targets.length>2000)approvalFailure();
  const byId=new Map(targets.map(row=>[String(row.id).toLowerCase(),row]));
  if(byId.size!==targets.length)approvalFailure();
  if(!targets.length){if(input.items?.length)approvalFailure();return;}
  const ids=targets.map(row=>uuid.parse(String(row.id).toLowerCase()));
  const {serviceRest}=await import('@/core/api/pos-relay.server');
  const {boundedText,isExactNumber}=await import('../../electron/sync/shift-recovery-exact.mjs');
  const {financialFact}=await import('../../electron/db/shift-financial-operations.cjs');
  let response:Response,rows:unknown;
  try{response=await serviceRest(`sales?id=in.(${ids.join(',')})&store_id=eq.${encodeURIComponent(input.branchId)}&select=id,store_id,shift_id,total_amount,discount_amount,is_refunded,row_version&limit=2000`,{signal:input.signal});
    if(!response.ok)return approvalFailure(503);
    rows=parseExactJson(await boundedText(response,2*1024*1024),{maxBytes:2*1024*1024,maxDepth:16});}
  catch{return approvalFailure(503);}
  if(!Array.isArray(rows))return approvalFailure(503);
  const current=new Map(rows.map(row=>[String((row as Record<string,unknown>).id).toLowerCase(),row as Record<string,unknown>]));
  const decimal=(value:unknown)=>value==null?null:isExactNumber(value)?(value as {raw:string}).raw:typeof value==='string'?value:typeof value==='number'&&Number.isSafeInteger(value)?String(value):approvalFailure();
  const fact=(row:Record<string,unknown>)=>financialFact({id:String(row.id).toLowerCase(),branchId:row.store_id,shiftId:row.shift_id,
    totalAmount:decimal(row.total_amount),discountAmount:decimal(row.discount_amount),rowVersion:decimal(row.row_version),
    paymentType:null,paymentsJson:null,isRefunded:row.is_refunded});
  const accepted=new Set<string>();
  for(const row of targets){const saved=current.get(String(row.id).toLowerCase());
    if(saved?.is_refunded===true&&saved.store_id===input.branchId&&row.store_id===input.branchId&&JSON.stringify(fact(row))===JSON.stringify(fact(saved)))accepted.add(String(row.id).toLowerCase());
  }
  const supplied=new Set<string>();
  for(const item of input.items??[]){
    const verified=await verifyFinancialOperationEnvelope({envelope:{organizationId:'default',operationJson:item.operationJson,proof:item.attestation},terminal:input.terminal,branchId:input.branchId});
    const change=verified.event.changes[0];
    if(verified.event.action!=='REFUND'||verified.event.changes.length!==1||!byId.has(change.saleId)||supplied.has(change.saleId))approvalFailure();
    supplied.add(change.saleId);
    if(!accepted.has(change.saleId)){
      const target=byId.get(change.saleId)!;
      if(!change.after||decimal(target.row_version)!==change.after.rowVersion||JSON.stringify(fact(target))!==JSON.stringify(financialFact(change.after)))approvalFailure();
      const authorized=await verifyFinancialRefundApproval({...item,terminal:input.terminal,branchId:input.branchId,signal:input.signal});
      let createdAt:string;
      try{if(typeof target.created_at!=='string')return approvalFailure();createdAt=new Date(target.created_at).toISOString();}catch{return approvalFailure();}
      if(createdAt!==authorized.basis.saleCreatedAt)approvalFailure();
      accepted.add(change.saleId);
    }
  }
  if(ids.some(id=>!accepted.has(id)))approvalFailure();
}
