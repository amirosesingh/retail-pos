// Reuse the real owned Main/LocalDB/HTTP/PostgreSQL workflow, adding a history
// CT-expiry fault only to the existing worker. No operator profile or key.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=process.cwd(),file=path.join(root,'scripts/test-shift-financial-runtime-sqlserver.cjs');let source=fs.readFileSync(file,'utf8');
const marker="  await test('actual later offline refund preserves earlier closing and exact retry'";
if(source.split(marker).length!==2)throw Error('Reviewed actual closing fixture boundary changed');
source=source.replace(marker,`
  await test('actual Main final-upload hold never discards the saved offline closing or duplicates its retry',async()=>{
   offline=false;const {SyncCoordinator}=require('../electron/sync/coordinator.cjs');
   const actualRegistry=context.push.registry,changedIds=context.reader.changedIds;
   context.push.registry={...actualRegistry,tables:[...actualRegistry.tables,{cloudTable:'change_history',sqlServerTable:'change_history',direction:'both',scope:'global',dependencyOrder:9999,columns:[{primaryKey:true,cloudColumn:'id',sqlServerColumn:'id'}]}]};
   context.reader.changedIds=async(table,...args)=>{if(table.cloudTable==='change_history')throw Object.assign(new Error('owned history CT expired'),{code:'ECHANGEGAP',table:'change_history'});return changedIds(table,...args);};
   let finalPasses=0;const coordinator=new SyncCoordinator({pushWorker:{reader:context.reader,run:options=>{finalPasses++;return runtime.runPush(options);}},pullWorker:{run:async()=>{throw Error('Final upload must not download unrelated history');}}});
   const mainSource=readFileSync('electron/main.cjs','utf8'),start=mainSource.indexOf('async function synchronizeClosingShifts('),end=mainSource.indexOf('async function restoreShiftCloseGuard(',start);assert(start>=0&&end>start);
   const pending=new Set([shift]),vmContext={pendingShiftCloseSync:pending,mandatoryShiftSyncRun:null,localBranchId:()=>branch,databaseManager:{isConnected:()=>true},syncCloud:{health:async()=>({online:true,ready:true})},legacyRecoveryRuntime:{reader:context.reader},syncCoordinator:coordinator,SHUTDOWN_SYNC_TIMEOUT_MS:120000,
    prepareLocalData:async()=>{throw Error('ID membership must never fall back to a push-baseline reset');},require:require('node:module').createRequire(join(process.cwd(),'electron/main.cjs'))};
   require('node:vm').runInNewContext(mainSource.slice(start,end)+'\\nthis.finalize=synchronizeClosingShifts;',vmContext);
   try{
    const result=await vmContext.finalize(shift);assert.equal(result.ok,false);assert.equal(result.allUploaded,false);assert.equal(result.code,'EHISTORY_UPLOAD_REVIEW');assert.equal(pending.size,1);assert.equal(finalPasses,1);
    assert.equal((await manager.pool.request().input('shift',shift).query('SELECT state FROM dbo.shifts WHERE id=@shift')).recordset[0].state,'CLOSED');
    assert.equal(await scalar('SELECT status FROM shifts WHERE id=$1',[shift]),'CLOSED');
    assert.equal((await calls.commitLocalShiftCashCount(count)).replayed,true);
    assert.equal((await manager.pool.request().input('shift',shift).query('SELECT count(*) n FROM dbo.shift_cash_counts WHERE shift_id=@shift')).recordset[0].n,1);
    const again=await vmContext.finalize(shift);assert.equal(again.allUploaded,false);assert.equal(finalPasses,2);assert.equal(await scalar('SELECT count(*)::int FROM shift_cash_counts WHERE shift_id=$1',[shift]),1);
   }finally{context.push.registry=actualRegistry;context.reader.changedIds=changedIds;offline=true;}
  });
`+marker);
const fixture=new Module(__filename,module);fixture.filename=__filename;fixture.paths=module.paths;fixture._compile(source,__filename);
