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
    SELECT TOP(8) j.change_id,m.id,DATALENGTH(m.payload_json) payload_size,DATALENGTH(m.author_proof_json) proof_size
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
    const size=3*(Number(candidate.payload_size)+Number(candidate.proof_size??0))+256;
    if(bytes+size>126976){if(!chosen.length)contract.fail('ESTOCK_HISTORY_OVERSIZED');break;}
    chosen.push(candidate);bytes+=size;
   }
   const request=this.store.request(tx);chosen.forEach((row,n)=>request.input('stock_id'+n,row.id));
   const rows=(await request.query(`SELECT LOWER(CONVERT(nvarchar(36),id)) id,LOWER(CONVERT(nvarchar(36),operation_id)) operation_id,
    LOWER(CONVERT(nvarchar(36),product_id)) product_id,store_id,terminal_id,actor_id,source_kind,
    CONVERT(nvarchar(50),quantity_delta) quantity_delta,effective_at_raw,CONVERT(nvarchar(30),effective_ticks) effective_ticks,
    recorded_at_raw,product_name,sku,barcode,clock_state,payload_hash,payload_json,author_proof_json FROM dbo.stock_history_movements
    WHERE id IN(${chosen.map((_,n)=>'@stock_id'+n).join(',')}) ORDER BY local_cursor;`)).recordset??[];
   if(rows.length!==new Set(chosen.map(row=>String(row.id).toLowerCase())).size)fail();
   if(rows.some(row=>contract.uploadAggregateId(row.operation_id,branchId)!==aggregateId))fail();
   const batch=Object.freeze({version:1,branchId,terminalId,rows:Object.freeze(rows.map(row=>stockHistoryUploadRow(row,{branchId,terminalId})))});
   BATCHES.set(batch,{owner:this,pool,databaseKey:cap.databaseKey,aggregateId,proofs:new Map(rows.map(row=>[row.id,row.author_proof_json??null])),
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
     .input('stock_aggregate',captured.aggregateId).input('stock_proof',captured.proofs.get(receipt.id));
    changes.forEach((row,n)=>request.input('stock_change'+n,row.changeId));
    await request.query(`IF NOT EXISTS(SELECT 1 FROM dbo.stock_history_movements WITH(UPDLOCK,HOLDLOCK)
      WHERE id=TRY_CONVERT(uniqueidentifier,@stock_id) AND store_id=@stock_branch AND terminal_id=@stock_terminal
       AND payload_hash COLLATE Latin1_General_100_BIN2=@stock_hash COLLATE Latin1_General_100_BIN2
       AND DATALENGTH(payload_json)=DATALENGTH(@stock_json) AND CONVERT(varbinary(max),payload_json)=CONVERT(varbinary(max),@stock_json)
       AND ((author_proof_json IS NULL AND @stock_proof IS NULL) OR (DATALENGTH(author_proof_json)=DATALENGTH(@stock_proof)
        AND CONVERT(varbinary(max),author_proof_json)=CONVERT(varbinary(max),@stock_proof)))
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
 async reviewHeldCount(remaining,branchId,terminalId){
  branchId=contract.identifier(branchId);terminalId=contract.identifier(terminalId);
  const groups=remaining?.queuedTables;
  if(!Array.isArray(groups))return 0;
  const expected=groups.filter(row=>row.table==='stock_history_movements').reduce((sum,row)=>({pending:sum.pending+Number(row.pending??0),failed:sum.failed+Number(row.failed??0)}),{pending:0,failed:0});
  if(!Number.isSafeInteger(expected.pending)||!Number.isSafeInteger(expected.failed)||expected.failed<1)return 0;
  return this.transaction(async tx=>{
   const cap=await this.store.capability(tx);if(!cap.available)return 0;
   const row=(await this.store.request(tx).input('stock_branch',branchId).input('stock_terminal',terminalId).query(`
    SELECT COUNT_BIG(*) total,
     COALESCE(SUM(CONVERT(bigint,CASE WHEN j.last_error IS NULL THEN 1 ELSE 0 END)),0) pending,
     COALESCE(SUM(CONVERT(bigint,CASE WHEN j.last_error IS NOT NULL THEN 1 ELSE 0 END)),0) failed,
     COALESCE(SUM(CONVERT(bigint,CASE WHEN j.entity_type=N'stock_history_movements' AND j.last_error IS NULL THEN 1 ELSE 0 END)),0) stock_pending,
     COALESCE(SUM(CONVERT(bigint,CASE WHEN j.entity_type=N'stock_history_movements' AND j.last_error IS NOT NULL THEN 1 ELSE 0 END)),0) stock_failed,
     COALESCE(SUM(CONVERT(bigint,CASE WHEN CONVERT(varbinary(max),j.entity_type)=CONVERT(varbinary(max),N'stock_history_movements')
      AND CONVERT(varbinary(max),j.operation)=CONVERT(varbinary(max),N'insert') AND j.last_error LIKE N'Stock history needs source/author review (%'
      AND CONVERT(varbinary(max),j.branch_id)=CONVERT(varbinary(max),@stock_branch)
      AND CONVERT(varbinary(max),m.store_id)=CONVERT(varbinary(max),@stock_branch)
      AND CONVERT(varbinary(max),m.terminal_id)=CONVERT(varbinary(max),@stock_terminal)
      AND m.upload_aggregate_id=j.aggregate_id AND mixed.present IS NULL
      THEN 1 ELSE 0 END)),0) held
    FROM dbo.sync_change_journal j WITH(HOLDLOCK) LEFT JOIN dbo.stock_history_movements m WITH(HOLDLOCK)
     ON m.id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(j.entity_id)=1 THEN j.entity_id ELSE N'{}' END,'$.id'))
    OUTER APPLY(SELECT TOP(1) 1 present FROM dbo.sync_change_journal other WITH(HOLDLOCK)
     WHERE j.entity_type=N'stock_history_movements' AND other.aggregate_id=j.aggregate_id AND other.acknowledged_at IS NULL AND other.entity_type<>N'stock_history_movements') mixed
    WHERE j.branch_id IN(@stock_branch,N'global') AND j.acknowledged_at IS NULL;`)).recordset?.[0];
   if(!row||Number(row.pending)!==remaining.pending||Number(row.failed)!==remaining.failed||Number(row.stock_pending)!==expected.pending||Number(row.stock_failed)!==expected.failed||!Number.isSafeInteger(Number(row.held))||Number(row.held)<0||Number(row.held)>expected.failed)return 0;
   return Number(row.held);
  });
 }
}
module.exports={StockHistoryOutbox};
