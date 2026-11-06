'use strict';
// Called only with the repository's original validated operations and actual
// before/after/source readbacks, in that business transaction. It constructs a
// source claim, not cloud acceptance, author authority or physical clock proof.
const contract=require('./stock-history-contract.cjs');
function records(operations,table){
 return operations.filter(op=>op.table===table&&['insert','upsert','update'].includes(op.kind)).flatMap(op=>
  (op.rows??[op.values??{}]).map(row=>({...row,id:row.id??op.match?.id})));
}
function id(value){try{return contract.identifier(value,true);}catch{return null;}}
function sameRefs(left,right){return JSON.stringify(left)===JSON.stringify(right);}
async function sourceManifestForMovement({action,row,operations,before,after,claims,request}){
 let document;
 if(action==='ADJUST'){
  const refs=(row.source_refs??[]).filter(ref=>ref[0]==='stock_adjustments');
  if(refs.length!==1||!claims.some(claim=>claim.table==='stock_adjustments'&&claim.id===refs[0][1]&&claim.productId===row.product_id&&
   claim.branchId===row.store_id&&claim.delta===String(row.quantity_delta)))return null;
  if(!records(operations,'stock_adjustments').some(record=>id(record.id)===refs[0][1]))return null;
  document={type:'stock_adjustments',id:refs[0][1]};
 }else if(action==='PRODUCT_CREATE'){
  if(before.some(product=>id(product.id)===row.product_id)||!after.some(product=>id(product.id)===row.product_id)||
   !records(operations,'products').some(product=>id(product.id)===row.product_id))return null;
  document={type:'products',id:row.product_id};
 }else if(action==='RECEIVE'){
  // The receiving UI's logical document is stored in purchase_orders, not a
  // fictitious receivings table. Never use an invoice date as movement time.
  const ids=[...new Set(records(operations,'purchase_orders').map(record=>id(record.id)).filter(Boolean))];
  if(ids.length!==1||typeof request!=='function')return null;
  const saved=(await request().input('stock_source_document',ids[0]).query(`SELECT id,store_id,status,reference,po_number
   FROM dbo.purchase_orders WITH(UPDLOCK,HOLDLOCK) WHERE id=CONVERT(uniqueidentifier,@stock_source_document);`)).recordset??[];
  if(saved.length!==1||saved[0].store_id!==row.store_id||saved[0].status!=='posted')return null;
  const refs=(row.source_refs??[]).filter(ref=>ref[0]==='item_activity_logs');if(!refs.length)return null;
  const q=request();refs.forEach((ref,index)=>q.input('stock_source_activity'+index,ref[1]));
  const activity=(await q.query(`SELECT id,product_id,store_id,activity_type,reference,CONVERT(nvarchar(50),quantity_delta) delta
   FROM dbo.item_activity_logs WITH(UPDLOCK,HOLDLOCK) WHERE id IN(${refs.map((_,index)=>'@stock_source_activity'+index).join(',')});`)).recordset??[];
  const reference=String(saved[0].reference??'').trim()||saved[0].po_number;
  if(activity.length!==refs.length||!reference||activity.some(value=>value.product_id?.toLowerCase()!==row.product_id||value.store_id!==row.store_id||
   value.activity_type!=='receive'||value.reference!==reference||!refs.some(ref=>ref[1]===id(value.id)&&ref[2]===String(value.delta))))return null;
  document={type:'receivings',id:ids[0]};
 }else return null; // Unsupported original workflows remain review-held.
 const {stockSourceManifestJson}=require('../shared/stock-source-manifest.mjs');
 const json=stockSourceManifestJson({version:1,operationId:row.operation_id,action,document,authorId:row.actor_id,terminalId:row.terminal_id,
  branchId:row.store_id,productId:row.product_id,delta:String(row.quantity_delta),effectiveAt:row.effective_at_raw,
  recordedAt:row.recorded_at_raw,sourceRefs:row.source_refs??[]});
 if(!sameRefs(JSON.parse(json).sourceRefs,row.source_refs??[]))return null;
 return json;
}
module.exports={sourceManifestForMovement};
