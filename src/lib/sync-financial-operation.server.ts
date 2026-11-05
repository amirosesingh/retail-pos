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
export const financialOperationEnvelopeSchema=z.object({organizationId:text,operationJson:z.string().min(2).max(6*1024*1024),proof:z.unknown()}).strict();
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
