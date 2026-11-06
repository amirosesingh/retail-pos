// Explicit opt-in: uniquely owned LocalDB, one pooled session, no POS profile.
const assert=require('node:assert/strict'),{readFileSync}=require('node:fs'),{runInNewContext}=require('node:vm');
const {createLocal}=require('./lib/shift-protocol-integration-fixture.cjs'),{HistoryIndexStore}=require('../electron/sync/history-index-recovery.cjs');
async function main(){assert.deepEqual(process.argv.slice(2),['--run']);let local,pool,other,passed=0;const branch='aaaaaaaa-aaaa-4aaa-8aaa-000000009000';
 const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
 try{
  local=await createLocal(branch);const sql=local.manager.sql();pool=await new sql.ConnectionPool({...local.manager.pool.config,pool:{min:1,max:1}}).connect();other=await new sql.ConnectionPool({...local.manager.pool.config,pool:{min:1,max:1}}).connect();
  const manager={pool,sql:()=>sql},store=new HistoryIndexStore(manager);
  await pool.request().batch('ALTER DATABASE CURRENT SET ALLOW_SNAPSHOT_ISOLATION ON;CREATE TABLE dbo.history_session_fixture(id int PRIMARY KEY,value int);INSERT dbo.history_session_fixture VALUES(1,10);');
  const state=async()=> (await pool.request().query('SELECT @@SPID session_id,(SELECT TOP(1)CONVERT(nvarchar(36),connection_id) FROM sys.dm_exec_connections WHERE session_id=@@SPID) connection_id,@@TRANCOUNT transactions,@@OPTIONS options,@@LOCK_TIMEOUT lock_timeout,transaction_isolation_level isolation,deadlock_priority FROM sys.dm_exec_sessions WHERE session_id=@@SPID;')).recordset[0];
  let next=2;
  for(const [index,level]of ['READ UNCOMMITTED','READ COMMITTED','REPEATABLE READ','SERIALIZABLE','SNAPSHOT'].entries()){
   await pool.request().query('SET TRANSACTION ISOLATION LEVEL '+level+';SET LOCK_TIMEOUT 500;SET DEADLOCK_PRIORITY LOW;');const before=await state();assert.equal(before.isolation,index+1);
   await test(level+' caller settings and transaction count survive commit/rollback/context failure',async()=>{
    await store.transaction(async tx=>{assert.equal((await store.request(tx).query('SELECT @@TRANCOUNT n;')).recordset[0].n,1);await store.request(tx).input('id',next++).query('INSERT dbo.history_session_fixture VALUES(@id,20);');});assert.deepEqual(await state(),before);
    const key=next++;await assert.rejects(store.transaction(async tx=>{await store.request(tx).input('id',key).query('INSERT dbo.history_session_fixture VALUES(@id,30);');throw Object.assign(new Error('owned context changed'),{code:'ESYNC_REQUEST_CONTEXT_CHANGED'});}),{code:'ESYNC_REQUEST_CONTEXT_CHANGED'});
    assert.deepEqual(await state(),before);assert.equal((await pool.request().input('id',key).query('SELECT count(*) n FROM dbo.history_session_fixture WHERE id=@id;')).recordset[0].n,0);
    const original=store.request.bind(store);store.request=(tx)=>{const request=original(tx),query=request.query.bind(request);request.query=async text=>{const value=await query(text);if(text==='BEGIN TRANSACTION;')throw Object.assign(new Error('owned begin readback lost'),{code:'ESYNC_REQUEST_CONTEXT_CHANGED'});return value;};return request;};
    try{await assert.rejects(store.transaction(async()=>{throw Error('handler must not start');}),{code:'ESYNC_REQUEST_CONTEXT_CHANGED'});}finally{store.request=original;}assert.deepEqual(await state(),before);
   });
   await test(level+' contention preserves the writer and releases the observer transaction',async()=>{
    await other.request().query('BEGIN TRANSACTION;UPDATE dbo.history_session_fixture SET value=11 WHERE id=1;');
    try{await assert.rejects(store.transaction(tx=>store.request(tx).query('SELECT value FROM dbo.history_session_fixture WITH(UPDLOCK,HOLDLOCK) WHERE id=1;')),error=>error.number===1222);assert.equal((await other.request().query('SELECT @@TRANCOUNT n;')).recordset[0].n,1);assert.deepEqual(await state(),before);}finally{await other.request().query('ROLLBACK TRANSACTION;');}
   });
  }
  await test('inherited transactions and implicit-transaction mode are refused without rolling back caller work',async()=>{
   await pool.request().query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED;BEGIN TRANSACTION;INSERT dbo.history_session_fixture VALUES(999,99);');const before=await state();
   await assert.rejects(store.transaction(()=>{throw Error('must not run');}),{code:'EHISTORY_INDEX_TRANSACTION'});assert.deepEqual(await state(),before);await pool.request().query('ROLLBACK TRANSACTION;SET IMPLICIT_TRANSACTIONS ON;');
   const initial=(await pool.request().query('SELECT @@TRANCOUNT transactions,@@OPTIONS options;')).recordset[0];assert.equal(initial.transactions,0);
   try{await assert.rejects(store.transaction(()=>{throw Error('must not run');}),{code:'EHISTORY_INDEX_TRANSACTION'});assert.deepEqual((await pool.request().query('SELECT @@TRANCOUNT transactions,@@OPTIONS options;')).recordset[0],initial);}finally{await pool.request().query('SET IMPLICIT_TRANSACTIONS OFF;');}
  });
  await test('actual Main GUID ownership callback uses the same pinned session in a one-connection pool',async()=>{
   const sourceText=readFileSync('electron/main.cjs','utf8'),start=sourceText.indexOf('async function ownsHistoryRecoveryExecution('),end=sourceText.indexOf('const localDataLifecycle =',start);
   const terminal='aaaaaaaa-aaaa-4aaa-8aaa-000000009001',job='aaaaaaaa-aaaa-4aaa-8aaa-000000009002',source={pool,fingerprint:'private-owned-fixture',terminalId:terminal,databaseGuid:await store.guid()};
   const {SyncCoordinator}=require('../electron/sync/coordinator.cjs'),coordinator=new SyncCoordinator({pushWorker:{run:async()=>({})},pullWorker:{run:async()=>({})}});
   const context={app:{hasSingleInstanceLock:()=>true},syncCoordinator:coordinator,databaseManager:manager,syncCloud:{requestContext:()=>({pool,fingerprint:source.fingerprint}),terminalId:()=>terminal},jobManager:{running:{job_type:'history_index_recovery_v1',job_id:job}},recordId:value=>value};runInNewContext(sourceText.slice(start,end)+'\nthis.check=ownsHistoryRecoveryExecution;',context);
   assert.equal(await context.check({jobId:job,source}),false);const before=await state();await coordinator.withExclusive(()=>store.transaction(async tx=>{assert.equal(await context.check({jobId:job,source,requestParent:tx}),true);}));assert.deepEqual(await state(),before);assert.equal(await context.check({jobId:job,source}),false);
  });
  await test('unverifiable rollback discards only the owned connection before it returns to the pool',async()=>{
   const original=store.request.bind(store),acquire=pool.acquire.bind(pool),borrowed=[];
   pool.acquire=(requester,callback)=>acquire(requester,(error,connection,config)=>{if(!error)borrowed.push(connection);callback(error,connection,config);});
   store.request=tx=>{const request=original(tx),query=request.query.bind(request);request.query=text=>text.startsWith('IF @@TRANCOUNT>0 ROLLBACK')?Promise.reject(Object.assign(new Error('owned rollback transport loss'),{code:'EAI_AGAIN'})):query(text);return request;};
   try{
    await assert.rejects(store.transaction(async tx=>{await store.request(tx).query('INSERT dbo.history_session_fixture VALUES(1000,100);');throw Object.assign(new Error('owned context changed'),{code:'ESYNC_REQUEST_CONTEXT_CHANGED'});}),{code:'ESYNC_REQUEST_CONTEXT_CHANGED'});
    const after=await state();assert.equal(after.transactions,0);assert.equal(borrowed[0].hasError,true);assert.notEqual(borrowed.at(-1),borrowed[0]);
    // ODBC can reuse the physical server session after closing its client
    // handle; the pool must replace the discarded driver handle regardless.
    assert.equal((await pool.request().query('SELECT count(*) n FROM dbo.history_session_fixture WHERE id=1000;')).recordset[0].n,0);
   }finally{store.request=original;pool.acquire=acquire;}
  });
  console.log('PASS '+passed+' owned single-session history groups');
 }finally{await other?.close();await pool?.close();await local?.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
