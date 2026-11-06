const {createHash}=require('node:crypto');
const contract=require('../db/stock-history-contract.cjs');
const fail=()=>contract.fail('ESTOCK_HISTORY_ACK_UNCONFIRMED');
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const cursor=value=>{if(typeof value!=='string'||! /^[1-9]\d{0,18}$/.test(value)||BigInt(value)>9223372036854775807n)fail();return value;};
/** Validate original SQL bytes; never regenerate a past claim from current products. */
function stockHistoryUploadRow(row,{branchId,terminalId}){
 if(!row||typeof row.payload_json!=='string'||Buffer.byteLength(row.payload_json,'utf8')>126976||hash(row.payload_json)!==row.payload_hash)fail();
 let value;try{value=JSON.parse(row.payload_json);}catch{fail();}
 if(!Array.isArray(value)||value.length!==18||value[0]!==1)fail();
 const fields=['id','operation_id','product_id','store_id','terminal_id','actor_id','source_kind','quantity_delta','effective_at_raw','effective_ticks','recorded_at_raw','product_name','sku','barcode','clock_state'];
 for(let index=0;index<fields.length;index++)if(value[index+1]!==row[fields[index]])fail();
 for(const key of ['id','operation_id','product_id'])if(contract.identifier(row[key],true)!==row[key])fail();
 if(contract.identifier(row.store_id)!==branchId||contract.identifier(row.terminal_id)!==terminalId||
  !contract.KINDS.has(row.source_kind)||!['verified','unverified'].includes(row.clock_state)||
  String(contract.instant(row.effective_at_raw))!==row.effective_ticks||contract.instant(row.effective_at_raw)>contract.instant(row.recorded_at_raw))fail();
 if(contract.quantity(row.quantity_delta)===0n||typeof row.product_name!=='string'||
  (row.sku!==null&&typeof row.sku!=='string')||(row.barcode!==null&&typeof row.barcode!=='string'))fail();
 const refs=value[16],seen=new Set();
 if(!Array.isArray(refs)||refs.length>2000)fail();
 for(const reference of refs){
  if(!Array.isArray(reference)||reference.length!==3||!['item_activity_logs','stock_adjustments','stock_delta_applied'].includes(reference[0]))fail();
  contract.identifier(reference[1],true);contract.quantity(reference[2]);
  const id=reference[0]+':'+reference[1];if(seen.has(id))fail();seen.add(id);
 }
 contract.quantity(value[17]);
 if(row.author_proof_json!=null){
  let proof;try{proof=require('../security/stock-event-author-protocol.cjs').normalizeStockEvent(JSON.parse(row.author_proof_json));}catch{fail();}
  const rule=require('../security/stock-event-author-protocol.cjs').ACTIONS[proof.action];
  if(proof.movementId!==row.id||proof.operationId!==row.operation_id||proof.authorId!==row.actor_id||proof.branchId!==branchId||
   proof.terminalId!==terminalId||proof.payloadHash!==row.payload_hash||rule.kind!==row.source_kind||Buffer.byteLength(row.author_proof_json,'utf8')>16384)fail();
 }
 return Object.freeze({id:row.id,payloadHash:row.payload_hash,payloadJson:row.payload_json,
  ...(row.author_proof_json!=null?{authorProofJson:row.author_proof_json}:{})});
}
/** HTTP success alone cannot clear a local stock-history claim. */
function assertStockHistoryAcknowledgement(batch,response){
 if(!response||response.ok!==true||response.version!==1||response.branchId!==batch.branchId||response.terminalId!==batch.terminalId||
  !Array.isArray(response.receipts)||response.receipts.length!==batch.rows.length)fail();
 const receipts=new Map(),effects=new Set(),positions=new Set();
 for(const receipt of response.receipts){
  if(!receipt||receipts.has(receipt.id)||!Array.isArray(receipt.effectIds)||!receipt.effectIds.length||receipt.effectIds.length>2000)fail();
  if(contract.identifier(receipt.id,true)!==receipt.id)fail();cursor(receipt.ingestedCursor);contract.instant(receipt.acceptedAt);
  if(positions.has(receipt.ingestedCursor))fail();positions.add(receipt.ingestedCursor);
  for(const id of receipt.effectIds){if(contract.identifier(id,true)!==id||effects.has(id))fail();effects.add(id);}
  receipts.set(receipt.id,receipt);
 }
 return Object.freeze(batch.rows.map(row=>{
  const receipt=receipts.get(row.id);if(!receipt||receipt.payloadHash!==row.payloadHash)fail();
  return Object.freeze({id:row.id,payloadHash:row.payloadHash,ingestedCursor:receipt.ingestedCursor,
   acceptedAt:contract.canonicalInstant(receipt.acceptedAt),effectIds:Object.freeze([...receipt.effectIds])});
 }));
}
module.exports={stockHistoryUploadRow,assertStockHistoryAcknowledgement};
