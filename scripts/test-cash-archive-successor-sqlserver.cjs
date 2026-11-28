// Opt-in, fresh UUID-owned LocalDB only. No operator profile or hosted calls.
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const{readFileSync}=require('node:fs'),{join}=require('node:path');
const{createLocal}=require('./lib/shift-protocol-integration-fixture.cjs');
const{cashSuccessorFixture}=require('./lib/cash-successor-fixture.cjs');
const{ChangeReader}=require('../electron/sync/change-reader.cjs');
const{CloudClient}=require('../electron/sync/cloud-client.cjs');
const{CheckpointRepository}=require('../electron/sync/checkpoints.cjs');
const{applyPagedRecovery}=require('../electron/sync/grouped-paged-recovery.cjs');
const{applyGroupedCashInTransaction,parseMixedCashGroup}=require('../electron/sync/grouped-cash-receipt.cjs');
const{applyFinancialCorrection}=require('../electron/sync/grouped-financial-corrections.cjs');
async function main(){
 assert.deepEqual(process.argv.slice(2),['--run']);const f=cashSuccessorFixture(),local=await createLocal(f.branch,{extraTables:['products','item_activity_logs','stock_delta_applied']});
 const{manager,registry,insert}=local;let passed=0;
 const test=async(name,run)=>{await run();passed++;console.log('PASS '+name);};
 try{
  for(const file of ['pos-sync-live-stock-native-v1.sql','pos-sync-cash-settings-recovery-stage-v1.sql','pos-sync-refund-native-receipt-v1.sql'])
   await manager.pool.request().batch(readFileSync(join(__dirname,'preparation',file),'utf8'));
  await insert('shifts',{id:f.shift,store_id:f.branch,terminal_id:f.origin,state:'ACTIVE',status:'OPEN',row_version:1});
  await insert('products',{id:f.product,owner_store_id:f.branch,row_version:2,stock_quantity:27,stock_by_store:{A:20,B:7}});
  for(const[name,rows]of Object.entries(f.localRows))for(const row of rows)await insert(name,row);
  const ledger=f.correction.ledger[0];await insert('stock_delta_applied',{movement_id:ledger.movement_id,product_id:f.product,store_id:f.branch,delta:ledger.delta,applied_at:ledger.applied_at});
  await manager.pool.request().query('UPDATE dbo.sync_checkpoints SET change_tracking_version=CHANGE_TRACKING_CURRENT_VERSION();');
  const checkpoints=new CheckpointRepository(manager),reader=new ChangeReader(manager,registry),cloud=new CloudClient({});
  const worker={registry,reader,cloud,connectionManager:manager},source={terminal:{tokenId:f.terminal}};
  const context={source,branch:f.branch,extended:true,databaseGuid:randomUUID(),parseCash:(wire,epoch)=>parseMixedCashGroup(wire,f.branch,epoch,f.terminal,registry)};
  const snapshot={runId:randomUUID(),pinId:randomUUID(),branch:f.branch,epoch:f.epoch,seq:'2',expires:Date.now()+300000,
   totals:{cash:'1',financial:'1',stock:'1'}};
  const page=(kind,rows)=>JSON.stringify({scope_id:f.branch,epoch:f.epoch,seq:'2',pin_id:snapshot.pinId,kind,after:'0',next:'1',total:'1',rows});
  const pages={cash:page('cash',[f.cashGroup]),financial:page('financial',[f.wire]),stock:page('stock',[{product_id:f.product,branch_balance:20,row_version:2}])};
  for(const[kind,payload]of Object.entries(pages))await manager.pool.request().input('run',snapshot.runId).input('kind',kind).input('payload',payload).input('hash',f.hash(payload))
   .query('INSERT dbo.pos_sync_cash_settings_recovery_pages_v1 VALUES(@run,@kind,0,DATEADD(minute,5,SYSUTCDATETIME()),@payload,@hash);');
  const state=async()=>({
   data:(await manager.pool.request().input('sale',f.cash.sale.id).query(`SELECT CONVERT(nvarchar(80),total_amount) total,is_refunded,row_version,
     (SELECT refunded_qty FROM sale_items WHERE id='${f.cash.item.id}') refunded,
     (SELECT COUNT(*) FROM stock_delta_applied) ledger,(SELECT COUNT(*) FROM sync_change_journal) journal,
     (SELECT stock_by_store FROM products WHERE id='${f.product}') buckets FROM sales WHERE id=@sale;`)).recordset,
   cursor:(await checkpoints.get(f.branch,'__cash_successor_test__','pull'))?.committed_cursor??null,
   stockProof:(await manager.pool.request().query('SELECT COUNT(*) n FROM dbo.pos_sync_grouped_stock_v1;')).recordset[0].n});
  const apply=async({before=null,after=null,commit=true,invalidateAfterCash=false}={})=>{
   const sql=manager.sql(),tx=new sql.Transaction(manager.pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
   let current=true;const assertCurrent=()=>{if(!current)throw Object.assign(new Error('Synthetic source changed after proof'),{code:'ESYNC_GROUPED_SOURCE_CHANGED'});};
   try{
    await before?.(tx);
    const changes=await applyPagedRecovery(worker,tx,context,snapshot,
      async(facts,_seq,cashSuccessor)=>{const result=await applyGroupedCashInTransaction(worker,tx,{...context,retiredStockEpoch:f.epoch,cashSuccessor},facts);if(invalidateAfterCash)current=false;return result;},assertCurrent,
      async facts=>applyFinancialCorrection(worker,tx,{...context,financialEpoch:f.epoch,recoveringFinancial:true},facts));
    await after?.(tx);
    await checkpoints.save(f.branch,'__cash_successor_test__','pull',{committed_cursor:snapshot.seq},tx);
    if(commit)await tx.commit();else await tx.rollback();return changes;
   }catch(error){await tx.rollback().catch(()=>{});throw error;}
  };
  await test('later exact refund archive permits historical cash without rewriting a bootstrapped refunded receipt',async()=>{
   const before=await state();assert.equal(before.cursor,null);assert.equal(before.stockProof,0);
   await apply({commit:false});assert.deepEqual(await state(),before);
  });
  await test('a later correction failure rolls back cash, stock proof and cursor together',async()=>{
   const before=await state();await assert.rejects(apply({after:()=>{throw Object.assign(new Error('synthetic late correction hold'),{code:'ETEST_HOLD'});}}),{code:'ETEST_HOLD'});
   assert.deepEqual(await state(),before);
  });
  await test('pending local receipt journal remains a hard recovery refusal',async()=>{
   const before=await state();await assert.rejects(apply({before:tx=>tx.request().input('id',JSON.stringify({id:f.cash.sale.id})).input('aggregate',randomUUID()).query(`
    INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id) VALUES(N'sales',@id,N'update',N'A',2,@aggregate);`)}),{code:'ELOCAL_UPLOAD_PENDING'});
   assert.deepEqual(await state(),before);
  });
  await test('extra fully-refunded items and foreign-labelled tenders cannot hide outside the verified graph',async()=>{
   const before=await state();
   for(const name of ['sale_items','payment_transactions'])await assert.rejects(apply({before:tx=>{
    const request=tx.request().input('id',randomUUID()).input('sale',f.cash.sale.id).input('product',f.product);
    return request.query(name==='sale_items'?`INSERT dbo.sale_items(id,sale_id,product_id,branch_id,quantity,refunded_qty,row_version) VALUES(@id,@sale,@product,N'foreign',1,1,2);`
     :`INSERT dbo.payment_transactions(id,sale_id,store_id,source_type,row_version) VALUES(@id,@sale,N'foreign',N'sale',1);`);
   }}),{code:'ESYNC_CASH_RECEIPT_REVIEW'});
   assert.deepEqual(await state(),before);
  });
  await test('source invalidation after lazy cash proof rolls the whole activation transaction back',async()=>{
   const before=await state();await assert.rejects(apply({invalidateAfterCash:true}),{code:'ESYNC_GROUPED_SOURCE_CHANGED'});assert.deepEqual(await state(),before);
  });
  await test('missing, wrong-hash or wrong-epoch successor proof cannot authorize skipping the cash birth',async()=>{
   const before=await state();
   for(const mode of ['missing','hash','epoch','pin']){
    const wire=structuredClone(f.wire);if(mode==='missing')delete wire.receipt_graph;
    if(mode==='hash')wire.receipt_graph.payload_sha256='0'.repeat(64);
    if(mode==='epoch'){const graph=JSON.parse(wire.receipt_graph.payload_json);graph.epoch=randomUUID();const raw=JSON.stringify(graph);wire.receipt_graph={payload_json:raw,payload_sha256:f.hash(raw)};}
    const payload=mode==='pin'?JSON.stringify({...JSON.parse(page('financial',[wire])),pin_id:randomUUID()}):page('financial',[wire]);
    await assert.rejects(apply({before:tx=>tx.request().input('run',snapshot.runId).input('payload',payload).input('hash',f.hash(payload)).query(`
      UPDATE dbo.pos_sync_cash_settings_recovery_pages_v1 SET payload_json=@payload,payload_sha256=@hash WHERE run_id=@run AND kind='financial';`)}));
    assert.deepEqual(await state(),before);
   }
  });
  await test('atomic acceptance and restart replay retain one refund movement and unchanged financial values',async()=>{
   const before=await state();await apply();const accepted=await state();assert.deepEqual(accepted.data,before.data);assert.equal(accepted.cursor,'2');assert.equal(accepted.stockProof,1);
   await local.restart();await apply();assert.deepEqual(await state(),accepted);
  });
  await test('an unacknowledged same-value local CT edit still refuses the archived recovery',async()=>{
   await manager.pool.request().input('sale',f.cash.sale.id).query('UPDATE dbo.sales SET is_refunded=is_refunded WHERE id=@sale;');
   const before=await state();await assert.rejects(apply(),{code:'ELOCAL_UPLOAD_PENDING'});assert.deepEqual(await state(),before);
  });
  console.log(passed+' actual disposable SQL Server cash-successor recovery groups passed; staged hosted pages are synthetic adapters.');
 }finally{await local.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
