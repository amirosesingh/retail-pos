// Opt-in, owned disposable LocalDB + exact protected HTTP envelopes only.
// No operator profile/backend, business transaction or real enrollment is used.
const assert=require('node:assert/strict');
const {createLocal}=require('./lib/shift-protocol-integration-fixture.cjs');
const {CloudClient}=require('../electron/sync/cloud-client.cjs');
const {PullWorker}=require('../electron/sync/pull-worker.cjs');
const {CheckpointRepository}=require('../electron/sync/checkpoints.cjs');
const {HistoryIndexStore}=require('../electron/sync/history-index-recovery.cjs');
const {prepareHistoryFeed}=require('../electron/sync/history-feed.cjs');
const {PROJECTION}=require('../electron/sync/history-index-protocol.cjs');
const id=n=>'aaaaaaaa-aaaa-4aaa-8aaa-'+String(n).padStart(12,'0'),branch=id(9000),terminal=id(9001);
const row=n=>({id:id(n),organization_id:'default',entity_type:'fixture',entity_id:String(n),action:'insert',old_value_json:null,new_value_json:'{"quantity":9007199254740993,"decimal":0.1234567890123456789,"unicode":"✓  "}',revision:'9007199254740993',scope_type:'GLOBAL',scope_id:null,changed_by:null,source_application:'fixture',device_id:null,terminal_id:null,server_timestamp:'2026-11-06T01:02:03.1234567Z'});
const hint=n=>({cursor:n,table_name:'change_history',entity_id:JSON.stringify({id:id(n)}),operation:'insert',row_version:1,tombstone:false,row_data:{id:id(n),revision:9007199254740992,new_value:{quantity:9007199254740992}}});
async function main(){
 assert.deepEqual(process.argv.slice(2),['--run']);let local,passed=0,url='https://owned-history-feed.invalid',afterRows=()=>{},prefix=10;
 const fetchBefore=globalThis.fetch,remote=new Map([1,2].map(n=>[n,row(n)])),calls=[];
 const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
 try{
  local=await createLocal(branch);const cm=local.manager,table=require('../electron/db/schema-registry.cjs').loadRegistry().tables.find(t=>t.cloudTable==='change_history');
  await cm.pool.request().batch(`CREATE TABLE dbo.change_history(${table.columns.map(c=>'['+c.sqlServerColumn+'] '+c.sqlServerType+(c.nullable?' NULL':' NOT NULL')).join(',')},PRIMARY KEY(id));ALTER TABLE dbo.change_history ENABLE CHANGE_TRACKING;`);
  const cloud=new CloudClient({connectionManager:cm,configStore:{get:()=>url},terminalStore:{read:()=>({tokenId:terminal,locationId:branch,deviceUse:'operations',deviceBindingProof:'a'.repeat(64)})}});
  const checkpoints=new CheckpointRepository(cm),store=new HistoryIndexStore(cm);let generic=0;
  cloud.applyLocalBatch=async()=>{generic++;throw Error('Protected history reached generic MERGE');};
  const envelope={projection:PROJECTION,organization_id:'default',branch_id:branch,terminal_id:terminal,keep_commerce:false};
  globalThis.fetch=async(_url,options)=>{
   const body=JSON.parse(options.body),read=body.sqlServerHistoryReconcile;calls.push(structuredClone(body));let value,kind;
   if(body.sqlServerPull){const rows=[...remote.keys()].filter(n=>n>body.sqlServerPull.cursor).map(hint);return new Response(JSON.stringify(rows),{headers:{'content-type':'application/json','X-POS-Feed-Projection':'1','X-POS-Feed-Continue':'0'}});}
   assert(read);if(read.action==='begin'){kind='index';const ids=[...remote.values()].map(r=>r.id).sort();value={...envelope,protocol:'history-index-v1',action:'begin',upper_id:ids.at(-1)??null,after_id:null,ids,next_id:null,complete:true,range_count:null};}
   else{assert.equal(read.action,'rows');kind='rows';const ids=read.ids.slice(0,prefix);value={...envelope,protocol:'history-rows-v1',requested_ids:read.ids,rows:ids.map(key=>[...remote.values()].find(r=>r.id===key)),remaining_ids:read.ids.slice(ids.length)};afterRows();}
   return new Response(JSON.stringify(value),{headers:{'content-type':'application/json','X-POS-History-Reconcile-Version':'1','X-POS-History-Reconcile-Kind':kind}});
  };
  const worker=()=>new PullWorker({connectionManager:cm,cloud,checkpoints,registry:{tables:[table]},reader:{unacknowledged:async()=>[]}});
  const run=()=>worker().run({branchId:branch,skipMembership:true});
  const checkpoint=async()=>String((await checkpoints.get(branch,'__feed__','pull'))?.committed_cursor??0);
  const saved=async n=>(await cm.pool.request().input('id',id(n)).query("SELECT CONVERT(nvarchar(30),revision) revision,new_value,CONVERT(nvarchar(40),SWITCHOFFSET(server_timestamp,'+00:00'),127) instant FROM dbo.change_history WHERE id=@id;")).recordset[0];
  await test('actual CloudClient/PullWorker inserts exact bigint/JSON/100ns rather than rounded ordinary payload',async()=>{prefix=1;await run();assert.equal((await saved(1)).revision,row(1).revision);assert.equal((await saved(1)).new_value,row(1).new_value_json);assert.match((await saved(1)).instant,/\.1234567(?:Z|\+00:00)$/);assert.equal(await checkpoint(),'2');assert.equal(generic,0);});
  await test('same-page checkpoint failure rolls SQL inserts back and retry commits once',async()=>{remote.set(3,row(3));const original=checkpoints.save.bind(checkpoints);checkpoints.save=async(...args)=>{await original(...args);throw Error('fixture checkpoint failure');};await assert.rejects(run(),/fixture checkpoint failure/);assert.equal(await saved(3),undefined);assert.equal(await checkpoint(),'2');checkpoints.save=original;await run();assert.equal(await checkpoint(),'3');});
  await test('pending uppercase history journal stays durable and blocks cursor advancement',async()=>{remote.set(4,row(4));await cm.pool.request().input('key',JSON.stringify({id:id(4).toUpperCase()})).input('branch',branch).query("INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version) VALUES('change_history',@key,'insert',@branch,1);");assert.equal((await run()).deferredLocalChanges,true);assert.equal(await saved(4),undefined);assert.equal(await checkpoint(),'3');assert.equal((await cm.pool.request().query("SELECT count(*) n FROM dbo.sync_change_journal WHERE entity_type='change_history' AND acknowledged_at IS NULL;")).recordset[0].n,1);await cm.pool.request().query("DELETE dbo.sync_change_journal WHERE entity_type='change_history';");await run();assert.equal(await checkpoint(),'4');});
  await test('existing divergent immutable row survives without another payload read',async()=>{remote.set(5,row(5));await store.transaction(tx=>store.insert(tx,{...row(5),new_value_json:'{"originalLocal":true}'}));const before=calls.length;await run();assert.equal((await saved(5)).new_value,'{"originalLocal":true}');assert.equal(calls.slice(before).filter(x=>x.sqlServerHistoryReconcile).length,0);assert.equal(await checkpoint(),'5');});
  await test('profile change during exact response prevents SQL/cursor writes',async()=>{remote.set(6,row(6));afterRows=()=>{url='https://changed-owned-history.invalid';};await assert.rejects(run(),error=>error.code==='ESYNC_REQUEST_CONTEXT_CHANGED');assert.equal(await saved(6),undefined);assert.equal(await checkpoint(),'5');afterRows=()=>{};url='https://owned-history-feed.invalid';await run();assert.equal(await checkpoint(),'6');});
  await test('lost post-commit notification and cold pool retry do not duplicate or redownload accepted history',async()=>{remote.set(7,row(7));const failing=worker();failing.publish=()=>{throw Error('fixture lost postcommit notification');};await assert.rejects(failing.run({branchId:branch,skipMembership:true}),/lost postcommit/);assert.equal(await checkpoint(),'7');assert.equal((await saved(7)).revision,row(7).revision);await local.restart();const before=calls.length;await run();assert.equal(calls.slice(before).filter(x=>x.sqlServerHistoryReconcile).length,0);assert.equal((await cm.pool.request().query('SELECT count(*) n FROM dbo.change_history;')).recordset[0].n,7);});
  await test('actual aggregate business save completes before exact append in a mixed-page lock interleaving',async()=>{
   const sql=cm.sql(),full=require('../electron/db/schema-registry.cjs').loadRegistry(),product=full.tables.find(t=>t.cloudTable==='products'),pid=id(8800);
   await cm.pool.request().batch(`CREATE TABLE dbo.products(${product.columns.map(c=>'['+c.sqlServerColumn+'] '+c.sqlServerType+(c.primaryKey?' NOT NULL':' NULL')).join(',')},PRIMARY KEY(id));`);
   await cm.pool.request().input('id',pid).input('branch',branch).input('stock',JSON.stringify({[branch]:1})).query("INSERT dbo.products(id,name,owner_store_id,stock_by_store,stock_quantity,row_version,is_archived) VALUES(@id,'before',@branch,@stock,1,1,0);");
   const {OperationsRepository}=require('../electron/db/repositories/operations.cjs'),{AggregateRepository}=require('../electron/db/repositories/aggregates.cjs');
   const operations=new OperationsRepository(cm,full),aggregate=new AggregateRepository(cm,operations),original=operations.applyOperation.bind(operations);
   let release,locked;const paused=new Promise(done=>{locked=done;}),continueWriter=new Promise(done=>{release=done;});
   operations.applyOperation=async(...args)=>{const result=await original(...args);locked();await continueWriter;return result;};
   remote.set(8,row(8));const prepared=await prepareHistoryFeed({cloud,connectionManager:cm,branchId:branch,changes:[hint(8)]});
   const business=aggregate.commit('product',{operationId:id(8801),branchId:branch,terminalId:terminal,permissions:{can_edit_product_details:true},operations:[{table:'products',kind:'update',match:{id:pid},values:{name:'business-saved'}}]});
   // The real aggregate writer now owns its business row, before its normal
   // journal/receipt. The download must wait there BEFORE taking history locks.
   await paused;const tx=new sql.Transaction(cm.pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);let finished=false;
   const businessApply=CloudClient.prototype.applyLocalBatch.call(cloud,tx,product,{rows:[{entity_id:JSON.stringify({id:pid}),row_data:{id:pid,name:'business-saved'}}],tombstones:[]}).finally(()=>{finished=true;});
   try{await new Promise(done=>setTimeout(done,50));assert.equal(finished,false);release();const writer=await business;assert.equal(writer.ok,true);await businessApply;assert.equal(await prepared.apply(tx),1);await prepared.assert(tx);await checkpoints.save(branch,'__feed__','pull',{committed_cursor:8},tx);await tx.commit();}
   catch(error){release();await Promise.resolve(business).catch(()=>{});await Promise.resolve(businessApply).catch(()=>{});await tx.rollback().catch(()=>{});throw error;}
   assert.equal(await checkpoint(),'8');assert.equal((await saved(8)).revision,row(8).revision);
   assert.equal((await cm.pool.request().input('id',pid).query('SELECT name FROM dbo.products WHERE id=@id;')).recordset[0].name,'business-saved');
   assert.equal((await cm.pool.request().input('id',id(8801)).query('SELECT count(*) n FROM dbo.local_operation_receipts WHERE operation_id=@id;')).recordset[0].n,1);
   assert.equal((await cm.pool.request().query("SELECT count(*) n FROM dbo.sync_change_journal WHERE entity_type='products' AND acknowledged_at IS NULL;")).recordset[0].n,1);
  });
  await test('exact inserts use CLOUD CT context, generate no history upload evidence, and never use generic history MERGE',async()=>{const rows=(await cm.pool.request().query('SELECT SYS_CHANGE_OPERATION operation,CONVERT(varchar(32),SYS_CHANGE_CONTEXT,2) context FROM CHANGETABLE(CHANGES dbo.change_history,0) ct;')).recordset;assert.equal(rows.length,8);assert(rows.every(r=>r.operation==='I'&&r.context==='434C4F5544'));assert.equal((await cm.pool.request().query("SELECT count(*) n FROM dbo.sync_change_journal WHERE entity_type='change_history'")).recordset[0].n,0);assert.equal(generic,0);});
  console.log('PASS '+passed+' actual LocalDB exact-history feed groups');
 }finally{globalThis.fetch=fetchBefore;await local?.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
