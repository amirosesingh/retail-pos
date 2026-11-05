const {StockHistoryStore}=require('./stock-history.cjs');
const contract=require('./stock-history-contract.cjs');
const {stockHistoryUploadRow,assertStockHistoryAcknowledgement}=require('../sync/stock-history-ack.cjs');
const BATCHES=new WeakMap();
const fail=()=>contract.fail('ESTOCK_HISTORY_ACK_UNCONFIRMED');
/** Optional metadata in the existing SQL journal. No file/browser queue exists. */
class StockHistoryOutbox{
 constructor(manager,{assertCurrent=()=>{}}={}){this.manager=manager;this.assertCurrent=assertCurrent;this.store=new StockHistoryStore(manager,{assertCurrent});}
 async transaction(work){
  const pool=this.manager.pool;if(!pool)fail();this.assertCurrent();
  const sql=this.manager.sql(),tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
  try{const value=await work(tx,pool);this.assertCurrent();if(pool!==this.manager.pool)fail();await tx.commit();return value;}
  catch(error){await Promise.resolve(tx.rollback()).catch(()=>{});throw error;}
 }
 async pending(aggregateId,branchId,terminalId){
  aggregateId=contract.identifier(aggregateId,true);branchId=contract.identifier(branchId);terminalId=contract.identifier(terminalId);
  return this.transaction(async(tx,pool)=>{
   const cap=await this.store.capability(tx);if(!cap.available)contract.fail('ESTOCK_HISTORY_SCHEMA_UNAVAILABLE');
   const candidates=(await this.store.request(tx).input('stock_aggregate',aggregateId).input('stock_branch',branchId).query(`
    SELECT TOP(128) j.change_id,m.id,DATALENGTH(m.payload_json) payload_size
    FROM dbo.sync_change_journal j WITH(UPDLOCK,HOLDLOCK)
    LEFT JOIN dbo.stock_history_movements m WITH(UPDLOCK,HOLDLOCK)
     ON m.id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(j.entity_id)=1 THEN j.entity_id ELSE N'{}' END,'$.id'))
    WHERE j.aggregate_id=TRY_CONVERT(uniqueidentifier,@stock_aggregate) AND j.branch_id=@stock_branch
     AND j.entity_type=N'stock_history_movements' AND j.acknowledged_at IS NULL ORDER BY j.change_id;`)).recordset??[];
   if(!candidates.length)return null;
   let bytes=0;const chosen=[];
   for(const candidate of candidates){
    if(!candidate.id||!Number.isSafeInteger(Number(candidate.change_id))||candidate.payload_size==null)fail();
    // Conservative UTF-16→UTF-8 bound plus JSON string/envelope escaping.
    const size=3*Number(candidate.payload_size)+256;
    if(bytes+size>126976){if(!chosen.length)contract.fail('ESTOCK_HISTORY_OVERSIZED');break;}
    chosen.push(candidate);bytes+=size;
   }
   const request=this.store.request(tx);chosen.forEach((row,n)=>request.input('stock_id'+n,row.id));
   const rows=(await request.query(`SELECT LOWER(CONVERT(nvarchar(36),id)) id,LOWER(CONVERT(nvarchar(36),operation_id)) operation_id,
    LOWER(CONVERT(nvarchar(36),product_id)) product_id,store_id,terminal_id,actor_id,source_kind,
    CONVERT(nvarchar(50),quantity_delta) quantity_delta,effective_at_raw,CONVERT(nvarchar(30),effective_ticks) effective_ticks,
    recorded_at_raw,product_name,sku,barcode,clock_state,payload_hash,payload_json FROM dbo.stock_history_movements
    WHERE id IN(${chosen.map((_,n)=>'@stock_id'+n).join(',')}) ORDER BY local_cursor;`)).recordset??[];
   if(rows.length!==new Set(chosen.map(row=>String(row.id).toLowerCase())).size)fail();
   if(rows.some(row=>contract.uploadAggregateId(row.operation_id,branchId)!==aggregateId))fail();
   const batch=Object.freeze({version:1,branchId,terminalId,rows:Object.freeze(rows.map(row=>stockHistoryUploadRow(row,{branchId,terminalId})))});
   BATCHES.set(batch,{owner:this,pool,databaseKey:cap.databaseKey,aggregateId,
    changes:chosen.map(row=>({changeId:Number(row.change_id),id:String(row.id).toLowerCase()}))});
   return batch;
  });
 }
 async acknowledge(batch,response){
  const captured=BATCHES.get(batch);if(!captured||captured.owner!==this||captured.pool!==this.manager.pool)fail();
  const proof=assertStockHistoryAcknowledgement(batch,response);
  return this.transaction(async tx=>{
   const cap=await this.store.capability(tx);if(!cap.available||cap.databaseKey!==captured.databaseKey)fail();
   for(const receipt of proof){
    const expected=batch.rows.find(row=>row.id===receipt.id),changes=captured.changes.filter(change=>change.id===receipt.id);
    if(!expected||!changes.length)fail();
    const request=this.store.request(tx).input('stock_id',receipt.id).input('stock_json',expected.payloadJson).input('stock_hash',expected.payloadHash)
     .input('stock_cursor',receipt.ingestedCursor).input('stock_at',receipt.acceptedAt).input('stock_branch',batch.branchId).input('stock_terminal',batch.terminalId)
     .input('stock_aggregate',captured.aggregateId);
    changes.forEach((row,n)=>request.input('stock_change'+n,row.changeId));
    await request.query(`IF NOT EXISTS(SELECT 1 FROM dbo.stock_history_movements WITH(UPDLOCK,HOLDLOCK)
      WHERE id=TRY_CONVERT(uniqueidentifier,@stock_id) AND store_id=@stock_branch AND terminal_id=@stock_terminal
       AND payload_hash COLLATE Latin1_General_100_BIN2=@stock_hash COLLATE Latin1_General_100_BIN2
       AND DATALENGTH(payload_json)=DATALENGTH(@stock_json) AND CONVERT(varbinary(max),payload_json)=CONVERT(varbinary(max),@stock_json)
       AND (ingested_cursor IS NULL OR (ingested_cursor=CONVERT(bigint,@stock_cursor) AND ingested_at=CONVERT(datetimeoffset(7),@stock_at,127))))
      THROW 51031,'STOCK_HISTORY_ACK_UNCONFIRMED',1;
     IF (SELECT COUNT_BIG(*) FROM dbo.sync_change_journal WITH(UPDLOCK,HOLDLOCK)
      WHERE change_id IN(${changes.map((_,n)=>'@stock_change'+n).join(',')}) AND aggregate_id=TRY_CONVERT(uniqueidentifier,@stock_aggregate)
       AND branch_id=@stock_branch AND entity_type=N'stock_history_movements' AND acknowledged_at IS NULL
       AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(entity_id)=1 THEN entity_id ELSE N'{}' END,'$.id'))=TRY_CONVERT(uniqueidentifier,@stock_id))<>${changes.length}
      THROW 51031,'STOCK_HISTORY_JOURNAL_CHANGED',1;
     UPDATE dbo.stock_history_movements SET ingested_cursor=CONVERT(bigint,@stock_cursor),ingested_at=CONVERT(datetimeoffset(7),@stock_at,127)
      WHERE id=TRY_CONVERT(uniqueidentifier,@stock_id) AND ingested_cursor IS NULL;
     UPDATE dbo.sync_change_journal SET acknowledged_at=SYSDATETIMEOFFSET(),last_error=NULL
      WHERE change_id IN(${changes.map((_,n)=>'@stock_change'+n).join(',')}) AND aggregate_id=TRY_CONVERT(uniqueidentifier,@stock_aggregate)
       AND branch_id=@stock_branch AND entity_type=N'stock_history_movements' AND acknowledged_at IS NULL;
     UPDATE dbo.stock_history_heads SET coverage_state=N'incomplete',coverage_generation=coverage_generation+1
      WHERE store_id=@stock_branch AND committed_cursor<CONVERT(bigint,@stock_cursor);`);
   }
   BATCHES.delete(batch);return{acknowledged:proof.length};
  });
 }
}
module.exports={StockHistoryOutbox};
