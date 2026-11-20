// Only called by the uniquely owned disposable LocalDB acceptance harness.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
module.exports=async function cohortCases({pool,sql,migration,inTx,pass}){
 const id=randomUUID(),operation=randomUUID(),database=randomUUID(),aggregate=randomUUID();
 const raw='2026-11-06T01:02:03.1234567Z';
 const insert=(rowId,{op=operation,branch='a',terminal='t',sequence=1,previous=null,root='a'.repeat(64),count=1,action='ADJUST'}={})=>pool.request()
  .input('id',rowId).input('operation',op).input('branch',branch).input('terminal',terminal).input('database',database)
  .input('aggregate',aggregate).input('sequence',String(sequence)).input('previous',previous).input('root',root).input('count',count).input('action',action)
  .query(`INSERT dbo.stock_history_source_cohorts(id,operation_id,store_id,terminal_id,actor_id,action,source_root,source_count,database_guid,
   source_sequence,predecessor_root,proof_json,members_json,payload_hash,upload_aggregate_id,recorded_at_raw)
   VALUES(@id,@operation,@branch,@terminal,N'original-cashier',@action,@root,@count,@database,CONVERT(bigint,@sequence),@previous,
    N'{"signature":"fixture-original"}',N'[{"exact":"original member"}]',REPLICATE('b',64),@aggregate,N'${raw}');`);
 const read=async()=>JSON.stringify((await pool.request().input('id',id).query(`SELECT *,CONVERT(nvarchar(40),accepted_at,127) exact_accepted_at
  FROM dbo.stock_history_source_cohorts WHERE id=@id;`)).recordset);
 const businessBefore=JSON.stringify((await pool.request().query('SELECT * FROM dbo.products ORDER BY id; SELECT * FROM dbo.sync_change_journal ORDER BY change_id;')).recordsets);
 await insert(id);const original=await read();
 await pool.request().batch(migration);assert.equal(await read(),original);
 pass('populated original source cohort survives exact prepared upgrade replay');
 for(const [field,value]of [
  ['operation_id',`'${randomUUID()}'`],['store_id',"N'A'"],['terminal_id',"N'T'"],['actor_id',"N'Original-cashier'"],
  ['action',"N'RECEIVE'"],['source_root',"REPLICATE('c',64)"],['source_count','2'],['database_guid',`'${randomUUID()}'`],
  ['proof_json',"N'{\"signature\":\"fixture-Original\"}'"],['members_json',"N'[{\"exact\":\"Original member\"}]'"],
  ['payload_hash',"REPLICATE('d',64)"],['upload_aggregate_id',`'${randomUUID()}'`],['recorded_at_raw',"N'2026-11-06T01:02:03.1234568Z'"]]){
  await assert.rejects(pool.request().input('id',id).query(`UPDATE dbo.stock_history_source_cohorts SET ${field}=${value} WHERE id=@id;`),e=>/STOCK_HISTORY_SOURCE_IMMUTABLE/.test(e.message));
  assert.equal(await read(),original);
 }
 await assert.rejects(pool.request().input('id',id).query('DELETE dbo.stock_history_source_cohorts WHERE id=@id;'),e=>/STOCK_HISTORY_SOURCE_IMMUTABLE/.test(e.message));
 pass('every original source identity, author, body, proof, digest and time remains byte-immutable under CI defaults');
 for(const fields of ["accepted_batch_id=NEWID()","accepted_transaction_id=42","accepted_at=SYSDATETIMEOFFSET()"])
  await assert.rejects(pool.request().input('id',id).query(`UPDATE dbo.stock_history_source_cohorts SET ${fields} WHERE id=@id;`));
 assert.equal(await read(),original);pass('partial source acceptance is rejected without losing original pending evidence');
 const batch=randomUUID();
 const ack=await pool.request().input('id',id).input('batch',batch).query(`BEGIN TRY UPDATE dbo.stock_history_source_cohorts
  SET accepted_batch_id=@batch,accepted_transaction_id=42,accepted_at=CONVERT(datetimeoffset(7),'${raw}',127) WHERE id=@id;
  SELECT CONVERT(nvarchar(max),NULL) failure; END TRY BEGIN CATCH SELECT ERROR_MESSAGE() failure; END CATCH;`);
 assert.equal(ack.recordset?.[0]?.failure,null);
 const accepted=await read();
 const replay=await pool.request().input('id',id).input('batch',batch).query(`BEGIN TRY UPDATE dbo.stock_history_source_cohorts
  SET accepted_batch_id=@batch,accepted_transaction_id=42,accepted_at=CONVERT(datetimeoffset(7),'${raw}',127) WHERE id=@id;
  SELECT CONVERT(nvarchar(max),NULL) failure; END TRY BEGIN CATCH SELECT ERROR_MESSAGE() failure; END CATCH;`);
 assert.equal(replay.recordset?.[0]?.failure,null);
 assert.equal(await read(),accepted);pass('first complete source ACK and exact replay preserve a single immutable acceptance');
 for(const fields of ['accepted_batch_id=NEWID()','accepted_transaction_id=43',"accepted_at='2026-11-06T01:02:03.1234568Z'",
  "accepted_at='2026-11-06T09:02:03.1234567+08:00'",'accepted_batch_id=NULL,accepted_transaction_id=NULL,accepted_at=NULL'])
  await assert.rejects(pool.request().input('id',id).query(`UPDATE dbo.stock_history_source_cohorts SET ${fields} WHERE id=@id;`),e=>/STOCK_HISTORY_SOURCE_IMMUTABLE/.test(e.message));
 assert.equal(await read(),accepted);pass('changed receipt, 100ns or offset bytes and ACK removal are rejected');
 await insert(randomUUID(),{branch:'A'});await insert(randomUUID(),{terminal:'T',op:randomUUID()});
 await assert.rejects(insert(randomUUID(),{op:randomUUID()}));
 await assert.rejects(insert(randomUUID(),{sequence:2,previous:null,op:randomUUID()}));
 await insert(randomUUID(),{sequence:2,previous:'a'.repeat(64),op:randomUUID()});
 pass('source ordering is unique per exact database, branch and terminal; case-distinct codes are not merged');
 for(const value of [{root:'a'}, {root:'A'.repeat(64)}, {root:'g'.repeat(64)}, {count:0}, {count:2001}, {action:'adjust'}, {action:'ADJUST '}])
  await assert.rejects(insert(randomUUID(),{...value,op:randomUUID(),terminal:randomUUID()}));
 pass('malformed hashes, unsupported action bytes and out-of-bound source counts are rejected');
 await assert.rejects(inTx(async tx=>{
  await new sql.Request(tx).batch('DROP TABLE dbo.stock_history_source_cohorts;');
  await new sql.Request(tx).batch(migration);
 }),e=>/STOCK_HISTORY_PARTIAL_SCHEMA/.test(e.message));
 assert.equal(await read(),accepted);pass('an older four-table preparation is rejected and outer rollback preserves populated metadata');
 await assert.rejects(inTx(async tx=>{
  await new sql.Request(tx).batch('ALTER TABLE dbo.stock_history_source_cohorts NOCHECK CONSTRAINT CK_stock_history_source_count;');
  await new sql.Request(tx).batch(migration);
 }),e=>/STOCK_HISTORY_UNKNOWN_OBJECT/.test(e.message));
 assert.equal(await read(),accepted);pass('unknown cohort constraints stop upgrade without silently repairing or overwriting them');
 const businessAfter=JSON.stringify((await pool.request().query('SELECT * FROM dbo.products ORDER BY id; SELECT * FROM dbo.sync_change_journal ORDER BY change_id;')).recordsets);
 assert.equal(businessAfter,businessBefore);pass('source-schema replay, failures and ACKs change no products or business journal rows');
};
