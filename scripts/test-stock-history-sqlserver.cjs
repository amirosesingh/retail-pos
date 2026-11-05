// Opt-in, uniquely owned disposable LocalDB; never reads POS_Local/profiles.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process');
const sql=require('mssql/msnodesqlv8');
assert.deepEqual(process.argv.slice(2),['--run']);
const suffix=randomUUID().replaceAll('-',''),instance='CodexStockHistory_'+suffix,database='StockHistoryFixture_'+suffix;
const control=(...args)=>{const b=execFileSync('C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe',args,{windowsHide:true,timeout:30000});return b.toString(b.includes(0)?'utf16le':'utf8').replace(/^\uFEFF/,'');};
let owned=false,created=false,master,pool,server,groups=0;
const connect=name=>{assert(name==='master'||name===database);return new sql.ConnectionPool({connectionString:`Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`,pool:{min:0,max:3},requestTimeout:15000}).connect();};
const pass=name=>{groups++;console.log('PASS '+name);};
const {StockHistoryStore}=require('../electron/db/stock-history.cjs');
const c=require('../electron/db/stock-history-contract.cjs');
const pid='00000000-0000-4000-8000-000000000001',zero='00000000-0000-4000-8000-000000000002';
const migration=fs.readFileSync(path.join(__dirname,'../database/sqlserver/prepared/031_stock_history_effective_ledger.sql'),'utf8');
(async()=>{try{
 control('create',instance,'-s');owned=true;server=control('info',instance).match(/np:\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query/)?.[0];assert(server);
 master=await connect('master');await master.request().batch('CREATE DATABASE ['+database+'];');created=true;pool=await connect(database);
 await pool.request().batch(`CREATE TABLE dbo.products(id uniqueidentifier PRIMARY KEY,name nvarchar(128),sku nvarchar(128),barcode nvarchar(128),owner_store_id nvarchar(128),stock_by_store nvarchar(max));
  CREATE TABLE dbo.pos_schema_migrations(version int PRIMARY KEY,name nvarchar(128));
  CREATE TABLE dbo.local_operation_receipts(operation_id uniqueidentifier PRIMARY KEY,operation_type nvarchar(32),entity_id nvarchar(128),note nvarchar(max));
  CREATE TABLE dbo.item_activity_logs(id uniqueidentifier PRIMARY KEY,product_id uniqueidentifier,store_id nvarchar(128),quantity_delta int,created_at datetimeoffset(7),activity_type nvarchar(32),row_version int);
  CREATE TABLE dbo.shifts(id uniqueidentifier PRIMARY KEY,store_id nvarchar(128),status nvarchar(32),closed_at datetimeoffset(7));
  CREATE TABLE dbo.sync_change_journal(change_id bigint IDENTITY PRIMARY KEY,entity_type nvarchar(128),entity_id nvarchar(128),operation nvarchar(32),branch_id nvarchar(128),entity_version bigint,aggregate_id uniqueidentifier,acknowledged_at datetimeoffset(7),last_error nvarchar(1000));`);
 const manager={pool,sql:()=>sql},context={key:'source-1',branchId:'a',terminalId:'t',actorId:'admin',clockState:'verified'};
 const store=new StockHistoryStore(manager,{readContext:()=>context,authorizeRead:async()=>({contextKey:context.key,branchId:'a',canViewInventory:true,canExportReports:false,canViewShiftHistory:true})});
 const inTx=async fn=>{const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);try{const v=await fn(tx);await tx.commit();return v;}catch(e){await tx.rollback().catch(()=>{});throw e;}};
 const stock=async()=>JSON.parse((await pool.request().query(`SELECT stock_by_store FROM dbo.products WHERE id='${pid}'`)).recordset[0].stock_by_store);
 const op={kind:'update',table:'products',match:{id:pid},values:{stock_by_store:{a:2,b:1}}};
 const capture=async({operationId=randomUUID(),beforeFinish=null,failAfter=false,effectiveAt=null}={})=>inTx(async tx=>{
  const token=await store.begin(tx,[op],{operationId,branchId:'a',terminalId:'t',kind:'stock',...(effectiveAt?{effectiveAt}:{})});
  await new sql.Request(tx).input('stock',JSON.stringify(op.values.stock_by_store)).query(`UPDATE dbo.products SET stock_by_store=@stock WHERE id='${pid}';`);
  if(beforeFinish)await beforeFinish(tx);
  const outcome=await store.finish(tx,token);if(failAfter)throw Object.assign(new Error('Synthetic failure'),{code:'FIXTURE'});return outcome;
 });
 assert.equal((await inTx(tx=>store.capability(tx))).available,false);pass('all-absent optional schema is unavailable without writes');
 await pool.request().batch(migration);await pool.request().batch(migration);store.invalidateCapability();
 if(process.env.STOCK_HISTORY_SCHEMA_CAPTURE==='1'){
  const {catalogSql}=require('../electron/db/stock-history-schema-check.cjs');
  const objects=(await pool.request().query(catalogSql)).recordset;
  fs.writeFileSync(path.join(__dirname,'../electron/db/stock-history-schema-objects.json'),JSON.stringify(objects,null,2)+'\n');
  console.log('Captured fresh owned schema object fingerprints: '+objects.length);return;
 }
 assert.equal((await inTx(tx=>store.capability(tx))).available,true);pass('prepared upgrade installs/replays exact physical schema');
 assert.equal((await pool.request().query('SELECT COUNT(*) n FROM dbo.products')).recordset[0].n,0);pass('upgrade creates no business/baseline rows');
 await pool.request().batch(`INSERT dbo.products(id,name,sku,barcode,stock_by_store) VALUES('${pid}',N'Fixture',N'SKU-1',N'0001',N'{"a":3,"b":1}'),('${zero}',N'Archived zero',N'SKU-2',N'0002',N'{"a":0}');`);
 const first=await capture();assert.equal(first.captured,1);assert.deepEqual(await stock(),{a:2,b:1});
 let rows=(await pool.request().query('SELECT * FROM dbo.stock_history_movements')).recordset;
 assert.equal(rows.length,1);assert.equal(rows[0].quantity_delta,-1);assert.equal(rows[0].store_id,'a');assert.equal(rows[0].ingested_cursor,null);
 assert.equal((await pool.request().query("SELECT COUNT(*) n FROM dbo.sync_change_journal WHERE entity_type='stock_history_movements' AND acknowledged_at IS NULL")).recordset[0].n,1);
 pass('actual product delta and pending journal commit atomically without reapplying stock');
 assert.equal((await capture()).captured,0);assert.equal((await pool.request().query('SELECT COUNT(*) n FROM dbo.stock_history_movements')).recordset[0].n,1);pass('identical product replay produces no new history or cursor');
 op.values.stock_by_store={a:1,b:1};await assert.rejects(capture({failAfter:true}),{code:'FIXTURE'});assert.deepEqual(await stock(),{a:2,b:1});assert.equal((await pool.request().query('SELECT COUNT(*) n FROM dbo.stock_history_movements')).recordset[0].n,1);pass('failure after evidence rolls back product movement and journal together');
 await assert.rejects(capture({beforeFinish:()=>{context.key='changed';}}),{code:'ESTOCK_HISTORY_CONTEXT_CHANGED'});context.key='source-1';assert.deepEqual(await stock(),{a:2,b:1});pass('session/profile change after awaited write rolls back rather than relabeling history');
 await assert.rejects(pool.request().query("UPDATE dbo.stock_history_movements SET quantity_delta=2;"));
 await assert.rejects(pool.request().query('DELETE dbo.stock_history_movements;'));pass('saved physical claims are immutable');
 const report=await store.readPage({cutoff:'2026-11-05T01:00:00Z',timeZone:'Asia/Brunei'});assert.equal(report.status,'incomplete');assert(report.reasons.includes('NO_VERIFIED_OPENING'));assert.equal(report.rows.length,0);pass('existing current stock never substitutes for a verified historical opening');
 await assert.rejects(store.readPage({cutoff:'2026-11-05T01:00:00Z',timeZone:'Asia/Brunei',branchId:'b'}),{code:'SYNC_BRANCH_FORBIDDEN'});
 await assert.rejects(store.readPage({cutoff:'2026-11-05T01:00:00Z',timeZone:'Asia/Brunei',export:true}),{code:'PERMISSION_DENIED'});pass('normal branch historical read and export permissions remain enforced');
 const baseline=randomUUID(),b='2026-11-05T00:00:00.0000000Z',through='2026-11-06T00:00:00.0000000Z';
 await pool.request().input('baseline',baseline).input('ticks',String(c.instant(b))).input('through',String(c.instant(through))).batch(`
  INSERT dbo.stock_history_baselines(id,store_id,cutoff_at_raw,cutoff_ticks,captured_at_raw,captured_ticks,source_cursor,opening_kind,verification_state,expected_pairs,terminal_watermarks,verified_by,evidence_hash)
   VALUES(@baseline,N'a',N'${b}',CONVERT(decimal(20,0),@ticks),N'${b}',CONVERT(decimal(20,0),@ticks),0,N'system_snapshot',N'verified',2,N'{"fixture":"isolated"}',N'fixture-admin',REPLICATE('a',64));
  INSERT dbo.stock_history_openings(id,baseline_id,product_id,store_id,quantity,product_name,sku,barcode)
   VALUES(NEWID(),@baseline,'${pid}',N'a',3,N'Fixture',N'SKU-1',N'0001'),(NEWID(),@baseline,'${zero}',N'a',0,N'Archived zero',N'SKU-2',N'0002');
  UPDATE dbo.stock_history_heads SET baseline_id=@baseline,coverage_state=N'complete',coverage_from_ticks=CONVERT(decimal(20,0),@ticks),coverage_through_ticks=CONVERT(decimal(20,0),@through),committed_cursor=1 WHERE store_id=N'a';
  UPDATE dbo.stock_history_movements SET ingested_cursor=1,ingested_at=SYSDATETIMEOFFSET();`);
 let page=await store.readPage({cutoff:'2026-11-04T23:59:59.9999999Z',timeZone:'Asia/Brunei'});assert.equal(page.status,'unsupported');assert(page.reasons.includes('BEFORE_BASELINE'));pass('pre-activation dates explicitly unsupported rather than invented from today');
 const saved=(await pool.request().query('SELECT effective_at_raw FROM dbo.stock_history_movements')).recordset[0].effective_at_raw;
 // Synthetic evidence uses a real captured operation instant. Query at that
 // exact saved cutoff and at its preceding100ns, not a rounded Date boundary.
 const savedTicks=c.instant(saved);await pool.request().input('through',String(savedTicks)).query("UPDATE dbo.stock_history_heads SET coverage_through_ticks=CONVERT(decimal(20,0),@through);");
 page=await store.readPage({cutoff:saved,timeZone:'Asia/Brunei',limit:1});assert.equal(page.status,'complete');assert.equal(page.rows[0].quantity,'2');assert(page.next);const second=await store.readPage({cutoff:saved,timeZone:'Asia/Brunei',after:page.next,sourceRevision:page.sourceRevision,limit:1});assert.equal(second.rows[0].quantity,'0');assert.equal(second.next,null);pass('SQL exact effective cutoff, zero/archived opening identity and stable keyset pages');
 const before=await store.readPage({cutoff:c.utc(savedTicks-1n),timeZone:'Asia/Brunei'});assert.equal(before.rows[0].quantity,'3');pass('100ns cutoff does not include a later movement early');
 const laterBaseline=randomUUID(),laterAt=c.utc(savedTicks+1n);
 await pool.request().input('baseline',baseline).input('later',laterBaseline).input('at',laterAt).input('ticks',String(savedTicks+1n)).batch(`
  INSERT dbo.stock_history_baselines(id,store_id,cutoff_at_raw,cutoff_ticks,captured_at_raw,captured_ticks,source_cursor,opening_kind,verification_state,expected_pairs,terminal_watermarks,verified_by,evidence_hash)
   SELECT @later,store_id,@at,CONVERT(decimal(20,0),@ticks),@at,CONVERT(decimal(20,0),@ticks),1,opening_kind,verification_state,expected_pairs,terminal_watermarks,verified_by,evidence_hash FROM dbo.stock_history_baselines WHERE id=@baseline;
  INSERT dbo.stock_history_openings(id,baseline_id,product_id,store_id,quantity,product_name,sku,barcode,owner_store_id)
   SELECT NEWID(),@later,product_id,store_id,CASE WHEN product_id='${pid}' THEN 2 ELSE quantity END,product_name,sku,barcode,owner_store_id FROM dbo.stock_history_openings WHERE baseline_id=@baseline;
  UPDATE dbo.stock_history_heads SET baseline_id=@later,coverage_generation=coverage_generation+1,coverage_through_ticks=CONVERT(decimal(20,0),@ticks);`);
 const olderPage=await store.readPage({cutoff:saved,timeZone:'Asia/Brunei'});assert.equal(olderPage.status,'complete');assert.equal(olderPage.baselineAt,b);assert.equal(olderPage.rows[0].quantity,'2');
 const laterPage=await store.readPage({cutoff:laterAt,timeZone:'Asia/Brunei'});assert.equal(laterPage.status,'complete');assert.equal(laterPage.baselineAt,laterAt);assert.equal(laterPage.rows[0].quantity,'2');
 await pool.request().input('ticks',String(savedTicks+1n)).query('UPDATE dbo.stock_history_heads SET coverage_from_ticks=CONVERT(decimal(20,0),@ticks);');
 assert((await store.readPage({cutoff:saved,timeZone:'Asia/Brunei'})).reasons.includes('INCOMPLETE_MOVEMENTS'));
 await pool.request().input('ticks',String(c.instant(b))).query('UPDATE dbo.stock_history_heads SET coverage_from_ticks=CONVERT(decimal(20,0),@ticks);');
 page=olderPage;pass('a later opening preserves older supported dates without fabricating missing movement coverage');
 const closedShift=randomUUID();await pool.request().input('shift',closedShift).batch("INSERT dbo.shifts(id,store_id,status,closed_at) VALUES(@shift,N'a',N'CLOSED','2026-11-05T01:00:00.0000001Z');");
 const closed=await store.readPage({cutoff:'2099-01-01T00:00:00Z',closedShiftId:closedShift,timeZone:'Asia/Brunei'});assert.equal(closed.cutoff,'2026-11-05T01:00:00.0000001Z');
 await pool.request().input('shift',closedShift).query("UPDATE dbo.shifts SET store_id=N'b' WHERE id=@shift;");await assert.rejects(store.readPage({cutoff:saved,closedShiftId:closedShift,timeZone:'Asia/Brunei'}),{code:'ESTOCK_HISTORY_SHIFT_UNAVAILABLE'});
 pass('native closed-shift shortcut resolves exact SQL100ns source time and rejects foreign shift regardless of renderer timestamp');
 op.values.stock_by_store={a:1,b:1};await capture({effectiveAt:b});
 const invalidated=await store.readPage({cutoff:saved,timeZone:'Asia/Brunei'});assert.equal(invalidated.status,'incomplete');assert(invalidated.reasons.includes('INCOMPLETE_MOVEMENTS'));assert.equal(invalidated.rows.length,0);pass('late pre-baseline arrival invalidates coverage instead of double-counting or silently ignoring it');
 await assert.rejects(store.readPage({cutoff:saved,timeZone:'Asia/Brunei',sourceRevision:page.sourceRevision}),{code:'ESTOCK_HISTORY_SOURCE_CHANGED'});pass('changed snapshot generation rejects mixed report/export pages');

 const {OperationsRepository}=require('../electron/db/repositories/operations.cjs'),{AggregateRepository}=require('../electron/db/repositories/aggregates.cjs');
 const {loadRegistry}=require('../electron/db/schema-registry.cjs'),{aggregatePolicy}=require('../electron/db/write-policy.cjs');
 const operations=new OperationsRepository(manager,loadRegistry(),{stockHistory:store}),aggregate=new AggregateRepository(manager,operations);
 const receiptId=randomUUID(),arrivalOpId=randomUUID(),arrival=[{kind:'upsert',table:'item_activity_logs',rows:[{id:receiptId,product_id:pid,store_id:'a',quantity_delta:4,created_at:'2020-01-01T00:00:00Z',activity_type:'receive'}]}];
 const value={operationId:arrivalOpId,branchId:'a',terminalId:'t',operations:arrival,...aggregatePolicy('receiving',arrival,{source:'pos',level:'staff',subject:'admin',permissions:{can_receive_purchase_order:true}})};
 await aggregate.commit('receiving',value);await aggregate.commit('receiving',value);
 const received=(await pool.request().input('operation',arrivalOpId).query('SELECT quantity_delta,effective_at_raw,payload_json FROM dbo.stock_history_movements WHERE operation_id=@operation;')).recordset;
 assert.equal(received.length,1);assert.equal(received[0].quantity_delta,4);assert.equal(JSON.parse(received[0].payload_json)[17],'0');
 assert.deepEqual(JSON.parse(received[0].payload_json)[16],[['item_activity_logs',receiptId,'4']]);
 assert(c.instant(received[0].effective_at_raw)>c.instant('2020-01-01T00:00:00Z'));assert.deepEqual(await stock(),{a:1,b:1});
 pass('real receiving aggregate freezes original pending physical intent without changing existing deferred stock arithmetic or duplicating on replay');

 const wrong=JSON.parse(JSON.stringify(value));wrong.operationId=randomUUID();wrong.operations[0].rows[0].id=randomUUID();wrong.operations[0].rows[0].store_id='b';
 await assert.rejects(aggregate.commit('receiving',wrong),error=>error.code==='SYNC_BRANCH_FORBIDDEN'||error.code==='ESQLSERVER_WRITE');
 assert.equal((await pool.request().input('operation',wrong.operationId).query('SELECT COUNT(*) n FROM dbo.stock_history_movements WHERE operation_id=@operation;')).recordset[0].n,0);
 pass('existing aggregate foreign-branch denial rolls back history intent and source row together');

 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{
  await new sql.Request(tx).batch('ALTER TABLE dbo.stock_history_movements NOCHECK CONSTRAINT CK_stock_history_movement_clock;');store.invalidateCapability();
  assert.deepEqual(await store.capability(tx),{available:false,reason:'UNKNOWN_SCHEMA'});
  await assert.rejects(new sql.Request(tx).batch(migration),error=>/STOCK_HISTORY_UNKNOWN_OBJECT/.test(error.message));
 }finally{await tx.rollback().catch(()=>{});store.invalidateCapability();}
 assert.equal((await inTx(tx=>store.capability(tx))).available,true);pass('disabled/changed constraints invalidate capability and stop upgrade before silently repairing unknown metadata');

 const outer=new sql.Transaction(pool);await outer.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{await new sql.Request(outer).batch(migration);assert.equal((await new sql.Request(outer).query('SELECT @@TRANCOUNT n;')).recordset[0].n,1);}finally{await outer.rollback().catch(()=>{});store.invalidateCapability();}
 pass('prepared module preserves caller-owned outer transaction for consolidated all-or-nothing upgrade');

 const {StockHistoryOutbox}=require('../electron/db/stock-history-outbox.cjs');
 op.values.stock_by_store={a:2,b:1};const uploadOperation=randomUUID();await capture({operationId:uploadOperation});
 const uploadAggregate=c.uploadAggregateId(uploadOperation,'a'),outbox=new StockHistoryOutbox(manager),batch=await outbox.pending(uploadAggregate,'a','t');
 assert.equal(batch.rows.length,1);assert(Object.isFrozen(batch.rows[0]));
 const original=(await pool.request().input('operation',uploadOperation).query('SELECT payload_json,payload_hash FROM dbo.stock_history_movements WHERE operation_id=@operation;')).recordset[0];
 assert.equal(batch.rows[0].payloadJson,original.payload_json);assert.equal(batch.rows[0].payloadHash,original.payload_hash);
 pass('actual SQL outbox freezes exact original bytes after restarting its reader');
 const {ChangeReader}=require('../electron/sync/change-reader.cjs');
 await pool.request().input('operation',uploadOperation).input('entity',JSON.stringify({id:randomUUID()})).query(`
  INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)
   VALUES(N'item_activity_logs',@entity,N'insert',N'a',1,@operation);`);
 await new ChangeReader(manager).acknowledgeAggregate(uploadOperation);
 assert.equal((await pool.request().input('operation',uploadAggregate).query('SELECT COUNT(*) n FROM dbo.sync_change_journal WHERE aggregate_id=@operation AND acknowledged_at IS NULL;')).recordset[0].n,1);
 pass('ordinary business acknowledgement cannot clear the separate history metadata aggregate');
 const acceptedAt=c.canonicalInstant(new Date().toISOString()),ack={ok:true,version:1,branchId:'a',terminalId:'t',receipts:[{
  id:batch.rows[0].id,payloadHash:batch.rows[0].payloadHash,ingestedCursor:'22',acceptedAt,effectIds:[randomUUID()]}]};
 await assert.rejects(outbox.acknowledge(batch,{ok:true}));
 assert.equal((await pool.request().input('operation',uploadOperation).query('SELECT COUNT(*) n FROM dbo.stock_history_movements WHERE operation_id=@operation AND ingested_cursor IS NULL;')).recordset[0].n,1);
 pass('HTTP-only acknowledgement leaves real SQL history pending');
 let interrupted=true;const originalRequest=outbox.store.request.bind(outbox.store);
 outbox.store.request=tx=>{const request=originalRequest(tx),query=request.query.bind(request);request.query=async text=>{
  const result=await query(text);if(interrupted&&text.includes('UPDATE dbo.sync_change_journal SET acknowledged_at')){interrupted=false;throw Object.assign(new Error('Synthetic acknowledgement interruption'),{code:'FIXTURE'});}return result;
 };return request;};
 await assert.rejects(outbox.acknowledge(batch,ack),{code:'FIXTURE'});
 assert.equal((await pool.request().input('operation',uploadOperation).query('SELECT COUNT(*) n FROM dbo.stock_history_movements WHERE operation_id=@operation AND ingested_cursor IS NULL;')).recordset[0].n,1);
 assert.equal((await pool.request().input('operation',uploadAggregate).query('SELECT COUNT(*) n FROM dbo.sync_change_journal WHERE aggregate_id=@operation AND acknowledged_at IS NULL;')).recordset[0].n,1);
 pass('interrupted metadata acknowledgement rolls back ingestion and journal together');
 assert.deepEqual(await outbox.acknowledge(batch,ack),{acknowledged:1});assert.deepEqual(await stock(),{a:2,b:1});
 assert.equal(await new StockHistoryOutbox(manager).pending(uploadAggregate,'a','t'),null);
 const accepted=(await pool.request().input('operation',uploadOperation).query("SELECT CONVERT(nvarchar(30),ingested_cursor) accepted_position,CONVERT(nvarchar(40),SWITCHOFFSET(ingested_at,'+00:00'),127) accepted_at FROM dbo.stock_history_movements WHERE operation_id=@operation;")).recordset[0];
 assert.equal(accepted.accepted_position,'22');assert.equal(c.canonicalInstant(accepted.accepted_at),acceptedAt);
 pass('exact accepted receipt atomically acknowledges only its SQL metadata without changing stock');
 assert.equal((await pool.request().query("SELECT coverage_state FROM dbo.stock_history_heads WHERE store_id=N'a';")).recordset[0].coverage_state,'incomplete');
 pass('an acknowledged movement cannot claim a stale downloaded head is complete');
 op.values.stock_by_store={a:3,b:1};const changedOperation=randomUUID();await capture({operationId:changedOperation});
 const changedAggregate=c.uploadAggregateId(changedOperation,'a'),changedBatch=await outbox.pending(changedAggregate,'a','t'),changedAck={...ack,receipts:[{...ack.receipts[0],id:changedBatch.rows[0].id,payloadHash:changedBatch.rows[0].payloadHash,ingestedCursor:'23',effectIds:[randomUUID()]}]};
 await pool.request().input('operation',changedAggregate).input('other',JSON.stringify({id:randomUUID()})).query('UPDATE dbo.sync_change_journal SET entity_id=@other WHERE aggregate_id=@operation;');
 await assert.rejects(outbox.acknowledge(changedBatch,changedAck),error=>/STOCK_HISTORY_JOURNAL_CHANGED/.test(error.message));
 assert.equal((await pool.request().input('operation',changedOperation).query('SELECT COUNT(*) n FROM dbo.stock_history_movements WHERE operation_id=@operation AND ingested_cursor IS NULL;')).recordset[0].n,1);
 pass('changed journal identity cannot be silently acknowledged as another movement');
 await pool.request().batch('ALTER TABLE dbo.products ADD stock_quantity int,row_version bigint;');
 await pool.request().batch(`UPDATE dbo.products SET stock_quantity=4,row_version=1 WHERE id='${pid}';
  CREATE TABLE dbo.sales(id uniqueidentifier PRIMARY KEY,store_id nvarchar(128),is_refunded bit,row_version bigint);
  CREATE TABLE dbo.sale_items(id uniqueidentifier PRIMARY KEY,sale_id uniqueidentifier,product_id uniqueidentifier,quantity int,refunded_qty int,row_version bigint);
  CREATE TABLE dbo.stock_delta_applied(movement_id uniqueidentifier PRIMARY KEY,product_id uniqueidentifier,store_id nvarchar(128),delta int,applied_at datetimeoffset(7));`);
 const refundSale=randomUUID(),refundItem=randomUUID(),refundId=randomUUID();
 await pool.request().input('sale',refundSale).input('item',refundItem).batch(`INSERT dbo.sales VALUES(@sale,N'a',0,1);
  INSERT dbo.sale_items VALUES(@item,@sale,'${pid}',3,1,1);`);
 const {ReceiptRepository}=require('../electron/db/repositories/receipts.cjs'),{stableUuid}=require('../electron/db/repositories/aggregates.cjs');
 const receipts=new ReceiptRepository(manager,null,{stockHistory:store}),refundOperation=stableUuid({refundId}),beforeRefund=(await stock()).a;
 assert.equal((await receipts.refund({saleId:refundSale,refundId,branchId:'a'})).replayed,false);
 assert.equal((await receipts.refund({saleId:refundSale,refundId,branchId:'a'})).replayed,true);
 const refundHistory=(await pool.request().input('operation',refundOperation).query('SELECT payload_json,quantity_delta FROM dbo.stock_history_movements WHERE operation_id=@operation;')).recordset;
 assert.equal(refundHistory.length,1);assert.equal(refundHistory[0].quantity_delta,2);assert.equal((await stock()).a,beforeRefund+2);
 const savedRefundMovement=(await pool.request().query('SELECT LOWER(CONVERT(nvarchar(36),movement_id)) movement FROM dbo.stock_delta_applied;')).recordset[0].movement;
 assert.deepEqual(JSON.parse(refundHistory[0].payload_json)[16],[['stock_delta_applied',savedRefundMovement,'2']]);
 pass('actual partial-refund writer captures its exact existing source receipt and stock effect once without changing refund arithmetic');
 console.log('PASS '+groups+' actual disposable stock-history SQL groups');
}finally{
 await pool?.close().catch(()=>{});if(created)await master.request().batch('ALTER DATABASE ['+database+'] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE ['+database+'];');await master?.close().catch(()=>{});
 if(owned){control('stop',instance,'-k');control('delete',instance);}console.log('Cleaned uniquely owned stock-history LocalDB fixture');
}})().catch(error=>{console.error(error);process.exitCode=1;});
