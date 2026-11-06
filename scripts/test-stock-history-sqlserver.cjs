// Opt-in, uniquely owned disposable LocalDB; never reads POS_Local/profiles.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process');
const sql=require('mssql/msnodesqlv8');
assert.deepEqual(process.argv.slice(2),['--run']);
const suffix=randomUUID().replaceAll('-',''),instance='CodexStockHistory_'+suffix,database='StockHistoryFixture_'+suffix;
const control=(...args)=>{const b=execFileSync('C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe',args,{windowsHide:true,timeout:30000});return b.toString(b.includes(0)?'utf16le':'utf8').replace(/^\uFEFF/,'');};
let owned=false,created=false,master,pool,server,proofDirectory,groups=0;
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
 const oldProduct=randomUUID();
 await pool.request().input('id',oldProduct).query("INSERT dbo.products(id,name,stock_by_store) VALUES(@id,N'Existing schema30 checkout product',N'{\"a\":2}');");
 await inTx(async tx=>{
  const token=await store.begin(tx,[{kind:'update',table:'products',match:{id:oldProduct},values:{stock_by_store:{a:1}}}],{operationId:randomUUID(),branchId:'a',terminalId:'t',kind:'sale'});
  assert.equal(token,null);
  await new sql.Request(tx).input('id',oldProduct).query("UPDATE dbo.products SET stock_by_store=N'{\"a\":1}' WHERE id=@id;");
  assert.deepEqual(await store.finish(tx,token),{captured:0,available:false});
 });
 assert.equal((await pool.request().input('id',oldProduct).query('SELECT stock_by_store FROM dbo.products WHERE id=@id;')).recordset[0].stock_by_store,'{"a":1}');
 const oldReport=await store.readPage({cutoff:'2026-11-05T01:00:00Z',timeZone:'Asia/Brunei'});
 assert.equal(oldReport.status,'unavailable');assert.deepEqual(oldReport.reasons,['SCHEMA_NOT_INSTALLED']);
 assert.equal((await pool.request().query('SELECT COUNT(*) n FROM dbo.sync_change_journal;')).recordset[0].n,0);
 await pool.request().input('id',oldProduct).query('DELETE dbo.products WHERE id=@id;');
 pass('existing schema without optional031 keeps normal local stock saves and truthful unavailable report without phantom pending metadata');
 await pool.request().batch(migration);store.invalidateCapability();
 if(process.env.STOCK_HISTORY_SCHEMA_CAPTURE==='1'){
  const {catalogSql}=require('../electron/db/stock-history-schema-check.cjs');
  const objects=(await pool.request().query(catalogSql)).recordset;
  fs.writeFileSync(path.join(__dirname,'../electron/db/stock-history-schema-objects.json'),JSON.stringify(objects,null,2)+'\n');
  console.log('Captured fresh owned schema object fingerprints: '+objects.length);return;
 }
 await pool.request().batch(migration);
 assert.equal((await inTx(tx=>store.capability(tx))).available,true);pass('prepared upgrade installs/replays exact physical schema');
 assert.equal((await pool.request().query('SELECT COUNT(*) n FROM dbo.products')).recordset[0].n,0);pass('upgrade creates no business/baseline rows');
 await require('./stock-history-cohort-sqlserver-cases.cjs')({pool,sql,migration,inTx,pass});
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
 const codeCaseReader=new StockHistoryStore(manager,{authorizeRead:async()=>({contextKey:'code-case',branchId:'A',canViewInventory:true})});
 const codeCasePage=await codeCaseReader.readPage({cutoff:saved,timeZone:'Asia/Brunei'});
 assert.equal(codeCasePage.status,'incomplete');assert.deepEqual(codeCasePage.rows,[]);assert(codeCasePage.reasons.includes('NO_VERIFIED_OPENING'));
 pass('an authorized case-distinct branch code cannot read another branch opening, quantities or identities under CI SQL defaults');
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
 const {createShiftAuthorKeys}=require('../electron/security/shift-author-key.cjs');
 proofDirectory=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'stock-history-author-fixture-'));
 const keys=createShiftAuthorKeys({safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()},directory:()=>proofDirectory});
 const authorId=randomUUID(),binding={projectOrigin:'https://stock.fixture',terminalId:'t',authorId},info=keys.prepare(binding);
 keys.markEnrolled(binding,{keyId:info.keyId,publicKey:info.publicKey});context.actorId=authorId;
 context.author={signMovement:row=>keys.signStockEvent(binding,{expectedKeyId:info.keyId,subject:'cashier-a',branchId:row.store_id,operationId:row.operation_id,movementId:row.id,action:'ADJUST',payloadHash:row.payload_hash})};
 op.values.stock_by_store={a:(await stock()).a+1,b:1};const signedOperation=randomUUID();await capture({operationId:signedOperation});
 const signedRow=(await pool.request().input('operation',signedOperation).query('SELECT * FROM dbo.stock_history_movements WHERE operation_id=@operation;')).recordset[0];
 assert.equal(JSON.parse(signedRow.author_proof_json).authorId,authorId);assert.equal(JSON.parse(signedRow.author_proof_json).payloadHash,signedRow.payload_hash);
 const signedAggregate=c.uploadAggregateId(signedOperation,'a'),signedBatch=await new StockHistoryOutbox(manager).pending(signedAggregate,'a','t');
 assert.equal(signedBatch.rows[0].authorProofJson,signedRow.author_proof_json);
 pass('original enrolled author proof and exact original bytes commit with actual stock and survive an outbox restart');
 await assert.rejects(pool.request().input('operation',signedOperation).query(`UPDATE dbo.stock_history_movements
  SET author_proof_json=REPLACE(author_proof_json,N'cashier-a',N'CASHIER-A'),ingested_cursor=40,ingested_at=SYSDATETIMEOFFSET() WHERE operation_id=@operation;`),error=>/STOCK_HISTORY_IMMUTABLE/.test(error.message));
 pass('proof identity bytes cannot change during arrival acknowledgement even under case-insensitive SQL collation');
 const proofFiles=fs.readdirSync(proofDirectory);assert.equal(proofFiles.length,1);fs.unlinkSync(path.join(proofDirectory,proofFiles[0]));
 const beforeUnsigned=(await stock()).a;op.values.stock_by_store={a:beforeUnsigned+1,b:1};const missingKeyOperation=randomUUID();
 assert.equal((await capture({operationId:missingKeyOperation})).captured,1);assert.equal((await stock()).a,beforeUnsigned+1);
 const unsignedRow=(await pool.request().input('operation',missingKeyOperation).query('SELECT author_proof_json,ingested_cursor FROM dbo.stock_history_movements WHERE operation_id=@operation;')).recordset[0];
 assert.equal(unsignedRow.author_proof_json,null);assert.equal(unsignedRow.ingested_cursor,null);assert.equal(fs.readdirSync(proofDirectory).length,0);
 pass('missing author vault material retains unsigned review evidence without rolling back stock or replacing a key');
 context.author={signMovement:()=>{throw Object.assign(new Error('Synthetic report-author permission change'),{code:'ESTOCK_AUTHOR_PERMISSION_REVOKED'});}};
 const beforeRevoked=(await stock()).a;op.values.stock_by_store={a:beforeRevoked+1,b:1};const revokedOperation=randomUUID();await capture({operationId:revokedOperation});
 assert.equal((await stock()).a,beforeRevoked+1);assert.equal((await pool.request().input('operation',revokedOperation).query('SELECT author_proof_json FROM dbo.stock_history_movements WHERE operation_id=@operation;')).recordset[0].author_proof_json,null);
 pass('report-author permission loss retains review evidence without widening or overriding the actual business writer');
 const multiProducts=Array.from({length:10},()=>randomUUID()),multiOperation=randomUUID();
 await pool.request().input('ids',JSON.stringify(multiProducts)).query(`INSERT dbo.products(id,name,stock_by_store) SELECT CONVERT(uniqueidentifier,value),N'Batch fixture',N'{"a":3}' FROM OPENJSON(@ids);`);
 await inTx(async tx=>{
  const operations=multiProducts.map(id=>({kind:'update',table:'products',match:{id},values:{stock_by_store:{a:2}}}));
  const token=await store.begin(tx,operations,{operationId:multiOperation,branchId:'a',terminalId:'t',kind:'stock'});
  await new sql.Request(tx).input('ids',JSON.stringify(multiProducts)).query(`UPDATE p SET stock_by_store=N'{"a":2}' FROM dbo.products p JOIN OPENJSON(@ids) ids ON p.id=CONVERT(uniqueidentifier,ids.value);`);
  assert.equal((await store.finish(tx,token)).captured,10);
 });
 const multiAggregate=c.uploadAggregateId(multiOperation,'a'),firstReader=new StockHistoryOutbox(manager),firstPage=await firstReader.pending(multiAggregate,'a','t');
 assert.equal(firstPage.rows.length,8);const restartedReader=new StockHistoryOutbox(manager),retryPage=await restartedReader.pending(multiAggregate,'a','t');
 assert.deepEqual(retryPage,firstPage);pass('a ten-product operation uploads only eight original claims and repeats the same unacknowledged page after restart');
 let nextPosition=100;const pageAck=page=>({ok:true,version:1,branchId:'a',terminalId:'t',receipts:page.rows.map(row=>({id:row.id,payloadHash:row.payloadHash,ingestedCursor:String(nextPosition++),acceptedAt,effectIds:[randomUUID()]}))});
 assert.deepEqual(await restartedReader.acknowledge(retryPage,pageAck(retryPage)),{acknowledged:8});
 const lastPage=await restartedReader.pending(multiAggregate,'a','t');assert.equal(lastPage.rows.length,2);assert(lastPage.rows.every(row=>!firstPage.rows.some(first=>first.id===row.id)));
 assert.deepEqual(await restartedReader.acknowledge(lastPage,pageAck(lastPage)),{acknowledged:2});assert.equal(await restartedReader.pending(multiAggregate,'a','t'),null);
 assert.equal((await pool.request().input('ids',JSON.stringify(multiProducts)).query(`SELECT COUNT(*) n FROM dbo.products p JOIN OPENJSON(@ids) ids ON p.id=CONVERT(uniqueidentifier,ids.value) WHERE JSON_VALUE(stock_by_store,'$.a')=N'2';`)).recordset[0].n,10);
 pass('partial exact acknowledgements preserve the remaining two claims and never reapply business stock');
 const heldMessage='Stock history needs source/author review (STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN).';
 const heldAggregate=c.uploadAggregateId(revokedOperation,'a'),queue=new ChangeReader(manager);
 await pool.request().input('aggregate',heldAggregate).input('message',heldMessage).query('UPDATE dbo.sync_change_journal SET last_error=@message WHERE aggregate_id=@aggregate;');
 const heldReader=new StockHistoryOutbox(manager),summary=()=>queue.pendingSummary('a');
 assert.equal(await heldReader.reviewHeldCount(await summary(),'a','t'),1);
 assert.equal(await new StockHistoryOutbox(manager).reviewHeldCount(await summary(),'a','t'),1);
 assert.equal(await heldReader.reviewHeldCount(await summary(),'a','other-terminal'),0);
 assert.equal(await heldReader.reviewHeldCount(await summary(),'A','t'),0);
 assert.equal(await heldReader.reviewHeldCount(await summary(),'a','T'),0);
 pass('durable exact metadata identity remains review-held after restart and is terminal-scoped');
 await assert.rejects(pool.request().input('aggregate',randomUUID()).input('operation',revokedOperation).query('UPDATE dbo.stock_history_movements SET upload_aggregate_id=@aggregate WHERE operation_id=@operation;'),error=>/STOCK_HISTORY_IMMUTABLE/.test(error.message));
 pass('business-journal renaming cannot change the immutable metadata aggregate identity');
 const fakeAggregate=randomUUID(),fakeId=randomUUID();
 await pool.request().input('aggregate',fakeAggregate).input('entity',JSON.stringify({id:fakeId})).input('message',heldMessage).query(`INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id,last_error)
  VALUES(N'stock_history_movements',@entity,N'insert',N'a',1,@aggregate,@message);`);
 assert.equal(await heldReader.reviewHeldCount(await summary(),'a','t'),1);
 await pool.request().input('aggregate',fakeAggregate).input('entity',JSON.stringify({id:signedRow.id})).query('UPDATE dbo.sync_change_journal SET entity_id=@entity WHERE aggregate_id=@aggregate;');
 assert.equal(await heldReader.reviewHeldCount(await summary(),'a','t'),1);
 pass('forged review text/table names and unknown movement IDs remain critical');
 const mixedId=randomUUID();
 await pool.request().input('aggregate',heldAggregate).input('entity',JSON.stringify({id:mixedId})).input('message',heldMessage).query(`INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id,last_error)
  VALUES(N'audit_logs',@entity,N'insert',N'other-branch',1,@aggregate,@message);`);
 assert.equal(await heldReader.reviewHeldCount(await summary(),'a','t'),0);
 await pool.request().input('aggregate',heldAggregate).query("DELETE dbo.sync_change_journal WHERE aggregate_id=@aggregate AND entity_type=N'audit_logs';");
 assert.equal(await heldReader.reviewHeldCount(await summary(),'a','t'),1);
 pass('any mixed business row keeps its entire aggregate critical even under another branch');
 const staleSummary=await summary();staleSummary.queuedTables.find(row=>row.table==='stock_history_movements').failed++;
 assert.equal(await heldReader.reviewHeldCount(staleSummary,'a','t'),0);
 const beforeCoreSummary=await summary(),newCoreAggregate=randomUUID();
 await pool.request().input('aggregate',newCoreAggregate).input('entity',JSON.stringify({id:randomUUID()})).query(`INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)
  VALUES(N'sales',@entity,N'insert',N'a',1,@aggregate);`);
 assert.equal(await heldReader.reviewHeldCount(beforeCoreSummary,'a','t'),0);
 assert.equal(await heldReader.reviewHeldCount(await summary(),'a','t'),1);
 pass('a core sale committed between summary and classifier cannot be waived by the extra metadata read');
 const beforeHeldStock=await stock(),beforeHeldCount=(await pool.request().query('SELECT COUNT(*) n FROM dbo.sync_change_journal WHERE acknowledged_at IS NULL;')).recordset[0].n;
 await heldReader.reviewHeldCount(await summary(),'a','t');
 assert.deepEqual(await stock(),beforeHeldStock);assert.equal((await pool.request().query('SELECT COUNT(*) n FROM dbo.sync_change_journal WHERE acknowledged_at IS NULL;')).recordset[0].n,beforeHeldCount);
 pass('stale queue summaries fail closed and review classification changes no data or acknowledgements');
 await pool.request().batch('CREATE TABLE dbo.stock_adjustments(id uniqueidentifier PRIMARY KEY,product_id uniqueidentifier,store_id nvarchar(128),delta int);');
 const freshInfo=keys.prepare(binding);keys.markEnrolled(binding,{keyId:freshInfo.keyId,publicKey:freshInfo.publicKey});
 context.author={action:'ADJUST',signMovement:(row,sourceManifestJson)=>keys.signStockEvent(binding,{expectedKeyId:freshInfo.keyId,subject:'cashier-a',branchId:row.store_id,operationId:row.operation_id,movementId:row.id,action:'ADJUST',payloadHash:row.payload_hash,...(sourceManifestJson?{sourceManifestJson}:{})}),
  signSourceCohort:input=>keys.signStockSourceCohort(binding,{...input,expectedKeyId:freshInfo.keyId,subject:'cashier-a',branchId:'a',action:'ADJUST'})};
 const adjustId=randomUUID(),adjustOperation=randomUUID(),adjustBefore=(await stock()).a;
 await inTx(async tx=>{
  const adjustments=[{kind:'update',table:'products',match:{id:pid},values:{stock_by_store:{a:adjustBefore-1,b:1}}},{kind:'insert',table:'stock_adjustments',rows:[{id:adjustId,product_id:pid,store_id:'a',delta:-1}]}];
  const token=await store.begin(tx,adjustments,{operationId:adjustOperation,branchId:'a',terminalId:'t',kind:'stock'});
  await new sql.Request(tx).input('id',adjustId).input('stock',JSON.stringify({a:adjustBefore-1,b:1})).batch(`INSERT dbo.stock_adjustments VALUES(@id,'${pid}',N'a',-1);UPDATE dbo.products SET stock_by_store=@stock WHERE id='${pid}';`);
  assert.equal((await store.finish(tx,token)).captured,1);
 });
 const adjustmentRow=(await pool.request().input('operation',adjustOperation).query('SELECT author_proof_json,payload_hash FROM dbo.stock_history_movements WHERE operation_id=@operation;')).recordset[0];
 const adjustmentProof=JSON.parse(adjustmentRow.author_proof_json),sourceManifest=JSON.parse(adjustmentProof.sourceManifestJson);
 assert.equal(adjustmentProof.payloadHash,adjustmentRow.payload_hash);assert.deepEqual(sourceManifest.document,{type:'stock_adjustments',id:adjustId});
 assert.deepEqual(sourceManifest.sourceRefs,[['stock_adjustments',adjustId,'-1']]);assert.equal(sourceManifest.authorId,authorId);
 pass('original actual adjustment source manifest and enrolled author signature commit with the stock delta, without later reconstruction');
 const savedCohort=(await pool.request().input('operation',adjustOperation).query(`SELECT *,CONVERT(nvarchar(30),source_sequence) sequence_text
  FROM dbo.stock_history_source_cohorts WHERE operation_id=@operation;`)).recordset;
 assert.equal(savedCohort.length,1);assert.equal(savedCohort[0].sequence_text,'1');assert.equal(savedCohort[0].predecessor_root,null);
 const cohortProof=JSON.parse(savedCohort[0].proof_json),cohortMembers=JSON.parse(savedCohort[0].members_json);
 assert.equal(cohortProof.authorId,authorId);assert.equal(cohortProof.sourceDatabaseId.toLowerCase(),String(savedCohort[0].database_guid).toLowerCase());
 assert.equal(cohortProof.sourceRoot,savedCohort[0].source_root);assert.equal(cohortProof.sourceSequence,'1');
 assert.equal(cohortMembers.length,1);assert.equal(cohortMembers[0].manifestJson,adjustmentProof.sourceManifestJson);
 const {verifyStockSourceMembership}=require('../electron/shared/stock-source-cohort.mjs');
 assert.deepEqual(await verifyStockSourceMembership(cohortMembers[0],{root:cohortProof.sourceRoot,count:cohortProof.sourceCount}),sourceManifest);
 pass('original same-transaction source cohort freezes full membership, database generation and original enrolled author before any upload');
 const rolledSource=randomUUID(),rolledOperation=randomUUID(),beforeRollbackStock=await stock();
 await assert.rejects(inTx(async tx=>{
  const token=await store.begin(tx,[{kind:'update',table:'products',match:{id:pid},values:{stock_by_store:{a:adjustBefore-2,b:1}}},
   {kind:'insert',table:'stock_adjustments',rows:[{id:rolledSource,product_id:pid,store_id:'a',delta:-1}]}],{operationId:rolledOperation,branchId:'a',terminalId:'t',kind:'stock'});
  await new sql.Request(tx).input('id',rolledSource).input('stock',JSON.stringify({a:adjustBefore-2,b:1})).batch(`INSERT dbo.stock_adjustments VALUES(@id,'${pid}',N'a',-1);UPDATE dbo.products SET stock_by_store=@stock WHERE id='${pid}';`);
  await store.finish(tx,token);throw Object.assign(new Error('Synthetic post-cohort failure'),{code:'FIXTURE'});
 }),{code:'FIXTURE'});
 assert.deepEqual(await stock(),beforeRollbackStock);
 const rolledCounts=(await pool.request().input('operation',rolledOperation).query(`SELECT
  (SELECT COUNT(*) FROM dbo.stock_history_source_cohorts WHERE operation_id=@operation) cohorts,
  (SELECT COUNT(*) FROM dbo.stock_history_movements WHERE operation_id=@operation) movements,
  (SELECT COUNT(*) FROM dbo.stock_adjustments WHERE id='${rolledSource}') sources;`)).recordset[0];
 assert.deepEqual(rolledCounts,{cohorts:0,movements:0,sources:0});
 pass('failure after original source signing rolls back stock, source, complete cohort and pending movement together without a sequence hole');
 const bulkOperation=randomUUID(),bulk=Array.from({length:10},()=>({id:randomUUID(),source:randomUUID()}));
 for(const product of bulk)await pool.request().input('id',product.id).query("INSERT dbo.products(id,name,stock_by_store) VALUES(@id,N'Bulk source fixture',N'{\"a\":2}');");
 const bulkOperations=[...bulk.map(product=>({kind:'update',table:'products',match:{id:product.id},values:{stock_by_store:{a:1}}})),
  {kind:'insert',table:'stock_adjustments',rows:bulk.map(product=>({id:product.source,product_id:product.id,store_id:'a',delta:-1}))}];
 await inTx(async tx=>{
  const token=await store.begin(tx,bulkOperations,{operationId:bulkOperation,branchId:'a',terminalId:'t',kind:'stock'});
  for(const product of bulk)await new sql.Request(tx).input('id',product.id).input('source',product.source).batch("UPDATE dbo.products SET stock_by_store=N'{\"a\":1}' WHERE id=@id;INSERT dbo.stock_adjustments VALUES(@source,@id,N'a',-1);");
  assert.equal((await store.finish(tx,token)).captured,10);
 });
 const bulkCohort=(await pool.request().input('operation',bulkOperation).query('SELECT *,CONVERT(nvarchar(30),source_sequence) sequence_text FROM dbo.stock_history_source_cohorts WHERE operation_id=@operation;')).recordset[0];
 assert.equal(bulkCohort.source_count,10);assert.equal(bulkCohort.sequence_text,'2');assert.equal(bulkCohort.predecessor_root,savedCohort[0].source_root);
 const bulkProof=JSON.parse(bulkCohort.proof_json),bulkMembers=JSON.parse(bulkCohort.members_json);
 assert.equal(bulkMembers.length,10);assert.equal(new Set(bulkMembers.map(member=>JSON.parse(member.manifestJson).productId)).size,10);
 for(const member of bulkMembers)assert.equal((await verifyStockSourceMembership(member,{root:bulkProof.sourceRoot,count:10})).operationId,bulkOperation);
 const bulkOutbox=new StockHistoryOutbox(manager),bulkPending=await bulkOutbox.pending(c.uploadAggregateId(bulkOperation,'a'),'a','t');
 assert.equal(bulkPending.rows.length,8);assert.equal(bulkMembers.length,10);
 assert.equal((await pool.request().input('operation',bulkOperation).query('SELECT COUNT(*) n FROM dbo.stock_history_movements WHERE operation_id=@operation;')).recordset[0].n,10);
 pass('a ten-product original operation commits one full signed cohort and a gap-free predecessor while bounded eight-row uploads retain all ten source members');
 const sourceBusinessBatch=randomUUID(),sourceBatch=await bulkOutbox.sourceForBusiness(bulkOperation,'a','t',sourceBusinessBatch);
 assert.equal(sourceBatch.cohorts[0].proofJson,bulkCohort.proof_json);
 assert.equal(await bulkOutbox.sourceForBusiness(bulkOperation,'A','t',sourceBusinessBatch),null);
 assert.equal(await bulkOutbox.sourceForBusiness(bulkOperation,'a','T',sourceBusinessBatch),null);
 const sourceAck={ok:true,stockSourceStatus:'captured_unverified',stockSourceReceipts:[{
  proofHash:require('node:crypto').createHash('sha256').update(bulkCohort.proof_json,'utf8').digest('hex'),state:'unverified',
  batchId:sourceBusinessBatch,transactionId:'9007199254740993',acceptedAt:'2026-11-06T02:00:00.1234567Z'}]};
 const unacceptedMovements=(await pool.request().input('operation',bulkOperation).query('SELECT COUNT(*) n FROM dbo.stock_history_movements WHERE operation_id=@operation AND ingested_cursor IS NULL;')).recordset[0].n;
 assert.deepEqual(await bulkOutbox.acknowledgeSource(sourceBatch,{ok:true,stockSourceStatus:'held',stockSourceReceipts:[]}),{acknowledged:0});
 await assert.rejects(bulkOutbox.acknowledgeSource({...sourceBatch},sourceAck),{code:'ESTOCK_HISTORY_ACK_UNCONFIRMED'});
 await assert.rejects(bulkOutbox.acknowledgeSource(sourceBatch,{...sourceAck,stockSourceReceipts:[{...sourceAck.stockSourceReceipts[0],proofHash:'c'.repeat(64)}]}),{code:'ESTOCK_HISTORY_ACK_UNCONFIRMED'});
 await assert.rejects(bulkOutbox.acknowledgeSource(sourceBatch,{...sourceAck,stockSourceReceipts:[{...sourceAck.stockSourceReceipts[0],batchId:randomUUID()}]}),{code:'ESTOCK_HISTORY_ACK_UNCONFIRMED'});
 assert.deepEqual(await bulkOutbox.acknowledgeSource(sourceBatch,sourceAck),{acknowledged:1});
 const originalMembershipPage=await bulkOutbox.pending(c.uploadAggregateId(bulkOperation,'a'),'a','t');
 assert.equal(originalMembershipPage.rows.length,8);
 for(const memberRow of originalMembershipPage.rows){
  const envelope=JSON.parse(memberRow.sourceCohortJson);
  assert.equal(envelope.proofJson,bulkCohort.proof_json);assert.equal(envelope.sourceBatchId,sourceBusinessBatch);
  assert.equal(JSON.parse(envelope.member.manifestJson).productId,JSON.parse(memberRow.payloadJson)[3]);
  assert.equal(envelope.member.count,10);
 }
 const sourceReceipt=(await pool.request().input('operation',bulkOperation).query('SELECT CONVERT(nvarchar(30),accepted_transaction_id) exact_transaction FROM dbo.stock_history_source_cohorts WHERE operation_id=@operation;')).recordset[0];
 assert.equal(sourceReceipt.exact_transaction,'9007199254740993');
 assert.equal((await pool.request().input('operation',bulkOperation).query('SELECT COUNT(*) n FROM dbo.stock_history_movements WHERE operation_id=@operation AND ingested_cursor IS NULL;')).recordset[0].n,unacceptedMovements);
 pass('exact private source-retention ACK binds original proof and preserves all ten pending movement claims; raw witness establishes no report or financial acceptance');
 const restartedSources=new StockHistoryOutbox(manager),repeatSource=await restartedSources.sourceForBusiness(bulkOperation,'a','t',sourceBusinessBatch);
 assert.deepEqual(await restartedSources.acknowledgeSource(repeatSource,sourceAck),{acknowledged:1});
 const changedSource=await restartedSources.sourceForBusiness(bulkOperation,'a','t',sourceBusinessBatch);
 await assert.rejects(restartedSources.acknowledgeSource(changedSource,{...sourceAck,stockSourceReceipts:[{...sourceAck.stockSourceReceipts[0],transactionId:'42'}]}));
 pass('source-retention restart/exact replay keeps one receipt; different transaction or scope cannot replace it or clear business work');
 context.author=null;
 const cohortProduct=randomUUID(),cohortOperation=randomUUID();
 await pool.request().query("UPDATE dbo.stock_history_heads SET coverage_state=N'complete' WHERE store_id=N'a';");
 await inTx(async tx=>{
  const token=await store.begin(tx,[{kind:'insert',table:'products',rows:[{id:cohortProduct}]}],{operationId:cohortOperation,branchId:'a',terminalId:'t',kind:'product'});
  await new sql.Request(tx).input('id',cohortProduct).query("INSERT dbo.products(id,name,stock_by_store) VALUES(@id,N'New zero product',N'{\"a\":0}');");
  assert.deepEqual(await store.finish(tx,token),{captured:0,available:true,incomplete:true});
 });
 assert.equal((await pool.request().query("SELECT coverage_state FROM dbo.stock_history_heads WHERE store_id=N'a';")).recordset[0].coverage_state,'incomplete');
 pass('a newly created zero-stock product invalidates old cohort coverage instead of disappearing from a complete report');
 const openingRows=(await pool.request().input('id',zero).query('SELECT COUNT(*) n FROM dbo.stock_history_openings WHERE product_id=@id;')).recordset[0].n;
 await inTx(async tx=>{
  const token=await store.begin(tx,[{kind:'delete',table:'products',match:{id:zero}}],{operationId:randomUUID(),branchId:'a',terminalId:'t',kind:'product'});
  await new sql.Request(tx).input('id',zero).query('DELETE dbo.products WHERE id=@id;');assert.equal((await store.finish(tx,token)).incomplete,true);
 });
 assert.equal((await pool.request().input('id',zero).query('SELECT COUNT(*) n FROM dbo.stock_history_openings WHERE product_id=@id;')).recordset[0].n,openingRows);
 pass('catalogue deletion retains historical opening identity and invalidates membership coverage without a blocking history FK');
 await pool.request().query("UPDATE dbo.stock_history_heads SET coverage_state=N'complete' WHERE store_id=N'a';");
 await inTx(async tx=>{
  const token=await store.begin(tx,[{kind:'update',table:'products',match:{id:pid},values:{owner_store_id:'b'}}],{operationId:randomUUID(),branchId:'a',terminalId:'t',kind:'product'});
  await new sql.Request(tx).input('id',pid).query("UPDATE dbo.products SET owner_store_id=N'b' WHERE id=@id;");
  assert.equal((await store.finish(tx,token)).incomplete,true);
 });
 assert.equal((await pool.request().query("SELECT coverage_state FROM dbo.stock_history_heads WHERE store_id=N'a';")).recordset[0].coverage_state,'incomplete');
 assert.equal((await pool.request().input('id',pid).query('SELECT COUNT(*) n FROM dbo.stock_history_openings WHERE product_id=@id;')).recordset[0].n>0,true);
 pass('an owner-only catalogue change is captured for cohort invalidation while original historical identity remains');
 console.log('PASS '+groups+' actual disposable stock-history SQL groups');
}finally{
 await pool?.close().catch(()=>{});if(created)await master.request().batch('ALTER DATABASE ['+database+'] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE ['+database+'];');await master?.close().catch(()=>{});
 if(owned){control('stop',instance,'-k');control('delete',instance);}console.log('Cleaned uniquely owned stock-history LocalDB fixture');
 if(proofDirectory){const resolved=path.resolve(proofDirectory),root=path.resolve(require('node:os').tmpdir());assert(resolved.startsWith(root+path.sep)&&path.basename(resolved).startsWith('stock-history-author-fixture-'));fs.rmSync(resolved,{recursive:true,force:true});}
}})().catch(error=>{console.error(error);process.exitCode=1;});
