'use strict';
// Opt-in disposable LocalDB only: no POS profile, real key, cloud or POS_Local.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const sql=require('mssql/msnodesqlv8');
const {readStockHistoryFrontierSnapshot:read}=require('../electron/db/stock-history-frontier-snapshot.cjs');
const {StockHistoryStore}=require('../electron/db/stock-history.cjs'),contract=require('../electron/db/stock-history-contract.cjs');
assert.deepEqual(process.argv.slice(2),['--run']);
const suffix=randomUUID().replaceAll('-',''),instance='CodexStockFrontier_'+suffix,database='StockFrontierFixture_'+suffix;
const control=(...args)=>{const bytes=execFileSync('C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe',args,{windowsHide:true,timeout:30000});return bytes.toString(bytes.includes(0)?'utf16le':'utf8').replace(/^\uFEFF/,'');};
let master,pool,writerPool,server,owned=false,created=false,groups=0;
const pass=name=>{groups++;console.log('PASS '+name);};
const connect=name=>{assert(name==='master'||name===database);return new sql.ConnectionPool({connectionString:`Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`,pool:{min:0,max:1},requestTimeout:15000}).connect();};
const scope={current:true,lease:true};
const manager={get pool(){return pool;},sql:()=>sql};
const options=()=>({manager,branchId:'a',terminalId:'t',assertCurrent:()=>{if(!scope.current)throw Object.assign(new Error('Synthetic scope changed'),{code:'FIXTURE_CONTEXT'});},assertLease:()=>{if(!scope.lease)throw Object.assign(new Error('Synthetic lease changed'),{code:'FIXTURE_LEASE'});}});
const session=async()=>{
 const basic=(await pool.request().query('SELECT @@SPID spid,@@TRANCOUNT transaction_count,@@OPTIONS session_options,@@LOCK_TIMEOUT lock_timeout;')).recordset[0];
 const isolation=(await pool.request().query('SELECT transaction_isolation_level,deadlock_priority FROM sys.dm_exec_sessions WHERE session_id=@@SPID;')).recordset[0];
 return{...basic,...isolation};
};
const saved=async()=>{
 const tables=['products','sync_change_journal','sync_checkpoints','local_operation_receipts',...contract.TABLES],parts=[];
 for(const table of tables){assert(/^[a-z_]+$/.test(table));
  parts.push((await pool.request().query(`SELECT (SELECT * FROM dbo.[${table}] ORDER BY 1 FOR JSON PATH,INCLUDE_NULL_VALUES) body;`)).recordset[0].body);
 }
 parts.push(String((await pool.request().query('SELECT CHANGE_TRACKING_CURRENT_VERSION() version;')).recordset[0].version));
 return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
};
const id=()=>randomUUID(),root='a'.repeat(64),proof='{"fixture":"店📦","amount":"9007199254740993"}';
let databaseId,operation,product,movementId,movementHash;
async function source({sourceId=id(),operationId=operation,guid=databaseId,store='a',till='t',sequence='1',previous=null,sourceRoot=root,unsigned=false}={}){
 await pool.request().input('id',sourceId).input('operation',operationId).input('database',guid).input('terminal',till).input('sequence',sequence)
  .input('store',store).input('previous',previous).input('root',sourceRoot).input('proof',sql.NVarChar(sql.MAX),unsigned?null:proof).input('aggregate',contract.uploadAggregateId(operationId,store))
  .query(`INSERT dbo.stock_history_source_cohorts(id,operation_id,store_id,terminal_id,actor_id,action,source_root,source_count,database_guid,source_sequence,
   predecessor_root,proof_json,members_json,payload_hash,upload_aggregate_id,recorded_at_raw)
   VALUES(@id,@operation,@store,@terminal,N'fixture-author',N'ADJUST',@root,1,@database,CONVERT(bigint,@sequence),@previous,@proof,N'[]',REPLICATE('b',64),@aggregate,N'2026-11-06T00:00:00.1234567Z');`);
 return sourceId;
}
(async()=>{try{
 control('create',instance,'-s');owned=true;server=control('info',instance).match(/np:\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query/)?.[0];assert(server);
 master=await connect('master');await master.request().batch(`CREATE DATABASE [${database}];`);created=true;
 await master.request().batch(`ALTER DATABASE [${database}] SET ALLOW_SNAPSHOT_ISOLATION ON; ALTER DATABASE [${database}] SET CHANGE_TRACKING=ON(CHANGE_RETENTION=2 DAYS,AUTO_CLEANUP=ON);`);
 pool=await connect(database);
 await pool.request().batch(`CREATE TABLE dbo.products(id uniqueidentifier NOT NULL PRIMARY KEY,name nvarchar(128),sku nvarchar(128),barcode nvarchar(128),owner_store_id nvarchar(128),stock_by_store nvarchar(max));
  ALTER TABLE dbo.products ENABLE CHANGE_TRACKING WITH(TRACK_COLUMNS_UPDATED=ON);
  CREATE TABLE dbo.pos_schema_migrations(version int NOT NULL PRIMARY KEY,name nvarchar(128));
  CREATE TABLE dbo.sync_change_journal(change_id bigint IDENTITY NOT NULL PRIMARY KEY,entity_type nvarchar(128) NOT NULL,entity_id nvarchar(128) NOT NULL,
   operation nvarchar(10) NOT NULL,branch_id nvarchar(128) NOT NULL,entity_version bigint NOT NULL,aggregate_id uniqueidentifier NULL,acknowledged_at datetimeoffset(7) NULL,last_error nvarchar(1000) NULL);
  CREATE INDEX IX_sync_change_journal_pending ON dbo.sync_change_journal(branch_id,acknowledged_at,aggregate_id,change_id);
  CREATE TABLE dbo.sync_checkpoints(entity_type nvarchar(128) NOT NULL PRIMARY KEY,last_version bigint NOT NULL);
  CREATE TABLE dbo.local_operation_receipts(operation_id uniqueidentifier NOT NULL PRIMARY KEY,operation_type nvarchar(32),entity_id nvarchar(128),note nvarchar(max));
  INSERT dbo.sync_checkpoints VALUES(N'products',9007199254740993);`);
 const beforeAbsent=await session();assert.deepEqual(await read(options()),{available:false,reason:'SCHEMA_NOT_INSTALLED'});assert.deepEqual(await session(),beforeAbsent);
 pass('all-absent031 yields unavailable with unchanged connection state');
 await pool.request().batch(fs.readFileSync(path.join(__dirname,'../database/sqlserver/prepared/031_stock_history_effective_ledger.sql'),'utf8'));
 databaseId=String((await pool.request().query('SELECT database_guid FROM sys.database_recovery_status WHERE database_id=DB_ID();')).recordset[0].database_guid).toLowerCase();
 operation=id();product=id();
 await pool.request().input('id',product).query("INSERT dbo.products(id,name,sku,stock_by_store) VALUES(@id,N'Fixture',N'00001',N'{\"a\":3,\"A\":99}');");
 const store=new StockHistoryStore(manager),tx=new sql.Transaction(pool);await tx.begin();
 try{
  await store.ensureHead(tx,'a');
  const context=contract.normalizeContext({operationId:operation,branchId:'a',terminalId:'t',actorId:'fixture-author',kind:'stock'},'2026-11-06T00:00:00.1234567Z');
  const rows=contract.changes(context,[{id:product,name:'Fixture',stock_by_store:{a:3}}],[{id:product,name:'Fixture',stock_by_store:{a:2}}],[]);
  assert.equal(rows.length,1);movementId=rows[0].id;movementHash=rows[0].payload_hash;
  await store.insertMovements(tx,'a',[{...rows[0],author_proof_json:proof}]);await tx.commit();
 }catch(error){await tx.rollback();throw error;}
 const originalSourceId=await source();
 const baseline=id(),ticks=String(contract.instant('2026-11-05T00:00:00.0000000Z'));
 await pool.request().input('baseline',baseline).input('ticks',ticks).query(`INSERT dbo.stock_history_baselines(id,store_id,cutoff_at_raw,cutoff_ticks,captured_at_raw,captured_ticks,
  source_cursor,opening_kind,verification_state,expected_pairs,terminal_watermarks,verified_by,evidence_hash)
  VALUES(@baseline,N'a',N'2026-11-05T00:00:00.0000000Z',CONVERT(decimal(20,0),@ticks),N'2026-11-05T00:00:00.0000000Z',CONVERT(decimal(20,0),@ticks),0,N'physical_count',N'verified',0,N'{}',N'fixture',REPLICATE('d',64));
  UPDATE dbo.stock_history_heads SET coverage_state=N'complete',baseline_id=@baseline,coverage_from_ticks=CONVERT(decimal(20,0),@ticks),coverage_through_ticks=CONVERT(decimal(20,0),@ticks) WHERE store_id=N'a';`);
 await pool.request().query(`SET IDENTITY_INSERT dbo.sync_change_journal ON;INSERT dbo.sync_change_journal(change_id,entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)
  VALUES(9007199254740993,N'sales',N'{"id":"${id()}"}',N'insert',N'a',9007199254740994,'${id()}');SET IDENTITY_INSERT dbo.sync_change_journal OFF;`);
 const capturedRows={};let fixtureQueryError;class CaptureRequest extends sql.Request{async query(text){try{const result=await super.query(text);const tag=/stock-frontier:([a-z-]+)/.exec(text)?.[1];if(tag)capturedRows[tag]=result.recordset;return result;}catch(error){fixtureQueryError=error.message;throw error;}}}
 const before=await saved(),initial=await read({...options(),manager:{pool,sql:()=>({...sql,Request:CaptureRequest})}});assert.equal(initial.available,true,JSON.stringify({initial,fixtureQueryError}));assert.equal(initial.databaseId,databaseId);assert.equal(initial.sourceSequence,'1');assert.equal(initial.sourceRoot,root);
 assert.deepEqual(initial.pending,{business:'1',metadata:'2',unsigned:'0',unknown:'0'});assert.equal(initial.coverageProven,false);assert.equal(await saved(),before);
 const proofDigest=createHash('sha256').update(proof,'utf8').digest('hex');
 assert.equal(capturedRows['source-hashes'][0].proof_hash,proofDigest);assert.equal(capturedRows['movement-hashes'][0].proof_hash,proofDigest);
 const journalEvidence=capturedRows.journal.map(row=>{
  const fingerprint=[row.change_id,row.entity_type,row.entity_id,row.operation,row.branch_id,row.entity_version,row.aggregate_id,row.failed===1];
  if(['stock_history_movements','stock_history_source_cohorts'].includes(row.entity_type))fingerprint.push([row.reference_table,row.reference_id,row.reference_operation_id,row.reference_store_id,row.reference_terminal_id,row.reference_upload_aggregate_id,row.reference_pending]);
  return fingerprint;
 }).sort((left,right)=>JSON.stringify(left)<JSON.stringify(right)?-1:JSON.stringify(left)>JSON.stringify(right)?1:0);
 const expectedGeneration=createHash('sha256').update(JSON.stringify(['stock-history.frontier-state.v1',initial.databaseKey,'a','t',
  capturedRows['source-summary'].map(row=>[row.database_id,row.terminal_id,row.row_count,row.unique_count,row.min_sequence,row.max_sequence,row.last_root,row.accepted_count,row.unsigned_count,row.broken_count,row.evidence_hash]),
  capturedRows['movement-summary'].map(row=>[row.terminal_id,row.row_count,row.accepted_count,row.unsigned_count,row.missing_source_count,row.unknown_kind_count,row.evidence_hash]),
  [[originalSourceId,operation,databaseId,'t','1',root,null,'b'.repeat(64),proofDigest,null,null,null]],
  [[movementId,operation,product,'t',movementHash,proofDigest,null]],journalEvidence]),'utf8').digest('hex');
 assert.equal(initial.sourceGeneration,expectedGeneration);
 assert(!JSON.stringify(initial).includes(proof));assert.match(initial.observedAt,/\.\d{7}Z$/);assert.equal(Object.isFrozen(initial.pending),true);
 pass('actual exact031 snapshot is immutable/private and changes no business,metadata,journal,checkpoint,receipt or CT state');
 for(const [name,value]of [['READ UNCOMMITTED',1],['READ COMMITTED',2],['REPEATABLE READ',3],['SERIALIZABLE',4],['SNAPSHOT',5]]){
  await pool.request().query(`SET TRANSACTION ISOLATION LEVEL ${name};`);const connectionBefore=await session();assert.equal(connectionBefore.transaction_isolation_level,value);
  const result=await read(options());assert.equal(result.available,true,JSON.stringify(result));assert.deepEqual(await session(),connectionBefore);assert.equal(await saved(),before);
  pass(`same-connection ${name} preserved after read-only snapshot`);
 }
 await pool.request().query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED;BEGIN TRANSACTION;');
 const inherited=await session();assert.equal(inherited.transaction_count,1);assert.deepEqual(await read(options()),{available:false,reason:'FRONTIER_CALLER_TRANSACTION'});assert.deepEqual(await session(),inherited);
 await pool.request().query('ROLLBACK TRANSACTION;');pass('preexisting caller transaction is neither read nor committed/rolled back');
 await pool.request().query('SET IMPLICIT_TRANSACTIONS ON;');
 const implicitBefore=(await pool.request().query('SELECT @@SPID spid,@@TRANCOUNT transaction_count,@@OPTIONS session_options;')).recordset[0];assert.equal(implicitBefore.transaction_count,0);
 assert.deepEqual(await read(options()),{available:false,reason:'FRONTIER_CALLER_TRANSACTION'});
 assert.deepEqual((await pool.request().query('SELECT @@SPID spid,@@TRANCOUNT transaction_count,@@OPTIONS session_options;')).recordset[0],implicitBefore);
 await pool.request().query('SET IMPLICIT_TRANSACTIONS OFF;');pass('implicit-transactions ON refused without opening an outer transaction or changing options');
 const restarted=await read(options());assert.deepEqual(restarted,{...initial,observedAt:restarted.observedAt});
 pass('restart/fresh helper reads preserve stable exact evidence digests');
 const wrongCase=await read({...options(),branchId:'A'});assert.equal(wrongCase.available,true);assert.equal(wrongCase.sourceSequence,'0');assert.equal(wrongCase.pending.metadata,'0');assert.equal(wrongCase.pending.business,'0');assert(wrongCase.blockers.includes('LOCAL_COVERAGE_UNPROVEN'));
 const foreign=await read({...options(),terminalId:'T'});assert.equal(foreign.sourceSequence,'0');assert(foreign.blockers.includes('OTHER_TERMINAL_PENDING_SOURCE'));assert(foreign.blockers.includes('OTHER_TERMINAL_PENDING_MOVEMENT'));
 pass('actual binary branch/till code scope never relabels another writer');
 const uuidBranch='ABCDEF00-0000-4000-8000-000000000009';await source({store:uuidBranch,operationId:id()});
 const uuidRead=await read({...options(),branchId:uuidBranch.toLowerCase()});assert.equal(uuidRead.available,true);assert.equal(uuidRead.sourceSequence,'1');assert.equal(uuidRead.pending.metadata,'1');
 const uuidUpper=await read({...options(),branchId:uuidBranch});assert.deepEqual(uuidUpper,{...uuidRead,observedAt:uuidUpper.observedAt});
 pass('UUID spelling is canonical without lowercasing or widening non-UUID branch codes');
 const uuidTill='ABCDEF00-0000-4000-8000-000000000019',uuidOperation=id();
 await source({store:'uuid-till-scope',till:uuidTill,operationId:uuidOperation});
 await pool.request().input('operation',uuidOperation).input('terminal',uuidTill.toLowerCase()).query(`
  INSERT dbo.stock_history_movements(id,operation_id,product_id,store_id,terminal_id,actor_id,source_kind,quantity_delta,effective_at_raw,effective_ticks,
   recorded_at_raw,recorded_ticks,product_name,clock_state,payload_hash,payload_json,author_proof_json,ingested_cursor,ingested_at,local_cursor)
  SELECT TOP(1) NEWID(),@operation,NEWID(),N'uuid-till-scope',@terminal,actor_id,source_kind,quantity_delta,effective_at_raw,effective_ticks,recorded_at_raw,recorded_ticks,product_name,clock_state,payload_hash,payload_json,N'{}',1,SYSDATETIMEOFFSET(),1
  FROM dbo.stock_history_movements WHERE store_id=N'a';`);
 const uuidTerminalRead=await read({...options(),branchId:'uuid-till-scope',terminalId:uuidTill.toLowerCase()});
 assert.equal(uuidTerminalRead.sourceSequence,'1');assert(!uuidTerminalRead.blockers.includes('UNPROVEN_ORIGINAL_SOURCE'));assert(!uuidTerminalRead.blockers.includes('OTHER_TERMINAL_PENDING_SOURCE'));
 pass('UUID-only till normalization matches original source evidence without treating case-sensitive codes as equal');
 await source({guid:id(),operationId:id(),sourceRoot:'e'.repeat(64)});
 const retained=await read(options());assert.equal(retained.sourceSequence,'1');assert(retained.blockers.includes('RETAINED_DATABASE_GENERATION'));
 await source({sequence:'3',previous:root,sourceRoot:'f'.repeat(64),operationId:id(),unsigned:true});
 const broken=await read(options());assert.equal(broken.sourceSequence,'3');assert.equal(broken.pending.unsigned,'1');assert(broken.blockers.includes('BROKEN_SOURCE_PREFIX'));assert(broken.blockers.includes('UNSIGNED_SOURCE'));
 pass('retained original generations and broken/unsigned prefixes remain explicit private blockers');
 await source({sequence:'9007199254740993',previous:'f'.repeat(64),sourceRoot:'e'.repeat(64),operationId:id()});
 const exact=await read(options());assert.equal(exact.sourceSequence,'9007199254740993');assert(exact.blockers.includes('BROKEN_SOURCE_PREFIX'));assert.notEqual(exact.sourceGeneration,broken.sourceGeneration);
 pass('source sequence and journal evidence above2^53 remain exact decimal strings');
 const sessionBefore=await session();scope.current=false;await assert.rejects(read(options()),{code:'FIXTURE_CONTEXT'});scope.current=true;scope.lease=false;await assert.rejects(read(options()),{code:'FIXTURE_LEASE'});scope.lease=true;
 assert.deepEqual(await session(),sessionBefore);pass('current Main/lease denial does not acquire a data transaction or mutate settings');
 for(const kind of ['current','lease']){
  let changed=false;class ChangedRequest extends sql.Request{async query(text){const result=await super.query(text);if(!changed&&text.includes('stock-frontier:head')){changed=true;scope[kind]=false;}return result;}}
  await assert.rejects(read({...options(),manager:{pool,sql:()=>({...sql,Request:ChangedRequest})}}),{code:kind==='current'?'FIXTURE_CONTEXT':'FIXTURE_LEASE'});scope[kind]=true;
  assert.deepEqual(await session(),sessionBefore);pass(`actual ${kind} loss after an awaited data read rolls back only the owned transaction`);
 }
 writerPool=await connect(database);const writerManager={pool:writerPool,sql:()=>sql},writerStore=new StockHistoryStore(writerManager);
 const writeTx=new sql.Transaction(writerPool);await writeTx.begin();
 try{
  const operations=[{kind:'update',table:'products',match:{id:product},values:{stock_by_store:{a:2,A:99}}}];
  const token=await writerStore.begin(writeTx,operations,{operationId:id(),branchId:'a',terminalId:'t',kind:'stock'});
  await new sql.Request(writeTx).input('id',product).query("UPDATE dbo.products SET stock_by_store=N'{\"a\":2,\"A\":99}' WHERE id=@id;");
  await writerStore.finish(writeTx,token);
  await pool.request().query('SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;');const contestedSession=await session();
  const started=Date.now(),busy=await read(options());assert.deepEqual(busy,{available:false,reason:'FRONTIER_BUSY'});assert(Date.now()-started<2500);
  assert.deepEqual(await session(),contestedSession);await pool.request().query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED;');
  await writeTx.commit();
 }catch(error){await writeTx.rollback().catch(()=>{});throw error;}
 assert.equal((await pool.request().input('id',product).query('SELECT stock_by_store FROM dbo.products WHERE id=@id;')).recordset[0].stock_by_store,'{"a":2,"A":99}');
 assert.equal((await read(options())).available,true);assert.deepEqual(await session(),sessionBefore);
 pass('observer NOWAIT yields immediately to a real atomic stock save; business save wins and later snapshot retries');
 class SlowRequest extends sql.Request{query(text){return super.query(text.includes('stock-frontier:sources')?"WAITFOR DELAY '00:00:02';"+text:text);}}
 const savedBeforeTimeout=await saved();assert.deepEqual(await read({...options(),manager:{pool,sql:()=>({...sql,Request:SlowRequest})}}),{available:false,reason:'FRONTIER_READ_UNAVAILABLE'});
 assert.equal(await saved(),savedBeforeTimeout);assert.deepEqual(await session(),sessionBefore);pass('actual native request timeout cleans its read transaction and pooled session without data loss');
 await pool.request().query("EXEC sys.sp_rename N'dbo.stock_history_source_cohorts',N'stock_history_source_cohorts_fixture_hidden';");
 store.invalidateCapability();assert.deepEqual(await read(options()),{available:false,reason:'PARTIAL_SCHEMA'});
 await pool.request().query("EXEC sys.sp_rename N'dbo.stock_history_source_cohorts_fixture_hidden',N'stock_history_source_cohorts';");
 await pool.request().query('ALTER TABLE dbo.stock_history_source_cohorts ADD fixture_unknown int NULL;');store.invalidateCapability();assert.deepEqual(await read(options()),{available:false,reason:'UNKNOWN_SCHEMA'});
 await pool.request().query('ALTER TABLE dbo.stock_history_source_cohorts DROP COLUMN fixture_unknown;');store.invalidateCapability();assert.equal((await read(options())).available,true);
 pass('partial/unknown031 rejected and exact restored shape revalidated without auto-upgrade');
 await require('./stock-frontier-runtime-sqlserver-cases.cjs')({pool,sql,saved,session,pass});
 // Synthetic accepted metadata in this disposable database only. Thousands of
 // finished rows (with large historical proof bodies) must not consume the
 // bounded pending detail/hash budget or be exported as raw proof data.
 const bulkBranch='bulk-scope',bulkTill='bulk',bulkBaseline=id();
 const bulkData=Array.from({length:2001},(_,index)=>{const operation_id=id();return{n:index+1,id:id(),operation_id,movement_id:id(),aggregate_id:contract.uploadAggregateId(operation_id,bulkBranch)};});
 await pool.request().input('database',databaseId).input('baseline',bulkBaseline).input('product',product).input('bulk_json',sql.NVarChar(sql.MAX),JSON.stringify(bulkData)).query(`
  DECLARE @bulk table(n int NOT NULL PRIMARY KEY,id uniqueidentifier NOT NULL,operation_id uniqueidentifier NOT NULL,movement_id uniqueidentifier NOT NULL,aggregate_id uniqueidentifier NOT NULL);
  INSERT @bulk SELECT n,id,operation_id,movement_id,aggregate_id FROM OPENJSON(@bulk_json) WITH(n int,id uniqueidentifier,operation_id uniqueidentifier,movement_id uniqueidentifier,aggregate_id uniqueidentifier);
  INSERT dbo.stock_history_source_cohorts(id,operation_id,store_id,terminal_id,actor_id,action,source_root,source_count,database_guid,source_sequence,
   predecessor_root,proof_json,members_json,payload_hash,upload_aggregate_id,accepted_batch_id,accepted_transaction_id,accepted_at,recorded_at_raw)
  SELECT id,operation_id,N'bulk-scope',N'bulk',N'fixture',N'ADJUST',REPLICATE('a',64),1,@database,n,
   CASE WHEN n=1 THEN NULL ELSE REPLICATE('a',64) END,CONVERT(nvarchar(max),N'{"fixture":"')+REPLICATE(CONVERT(nvarchar(max),N'x'),4096)+N'"}',N'[]',REPLICATE('b',64),aggregate_id,NEWID(),
   CONVERT(bigint,9007199254740993)+n,CONVERT(datetimeoffset(7),N'2026-11-06T00:00:00.1234567Z',127),N'2026-11-06T00:00:00.1234567Z' FROM @bulk;
  INSERT dbo.stock_history_movements(id,operation_id,product_id,store_id,terminal_id,actor_id,source_kind,quantity_delta,effective_at_raw,effective_ticks,
   recorded_at_raw,recorded_ticks,product_name,clock_state,payload_hash,payload_json,author_proof_json,upload_aggregate_id,ingested_cursor,ingested_at,local_cursor)
  SELECT movement_id,operation_id,@product,N'bulk-scope',N'bulk',N'fixture',N'stock',-1,N'2026-11-06T00:00:00.1234567Z',CONVERT(decimal(20,0),17939232001234567),
   N'2026-11-06T00:00:00.1234567Z',CONVERT(decimal(20,0),17939232001234567),N'Fixture',N'unverified',REPLICATE('c',64),N'[]',
   CONVERT(nvarchar(max),N'{"fixture":"')+REPLICATE(CONVERT(nvarchar(max),N'x'),4096)+N'"}',aggregate_id,CONVERT(bigint,9007199254740993)+n,CONVERT(datetimeoffset(7),N'2026-11-06T00:00:00.1234567Z',127),n FROM @bulk;
  INSERT dbo.stock_history_baselines(id,store_id,cutoff_at_raw,cutoff_ticks,captured_at_raw,captured_ticks,source_cursor,opening_kind,verification_state,expected_pairs,terminal_watermarks,verified_by,evidence_hash)
  SELECT @baseline,N'bulk-scope',cutoff_at_raw,cutoff_ticks,captured_at_raw,captured_ticks,source_cursor,opening_kind,verification_state,expected_pairs,terminal_watermarks,verified_by,evidence_hash
  FROM dbo.stock_history_baselines WHERE id='${baseline}';
  INSERT dbo.stock_history_heads(store_id,coverage_state,baseline_id,coverage_from_ticks,coverage_through_ticks) SELECT N'bulk-scope',N'complete',@baseline,coverage_from_ticks,coverage_through_ticks
  FROM dbo.stock_history_heads WHERE store_id=N'a';`);
 const bulkOptions=()=>({...options(),branchId:bulkBranch,terminalId:bulkTill}),bulkBefore=await saved(),summaryRows={};
 class BulkRequest extends sql.Request{async query(text){const result=await super.query(text);const tag=/stock-frontier:([a-z-]+)/.exec(text)?.[1];if(tag)summaryRows[tag]=result.recordset;return result;}}
 const bulkStart=Date.now(),large=await read({...bulkOptions(),manager:{pool,sql:()=>({...sql,Request:BulkRequest})}}),bulkMilliseconds=Date.now()-bulkStart;
 assert.equal(large.available,true,JSON.stringify(large));assert.equal(large.sourceSequence,'2001');assert.deepEqual(large.pending,{business:'0',metadata:'0',unsigned:'0',unknown:'0'});
 assert.equal(summaryRows.sources.length,0);assert.equal(summaryRows.movements.length,0);assert.equal(summaryRows['source-hashes'].length,0);assert.equal(summaryRows['movement-hashes'].length,0);
 assert.equal(summaryRows['source-summary'].length,1);assert.equal(summaryRows['movement-summary'].length,1);assert.equal(large.coverageProven,false);assert.equal(await saved(),bulkBefore);
 pass(`2001 accepted sources and2001 ingested movements with>16MiB proof bodies need no historical proof reads (${bulkMilliseconds}ms) and preserve all data/CT`);
 for(const mode of ['accepted-movement','accepted-source','wrong-aggregate','global','extra-key','wrong-namespace']){
  const entity=mode==='accepted-source'?'stock_history_source_cohorts':'stock_history_movements';
  const actual=bulkData[0],reference=entity==='stock_history_source_cohorts'?actual.id:actual.movement_id;
  const entityName=mode==='wrong-namespace'?'stock_history_source_cohorts':entity;
  const entityKey=JSON.stringify({id:reference,...(mode==='extra-key'?{other:'untrusted'}:{})});
  const row=(await pool.request().input('entity',entityName).input('key',entityKey).input('branch',mode==='global'?'global':bulkBranch).input('aggregate',mode==='wrong-aggregate'?id():actual.aggregate_id)
   .query(`INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)
    OUTPUT CONVERT(nvarchar(30),inserted.change_id) change_id VALUES(@entity,@key,N'insert',@branch,1,@aggregate);`)).recordset[0];
  const journalBefore=await saved(),held=await read(bulkOptions());assert.equal(held.available,true);assert.equal(held.pending.business,'1');assert.equal(held.pending.metadata,'0');assert.equal(held.pending.unknown,'1');assert.equal(await saved(),journalBefore);
  assert(held.blockers.includes(mode.startsWith('accepted-')?'ACKED_HISTORY_WITH_PENDING_JOURNAL':mode==='wrong-namespace'?'ORPHAN_HISTORY_JOURNAL':'HISTORY_JOURNAL_BINDING_UNVERIFIED'));
  await pool.request().input('id',row.change_id).query('DELETE dbo.sync_change_journal WHERE change_id=CONVERT(bigint,@id);');
  assert.deepEqual((await read(bulkOptions())).pending,large.pending);
 }
 pass('healthy accepted prefix plus unACKed accepted-row/wrong namespace/aggregate/global/extra-key journal is critical pending/unknown, never silently allzero');
 const bulkSource=(await pool.request().query("SELECT TOP(1) operation_id FROM dbo.stock_history_source_cohorts WHERE store_id=N'bulk-scope' ORDER BY source_sequence;")).recordset[0].operation_id;
 const pendingMovement=id();
 await pool.request().input('id',pendingMovement).input('operation',bulkSource).input('product',product).input('aggregate',contract.uploadAggregateId(String(bulkSource).toLowerCase(),bulkBranch)).query(`
  INSERT dbo.stock_history_movements(id,operation_id,product_id,store_id,terminal_id,actor_id,source_kind,quantity_delta,effective_at_raw,effective_ticks,
   recorded_at_raw,recorded_ticks,product_name,clock_state,payload_hash,payload_json,author_proof_json,upload_aggregate_id,local_cursor)
  SELECT @id,@operation,NEWID(),store_id,terminal_id,actor_id,source_kind,quantity_delta,effective_at_raw,effective_ticks,recorded_at_raw,recorded_ticks,product_name,clock_state,payload_hash,payload_json,N'{}',@aggregate,2002
  FROM dbo.stock_history_movements WHERE operation_id=@operation AND store_id=N'bulk-scope';
  INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)
  SELECT N'stock_history_movements',N'{"id":"'+CONVERT(nvarchar(36),id)+N'"}',N'insert',N'bulk-scope',1,@aggregate
  FROM dbo.stock_history_movements WHERE id=@id;`);
 const tinyBefore=await saved(),tiny=await read(bulkOptions());assert.equal(tiny.available,true);assert.deepEqual(tiny.pending,{business:'0',metadata:'1',unsigned:'0',unknown:'0'});
 assert.notEqual(tiny.sourceGeneration,large.sourceGeneration);assert.equal(await saved(),tinyBefore);
 pass('tiny pending movement recognizes its accepted source and valid own unACKed metadata journal is not counted twice');
 await source({store:bulkBranch,till:bulkTill,operationId:id(),sequence:'2002',previous:root,sourceRoot:'e'.repeat(64)});
 const advanced=await read(bulkOptions());assert.equal(advanced.sourceSequence,'2002');assert.equal(advanced.sourceRoot,'e'.repeat(64));assert.notEqual(advanced.sourceGeneration,tiny.sourceGeneration);
 await source({store:bulkBranch,till:bulkTill,operationId:id(),sequence:'2003',previous:root,sourceRoot:'f'.repeat(64)});
 const mislinked=await read(bulkOptions());assert(mislinked.blockers.includes('BROKEN_SOURCE_PREFIX'));assert.equal(mislinked.pending.unknown,'1');
 pass('aggregate digest and exact linked head advance, while a malformed predecessor remains unconfirmed after finished history grows');
 const orphanOperation=id(),orphanMovement=id();
 await pool.request().input('id',orphanMovement).input('operation',orphanOperation).query(`INSERT dbo.stock_history_movements(id,operation_id,product_id,store_id,terminal_id,actor_id,source_kind,quantity_delta,effective_at_raw,effective_ticks,
  recorded_at_raw,recorded_ticks,product_name,clock_state,payload_hash,payload_json,author_proof_json,ingested_cursor,ingested_at,local_cursor)
  SELECT TOP(1) @id,@operation,NEWID(),store_id,terminal_id,actor_id,N'sale',quantity_delta,effective_at_raw,effective_ticks,recorded_at_raw,recorded_ticks,product_name,clock_state,payload_hash,payload_json,N'{}',9007199254740993,ingested_at,2003
  FROM dbo.stock_history_movements WHERE store_id=N'bulk-scope' AND ingested_at IS NOT NULL;`);
 const orphan=await read(bulkOptions());assert(orphan.blockers.includes('UNPROVEN_ORIGINAL_SOURCE'));assert.equal(orphan.pending.unknown,'2');
 const otherTill=await read({...bulkOptions(),terminalId:'Bulk'});assert.equal(otherTill.sourceSequence,'0');assert(otherTill.blockers.includes('OTHER_TERMINAL_PENDING_SOURCE'));
 const otherBranch=await read({...bulkOptions(),branchId:'Bulk-scope'});assert.equal(otherBranch.sourceSequence,'0');assert.equal(otherBranch.pending.metadata,'0');
 pass('accepted SALE without an original source stays unknown; large-history code casing never widens the original scope');
 await pool.request().input('database',databaseId).query(`INSERT dbo.stock_history_source_cohorts(id,operation_id,store_id,terminal_id,actor_id,action,source_root,source_count,database_guid,source_sequence,
  predecessor_root,proof_json,members_json,payload_hash,upload_aggregate_id,recorded_at_raw)
  SELECT TOP(2001) NEWID(),NEWID(),N'a',N'bulk',N'fixture',N'ADJUST',REPLICATE('a',64),1,@database,ROW_NUMBER()OVER(ORDER BY a.object_id,b.object_id),
  CASE WHEN ROW_NUMBER()OVER(ORDER BY a.object_id,b.object_id)=1 THEN NULL ELSE REPLICATE('a',64) END,N'{}',N'[]',REPLICATE('b',64),NEWID(),N'2026-11-06T00:00:00.1234567Z'
  FROM sys.all_objects a CROSS JOIN sys.all_objects b;`);
 assert.deepEqual(await read(options()),{available:false,reason:'FRONTIER_EVIDENCE_OVERSIZED'});assert.deepEqual(await session(),sessionBefore);
 pass('actual row bound refuses a truncated frontier instead of signing a partial prefix');
 console.log(`PASS ${groups} actual disposable stock frontier SQL groups`);
}finally{
 await writerPool?.close().catch(()=>{});await pool?.close().catch(()=>{});
 if(created){assert(database.startsWith('StockFrontierFixture_')&&database.endsWith(suffix));await master.request().batch(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE [${database}];`);}
 await master?.close().catch(()=>{});if(owned){assert(instance.startsWith('CodexStockFrontier_')&&instance.endsWith(suffix));control('stop',instance,'-k');control('delete',instance);}
 console.log('Cleaned uniquely owned stock-frontier LocalDB fixture');
}})().catch(error=>{console.error(error);process.exitCode=1;});
