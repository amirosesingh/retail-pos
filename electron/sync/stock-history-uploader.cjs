const contract=require('../db/stock-history-contract.cjs');
const TABLE='stock_history_movements';
const fail=()=>contract.fail('ESTOCK_HISTORY_ACK_UNCONFIRMED');
/** Optional metadata adapter in the existing PushWorker; not a second engine.
 * No factory activates it before accepted-effect/author admission is ready. */
class StockHistoryUploader{
 constructor({outbox,cloud,assertCurrent=()=>{}}){Object.assign(this,{outbox,cloud,assertCurrent});}
 accepts(aggregate){return aggregate?.changes?.some(change=>change.entity_type===TABLE)===true;}
 async upload(aggregate,branchId,terminalId){
  try{
   this.assertCurrent();
   if(!this.accepts(aggregate)||aggregate.originals||aggregate.changes.some(change=>change.entity_type!==TABLE))fail();
   const batch=await this.outbox.pending(aggregate.aggregateId,branchId,terminalId);this.assertCurrent();
   if(!batch)fail();
   const response=await this.cloud.pushStockHistory(batch);this.assertCurrent();
   // Only the outbox's original Main-private batch witness may acknowledge its
   // exact SQL rows. A generic aggregate ACK is deliberately never invoked.
   const result=await this.outbox.acknowledge(batch,response);this.assertCurrent();
   return{acknowledged:result.acknowledged};
  }catch(error){error.table??=TABLE;throw error;}
 }
}
module.exports={StockHistoryUploader};
