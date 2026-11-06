import { serviceRest } from "@/core/api/pos-relay.server";
import { supabaseConfig } from "./external-supabase-config";
import { canonicalBranchId } from "./branch-id";
import type { VerifiedTerminalDescriptor } from "./terminal-binding.server";
import { stockInstant } from "./stock-as-of";
import { verifyStockEventAuthor, readStockEventAuthorPermission } from "./stock-event-author-verification.server";
import { ShiftAuthorError, createStockEventVerificationRequest } from "./shift-author-verification.server";

export type StockHistoryUpload={version:1;branchId:string;terminalId:string;rows:Array<{id:string;payloadHash:string;payloadJson:string;authorProofJson?:string;sourceCohortJson?:string}>};
const encoder=new TextEncoder();
const failure=(code:string,message:string,status=409):never=>{throw new ShiftAuthorError(code,message,status);};
/** Called only after the shared relay has verified the paired terminal. It
 * imports no UI/router and uses the original author's saved proof, not the
 * cashier currently carrying the background upload. This writes metadata only. */
export async function acceptStockHistoryUpload(input:StockHistoryUpload,terminal:VerifiedTerminalDescriptor){
 if(terminal.platform!=="pc"||terminal.mode!=="operations"||!terminal.branchId||input.terminalId!==terminal.id||
  canonicalBranchId(input.branchId)!==canonicalBranchId(terminal.branchId))
  return failure("SYNC_BRANCH_FORBIDDEN","Stock history must remain in this registered terminal's branch.",403);
 if(input.version!==1||!Array.isArray(input.rows)||input.rows.length<1||input.rows.length>8||encoder.encode(JSON.stringify(input)).length>126976)
  return failure("ESTOCK_HISTORY_OVERSIZED","The stock-history page exceeds the bounded upload limit.",413);
 const seen=new Set<string>(),rows=[],verificationRequest=createStockEventVerificationRequest();
 for(const row of input.rows){
  if(seen.has(row.id))return failure("ESTOCK_HISTORY_REPLAY_CONFLICT","A movement was repeated within the upload.");seen.add(row.id);
  if(typeof row.authorProofJson!=="string"||!row.authorProofJson||encoder.encode(row.authorProofJson).length>16384)
   return failure("ESTOCK_HISTORY_AUTHOR_REQUIRED","Original author evidence is unavailable. This stock history remains pending review.");
  let proof:unknown;try{proof=JSON.parse(row.authorProofJson);}catch{return failure("ESTOCK_AUTHOR_INVALID","The original stock author evidence is invalid.",403);}
  const checked=await verifyStockEventAuthor({proof,payloadJson:row.payloadJson,terminal,branchId:input.branchId},verificationRequest);
  if(row.id!==checked.claim.id||row.payloadHash!==checked.proof.payloadHash)
   return failure("ESTOCK_AUTHOR_INVALID","The stock-history identity changed.",403);
  // SQL independently rechecks current registry/account rights for NEW claims.
  // False authority can acknowledge an exact already-accepted receipt only.
  const authorState=await readStockEventAuthorPermission(checked.proof,verificationRequest);
  let sourceState;
  if(row.sourceCohortJson!==undefined){
   const {verifyStockSourceMovement}=await import('./stock-source-movement.server');
   sourceState=await verifyStockSourceMovement({sourceCohortJson:row.sourceCohortJson,checked,terminal,branchId:input.branchId},verificationRequest);
  }
  rows.push({...row,authorState,...(sourceState?{sourceState}:{})});
 }
 let response:Response;
 try{response=await serviceRest("rpc/pos_stock_history_accept_claims",{method:"POST",body:JSON.stringify({p_project:new URL(supabaseConfig().url).origin,p_branch:input.branchId,p_terminal:terminal.id,p_rows:rows})});}
 catch{return failure("ESTOCK_HISTORY_UNAVAILABLE","Stock history could not reach the company database. Saved work remains pending.",503);}
 const raw=await response.text();
 if(encoder.encode(raw).length>262144)return failure("ESTOCK_HISTORY_ACK_UNCONFIRMED","The acceptance response exceeded its safe limit.",503);
 let result:unknown;try{result=JSON.parse(raw);}catch{return failure("ESTOCK_HISTORY_ACK_UNCONFIRMED","The company database did not return a stock-history acceptance receipt.",503);}
 if(!response.ok){
  const message=result&&typeof result==="object"&&"message"in result?String(result.message):"";
  const codes=["STOCK_HISTORY_SOURCE_NOT_ACCEPTED","STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN","STOCK_HISTORY_EFFECT_ALREADY_CONSUMED","STOCK_HISTORY_REPLAY_CONFLICT","STOCK_HISTORY_AUTHOR_PERMISSION_REVOKED","STOCK_HISTORY_AUTHOR_REQUIRED","SYNC_TERMINAL_SCOPE_FORBIDDEN"];
  return failure(codes.includes(message)?message:"ESTOCK_HISTORY_UNAVAILABLE","Stock history remains pending because its original source or authority is not confirmed.",response.status>=500?503:409);
 }
 if(!result||typeof result!=="object"||Array.isArray(result))return failure("ESTOCK_HISTORY_ACK_UNCONFIRMED","Stock-history acceptance is unconfirmed.",503);
 const ack=result as {ok?:unknown;version?:unknown;branchId?:unknown;terminalId?:unknown;receipts?:unknown};
 if(ack.ok!==true||ack.version!==1||ack.branchId!==input.branchId||ack.terminalId!==terminal.id||!Array.isArray(ack.receipts)||ack.receipts.length!==rows.length)
  return failure("ESTOCK_HISTORY_ACK_UNCONFIRMED","Stock-history acceptance is unconfirmed.",503);
 const receiptIds=new Set<string>(),positions=new Set<string>(),effects=new Set<string>();
 for(const receipt of ack.receipts){
  const expected=rows.find(row=>row.id===receipt?.id);
  if(!expected||receiptIds.has(receipt.id)||receipt.payloadHash!==expected.payloadHash||typeof receipt.ingestedCursor!=="string"||
   !/^[1-9]\d{0,18}$/.test(receipt.ingestedCursor)||BigInt(receipt.ingestedCursor)>9223372036854775807n||positions.has(receipt.ingestedCursor)||
   !Array.isArray(receipt.effectIds)||receipt.effectIds.length<1||receipt.effectIds.length>2000)
   return failure("ESTOCK_HISTORY_ACK_UNCONFIRMED","Stock-history acceptance is unconfirmed.",503);
  try{stockInstant(receipt.acceptedAt);}catch{return failure("ESTOCK_HISTORY_ACK_UNCONFIRMED","Stock-history acceptance time is invalid.",503);}
  receiptIds.add(receipt.id);positions.add(receipt.ingestedCursor);
  for(const effect of receipt.effectIds){if(typeof effect!=="string"||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(effect)||effects.has(effect))return failure("ESTOCK_HISTORY_ACK_UNCONFIRMED","Stock-effect acceptance is unconfirmed.",503);effects.add(effect);}
 }
 return result;
}
