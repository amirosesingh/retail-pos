#!/usr/bin/env node
// Real native SQL apply/CT/pending/cursor path, with an owned disposable LocalDB
// and a synthetic HTTPS transport. No POS_Local, saved profile or network call.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process');
const sql=require('mssql/msnodesqlv8');
const {CloudClient}=require('../electron/sync/cloud-client.cjs');
const {PullWorker}=require('../electron/sync/pull-worker.cjs');
const {PushWorker}=require('../electron/sync/push-worker.cjs');
const {ChangeReader}=require('../electron/sync/change-reader.cjs');
const {CheckpointRepository}=require('../electron/sync/checkpoints.cjs');
// Exercise the actual branch Archive selector without writing a generated file.
const inventoryModule=new(require('node:module').Module)(__filename,module);
inventoryModule._compile(require('esbuild').buildSync({entryPoints:[require('node:path').join(__dirname,'../src/lib/inventory-branch-view.ts')],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'}).outputFiles[0].text,__filename);
const {branchInventoryArchived,branchInventoryCounts}=inventoryModule.exports;
assert.deepEqual(process.argv.slice(2),['--run']);
const suffix=randomUUID().replaceAll('-',''),instance='CodexThreeProducts_'+suffix,database='ThreeProductFixture_'+suffix;
const branch='11111111-1111-4111-8111-111111111111',foreign='22222222-2222-4222-8222-222222222222',terminal='33333333-3333-4333-8333-333333333333';
const ids=[1,2,3].map(n=>'44444444-4444-4444-8444-'+String(n).padStart(12,'0')),versions=[7,10,9];
const control=(...args)=>{const output=execFileSync('C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe',args,{windowsHide:true,timeout:30000});return output.toString(output.includes(0)?'utf16le':'utf8').replace(/^\uFEFF/,'');};
let owned=false,created=false,master,pool,server,passed=0;
const originalFetch=globalThis.fetch;
const connect=name=>{assert(name==='master'||name===database);assert(server&&owned);return new sql.ConnectionPool({connectionString:`Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`,pool:{min:0,max:3},requestTimeout:10000}).connect();};
const pass=name=>{passed++;console.log('PASS '+name);};
const types={id:['uniqueidentifier','uuid'],name:['nvarchar(128)','text'],sku:['nvarchar(128)','text'],barcode:['nvarchar(128)','text'],owner_store_id:['nvarchar(128)','text'],
 stock_quantity:['int','integer'],stock_by_store:['nvarchar(max)','jsonb'],cost_price:['decimal(18,4)','numeric'],selling_price:['decimal(18,4)','numeric'],
 is_archived:['bit','boolean'],archived_at:['datetimeoffset(7)','timestamptz'],row_version:['int','integer'],updated_at:['datetimeoffset(7)','timestamptz']};
const table={cloudTable:'products',sqlServerTable:'products',scope:'branch',direction:'both',dependencyOrder:1,conflictRule:'highest_version',columns:Object.entries(types).map(([name,[sqlServerType,cloudType]])=>({cloudColumn:name,sqlServerColumn:name,sqlServerType,cloudType,primaryKey:name==='id'}))};
const registry={tables:[table]};
const sourceRows=ids.map((id,index)=>({id,name:'Synthetic product '+(index+1),sku:'SYNTHETIC-'+index,barcode:'000000'+index,owner_store_id:null,stock_quantity:1,stock_by_store:{[branch]:1},
 cost_price:String(10.25+index),selling_price:String(20.75+index),is_archived:false,archived_at:null,row_version:versions[index],updated_at:'2026-10-12T02:09:45.1234567Z'}));
// The authoritative cloud rows are already archived. The ownership repair
// itself preserves these values; ordinary download must adopt their exact time.
const fixedRows=sourceRows.map((row,index)=>({...row,owner_store_id:branch,stock_quantity:0,stock_by_store:{[branch]:0},is_archived:true,
 archived_at:`2026-11-05T01:02:03.123456${7+index}Z`,row_version:row.row_version+1,updated_at:'2026-11-06T00:00:00.1234567Z'}));
const change=(row,cursor)=>({cursor,organization_id:'default',branch_id:'global',table_name:'products',entity_id:JSON.stringify({id:row.id}),row_data:row,tombstone:false});
async function main(){try{
 control('create',instance,'-s');owned=true;server=control('info',instance).match(/np:\\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query/)?.[0];assert(server);
 master=await connect('master');await master.request().batch(`CREATE DATABASE [${database}];ALTER DATABASE [${database}] SET CHANGE_TRACKING=ON(CHANGE_RETENTION=2 DAYS,AUTO_CLEANUP=ON);`);created=true;pool=await connect(database);
 const identity=(await pool.request().query('SELECT DB_NAME() database_name,CONVERT(nvarchar(36),database_guid) database_guid FROM sys.database_recovery_status WHERE database_id=DB_ID();')).recordset[0];
 assert.equal(identity.database_name,database);assert.match(identity.database_guid,/^[a-f0-9-]{36}$/i);
 await pool.request().batch(`CREATE TABLE dbo.products(${Object.entries(types).map(([name,[type]])=>'['+name+'] '+type+(name==='id'?' NOT NULL PRIMARY KEY':' NULL')).join(',')});ALTER TABLE dbo.products ENABLE CHANGE_TRACKING;
 CREATE TABLE dbo.sync_change_journal(change_id bigint IDENTITY PRIMARY KEY,entity_type nvarchar(128) NOT NULL,entity_id nvarchar(128) NOT NULL,operation nvarchar(10) NOT NULL,branch_id nvarchar(128) NOT NULL,entity_version bigint NOT NULL,aggregate_id uniqueidentifier NULL,acknowledged_at datetimeoffset(7) NULL,retry_count int NOT NULL DEFAULT(0),last_error nvarchar(1000) NULL,created_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET());
 CREATE TABLE dbo.sync_checkpoints(organization_id nvarchar(128) NOT NULL,branch_id nvarchar(128) NOT NULL,entity_type nvarchar(128) NOT NULL,direction nvarchar(8) NOT NULL,committed_cursor nvarchar(512) NULL,change_tracking_version bigint NULL,acknowledged_at datetimeoffset(7) NULL,updated_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),PRIMARY KEY(organization_id,branch_id,entity_type,direction));
 CREATE TABLE dbo.sales(id uniqueidentifier PRIMARY KEY,bill_number nvarchar(128),store_id nvarchar(128),total_amount decimal(18,4));
 CREATE TABLE dbo.stock_delta_applied(movement_id uniqueidentifier PRIMARY KEY,product_id uniqueidentifier,store_id nvarchar(128),delta int,applied_at datetimeoffset(7));
 CREATE TABLE dbo.fixture_product_writes(statement_count int NOT NULL,changed_rows int NOT NULL);INSERT dbo.fixture_product_writes VALUES(0,0);
 INSERT dbo.sales VALUES(NEWID(),N'SYNTHETIC-UNCHANGED',N'${branch}',62.2500);`);
 for(const row of sourceRows){const request=pool.request();Object.entries(row).forEach(([key,value])=>request.input(key,key==='stock_by_store'?JSON.stringify(value):value));await request.query(`WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) INSERT dbo.products(${Object.keys(row).map(name=>'['+name+']').join(',')}) VALUES(${Object.keys(row).map(name=>'@'+name).join(',')});`);
  await pool.request().input('product',row.id).input('branch',branch).query('INSERT dbo.stock_delta_applied VALUES(NEWID(),@product,@branch,1,SYSDATETIMEOFFSET()),(NEWID(),@product,@branch,-1,SYSDATETIMEOFFSET());');}
 await pool.request().batch('CREATE TRIGGER dbo.fixture_product_update ON dbo.products AFTER UPDATE AS BEGIN SET NOCOUNT ON;UPDATE dbo.fixture_product_writes SET statement_count=statement_count+1,changed_rows=changed_rows+(SELECT COUNT(*) FROM inserted);END;');
 const manager={pool,sql:()=>sql,profile:{id:'owned-three-product-fixture',host:'owned-localdb',database,authMode:'integrated'}};
 const reader=new ChangeReader(manager,registry),checkpoints=new CheckpointRepository(manager),published=[],requests=[];
 const savedTerminal={tokenId:terminal,branchId:branch,deviceUse:'operations',deviceType:'pc',deviceBindingProof:'SYNTHETIC-SEALED-PROOF'};
 const client=new CloudClient({connectionManager:manager,configStore:{get:key=>key==='backendUrl'?'https://three-product-sync.fixture.invalid':null},terminalStore:{read:()=>({...savedTerminal})}});
 let entries=[],mutateAfterFetch=null;
 globalThis.fetch=async(url,options)=>{
  assert.equal(String(url),'https://three-product-sync.fixture.invalid/api/v1/pos/sync');assert.equal(options.method,'POST');
  const body=JSON.parse(options.body);requests.push(body);assert.equal(body.terminalToken,terminal);assert.equal(body.deviceBindingProof,'SYNTHETIC-SEALED-PROOF');
  assert(body.sqlServerPull&&!body.sqlServerBatch&&!body.sqlServerAggregate,'No synthetic upload is expected or accepted.');
  assert.equal(body.sqlServerPull.organizationId,'default');assert(body.sqlServerPull.limit<=100);
  // This synthetic relay enforces the existing paired-branch contract; native
  // SQL tests below prove refusal propagation, not independent hosted RLS.
  if(body.sqlServerPull.branchId!==branch)return Response.json({ok:false,code:'SYNC_BRANCH_FORBIDDEN',error:'Synthetic terminal branch denied'},{status:403});
  const page=entries.filter(row=>row.cursor>body.sqlServerPull.cursor).slice(0,body.sqlServerPull.limit);
  if(mutateAfterFetch){const mutate=mutateAfterFetch;mutateAfterFetch=null;mutate();}
  return Response.json(page,{headers:{'X-POS-Feed-Projection':'1','X-POS-Feed-Continue':'0'}});
 };
 const pull=new PullWorker({connectionManager:manager,cloud:client,checkpoints,registry,reader,publish:event=>published.push(event)});
 const push=new PushWorker({reader,cloud:client,checkpoints,registry});
 const run=()=>pull.run({branchId:branch,skipMembership:true});
 const snapshot=async()=>{
  const row=(await pool.request().query('SELECT (SELECT * FROM dbo.products ORDER BY id FOR JSON PATH,INCLUDE_NULL_VALUES) products,(SELECT * FROM dbo.sales ORDER BY id FOR JSON PATH,INCLUDE_NULL_VALUES) sales,(SELECT * FROM dbo.stock_delta_applied ORDER BY movement_id FOR JSON PATH,INCLUDE_NULL_VALUES) deltas,(SELECT * FROM dbo.sync_change_journal ORDER BY change_id FOR JSON PATH,INCLUDE_NULL_VALUES) journal,(SELECT changed_rows FROM dbo.fixture_product_writes) changed_rows;')).recordset[0];
  return{...row,products:JSON.parse(row.products),journal:JSON.parse(row.journal??'[]')};
 };
 const cursor=async()=>Number((await checkpoints.get(branch,'__feed__','pull'))?.committed_cursor??0);
 const baseline=await reader.currentVersion();await checkpoints.save(branch,'products','push',{change_tracking_version:baseline});
 const original=await snapshot();assert.equal(original.products.length,3);assert.equal(JSON.parse(original.deltas).length,6);
 assert(original.products.every(row=>row.is_archived===false&&row.archived_at===null&&!branchInventoryArchived({stockByStore:JSON.parse(row.stock_by_store)},branch)));
 entries=sourceRows.map((row,index)=>({...change(row,index+1),row_data:null}));
 await run();let current=await snapshot();assert.deepEqual(current.products,original.products);assert.equal(current.changed_rows,0);assert.equal(await cursor(),3);
 assert.deepEqual(await reader.changedIds(table,baseline),[]);
 pass('three ID-only/null invalidations advance the normal cursor without deleting, clearing or rewriting stale product facts');
 entries=fixedRows.map((row,index)=>change(row,index+4));
 await run();current=await snapshot();assert.equal(await cursor(),6);assert.equal(current.changed_rows,3);
 for(let index=0;index<3;index++){const row=current.products.find(item=>item.id.toLowerCase()===ids[index]);assert.equal(row.owner_store_id,branch);assert.equal(row.stock_quantity,0);assert.deepEqual(JSON.parse(row.stock_by_store),{[branch]:0});assert.equal(row.row_version,versions[index]+1);
  for(const field of['sku','barcode','cost_price','selling_price'])assert.deepEqual(row[field],original.products[index][field]);
  assert.equal(row.is_archived,true);assert.equal(row.archived_at,fixedRows[index].archived_at);
  assert.equal(branchInventoryArchived({stockByStore:JSON.parse(row.stock_by_store)},branch),true);}
 assert.deepEqual(branchInventoryCounts(current.products.map(row=>({stockByStore:JSON.parse(row.stock_by_store)})),branch),{active:0,archived:3,negative:0});
 assert.equal(current.sales,original.sales);assert.equal(current.deltas,original.deltas);assert.deepEqual(current.journal,[]);
 const adopted=await reader.changedIds(table,baseline);assert.equal(adopted.length,3);for(const event of adopted){assert.equal(event.remote,true);assert.equal(event.change_context.toString('utf8'),'CLOUD');}
 pass('real native download adopts cloud owner/zero/global archive flag and exact saved100ns archive time, including three branch Archive rows');
 entries=fixedRows.map((row,index)=>change(row,index+7));
 await run();const replayed=await snapshot();assert.deepEqual(replayed,current);assert.equal(await cursor(),9);
 const noUploadBefore=requests.length;const pushResult=await push.run({branchId:branch,batchSize:100});assert.equal(pushResult.pushed,0);assert.equal(requests.length,noUploadBefore);assert.deepEqual((await snapshot()).journal,[]);
 assert.equal((await reader.pendingSummary(branch)).pending,0);assert.equal((await reader.pendingSummary(branch)).failed,0);
 pass('same-value feed replay makes no extra product changes, sales, deductions, journal entries or actual upload requests');
 const beforeDenied=await snapshot();await assert.rejects(pull.run({branchId:foreign,skipMembership:true}),error=>error.code==='SYNC_BRANCH_FORBIDDEN'&&error.status===403);
 assert.deepEqual(await snapshot(),beforeDenied);assert.equal(await cursor(),9);
 await client.request({sqlServerPull:{organizationId:'default',branchId:branch,cursor:9,limit:100},terminalToken:foreign,deviceBindingProof:'UNTRUSTED-OVERRIDE'});
 assert.equal(requests.at(-1).terminalToken,terminal);assert.equal(requests.at(-1).deviceBindingProof,'SYNTHETIC-SEALED-PROOF');
 pass('paired foreign-branch refusal reaches the real client without SQL changes and caller fields cannot replace native terminal/proof');
 entries=fixedRows.map((row,index)=>change({...row,row_version:row.row_version+1},index+10));
 mutateAfterFetch=()=>{savedTerminal.branchId=foreign;};
 await assert.rejects(run(),{code:'ESYNC_REQUEST_CONTEXT_CHANGED'});savedTerminal.branchId=branch;
 assert.deepEqual(await snapshot(),beforeDenied);assert.equal(await cursor(),9);
 pass('a device-binding context change after the HTTP await cannot apply an old response or advance the page');
 const pendingAggregate=randomUUID(),pendingId=ids[2];
 await pool.request().input('id',pendingId).input('aggregate',pendingAggregate).input('entity',JSON.stringify({id:pendingId})).input('branch',branch).input('stock',JSON.stringify({[branch]:2})).batch("UPDATE dbo.products SET stock_quantity=2,stock_by_store=@stock,row_version=99 WHERE id=@id;INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id) VALUES(N'products',@entity,N'update',@branch,99,@aggregate);");
 const pending=await snapshot();entries=fixedRows.map((row,index)=>change({...row,row_version:100},index+10));
 const deferred=await run();assert.equal(deferred.deferredLocalChanges,true);assert.equal(await cursor(),9);assert.deepEqual(await snapshot(),pending);assert.equal(pending.journal.length,1);assert.equal(pending.journal[0].acknowledged_at,null);
 assert.equal(pending.products.find(row=>row.id.toLowerCase()===pendingId).stock_quantity,2);
 assert.equal((await reader.pendingSummary(branch)).pending,1);assert.equal((await reader.pendingSummary(branch)).failed,0);
 pass('a newer cloud page containing an unacknowledged local edit is deferred atomically with its saved quantity, queue and prior cursor retained');
 assert.equal((await snapshot()).sales,original.sales);assert.equal((await snapshot()).deltas,original.deltas);assert(published.length>=3);
 console.log(`PASS ${passed} actual native SQL adoption groups; hosted authorization and real business repair are separate checks.`);
}finally{
 globalThis.fetch=originalFetch;await pool?.close().catch(()=>{});
 if(created){assert(owned&&/^ThreeProductFixture_[a-f0-9]{32}$/.test(database)&&server?.includes('LOCALDB#'));await master.request().batch(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE [${database}];`);}
 await master?.close().catch(()=>{});if(owned){control('stop',instance,'-k');control('delete',instance);}
 console.log('Cleaned uniquely owned three-product LocalDB fixture');
}}
main().catch(error=>{console.error(error.message);for(const prior of error.precedingErrors??[])console.error(prior.message);process.exitCode=1;});
