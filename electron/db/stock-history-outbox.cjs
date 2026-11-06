const {StockHistoryStore}=require('./stock-history.cjs');
const contract=require('./stock-history-contract.cjs');
const {stockHistoryUploadRow,assertStockHistoryAcknowledgement}=require('../sync/stock-history-ack.cjs');
const BATCHES=new WeakMap();
const SOURCE_BATCHES=new WeakMap();
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
 async sourceForBusiness(operationId,branchId,terminalId,batchId){
  operationId=contract.identifier(operationId,true);branchId=contract.identifier(branchId);terminalId=contract.identifier(terminalId);
  batchId=contract.identifier(batchId,true);
  return this.transaction(async(tx,pool)=>{
   const cap=await this.store.capability(tx);if(!cap.available)return null;
   const rows=(await this.store.request(tx).input('source_operation',operationId).input('source_branch',branchId).input('source_terminal',terminalId).query(`
    SELECT LOWER(CONVERT(nvarchar(36),id)) id,proof_json,payload_hash,source_root,source_count,
     LOWER(CONVERT(nvarchar(36),database_guid)) database_guid,CONVERT(nvarchar(30),source_sequence) source_sequence
    FROM dbo.stock_history_source_cohorts WITH(HOLDLOCK) WHERE operation_id=CONVERT(uniqueidentifier,@source_operation)
     AND store_id=@source_branch AND terminal_id=@source_terminal;`)).recordset??[];
   if(!rows.length)return null;if(rows.length!==1)fail();
   const row=rows[0];if(row.proof_json==null)return null;
   const proof=require('../security/stock-event-author-protocol.cjs').normalizeStockSourceCohortProof(JSON.parse(row.proof_json));
   if(proof.operationId!==operationId||proof.branchId!==branchId||proof.terminalId!==terminalId||proof.sourceRoot!==row.source_root||
    proof.sourceCount!==row.source_count||proof.sourceDatabaseId!==row.database_guid||proof.sourceSequence!==row.source_sequence)fail();
   const batch=Object.freeze({cohorts:Object.freeze([Object.freeze({proofJson:row.proof_json})])});
   SOURCE_BATCHES.set(batch,{owner:this,pool,databaseKey:cap.databaseKey,row,proof,branchId,terminalId,batchId});return batch;
  });
 }
 async acknowledgeSource(batch,response){
  const saved=SOURCE_BATCHES.get(batch);if(!saved||saved.owner!==this||saved.pool!==this.manager.pool)fail();
  // Older/held source metadata is not a failed business ACK. Its original
  // movement journal remains pending and may never be cleared by this method.
  if(response?.stockSourceStatus!=='captured_unverified')return{acknowledged:0};
  const receipts=response.stockSourceReceipts;if(!Array.isArray(receipts)||receipts.length!==1)fail();
  const receipt=receipts[0],hash=require('node:crypto').createHash('sha256').update(saved.row.proof_json,'utf8').digest('hex');
  if(!receipt||receipt.state!=='unverified'||receipt.proofHash!==hash||receipt.batchId!==saved.batchId)fail();
  const batchId=contract.identifier(receipt.batchId,true);contract.instant(receipt.acceptedAt);
  if(typeof receipt.transactionId!=='string'||! /^[1-9]\d{0,18}$/.test(receipt.transactionId)||BigInt(receipt.transactionId)>9223372036854775807n)fail();
  return this.transaction(async tx=>{
   const cap=await this.store.capability(tx);if(!cap.available||cap.databaseKey!==saved.databaseKey)fail();
   await this.store.request(tx).input('source_id',saved.row.id).input('source_proof',saved.row.proof_json).input('source_hash',saved.row.payload_hash)
    .input('source_batch',batchId).input('source_transaction',receipt.transactionId).input('source_at',contract.canonicalInstant(receipt.acceptedAt)).query(`
    IF NOT EXISTS(SELECT 1 FROM dbo.stock_history_source_cohorts WITH(UPDLOCK,HOLDLOCK) WHERE id=CONVERT(uniqueidentifier,@source_id)
     AND payload_hash COLLATE Latin1_General_100_BIN2=@source_hash COLLATE Latin1_General_100_BIN2
     AND CONVERT(varbinary(max),proof_json)=CONVERT(varbinary(max),@source_proof)
     AND (accepted_batch_id IS NULL OR (accepted_batch_id=CONVERT(uniqueidentifier,@source_batch)
      AND accepted_transaction_id=CONVERT(bigint,@source_transaction) AND accepted_at=CONVERT(datetimeoffset(7),@source_at,127))))
      THROW 51031,'STOCK_HISTORY_SOURCE_ACK_UNCONFIRMED',1;
    UPDATE dbo.stock_history_source_cohorts SET accepted_batch_id=CONVERT(uniqueidentifier,@source_batch),
     accepted_transaction_id=CONVERT(bigint,@source_transaction),accepted_at=CONVERT(datetimeoffset(7),@source_at,127)
     WHERE id=CONVERT(uniqueidentifier,@source_id) AND accepted_batch_id IS NULL;`);
   SOURCE_BATCHES.delete(batch);return{acknowledged:1};
  });
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
   const operationIds=[...new Set(rows.map(row=>row.operation_id))];if(operationIds.length!==1)fail();
   const source=(await this.store.request(tx).input('source_operation',operationIds[0]).input('source_branch',branchId).input('source_terminal',terminalId).query(`
    SELECT proof_json,members_json,LOWER(CONVERT(nvarchar(36),accepted_batch_id)) accepted_batch_id
    FROM dbo.stock_history_source_cohorts WITH(HOLDLOCK) WHERE operation_id=CONVERT(uniqueidentifier,@source_operation)
     AND store_id=@source_branch AND terminal_id=@source_terminal AND accepted_batch_id IS NOT NULL;`)).recordset?.[0];
   const members=new Map();
   if(source){
    if(typeof source.proof_json!=='string'||typeof source.members_json!=='string'||Buffer.byteLength(source.members_json,'utf8')>12*1024*1024)fail();
    const proof=require('../security/stock-event-author-protocol.cjs').normalizeStockSourceCohortProof(JSON.parse(source.proof_json)),all=JSON.parse(source.members_json);
    if(proof.operationId!==operationIds[0]||proof.branchId!==branchId||proof.terminalId!==terminalId||!Array.isArray(all)||all.length!==proof.sourceCount)fail();
    for(const member of all){
     const manifest=JSON.parse(member.manifestJson);
     if(member.root!==proof.sourceRoot||member.count!==proof.sourceCount||members.has(manifest.productId))fail();
     members.set(manifest.productId,{proofJson:source.proof_json,member,sourceBatchId:source.accepted_batch_id});
    }
   }
   const wires=rows.map(row=>{
    const wire=stockHistoryUploadRow(row,{branchId,terminalId}),source=members.get(row.product_id);
    if(!source)return wire;const sourceCohortJson=JSON.stringify(source);
    if(Buffer.byteLength(sourceCohortJson,'utf8')>65536)contract.fail('ESTOCK_HISTORY_OVERSIZED');
    return Object.freeze({...wire,sourceCohortJson});
   });
   let batch;
   do{batch=Object.freeze({version:1,branchId,terminalId,rows:Object.freeze([...wires])});
    if(Buffer.byteLength(JSON.stringify(batch),'utf8')<=126976)break;
    if(wires.length===1)contract.fail('ESTOCK_HISTORY_OVERSIZED');wires.pop();
   }while(wires.length);
   const selected=new Set(batch.rows.map(row=>row.id));
   BATCHES.set(batch,{owner:this,pool,databaseKey:cap.databaseKey,aggregateId,proofs:new Map(rows.map(row=>[row.id,row.author_proof_json??null])),
    changes:chosen.filter(row=>selected.has(String(row.id).toLowerCase())).map(row=>({changeId:Number(row.change_id),id:String(row.id).toLowerCase()}))});
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
