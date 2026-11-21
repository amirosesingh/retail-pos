import {normalizeStockSourceCohortProof,type StockSourceCohortProof} from '../../electron/security/stock-event-author-protocol.cjs';
import type {VerifiedTerminalDescriptor} from './terminal-binding.server';
import {canonicalBranchId} from './branch-id';
import {ShiftAuthorError,verifyStockSourceCohortRegistryProof} from './shift-author-verification.server';
import {readStockEventAuthorPermission} from './stock-event-author-verification.server';
import {verifyStockSourceMembership,type StockSourceMembership} from '../../electron/shared/stock-source-cohort.mjs';

const verified=new WeakSet<object>();
const denied=():never=>{throw new ShiftAuthorError('ESTOCK_AUTHOR_INVALID','The original stock source cohort could not be verified.');};
/** Original producer identity only. Actual source/effect admission and current
 * action rights remain separate; this never authorizes a business mutation. */
export async function verifyStockSourceCohort(input:{proof:unknown;terminal:VerifiedTerminalDescriptor;branchId:string},request?:object){
 let candidate:StockSourceCohortProof;
 try{candidate=normalizeStockSourceCohortProof(input.proof);}catch{return denied();}
 if(input.terminal.platform!=='pc'||input.terminal.mode!=='operations'||!input.terminal.branchId||candidate.terminalId!==input.terminal.id||
  canonicalBranchId(candidate.branchId)!==canonicalBranchId(input.terminal.branchId)||canonicalBranchId(candidate.branchId)!==canonicalBranchId(input.branchId))return denied();
 const proof=await verifyStockSourceCohortRegistryProof(candidate,request);verified.add(proof);
 return{proof,timeGrade:'author_claimed' as const};
}
export async function readStockSourceCohortPermission(proof:StockSourceCohortProof,request?:object){
 if(!verified.has(proof))return{allowed:false as const,code:'ESTOCK_AUTHOR_INVALID'};
 return readStockEventAuthorPermission(proof,request);
}
/** A member is accepted as an original signed source claim only after both
 * cryptographic header verification and its exact signed root/count binding.
 * SQL still has to prove the actual accepted document and stock effect. */
export async function verifyStockSourceCohortMember(proof:StockSourceCohortProof,membership:StockSourceMembership){
 if(!verified.has(proof))return denied();
 let source;
 try{source=await verifyStockSourceMembership(membership,{count:proof.sourceCount,root:proof.sourceRoot});}catch{return denied();}
 if(source.operationId!==proof.operationId||source.action!==proof.action||source.authorId!==proof.authorId||source.terminalId!==proof.terminalId||
  source.branchId!==proof.branchId)return denied();
 return source;
}
