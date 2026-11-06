import{serviceRest}from'@/core/api/pos-relay.server';
import{supabaseConfig}from'./external-supabase-config';
import{canonicalBranchId}from'./branch-id';
import{stockInstant}from'./stock-as-of';
import type{VerifiedTerminalDescriptor}from'./terminal-binding.server';
import{ShiftAuthorError,createStockEventVerificationRequest}from'./shift-author-verification.server';
import{verifyStockCoverageFrontier}from'./stock-coverage-frontier-verification.server';
type Base={version:1;branchId:string;terminalId:string};
export type StockCoverageFrontierOperation=Base&({action:'challenge';challengeId:string;authorId:string;keyId:string}|{action:'accept';frontierJson:string;proofJson:string});
const encoder=new TextEncoder(),fail=(code='ESTOCK_FRONTIER_UNCONFIRMED',status=503):never=>{throw new ShiftAuthorError(code,'Stock writer coverage remains unconfirmed.',status);};
/** Verified native sync lane only. No opening/stock/financial acknowledgement. */
export async function stockCoverageFrontierOperation(input:StockCoverageFrontierOperation,terminal:VerifiedTerminalDescriptor){
 if(terminal.platform!=='pc'||terminal.mode!=='operations'||!terminal.branchId||input.terminalId!==terminal.id||
  canonicalBranchId(input.branchId)!==canonicalBranchId(terminal.branchId))return fail('SYNC_BRANCH_FORBIDDEN',403);
 const project=new URL(supabaseConfig().url).origin;let endpoint:string,parameters:Record<string,unknown>,challengeId:string,frontierHash:string|undefined,pending:Record<string,string>|undefined;
 if(input.version!==1||!['challenge','accept'].includes(input.action)||encoder.encode(JSON.stringify(input)).length>20480)return fail('ESTOCK_FRONTIER_INVALID',400);
 if(input.action==='challenge'){
  challengeId=input.challengeId;endpoint='pos_stock_history_frontier_challenge';
  parameters={p_id:challengeId,p_project:project,p_branch:input.branchId,p_terminal:terminal.id,p_author:input.authorId,p_key:input.keyId};
 }else{
  let proof:unknown;try{proof=JSON.parse(input.proofJson);}catch{return fail('ESTOCK_AUTHOR_INVALID',403);}
  const checked=await verifyStockCoverageFrontier({frontierJson:input.frontierJson,proof,terminal,branchId:input.branchId},createStockEventVerificationRequest());
  challengeId=checked.frontier.challengeId;frontierHash=checked.proof.frontierHash;pending=checked.frontier.pending;endpoint='pos_stock_history_accept_frontier';
  parameters={p_project:project,p_branch:input.branchId,p_terminal:terminal.id,p_frontier_json:input.frontierJson,p_proof_json:input.proofJson,p_author_verified:true};
 }
 let response:Response;try{response=await serviceRest('rpc/'+endpoint,{method:'POST',body:JSON.stringify(parameters)});}catch{return fail('ESTOCK_FRONTIER_UNAVAILABLE');}
 const raw=await response.text();if(encoder.encode(raw).length>8192)return fail();
 let result:Record<string,unknown>;try{result=JSON.parse(raw);}catch{return fail();}
 if(!response.ok){
  const allowed=['STOCK_FRONTIER_CHALLENGE_STALE','STOCK_FRONTIER_REPLAY_CONFLICT','STOCK_FRONTIER_CHALLENGE_CONFLICT','STOCK_FRONTIER_CHALLENGE_INVALID','STOCK_FRONTIER_IDENTITY_INVALID'];
  return fail(typeof result?.message==='string'&&allowed.includes(result.message)?result.message:'ESTOCK_FRONTIER_UNAVAILABLE',response.status>=500?503:409);
 }
 if(!result||typeof result!=='object'||Array.isArray(result)||result.challengeId!==challengeId)return fail();
 if(input.action==='challenge'){
  if(typeof result.nonce!=='string'||!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(result.nonce)||typeof result.cohortHash!=='string'||!/^[a-f0-9]{64}$/.test(result.cohortHash))return fail();
  try{if(stockInstant(String(result.expiresAt))<=stockInstant(String(result.issuedAt))||stockInstant(String(result.expiresAt))-stockInstant(String(result.issuedAt))>3000000000n)return fail();}catch{return fail();}
 }else{
  if(result.frontierHash!==frontierHash||!['accepted','unconfirmed'].includes(String(result.state))||result.observationGrade!=='author_claimed'||
    !Array.isArray(result.reasons)||result.reasons.length>8||result.reasons.some(value=>typeof value!=='string'||value.length>80)||
    (result.state==='accepted'&&(result.reasons.length!==0||Object.values(pending??{}).some(value=>value!=='0'))))return fail();
  try{stockInstant(String(result.acceptedAt));}catch{return fail();}
 }
 return{ok:true,version:1,branchId:input.branchId,terminalId:terminal.id,...(input.action==='challenge'?{challenge:result}:{receipt:result})};
}
