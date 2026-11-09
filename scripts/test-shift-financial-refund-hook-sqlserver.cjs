// Opt-in: owned disposable LocalDB, synthetic sealed keys and records only.
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{readFileSync}=require('node:fs');
const {createLocal,createAuthorKeys}=require('./lib/shift-protocol-integration-fixture.cjs');
const {ShiftFinancialOperations}=require('../electron/db/shift-financial-operations.cjs');
const {ShiftSyncJournal}=require('../electron/db/shift-sync-journal.cjs');
const {ShiftAuthorAuthority}=require('../electron/shift-authority.cjs');
const {ShiftFinancialBases}=require('../electron/db/shift-financial-bases.cjs');
const {ReceiptRepository}=require('../electron/db/repositories/receipts.cjs');
async function main(){
 const args = process.argv.slice(2), grouped = args[1] === '--grouped';
 assert.deepEqual(args, grouped ? ['--run','--grouped'] : ['--run']);
   const branch='refund-fixture',local=await createLocal(branch, grouped ? {extraTables:['products','stock_delta_applied','pos_settings']} : undefined),vault=createAuthorKeys();let passed=0,epoch=1;
 const {manager,repository}=local,sql=manager.sql(),terminal=randomUUID(),authorId=randomUUID(),writer=new ShiftSyncJournal(repository);
 const authority=new ShiftAuthorAuthority({keys:vault.keys,connectionManager:manager,session:{identity:()=>({source:'pos',authorId,canonicalSubject:'cashier',branchId:branch}),epoch:()=>epoch,hasPermission:()=>true},terminal:()=>({tokenId:terminal,deviceUse:'operations',branchId:branch}),project:()=> 'https://fixture.supabase.co',branch:()=>branch});
 const operationStore=new ShiftFinancialOperations(manager,{enabled:true});
 const insert=async(tx,name,row)=>{const request=new sql.Request(tx);Object.values(row).forEach((value,i)=>request.input('v'+i,value));await request.query(`INSERT dbo.[${name}](${Object.keys(row).map(key=>'['+key+']').join(',')}) VALUES(${Object.keys(row).map((_,i)=>'@v'+i).join(',')});`);};
 const transaction=async fn=>{const tx=new sql.Transaction(manager.pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);try{const result=await fn(tx);await tx.commit();return result;}catch(error){await tx.rollback().catch(()=>{});throw error;}};
 const seed=async({legacy=false,missingParent=false,openingFloat='20'}={})=>{
  const shift=legacy?(missingParent?randomUUID():null):randomUUID(),sale=randomUUID(),item=randomUUID(),product=randomUUID(),opening=randomUUID();
  if(!legacy){const author=await authority.prepare(authority.captureFinancial('OPEN'));await transaction(async tx=>{const token=await operationStore.captureOpening(tx,{branchId:branch,terminalId:terminal,shiftId:shift,operationId:opening,author});await insert(tx,'shifts',{id:shift,store_id:branch,terminal_id:terminal,status:'OPEN',state:'ACTIVE',opening_float:openingFloat,row_version:1,opened_at:'2026-11-04T00:00:00Z'});await writer.intents.freezeOpening(tx,opening,branch,shift);await operationStore.finalizeOpening(tx,token);});}
  await manager.pool.request().input('id',product).input('stock',JSON.stringify({[branch]:5})).query('INSERT dbo.products(id,stock_quantity,stock_by_store,row_version) VALUES(@id,5,@stock,1);');
  const data={id:sale,store_id:branch,shift_id:shift,total_amount:10,payment_type:'cash',payments:null,discount_amount:0,is_refunded:false,row_version:1};
  if(legacy){await local.insert('sales',data);await local.insert('sale_items',{id:item,sale_id:sale,product_id:product,quantity:2,refunded_qty:0,row_version:1});}
  else{const author=await authority.prepare(authority.captureFinancial('SALE'));await transaction(async tx=>{const token=await operationStore.captureMutation(tx,{branchId:branch,terminalId:terminal,shiftId:shift,operationId:randomUUID(),action:'SALE',author,saleIds:[sale]});await insert(tx,'sales',data);await insert(tx,'sale_items',{id:item,sale_id:sale,product_id:product,quantity:2,refunded_qty:0,row_version:1});await operationStore.finalizeMutation(tx,token);});}
  return{shift,sale,item,product,opening};
 };
 const stats=async value=>(await manager.pool.request().input('sale',value.sale).input('product',value.product).input('shift',value.shift).query(`SELECT (SELECT CONVERT(int,is_refunded) FROM dbo.sales WHERE id=@sale) refunded,(SELECT stock_quantity FROM dbo.products WHERE id=@product) stock,(SELECT COUNT(*) FROM dbo.stock_delta_applied WHERE product_id=@product) movements,(SELECT COUNT(*) FROM dbo.local_operation_receipts WHERE entity_id=CONVERT(nvarchar(128),@sale)) receipts,(SELECT COUNT(*) FROM dbo.pos_sync_shift_financial_events WHERE shift_id=@shift) events,(SELECT CONVERT(nvarchar(30),sequence) FROM dbo.pos_sync_shift_financial_heads WHERE shift_id=@shift) sequence;`)).recordset[0];
 const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
 try{
  if (grouped) {
   const native = require('../electron/sync/grouped-refund-native.cjs');
   const { stableUuid } = require('../electron/db/repositories/aggregates.cjs');
   const { CheckpointRepository } = require('../electron/sync/checkpoints.cjs');
   const { ChangeReader } = require('../electron/sync/change-reader.cjs');
   const { PushWorker } = require('../electron/sync/push-worker.cjs');
   const { SyncCoordinator } = require('../electron/sync/coordinator.cjs');
   const { createGroupedRefundRuntime } = require('../electron/sync/grouped-refund-runtime.cjs');
   const { MIXED_CHECKPOINT } = require('../electron/sync/grouped-store-settings.cjs');
   await manager.pool.request().batch(readFileSync(require.resolve('./preparation/pos-sync-refund-native-receipt-v1.sql'),'utf8'));
   await manager.pool.request().batch(readFileSync(require.resolve('./preparation/pos-sync-live-stock-native-v1.sql'),'utf8'));
   await manager.pool.request().batch(readFileSync(require.resolve('../database/sqlserver/migrations/015_restore_stocked_products_automatically.sql'),'utf8'));
   const value = await seed({legacy:true});
   await manager.pool.request().input('p',value.product).input('i',value.item).input('b',branch).input('map',JSON.stringify({[branch]:0})).query(`
    UPDATE dbo.products SET owner_store_id=@b,stock_quantity=0,stock_by_store=@map,
      is_archived=1,archived_at=SYSDATETIMEOFFSET() WHERE id=@p;
    UPDATE dbo.sale_items SET branch_id=@b WHERE id=@i;
    UPDATE dbo.sync_checkpoints SET change_tracking_version=CHANGE_TRACKING_CURRENT_VERSION()
      WHERE branch_id=@b AND entity_type=N'products' AND direction=N'push';`);
   const checkpoint = new CheckpointRepository(manager), reader = new ChangeReader(manager,local.registry);
   const baseline = await reader.currentVersion();
   const tables = ['sales','sale_items','products','stock_delta_applied'];
   for (const table of tables) await checkpoint.save(branch,table,'push',{change_tracking_version:baseline});
   const {database_guid:databaseGuid} = (await manager.pool.request().query(
    'SELECT LOWER(CONVERT(varchar(36),database_guid)) database_guid FROM sys.database_recovery_status WHERE database_id=DB_ID();')).recordset[0];
   const source = { branchId: branch, terminalId: terminal, databaseGuid, installationGeneration: randomUUID(), feedEpoch: randomUUID() };
   const refundId = 'refund:' + value.sale, operationId = stableUuid({refundId});
   const repo = new ReceiptRepository(manager,null);
   const command = {saleId:value.sale,refundId,branchId:branch};
   const fingerprint = 'verified-refund-fixture', captures = [], oldWrites = [];
   await checkpoint.save(branch,MIXED_CHECKPOINT,'pull',{committed_cursor:JSON.stringify({
    source:fingerprint,databaseGuid,epoch:source.feedEpoch,seq:'1',upper:null,extended:true,
   })});
   let response, admission = true, runtime;
   const cloud = {terminalId:()=>terminal, async submitGroupedRefund(active, wire, grant) {
    captures.push({payload:wire.refundJson,signature:wire.attestation.signature,grant});
    assert.equal(active.pool,manager.pool);
    if(captures.length===1)throw Object.assign(new Error('fixture lost confirmed response'),{code:'ETIMEDOUT'});
    return response;
   }, pushAggregate: payload=>oldWrites.push(payload), pushBatch: payload=>oldWrites.push(payload)};
   const worker = new PushWorker({reader,cloud,checkpoints:checkpoint,
    registry:{tables:local.registry.tables.filter(table=>tables.includes(table.sqlServerTable))},
    uploadGroupedRefund:wire=>runtime.upload(wire)});
   const coordinator = new SyncCoordinator({pushWorker:worker});
   const cash = { async admit() {
    assert(coordinator.ownsExclusive());
    return admission ? {source:{fingerprint,pool:manager.pool},scope:source,assertCurrent:()=>{}} : null;
   }};
   const createRuntime = ()=>createGroupedRefundRuntime({configured:true,cash,cloud,coordinator,connectionManager:manager,
    authority,legacyRepository:()=>repo});
   runtime = createRuntime();
   await runtime.commit(repo,command,null,{assertCurrent:()=>{},financialCapture:action=>authority.captureFinancial(action)},'ephemeral-fixture-grant');
   const pending = await native.readRefundRoute(manager,branch,operationId);
   assert.equal(pending.acceptance,null);
   assert.deepEqual(pending.command.lines,[{item_id:value.item,qty:2,expected_refunded_qty:0,expected_row_version:1}]);
   assert.equal(pending.author.authorId,authorId);
   assert.equal(pending.journal.length,4);
   assert.doesNotMatch(pending.refundJson,/ephemeral-fixture-grant/);
   assert.equal((await repo.refund(command)).replayed,true);
   await assert.rejects(native.assertLegacyRefundWrites(manager,branch,[{table:'products',id:value.product}]),{code:'ESYNC_REFUND_REVIEW_REQUIRED'});
   const change = {refundId:operationId,operation:'U',key:{id:value.product}};
   await assert.rejects(native.refundTrackingCoverage(manager,branch,'products',[change]),{code:'ESYNC_REFUND_REVIEW_REQUIRED'});
   const changes = await manager.pool.request().input('base',baseline).query(
    'SELECT TOP(1) SYS_CHANGE_CONTEXT AS context FROM CHANGETABLE(CHANGES dbo.products,@base) AS ct;');
   assert.equal(native.refundForTrackingContext(changes.recordset[0].context),operationId);
   const canonical = randomUUID(), appliedAt = '2026-11-09T06:25:00.000000+00:00';
   response = {status:'APPLIED',operation_id:operationId,sale_id:value.sale,sale_row_version:2,fully_refunded:true,
    feed_epoch:source.feedEpoch,feed_seq:'2',
    effects:[{item_id:value.item,product_id:value.product,movement_id:canonical,branch_id:branch,delta:2,refunded_qty:2,row_version:2}],
    stock:[{product_id:value.product,branch_id:branch,balance:2}]};
   await assert.rejects(native.recordRefundAcceptance(manager,pending,{...response,feed_epoch:randomUUID()},()=>{}));
   await assert.rejects(transaction(tx=>native.assertRefundHandbackClear(tx,branch,source.feedEpoch,'2')));
   admission = false;
   await assert.rejects(runtime.commit(repo,command,null,{assertCurrent:()=>{}},null),{code:'ESYNC_REFUND_REVIEW_REQUIRED'});
   assert.equal((await coordinator.runNow({branchId:branch,pushOnly:true})).refundUploadHeld.code,'ESYNC_REFUND_REVIEW_REQUIRED');
   assert.equal(captures.length,0);
   admission = true;
   assert.equal((await coordinator.runNow({branchId:branch,pushOnly:true})).code,'ETIMEDOUT');
   await local.restart();
   runtime = createRuntime();
   assert.equal((await coordinator.runNow({branchId:branch,pushOnly:true})).pushed,4);
   assert.deepEqual(captures,[{payload:pending.refundJson,signature:pending.attestation.signature,grant:'ephemeral-fixture-grant'},
    {payload:pending.refundJson,signature:pending.attestation.signature,grant:undefined}]);
   assert.deepEqual(oldWrites,[]);
   await native.recordRefundAcceptance(manager,pending,response,()=>{});
   assert.deepEqual(await native.readRefundRoute(manager,branch,operationId).then(saved=>saved.acceptance),response);
   assert.equal((await native.refundTrackingCoverage(manager,branch,'products',[change],{epoch:source.feedEpoch,withReceipts:true})).get(value.product).seq,'2');
   const proof = {operationId,seq:'2',sale:{id:value.sale,row_version:2,is_refunded:true},
    items:[{id:value.item,product_id:value.product,row_version:2,refunded_qty:2}],
    ledger:[{item_id:value.item,movement_id:canonical,product_id:value.product,store_id:branch,delta:2,applied_at:appliedAt}],
    stock:[{product_id:value.product,branch_balance:2}]};
   const context = {branch,databaseGuid,financialEpoch:source.feedEpoch};
   assert.equal(await transaction(tx=>native.proveNativeRefund(tx,context,proof)),true);
   assert.equal(await transaction(tx=>native.proveNativeRefund(tx,context,proof)),true);
   const ledger = (await manager.pool.request().input('product',value.product)
    .query('SELECT LOWER(CONVERT(varchar(36),movement_id)) id,delta FROM dbo.stock_delta_applied WHERE product_id=@product;')).recordset;
   assert.deepEqual(ledger,[{id:canonical,delta:2}]);
   const totals = await manager.pool.request().input('product',value.product).input('op',operationId).query(`
    SELECT (SELECT stock_quantity FROM dbo.products WHERE id=@product) stock,
      (SELECT is_archived FROM dbo.products WHERE id=@product) archived,
      (SELECT COUNT(*) FROM dbo.sync_change_journal WHERE aggregate_id=@op AND acknowledged_at IS NOT NULL) acknowledged;`);
   assert.deepEqual(totals.recordset,[{stock:2,archived:false,acknowledged:4}]);
   await assert.rejects(transaction(tx=>native.assertRefundHandbackClear(tx,branch,source.feedEpoch,'1')));
   await transaction(tx=>native.assertRefundHandbackClear(tx,branch,source.feedEpoch,'2'));
   console.log('PASS signed grouped refund exact local capture, journal/CT fences, accepted retry and canonical movement convergence');
   return;
  }
  await manager.pool.request().batch('CREATE TABLE dbo.products(id uniqueidentifier PRIMARY KEY,stock_quantity int,stock_by_store nvarchar(max),row_version bigint);CREATE TABLE dbo.stock_delta_applied(movement_id uniqueidentifier PRIMARY KEY,product_id uniqueidentifier,store_id nvarchar(128),delta int,applied_at datetimeoffset);');
  await manager.pool.request().batch(readFileSync(require.resolve('./preparation/025_shift_financial_bases.sql'),'utf8'));
  await manager.pool.request().batch(readFileSync(require.resolve('./preparation/026_shift_financial_operations.sql'),'utf8'));
  await test('actual protected refund signs durable before/after and returns stock once',async()=>{
   const value=await seed(),author=await authority.prepare(authority.captureFinancial('REFUND')),receipts=new ReceiptRepository(manager,null,{financialOperations:operationStore});
   const before=await stats(value);assert.deepEqual(before,{refunded:0,stock:5,movements:0,receipts:0,events:1,sequence:'1'});
   const request={saleId:value.sale,refundId:randomUUID(),branchId:branch};
   await receipts.refund(request,{terminalId:terminal,author});
   const after=await stats(value);assert.deepEqual(after,{refunded:1,stock:7,movements:1,receipts:1,events:2,sequence:'2'});
   assert.equal((await receipts.refund({...request,saleId:value.sale.toUpperCase()},{terminalId:terminal,author})).replayed,true);
   await assert.rejects(receipts.refund({...request,reason:'different reason'},{terminalId:terminal,author}),{code:'EIDEMPOTENCY'});
   await assert.rejects(receipts.refund({...request,saleId:randomUUID()},{terminalId:terminal,author}),{code:'EIDEMPOTENCY'});
   await assert.rejects(receipts.refund({...request,branchId:'other-branch'},{terminalId:terminal,author}),{code:'ERECEIPT'});
   assert.deepEqual(await stats(value),after);
  });
  await test('actual event failure after append rolls back refund stock receipt journal and frontier',async()=>{const value=await seed(),author=await authority.prepare(authority.captureFinancial('REFUND')),before=await stats(value);const wrapper={enabled:true,captureMutation:operationStore.captureMutation.bind(operationStore),assertCurrent:operationStore.assertCurrent.bind(operationStore),async finalizeMutation(tx,token){await operationStore.finalizeMutation(tx,token);throw new Error('injected after immutable event');}};const receipts=new ReceiptRepository(manager,null,{financialOperations:wrapper});await assert.rejects(receipts.refund({saleId:value.sale,refundId:randomUUID(),branchId:branch},{terminalId:terminal,author}),/injected after immutable event/);assert.deepEqual(await stats(value),before);});
  await test('author epoch changed after real event append rolls back all persisted changes',async()=>{const value=await seed(),author=await authority.prepare(authority.captureFinancial('REFUND')),before=await stats(value);const wrapper={enabled:true,captureMutation:operationStore.captureMutation.bind(operationStore),assertCurrent:operationStore.assertCurrent.bind(operationStore),async finalizeMutation(tx,token){await operationStore.finalizeMutation(tx,token);epoch++;}};await assert.rejects(new ReceiptRepository(manager,null,{financialOperations:wrapper}).refund({saleId:value.sale,refundId:randomUUID(),branchId:branch},{terminalId:terminal,author}),{code:'ESYNC_SHIFT_AUTHOR_CHANGED'});assert.deepEqual(await stats(value),before);});
  await test('unprotected NULL and pruned-parent legacy receipts retain existing refunds without invented events',async()=>{for(const missingParent of[false,true]){const value=await seed({legacy:true,missingParent}),before=await stats(value);await new ReceiptRepository(manager,null,{financialOperations:operationStore}).refund({saleId:value.sale,refundId:randomUUID(),branchId:branch},{terminalId:terminal});const after=await stats(value);assert.equal(after.refunded,1);assert.equal(after.stock,7);assert.equal(after.movements,1);assert.equal(after.events,0);assert.equal(after.sequence,null);assert.equal(before.refunded,0);}});
  await test('subcent opening exact origin and signed closing frontier remain historical after refund',async()=>{
   const value=await seed({openingFloat:'1.005'}),author=await authority.prepare(authority.capture('ORIGINAL'));
   const bases=new ShiftFinancialBases(manager,{enabled:true,financialOperations:operationStore,resolveOpeningOrigin:async({transaction,branchId,shiftId})=>{const row=(await new sql.Request(transaction).input('branch',branchId).input('shift',shiftId).query('SELECT local_aggregate_id,row_hash FROM dbo.pos_sync_shift_financial_origins WHERE branch_id=@branch AND shift_id=@shift;')).recordset[0];return row?{openingOrigin:{localAggregateId:String(row.local_aggregate_id).toLowerCase(),rowHash:row.row_hash},versionReferences:[]}:null;}});
   const journal=new ShiftSyncJournal(repository,{authorRequired:true,financialBases:bases,financialOperations:operationStore});
   await manager.pool.request().input('shift',value.shift).query("UPDATE dbo.shifts SET state=N'CASH_COUNT_REQUIRED' WHERE id=@shift;");
   const observation=await journal.observe(branch,value.shift),source=await bases.readDraft({branchId:branch,shiftId:value.shift});assert.equal(source.openingFloat,'1.005000000000');assert.equal(source.computed.expected.cash,'11.01');
   const {buildShiftFinancialDraft}=require('../electron/db/shift-financial-draft.cjs'),d=buildShiftFinancialDraft({computed:source.computed,counted:{cash:'11.01',card:null,digital:null},openingFloat:source.openingFloat});
   const fields=Object.fromEntries(Object.entries(d).filter(([key])=>/^(?:expected_|counted_|variance_)/.test(key))),count=randomUUID(),now='2026-11-04T12:00:00Z',clientKey=value.shift+':original';
   const ops=[{kind:'insert',table:'shift_cash_counts',rows:[{id:count,shift_id:value.shift,store_id:branch,terminal_id:terminal,kind:'ORIGINAL',counted_cash:'11.01',counted_card:null,counted_digital:null,counted_by_name:'cashier',counted_by_staff_id:'cashier',client_key:clientKey,created_at:now}]},
    {kind:'insert',table:'shift_reconciliations',rows:[{id:randomUUID(),shift_id:value.shift,store_id:branch,count_id:count,...fields,created_at:now}]},
    {kind:'insert',table:'shift_close_events',rows:[{id:randomUUID(),shift_id:value.shift,store_id:branch,terminal_id:terminal,event:'cash_count_submitted',to_state:'CASH_COUNT_SUBMITTED',detail:{count_id:count},actor_name:'cashier',actor_staff_id:'cashier',created_at:now},{id:randomUUID(),shift_id:value.shift,store_id:branch,terminal_id:terminal,event:'reconciled',from_state:'CASH_COUNT_SUBMITTED',to_state:'CLOSED',detail:{variance_total:'0.00',variance_status:'NO_VARIANCE'},actor_name:'cashier',actor_staff_id:'cashier',created_at:now}]},
    {kind:'update',table:'shifts',match:{id:value.shift},values:{store_id:branch,status:'CLOSED',state:'CLOSED',closed_at:now,final_counted_cash:'11.01',...fields}}];
   await journal.apply('subcent protected close',ops,{branchId:branch,terminalId:terminal,observation,author,financialSourceHash:source.sourceHash});
   const intent=String((await manager.pool.request().input('count',count).query('SELECT intent_id FROM dbo.pos_sync_shift_financial_bases WHERE count_id=@count;')).recordset[0].intent_id).toLowerCase();
   const before=await bases.get(intent,branch),raw=JSON.parse(before.shiftFinancialBasis.basisJson);assert.equal(before.status,'ready');assert.equal(raw.financialFrontier.sequence,'1');assert.equal(raw.financialFrontier.reservedSequence,'2');assert.equal(raw.openingFloat,'1.005000000000');
   const refundAuthor=await authority.prepare(authority.captureFinancial('REFUND'));await new ReceiptRepository(manager,null,{financialOperations:operationStore}).refund({saleId:value.sale,refundId:randomUUID(),branchId:branch},{terminalId:terminal,author:refundAuthor});assert.equal((await stats(value)).sequence,'3');assert.deepEqual(await bases.get(intent,branch),before);assert.equal((await journal.originalReplay({branchId:branch,shiftId:value.shift,clientKey,actor:'cashier',terminalId:terminal,cash:'11.01',card:null,digital:null})).state,'CLOSED');
  });
  await test('NULL shift on already protected sale holds rather than downgrading to legacy',async()=>{const value=await seed();await manager.pool.request().input('sale',value.sale).query('UPDATE dbo.sales SET shift_id=NULL WHERE id=@sale;');const before=await stats(value);await assert.rejects(new ReceiptRepository(manager,null,{financialOperations:operationStore}).refund({saleId:value.sale,refundId:randomUUID(),branchId:branch},{terminalId:terminal}),{code:'EFINANCIAL_LINEAGE_CONFLICT'});assert.deepEqual(await stats(value),before);});
  console.log(`${passed} owned LocalDB actual refund-hook groups passed`);
 }finally{vault.close();await local.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
