import{normalizeStockCoverageFrontierProof}from'../../electron/security/stock-event-author-protocol.cjs';
import{normalizeStockCoverageFrontier,stockCoverageFrontierJson}from'../../electron/shared/stock-coverage-frontier.mjs';
import{canonicalBranchId}from'./branch-id';
import type{VerifiedTerminalDescriptor}from'./terminal-binding.server';
import{ShiftAuthorError,verifyStockCoverageFrontierRegistryProof,readVerifiedStockEventAuthor}from'./shift-author-verification.server';
const encoder=new TextEncoder(),fail=():never=>{throw new ShiftAuthorError('ESTOCK_AUTHOR_INVALID','This terminal stock frontier could not be verified.');};
/** Identity and exact original frontier bytes only. Current source prefix,
 * challenge expiry, writer cohort and opening admission stay independent. */
export async function verifyStockCoverageFrontier(input:{frontierJson:string;proof:unknown;terminal:VerifiedTerminalDescriptor;branchId:string},request?:object){
 const raw=input.frontierJson,terminal={id:input.terminal.id,platform:input.terminal.platform,mode:input.terminal.mode,branchId:input.terminal.branchId},branch=input.branchId;
 let candidate,frontier;
 try{
  if(typeof raw!=='string'||encoder.encode(raw).length>8192)return fail();
  frontier=normalizeStockCoverageFrontier(JSON.parse(raw));if(stockCoverageFrontierJson(frontier)!==raw)return fail();
  candidate=normalizeStockCoverageFrontierProof(input.proof);
 }catch{return fail();}
 if(terminal.platform!=='pc'||terminal.mode!=='operations'||!terminal.branchId||candidate.terminalId!==terminal.id||frontier.terminalId!==terminal.id||
  canonicalBranchId(candidate.branchId)!==canonicalBranchId(terminal.branchId)||canonicalBranchId(candidate.branchId)!==canonicalBranchId(branch)||
  candidate.branchId!==frontier.branchId||candidate.authorId!==frontier.authorId||candidate.projectOrigin!==frontier.projectOrigin||candidate.challengeId!==frontier.challengeId)return fail();
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(raw)));
 if(candidate.frontierHash!==Array.from(digest,value=>value.toString(16).padStart(2,'0')).join(''))return fail();
 const proof=await verifyStockCoverageFrontierRegistryProof(candidate,request),authority=await readVerifiedStockEventAuthor(proof,request);
 if(!authority.allowed)throw new ShiftAuthorError(authority.code,'The original frontier account or key is no longer authorized. Stock history remains pending.');
 return Object.freeze({proof,frontier,observationGrade:'author_claimed' as const});
}
