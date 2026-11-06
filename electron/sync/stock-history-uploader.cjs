const contract=require('../db/stock-history-contract.cjs');
const TABLE='stock_history_movements';
const fail=()=>contract.fail('ESTOCK_HISTORY_ACK_UNCONFIRMED');
const HELD_CODES=new Set(['STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN','STOCK_HISTORY_SOURCE_NOT_ACCEPTED','STOCK_HISTORY_EFFECT_ALREADY_CONSUMED',
 'STOCK_HISTORY_AUTHOR_PERMISSION_REVOKED','STOCK_HISTORY_AUTHOR_REQUIRED','ESTOCK_HISTORY_AUTHOR_REQUIRED','ESTOCK_AUTHOR_PERMISSION_REVOKED','ESTOCK_AUTHOR_INVALID']);
/** Optional metadata adapter in the existing PushWorker; not a second engine.
 * No factory activates it before accepted-effect/author admission is ready. */
class StockHistoryUploader{
 constructor({outbox,cloud,assertCurrent=()=>{},now=()=>performance.now()}){Object.assign(this,{outbox,cloud,assertCurrent,now});this.holds=new Map();}
 accepts(aggregate){return aggregate?.changes?.some(change=>change.entity_type===TABLE)===true;}
 async reviewHeldCount(remaining,branchId,terminalId){this.assertCurrent();const count=await this.outbox.reviewHeldCount(remaining,branchId,terminalId);this.assertCurrent();return count;}
 async upload(aggregate,branchId,terminalId){
  try{
   this.assertCurrent();
   if(!this.accepts(aggregate)||aggregate.originals||aggregate.changes.some(change=>change.entity_type!==TABLE))fail();
   const heldKey=JSON.stringify([aggregate.aggregateId,branchId,terminalId]),held=this.holds.get(heldKey);
   if(held&&this.now()<held.retryAt)return{held:{...held,fresh:false}};
   const batch=await this.outbox.pending(aggregate.aggregateId,branchId,terminalId);this.assertCurrent();
   if(!batch)fail();
   const response=await this.cloud.pushStockHistory(batch);this.assertCurrent();
   // Only the outbox's original Main-private batch witness may acknowledge its
   // exact SQL rows. A generic aggregate ACK is deliberately never invoked.
   const result=await this.outbox.acknowledge(batch,response);this.assertCurrent();
   this.holds.delete(heldKey);
   return{acknowledged:result.acknowledged};
  }catch(error){
   error.table??=TABLE;
   if(HELD_CODES.has(error.code)){
    this.assertCurrent();
    const held={code:error.code,message:'Stock history needs source/author review ('+error.code+'). Existing business data and pending evidence are retained.',retryAt:this.now()+300000};
    const key=JSON.stringify([aggregate.aggregateId,branchId,terminalId]);
    if(this.holds.size<2000||this.holds.has(key))this.holds.set(key,held);
    return{held:{...held,fresh:true}};
   }
   throw error;
  }
 }
}
module.exports={StockHistoryUploader};
