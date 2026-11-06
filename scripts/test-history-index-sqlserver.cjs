// Explicit opt-in, owned disposable LocalDB only; no POS profile/URL is read.
const assert=require('node:assert/strict'),{readFileSync}=require('node:fs');
const {createHash}=require('node:crypto'),{createLocal}=require('./lib/shift-protocol-integration-fixture.cjs');
const {JobRepository}=require('../electron/jobs/repository.cjs'),{JobManager}=require('../electron/jobs/manager.cjs');
const {HistoryIndexRecovery,cursor}=require('../electron/sync/history-index-recovery.cjs');
const {PROJECTION}=require('../electron/sync/history-index-protocol.cjs');
const id=n=>'aaaaaaaa-aaaa-4aaa-8aaa-'+String(n).padStart(12,'0'),branch=id(9000),terminal=id(9001);
const row=n=>({id:id(n),organization_id:'default',entity_type:'fixture',entity_id:String(n),action:'insert',old_value_json:null,new_value_json:'{"exact":9007199254740993.1234567,"text":"unicode ✓  "}',revision:'9007199254740993',scope_type:'GLOBAL',scope_id:null,changed_by:null,source_application:'fixture',device_id:null,terminal_id:null,server_timestamp:'2026-11-06T01:02:03.1234560Z'});
async function main(){
 assert.deepEqual(process.argv.slice(2),['--run']);let local;let passed=0;
 const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
 try{
  local=await createLocal(branch);const cm=local.manager,registry=require('../electron/db/schema-registry.cjs').loadRegistry(),table=registry.tables.find(t=>t.cloudTable==='change_history');assert.equal(table.columns.length,15);
  const historyDdl=`CREATE TABLE dbo.change_history(${table.columns.map(c=>'['+c.sqlServerColumn+'] '+c.sqlServerType+(c.nullable?' NULL':' NOT NULL')).join(',')},PRIMARY KEY(id));ALTER TABLE dbo.change_history ENABLE CHANGE_TRACKING;`;
  await cm.pool.request().batch(historyDdl);
  const full=readFileSync('database/sqlserver/schema.sql','utf8'),start=full.indexOf("IF OBJECT_ID(N'dbo.pos_jobs'"),end=full.indexOf("IF OBJECT_ID(N'dbo.sync_checkpoints'",start);assert(start>=0&&end>start);await cm.pool.request().batch(full.slice(start,end));
  const jobs=new JobRepository(cm);let clock=Date.now(),afterRows=()=>{},failNext=false,maxRows=10;
  const remote=new Map(Array.from({length:27},(_,n)=>[id(n+1),row(n+1)])),calls=[],events=[];
  const base={projection:PROJECTION,organization_id:'default',branch_id:branch,terminal_id:terminal,keep_commerce:false};
  const cloud={backendUrl:()=> 'https://owned-history-fixture.invalid',terminalId:()=>terminal,terminalStore:{read:()=>({tokenId:terminal,locationId:branch,deviceUse:'operations'})},requestContext:()=>({pool:cm.pool,fingerprint:createHash('sha256').update('private-fixture-profile').digest('hex')}),
   historyIndex:async request=>{calls.push({type:'index',...request});const upper=request.action==='begin'?[...remote.keys()].sort().at(-1)??null:request.upperId,all=[...remote.keys()].sort().filter(key=>upper&&key<=upper&&(!request.afterId||key>request.afterId)),ids=request.action==='finish'?[]:all.slice(0,1000);return{...base,protocol:'history-index-v1',action:request.action,upper_id:upper,after_id:request.afterId??null,ids,next_id:all.length>1000&&request.action!=='finish'?ids.at(-1):null,complete:request.action==='finish'||all.length<=1000,range_count:request.action==='finish'?String(all.length):null};},
   historyMissingRows:async request=>{calls.push({type:'rows',...request});if(failNext){failNext=false;throw Object.assign(new Error('fixture network interruption'),{code:'EAI_AGAIN'});}await afterRows();const ids=request.ids.slice(0,maxRows);return{...base,protocol:'history-rows-v1',requested_ids:request.ids,rows:ids.map(key=>remote.get(key)),remaining_ids:request.ids.slice(ids.length)};}};
  let manager=new JobManager(jobs,{publish:event=>events.push({...event})}),recovery=new HistoryIndexRecovery({connectionManager:cm,cloud,jobRepository:jobs,jobManager:manager,now:()=>clock});
  const step=async()=>{const before=calls.length,value=await recovery.step({branchId:branch});assert(calls.slice(before).filter(x=>x.type==='index').length<=1);assert(calls.slice(before).filter(x=>x.type==='rows').length<=1);clock+=600000;return value;};
  const complete=async()=>{for(let n=0;n<100;n++){const value=await step();if(value.completed||value.status==='completed')return value;}throw Error('Owned fixture did not finish');};
  const count=async()=>(await cm.pool.request().query('SELECT count(*) n FROM dbo.change_history')).recordset[0].n;
  await cm.pool.request().input('branch',branch).query("INSERT dbo.sync_checkpoints(branch_id,entity_type,direction,change_tracking_version,committed_cursor) VALUES(@branch,'change_history','push',1,'keep-push'),(@branch,'change_history','pull',NULL,'keep-feed');");
  const checkpoint=async()=>JSON.stringify((await cm.pool.request().query("SELECT * FROM dbo.sync_checkpoints WHERE entity_type='change_history' ORDER BY direction FOR JSON PATH,INCLUDE_NULL_VALUES;")).recordset);
  const originalCheckpoint=await checkpoint();const initialVersion=String((await cm.pool.request().query('SELECT CHANGE_TRACKING_CURRENT_VERSION() v')).recordset[0].v);
  await test('real SQL missing-only inserts preserve exact15 fields and yield after a bounded quantum',async()=>{await step();assert.equal(await count(),10);const j=await jobs.recovery('history_index_recovery_v1',branch,terminal);assert.equal(j.status,'queued');assert.equal(cursor(j.last_committed_cursor).n,'10');assert.equal(manager.running,null);const r=(await cm.pool.request().query("SELECT CONVERT(nvarchar(40),revision) revision,new_value,CONVERT(nvarchar(40),server_timestamp,127) instant FROM dbo.change_history WHERE id='"+id(1)+"'")).recordset[0];assert.equal(r.revision,'9007199254740993');assert.equal(r.new_value,row(1).new_value_json);assert.match(r.instant,/2026-11-06T01:02:03\.1234560(?:Z|\+00:00)$/);});
  await test('real SQL rows and durable cursor roll back together without emitting uncommitted progress',async()=>{const original=jobs.checkpoint.bind(jobs);let once=true;jobs.checkpoint=async(...args)=>{await original(...args);if(args[2]&&args[1].completed_rows>10&&once){once=false;throw Error('fixture saved-page failure');}};await step();assert.equal(await count(),10);const j=await jobs.recovery('history_index_recovery_v1',branch,terminal);assert.equal(cursor(j.last_committed_cursor).n,'10');assert(!events.some(event=>event.completed_rows>10));jobs.checkpoint=original;});
  await test('cold SQL pool restart resumes saved missing members and fetches no committed payload twice',async()=>{await local.restart();manager=new JobManager(jobs);recovery=new HistoryIndexRecovery({connectionManager:cm,cloud,jobRepository:jobs,jobManager:manager,now:()=>clock});const before=calls.length;await complete();assert.equal(await count(),27);assert(calls.slice(before).filter(x=>x.type==='rows').flatMap(x=>x.ids).every(key=>key>id(10)));assert.equal((await jobs.history()).filter(j=>j.job_type==='history_index_recovery_v1').length,1);});
  await test('recovery retains both business checkpoints and creates only CLOUD-context CT inserts, no upload journal',async()=>{assert.equal(await checkpoint(),originalCheckpoint);assert.equal((await cm.pool.request().query("SELECT count(*) n FROM dbo.sync_change_journal WHERE entity_type='change_history'")).recordset[0].n,0);const changes=(await cm.pool.request().input('v',initialVersion).query('SELECT SYS_CHANGE_OPERATION operation,CONVERT(varchar(32),SYS_CHANGE_CONTEXT,2) context FROM CHANGETABLE(CHANGES dbo.change_history,@v) ct;')).recordset;assert.equal(changes.length,27);assert(changes.every(x=>x.operation==='I'&&x.context==='434C4F5544'));});
  await test('existing divergent history is retained and only a newly missing record downloads',async()=>{await cm.pool.request().query("UPDATE dbo.change_history SET new_value=N'{\"local\":true}' WHERE id='"+id(1)+"';");remote.set(id(28),row(28));clock+=13*60*60*1000;const before=calls.length;await complete();assert.equal(await count(),28);assert.deepEqual(calls.slice(before).filter(x=>x.type==='rows').flatMap(x=>x.ids),[id(28)]);assert.equal((await cm.pool.request().query("SELECT new_value FROM dbo.change_history WHERE id='"+id(1)+"'")).recordset[0].new_value,'{"local":true}');});
  await test('unacknowledged canonical/uppercase journal key holds an absent member and remains untouched',async()=>{remote.set(id(29),row(29));clock+=13*60*60*1000;await cm.pool.request().input('key',JSON.stringify({id:id(29).toUpperCase()})).input('branch',branch).query("INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version) VALUES('change_history',@key,'insert',@branch,1);");const value=await step();assert.equal(value.error_code,'ELOCAL_PENDING_UNVERIFIED');assert.equal(await count(),28);assert.equal((await cm.pool.request().query("SELECT count(*) n FROM dbo.sync_change_journal WHERE entity_type='change_history' AND acknowledged_at IS NULL;")).recordset[0].n,1);});
  await test('unknown retained keys fail closed without replacing data or losing the saved page',async()=>{await cm.pool.request().query("UPDATE dbo.sync_change_journal SET entity_id='not-json' WHERE entity_type='change_history';");await step();assert.equal(await count(),28);assert.equal((await jobs.recovery('history_index_recovery_v1',branch,terminal)).error_code,'ELOCAL_PENDING_UNVERIFIED');});
  await test('after fixture-only resolution normal resume completes without resetting cursors',async()=>{await cm.pool.request().query("DELETE dbo.sync_change_journal WHERE entity_type='change_history';");await complete();assert.equal(await count(),29);assert.equal(await checkpoint(),originalCheckpoint);});
  await test('lost network response retains committed local facts and resumes the same metadata scope',async()=>{remote.set(id(30),row(30));clock+=13*60*60*1000;failNext=true;await step();assert.equal(await count(),29);await complete();assert.equal(await count(),30);assert.equal(await checkpoint(),originalCheckpoint);});
  await test('byte-prefix continuation and local arrival during fetch never overwrite or duplicate a fact',async()=>{remote.set(id(31),row(31));remote.set(id(32),row(32));clock+=13*60*60*1000;maxRows=1;afterRows=async()=>{afterRows=()=>{};await cm.pool.request().input('id',id(31)).query("INSERT dbo.change_history(id,organization_id,entity_type,entity_id,action,revision,scope_type,source_application,server_timestamp) VALUES(@id,'default','fixture','31','retained-local',1,'GLOBAL','fixture',SYSDATETIMEOFFSET());");};await complete();assert.equal(await count(),32);assert.equal((await cm.pool.request().query("SELECT action FROM dbo.change_history WHERE id='"+id(31)+"'")).recordset[0].action,'retained-local');});
  const databaseState={enabled:true,configured:true,connected:true,tradingReady:true,profile:{database:'owned-fixture'}};
  const {LocalDataLifecycle}=require('../electron/jobs/lifecycle.cjs'),lifecycle=new LocalDataLifecycle({connectionManager:cm,databaseService:{snapshot:()=>databaseState},jobRepository:jobs,jobManager:manager,registry:local.registry,cloud,syncCoordinator:{withExclusive:fn=>fn()}});
  await test('first-time/incomplete setup cannot use a history-only readiness shortcut',async()=>{assert.equal(await lifecycle.cachedSnapshotReady(branch,90),false);});
  const prior=await jobs.recovery('history_index_recovery_v1',branch,terminal),bootstrap={...prior,job_id:require('node:crypto').randomUUID(),job_type:'bootstrap_90',status:'completed',phase:'complete'};
  await jobs.create(bootstrap);await jobs.checkpoint(bootstrap.job_id,{finished_at:new Date()});remote.set(id(33),row(33));clock+=13*60*60*1000;await step();
  await test('only a validated same-scope completed operational cache opens during its bound history job',async()=>{assert.equal(await lifecycle.cachedSnapshotReady(branch,90),true);assert.equal(lifecycle.preserveCachedReady(),true);databaseState.profile={database:'changed-fixture'};assert.equal(lifecycle.preserveCachedReady(),false);databaseState.profile={database:'owned-fixture'};});
  await test('an unrelated queued restore still gates cache and blocks automatic history work',async()=>{const current=await jobs.recovery('history_index_recovery_v1',branch,terminal),restore={...current,job_id:require('node:crypto').randomUUID(),job_type:'restore',status:'queued'};await jobs.create(restore);assert.equal(await lifecycle.cachedSnapshotReady(branch,90),false);assert.equal((await step()).busy,true);await jobs.checkpoint(restore.job_id,{status:'completed',finished_at:new Date()});});
  await test('forged history progress cannot release startup and existing cursors remain unchanged',async()=>{const current=await jobs.recovery('history_index_recovery_v1',branch,terminal),original=current.last_committed_cursor;await jobs.checkpoint(current.job_id,{last_committed_cursor:'unverified'});await assert.rejects(lifecycle.cachedSnapshotReady(branch,90),{code:'EHISTORY_INDEX_PROGRESS'});await jobs.checkpoint(current.job_id,{last_committed_cursor:original});assert.equal(await checkpoint(),originalCheckpoint);});
  await complete();
  await test('real concurrent pending-journal insertion cannot race the append/progress transaction',async()=>{
   remote.set(id(34),row(34));clock+=13*60*60*1000;const sql=cm.sql(),other=await new sql.ConnectionPool(cm.pool.config).connect(),original=recovery.store.insert.bind(recovery.store);let checked=false;
   recovery.store.insert=async(tx,value)=>{await original(tx,value);if(!checked){checked=true;await assert.rejects(other.request().input('branch',branch).input('key',JSON.stringify({id:id(34)})).query("SET LOCK_TIMEOUT 250;INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version) VALUES('change_history',@key,'insert',@branch,1);"),error=>error.number===1222);}};
   try{await complete();assert(checked);assert.equal(await count(),34);assert.equal((await cm.pool.request().query("SELECT count(*) n FROM dbo.sync_change_journal WHERE entity_type='change_history'")).recordset[0].n,0);}finally{recovery.store.insert=original;await other.close();}
  });
  await test('lost post-commit readback keeps the durable fact and resumes without another payload download',async()=>{
   remote.set(id(35),row(35));clock+=13*60*60*1000;const original=jobs.get.bind(jobs);let once=true;const before=calls.length;
   jobs.get=async(...args)=>{const value=await original(...args);if(!args[1]&&value?.completed_rows===1&&cursor(value.last_committed_cursor).n==='35'&&once){once=false;throw Error('fixture lost committed readback');}return value;};
   await step();assert.equal(await count(),35);jobs.get=original;await local.restart();manager=new JobManager(jobs);recovery=new HistoryIndexRecovery({connectionManager:cm,cloud,jobRepository:jobs,jobManager:manager,now:()=>clock});await complete();
   assert.deepEqual(calls.slice(before).filter(x=>x.type==='rows').flatMap(x=>x.ids),[id(35)]);assert.equal(await checkpoint(),originalCheckpoint);
  });
  await test('another owned PC/database recovers from its own cursor without using this PCs completion',async()=>{
   const second=await createLocal(branch);try{
    await second.manager.pool.request().batch(historyDdl);await second.manager.pool.request().batch(full.slice(start,end));
    const t=id(9003),secondaryJobs=new JobRepository(second.manager),secondaryCloud={...cloud,terminalId:()=>t,terminalStore:{read:()=>({tokenId:t,locationId:branch,deviceUse:'operations'})},requestContext:()=>({pool:second.manager.pool,fingerprint:createHash('sha256').update('second-owned-PC').digest('hex')}),historyIndex:async request=>({...await cloud.historyIndex(request),terminal_id:t}),historyMissingRows:async request=>({...await cloud.historyMissingRows(request),terminal_id:t})};
    const secondary=new HistoryIndexRecovery({connectionManager:second.manager,cloud:secondaryCloud,jobRepository:secondaryJobs,jobManager:new JobManager(secondaryJobs),now:()=>clock});
    await secondary.step({branchId:branch});const own=await secondaryJobs.recovery('history_index_recovery_v1',branch,t),primary=await jobs.recovery('history_index_recovery_v1',branch,terminal);
    assert.notEqual(own.organization_name,primary.organization_name);assert.equal(cursor(own.last_committed_cursor).n,'1');assert.equal(cursor(primary.last_committed_cursor).n,'35');assert.equal((await second.manager.pool.request().query('SELECT count(*) n FROM dbo.change_history')).recordset[0].n,1);assert.equal(await count(),35);
   }finally{await second.close();}
  });
  // Upgrade a real v1 run after its transaction committed an opaque page and
  // before its snapshot/CT proof completed. No production connection is used.
  await jobs.checkpoint(bootstrap.job_id,{status:'completed',finished_at:new Date()});
  const oldHistory=require('../electron/sync/history-recovery.cjs');
  await assert.rejects(oldHistory.recover({cloud,connectionManager:cm,jobRepository:jobs,jobManager:manager,reader:{unacknowledged:async()=>[]}},branch,90,
   async({progress})=>{const sql=cm.sql(),tx=new sql.Transaction(cm.pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);try{await progress.beforeApply(tx);await progress.save(tx,{cursor:'opaque-prior-application-page',completed:10});await tx.commit();}catch(error){await tx.rollback();throw error;}await progress.committed();throw Object.assign(new Error('owned old-app interruption'),{code:'EAI_AGAIN'});}));
  const legacy=await jobs.recovery(oldHistory.TYPE,branch,terminal);await jobs.checkpoint(legacy.job_id,{status:'interrupted'});
  const legacyImage=async()=>{const result=await jobs.legacyHistory(branch,terminal);assert.equal(result.length,1);return result[0].__history_legacy_json;};
  let beforeLegacy=await legacyImage();const legacyCheckpoint=await checkpoint();let owns=true;
  const proof=async()=>owns;
  const upgraded=()=>new HistoryIndexRecovery({connectionManager:cm,cloud,jobRepository:jobs,jobManager:manager,now:()=>clock,executionProof:proof});
  recovery=upgraded();
  const upgradedLifecycle=()=>new LocalDataLifecycle({connectionManager:cm,databaseService:{snapshot:()=>databaseState},jobRepository:jobs,jobManager:manager,registry:local.registry,cloud,syncCoordinator:{withExclusive:fn=>fn()},historyExecutionProof:proof});
  let upgradedCache=upgradedLifecycle();
  await test('persisted opaque v1 upgrade recovers missing IDs without changing its rows or either checkpoint',async()=>{
   remote.set(id(36),row(36));assert.equal(await upgradedCache.cachedSnapshotReady(branch,90),true);await step();
   assert.equal(await count(),36);assert.equal(await legacyImage(),beforeLegacy);assert.equal(await checkpoint(),legacyCheckpoint);
   await local.restart();manager=new JobManager(jobs);recovery=upgraded();upgradedCache=upgradedLifecycle();await complete();
   assert.equal(await upgradedCache.cachedSnapshotReady(branch,90),true);assert.equal(await legacyImage(),beforeLegacy);assert.equal(await checkpoint(),legacyCheckpoint);
   assert.equal((await jobs.get(legacy.job_id)).status,'interrupted');assert.equal((await jobs.get(legacy.job_id)).last_committed_cursor,'opaque-prior-application-page');
  });
  await test('actual ordinary startup-resume, cleanup and pause/resume leave a valid v1 fingerprint unchanged',async()=>{
   const image=await legacyImage(),scope=await recovery.capture(branch);
   assert.equal(await upgradedCache.resume(branch,90),null);await oldHistory.cleanup(upgradedCache,branch,90);
   const {SyncCoordinator}=require('../electron/sync/coordinator.cjs'),coordinator=new SyncCoordinator({pushWorker:{run:async()=>({})},pullWorker:{run:async()=>({})}});
   coordinator.pause();manager.pause();assert.equal((await recovery.step({branchId:branch})).paused,true);manager.resume();coordinator.resume();
   manager=new JobManager(jobs);recovery=upgraded();upgradedCache=upgradedLifecycle();
   assert.equal((await recovery.capture(branch)).hash,scope.hash);assert.equal(await upgradedCache.cachedSnapshotReady(branch,90),true);
   assert.equal(await legacyImage(),image);assert.equal(await checkpoint(),legacyCheckpoint);
  });
  await test('missing execution ownership and a real legacy handler retain the old barrier',async()=>{
   owns=false;await assert.rejects(upgradedCache.cachedSnapshotReady(branch,90),{code:'EHISTORY_LEGACY_REVIEW'});await assert.rejects(recovery.step({branchId:branch,force:true}),{code:'EHISTORY_LEGACY_REVIEW'});
   owns=true;manager.running={...legacy,status:'running'};assert.equal((await recovery.step({branchId:branch,force:true})).busy,true);await assert.rejects(upgradedCache.cachedSnapshotReady(branch,90),{code:'EHISTORY_LEGACY_REVIEW'});manager.running=null;
   assert.equal(await legacyImage(),beforeLegacy);assert.equal(await checkpoint(),legacyCheckpoint);
  });
  await test('unknown legacy scope and unknown queued job still block both cache and recovery',async()=>{
   const update=async(value)=>cm.pool.request().input('id',legacy.job_id).input('origin',value).query('UPDATE dbo.pos_jobs SET organization_name=@origin WHERE job_id=@id;');
   await update('https://different-owned-fixture.invalid');await assert.rejects(upgradedCache.cachedSnapshotReady(branch,90),{code:'EHISTORY_LEGACY_REVIEW'});await update(cloud.backendUrl());
   const unknown={...legacy,job_id:require('node:crypto').randomUUID(),job_type:'unknown_history_kind',status:'queued'};await jobs.create(unknown);
   assert.equal(await upgradedCache.cachedSnapshotReady(branch,90),false);assert.equal((await recovery.step({branchId:branch,force:true})).busy,true);await jobs.checkpoint(unknown.job_id,{status:'completed',finished_at:new Date()});
   // A later completed unrelated operation still invalidates the old cache.
   assert.equal(await upgradedCache.cachedSnapshotReady(branch,90),false);
   await jobs.checkpoint(bootstrap.job_id,{status:'completed',finished_at:new Date(Date.now()+1000)});
   beforeLegacy=await legacyImage();assert.equal(await checkpoint(),legacyCheckpoint);
  });
  await test('100ns legacy metadata changes invalidate the exact set before an insert/progress commit',async()=>{
   await cm.pool.request().input('id',legacy.job_id).query("UPDATE dbo.pos_jobs SET updated_at=CONVERT(datetimeoffset(7),'2026-11-06T01:02:03.1234560Z',127) WHERE job_id=@id;");beforeLegacy=await legacyImage();
   remote.set(id(37),row(37));clock+=13*60*60*1000;afterRows=async()=>{afterRows=()=>{};await cm.pool.request().input('id',legacy.job_id).query('UPDATE dbo.pos_jobs SET updated_at=DATEADD(nanosecond,100,updated_at) WHERE job_id=@id;');};
   await assert.rejects(step(),{code:'EHISTORY_INDEX_SCOPE'});assert.equal(await count(),36);assert.notEqual(await legacyImage(),beforeLegacy);assert.equal(await checkpoint(),legacyCheckpoint);
   const current=await jobs.recovery('history_index_recovery_v1',branch,terminal);assert.equal(cursor(current.last_committed_cursor).n,'0');
   const changedImage=await legacyImage();await complete();assert.equal(await count(),37);assert.equal(await legacyImage(),changedImage);assert.equal(await checkpoint(),legacyCheckpoint);
   // A new membership pass is not authority to discard the earlier now-unbound
   // job. Its retained operational-cache barrier still requires review.
   assert.equal(await upgradedCache.cachedSnapshotReady(branch,90),false);
  });
  await test('explicit empty default legacy allowlist and all invalid lists preserve default barriers',async()=>{
   assert.equal(await jobs.hasOtherActiveJobs(null,{ignoreHistoryIndex:true}),true);
   for(const invalid of [[legacy.job_id,legacy.job_id],Array.from({length:51},()=>require('node:crypto').randomUUID()),['not-a-guid']])await assert.rejects(jobs.hasOtherActiveJobs(null,{allowedLegacyIds:invalid}),{code:'EHISTORY_LEGACY_REVIEW'});
   assert.equal(await checkpoint(),legacyCheckpoint);
  });
  console.log('PASS '+passed+' owned SQL Server automatic history groups');
 }finally{await local?.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
