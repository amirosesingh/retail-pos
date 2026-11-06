const historyRecovery = require("../sync/history-recovery.cjs");
const { runBootstrap, refreshTable } = require("./bootstrap.cjs");
const { runRetention } = require("./retention.cjs");
const { localTableCounts, validatedCloudCounts, reconciliationError, MEMBERSHIP_TABLES } = require("../sync/reconciliation.cjs");
const { verifyTables } = require("../sync/verifier.cjs");
const { recordId } = require("../sync/uuid-fields.cjs");
const { binding } = require("../verified-activation.cjs");
const {ShiftGapRecovery,TABLES:SHIFT_GRAPH_TABLES}=require('../sync/shift-gap-recovery.cjs');
const { reportActivity } = require("../db/startup-activity.cjs");

class LocalDataLifecycle {
  constructor({connectionManager,databaseService,jobManager,jobRepository,registry,cloud,syncCoordinator,checkpoints,reader,publish=()=>{}}){
    Object.assign(this,{connectionManager,databaseService,jobManager,jobRepository,registry,cloud,syncCoordinator,checkpoints,reader,publish});
  }
  bootstrapType(historyDays){return `bootstrap_${historyDays}`;}
  cacheIdentity(branchId,historyDays){
    const state=this.databaseService?.snapshot?.();
    if(!state?.enabled||!state.configured||!state.connected||!state.tradingReady||!this.connectionManager.pool)return null;
    const terminal=this.cloud.terminalStore?.read?.();
    if(terminal){
      const registered=binding(terminal);
      // This shortcut belongs only to Operations startup. Management is routed
      // by Main to ManagementReplica and its server-authorized branch scope;
      // a NULL Management branch must neither become an Operations lock nor
      // grant an arbitrary caller-selected branch a cached readiness proof.
      if(registered?.mode!=="operations"||registered.branchId!==recordId(String(branchId)))return null;
    }
    return {pool:this.connectionManager.pool,profile:JSON.stringify(state.profile),registration:JSON.stringify(terminal?[terminal.deviceUse,terminal.locationId,terminal.storeId,terminal.branchId]:null),scope:JSON.stringify(historyRecovery.scope(this.cloud,branchId,historyDays))};
  }
  sameCacheIdentity(proof,branchId,historyDays){
    try{const current=this.cacheIdentity(branchId,historyDays);return Boolean(current&&proof&&current.pool===proof.pool&&current.profile===proof.profile&&current.registration===proof.registration&&current.scope===proof.scope);}catch{return false;}
  }
  async cachedSnapshotReady(branchId,historyDays,historyJob=null){
    const identity=this.cacheIdentity(branchId,historyDays);
    if(!identity)return false;
    const completed=await this.jobRepository.startupSnapshot(this.bootstrapType(historyDays),branchId,historyJob?.job_id??null);
    if(!completed||await this.jobRepository.hasOtherActiveJobs(historyJob?.job_id??null))return false;
    const result=await identity.pool.request().input("branch",String(branchId))
      .query("SELECT TOP (1) id FROM dbo.stores WHERE id=@branch;");
    if(!result.recordset?.length)return false;
    if(historyJob){
      const expected=historyRecovery.scope(this.cloud,branchId,historyDays);
      historyRecovery.decode(await this.jobRepository.get(historyJob.job_id),expected);
      const tables=this.registry.tables.filter(table=>table.direction!=="pull"&&table.sqlServerTable!=="change_history"&&table.columns.some(column=>column.primaryKey));
      // This exemption is for audit history only. Operational tables must not
      // require their own recovery before an existing snapshot can be exposed.
      const bounds=await identity.pool.request().input("tables",JSON.stringify(tables.map(table=>table.sqlServerTable))).input("branch",String(branchId)).query(`
        SELECT names.[value] table_name, CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(QUOTENAME('dbo')+'.'+QUOTENAME(names.[value]))) minimum_version,
          CHANGE_TRACKING_CURRENT_VERSION() current_version, checkpoints.change_tracking_version checkpoint_version
        FROM OPENJSON(@tables) names LEFT JOIN dbo.sync_checkpoints checkpoints
          ON checkpoints.entity_type=names.[value] AND checkpoints.branch_id=@branch AND checkpoints.direction='push';`);
      const rows=bounds.recordset??[];
      if(rows.length!==tables.length)return false;
      const seen=new Set();
      for(const row of rows){
        if(seen.has(row.table_name)||!tables.some(table=>table.sqlServerTable===row.table_name))return false;
        seen.add(row.table_name);
        const minimum=BigInt(historyRecovery.version(row.minimum_version)),current=BigInt(historyRecovery.version(row.current_version));
        const since=BigInt(historyRecovery.version(row.checkpoint_version??0));
        if(minimum>current||since>current||since>0n&&minimum>since)return false;
      }
      // Recheck scope and baseline after metadata reads; a profile change while
      // awaiting SQL must not publish readiness from an obsolete connection.
      historyRecovery.decode(await this.jobRepository.get(historyJob.job_id),expected);
      await historyRecovery.retained(this.connectionManager,null,historyRecovery.decode(historyJob,expected).baseline);
    }
    if(!this.sameCacheIdentity(identity,branchId,historyDays))return false;
    this.cachedReadyProof={...identity,branchId,historyDays};
    return true;
  }
  preserveCachedReady(){
    const proof=this.cachedReadyProof;
    return Boolean(proof&&this.sameCacheIdentity(proof,proof.branchId,proof.historyDays));
  }
  async releaseHistoryCache(branchId,historyDays,job){
    if(await this.cachedSnapshotReady(branchId,historyDays,job))this.databaseService.markReady({phase:"history_recovery",syncReady:false,branchId,historyDays});
  }
  async bootstrap(branchId,historyDays,existing=null,onActivity=()=>{}){return this.jobManager.run(this.bootstrapType(historyDays),context=>runBootstrap({registry:this.registry,reader:this.reader,cloud:this.cloud,connectionManager:this.connectionManager,checkpoints:this.checkpoints,branchId,historyDays,context,onActivity}),existing,{branchId});}
  async retain(branchId,historyDays,existing=null){if(historyDays===7300)return{status:"completed",skipped:true};return this.jobManager.run("retention",context=>runRetention({connectionManager:this.connectionManager,days:historyDays,context}),existing,{branchId});}
  async resume(branchId,historyDays,onActivity=()=>{}){const active=await this.jobRepository.active();if(!active||String(active.branch_id??"")!==String(branchId))return null;if(String(active.job_type).startsWith("bootstrap_"))return this.bootstrap(branchId,Number(String(active.job_type).slice(10))||historyDays,active,onActivity);if(active.job_type==="retention")return this.retain(branchId,historyDays,active);return null;}
  async recoverChangeTrackingGap(branchId,historyDays,tableName,onActivity=()=>{}){
    const table=this.registry.tables.find(candidate=>candidate.sqlServerTable===tableName);
    if(!table)throw Object.assign(new Error(`The expired Change Tracking table ${tableName} is not registered.`),{code:"ESCHEMA_REGISTRY"});
    if(table.sqlServerTable==="change_history"&&table.cloudTable==="change_history")return historyRecovery.recover(this,branchId,historyDays,refreshTable,onActivity);
    if(SHIFT_GRAPH_TABLES.includes(table.sqlServerTable)){
      const recovery=await new ShiftGapRecovery({connectionManager:this.connectionManager,registry:this.registry,reader:this.reader,checkpoints:this.checkpoints,branchId,tableName:table.sqlServerTable,cloud:this.cloud,historyDays}).begin();
      const refreshed=await refreshTable({registry:this.registry,reader:this.reader,cloud:this.cloud,connectionManager:this.connectionManager,branchId,historyDays,tableName:table.cloudTable,diagnosticOrigin:'gap_recovery',recovery,onActivity});
      await recovery.proveMissing(this.cloud);
      const proof=await recovery.finish();return {table:table.sqlServerTable,completed:refreshed.completed,...proof};
    }
    // The failed push has already uploaded durable aggregate-journal work. Pull
    // an authoritative branch-scoped snapshot before establishing a new SQL
    // Change Tracking baseline; never advance the checkpoint first.
    const version=await this.connectionManager.pool.request().query("SELECT CHANGE_TRACKING_CURRENT_VERSION() current_version;");
    const currentVersion=Number(version.recordset?.[0]?.current_version??0);
    const refreshed=await refreshTable({registry:this.registry,reader:this.reader,cloud:this.cloud,connectionManager:this.connectionManager,branchId,historyDays,tableName:table.cloudTable,diagnosticOrigin:"gap_recovery",onActivity});
    await this.checkpoints.save(branchId,table.sqlServerTable,"push",{change_tracking_version:currentVersion});
    return{table:table.sqlServerTable,completed:refreshed.completed,currentVersion};
  }
  async pushWithGapRecovery(branchId,historyDays,onActivity=()=>{}){
    const recovered=new Set();
    while(true){
      try{
        reportActivity(onActivity,{phase:"uploading"});
        const result=await this.syncCoordinator.runPush({branchId,batchSize:500,onProgress:progress=>reportActivity(onActivity,{phase:"uploading",table:progress.table})});
        if(this.jobRepository?.recovery&&this.cloud.terminalId?.())await historyRecovery.cleanup(this,branchId,historyDays);
        return{result,recovered:[...recovered]};
      }catch(error){
        if(error?.code!=="ECHANGEGAP"||!error?.table)throw error;
        const tableName=String(error.table);
        // A checkpoint reset must make progress. Seeing the same table twice
        // means the recovery did not establish a usable baseline, so surface
        // the original failure instead of looping forever.
        if(recovered.has(tableName))throw error;
        await this.recoverChangeTrackingGap(branchId,historyDays,tableName,onActivity);
        recovered.add(tableName);
      }
    }
  }
  async ensure({branchId,historyDays=90,force=false,onActivity=()=>{}}){
    this.cachedReadyProof=null;
    if(!branchId)throw Object.assign(new Error("This terminal needs a branch before local data can be prepared."),{code:"EBRANCH"});
    const cachedReady=!force&&await this.cachedSnapshotReady(branchId,historyDays);
    if(cachedReady)this.databaseService.markReady({phase:"background_sync",syncReady:false,branchId,historyDays});
    else this.databaseService.transition("enabled_bootstrapping",{phase:"resume"});
    // Identity must arrive even if an unrelated upload or a large catalogue
    // delays bootstrap. Also repairs installations with old bootstrap markers.
    // refreshTable preserves rows with unacknowledged local edits.
    for(const tableName of ["pos_settings","settings_scoped"]){
      const refreshed=await refreshTable({registry:this.registry,reader:this.reader,cloud:this.cloud,connectionManager:this.connectionManager,branchId,historyDays,tableName,diagnosticOrigin:"prefetch",onActivity});
      if(refreshed.completed)this.publish({kind:"general",branchId,source:"cloud",tables:[tableName]});
    }
    await this.resume(branchId,historyDays,onActivity);
    const completed=await this.jobRepository.completed(this.bootstrapType(historyDays),branchId);
    // Upload local changes before refreshing shared reference rows. Older
    // databases may have a completed bootstrap from before store_groups was
    // part of the registry, leaving stores.group_id without its local parent.
    const initialPush=await this.pushWithGapRecovery(branchId,historyDays,onActivity);
    const recoveredGap=initialPush.recovered.length>0;
    if((force&&!recoveredGap)||!completed){
      // A reused till database can contain completed offline sales before it
      // has a bootstrap checkpoint. Upload every locally tracked transaction
      // first; otherwise bootstrap could establish a new baseline over work
      // that head office has never acknowledged.
      await this.bootstrap(branchId,historyDays,null,onActivity);
    }
    // Always repair this small parent table, including databases whose old
    // completed bootstrap marker would otherwise skip newly-added tables.
    await refreshTable({registry:this.registry,reader:this.reader,cloud:this.cloud,connectionManager:this.connectionManager,branchId,historyDays,tableName:"store_groups",onActivity});
    reportActivity(onActivity,{phase:"checking"});
    const synced=await this.syncCoordinator.runNow({branchId,batchSize:10});
    if(!synced.ok)throw Object.assign(new Error(synced.error??"Final synchronization failed."),{code:"ESYNC"});
    reportActivity(onActivity,{phase:"retaining"});
    await this.retain(branchId,historyDays);
    reportActivity(onActivity,{phase:"checking"});
    const differences=await this.reconcileAndRecover(branchId,historyDays,onActivity);
    if(differences.length)throw reconciliationError(differences);
    this.databaseService.markReady({phase:"ready",branchId,historyDays});
    return{ok:true,branchId,historyDays,differences:[]};
  }
  async reconcile(branchId,historyDays=90,{publish=true}={}){
    const identity=this.reconciliationIdentity(branchId,historyDays);
    const terminalId=this.cloud.terminalId?.()??"";
    const [local,cloudRows]=await Promise.all([localTableCounts(this.connectionManager,this.registry,branchId,historyDays,terminalId),this.cloud.counts({branchId,historyDays})]);
    const cloud=validatedCloudCounts(this.registry,cloudRows);
    this.assertReconciliationIdentity(identity,branchId,historyDays);
    const verifiedAt=new Date().toISOString();
    const tables=this.registry.tables.filter(table=>cloud[table.cloudTable]!==undefined).map(table=>({
      table:table.cloudTable,
      local:String(local[table.cloudTable]??"0"),
      cloud:String(cloud[table.cloudTable]??"0"),
      status:String(local[table.cloudTable]??"0")===String(cloud[table.cloudTable]??"0")?"SYNCED":"DIFFERENT",
      verified:false,
      comparedAt:verifiedAt,
    }));
    this.lastCountReport={comparedAt:verifiedAt,verified:false,tables};
    if(publish)this.syncCoordinator.recordVerification(this.lastCountReport);
    return tables.filter(table=>table.status!=="SYNCED");
  }
  reconciliationIdentity(branchId,historyDays){
    const terminal=this.cloud.terminalStore?.read?.();
    if(terminal){
      const registered=binding(terminal);
      if(registered?.mode!=="operations"||registered.branchId!==recordId(String(branchId)))
        throw Object.assign(new Error("The synchronization scope changed; retry with the registered branch."),{code:"EBRANCH"});
    }
    const source=this.cloud.requestContext?.(false);
    return {pool:this.connectionManager.pool,profile:JSON.stringify(this.databaseService?.snapshot?.()?.profile),
      scope:source?.fingerprint??JSON.stringify([branchId,historyDays,this.cloud.backendUrl?.(),this.cloud.terminalId?.()]),
      registration:JSON.stringify(terminal?[terminal.deviceUse,terminal.locationId,terminal.storeId,terminal.branchId]:null)};
  }
  assertReconciliationIdentity(identity,branchId,historyDays){
    const now=this.reconciliationIdentity(branchId,historyDays);
    if(Object.keys(identity).some(key=>identity[key]!==now[key]))
      throw Object.assign(new Error("The database or terminal scope changed during reconciliation. Retry on the current connection."),{code:"ERECONCILE_SCOPE"});
  }
  async reconcileAndRecover(branchId,historyDays=90,onActivity=()=>{}){
    const identity=this.reconciliationIdentity(branchId,historyDays);
    const check=()=>this.assertReconciliationIdentity(identity,branchId,historyDays);
    let differences=await this.reconcile(branchId,historyDays,{publish:false});
    check();
    if(!differences.length||differences.every(row=>MEMBERSHIP_TABLES.has(row.table))){
      if(this.lastCountReport)this.syncCoordinator.recordVerification(this.lastCountReport);
      return differences;
    }
    // One bounded attempt for an unchanged cohort; never repeat a full bootstrap
    // on every startup retry. This evidence authorizes no deletion or ACK.
    const fingerprint=JSON.stringify(differences.map(({table,local,cloud})=>[table,local,cloud]).sort());
    const prior=this.lastReconciliationAttempt;
    if(prior&&Object.keys(identity).every(key=>identity[key]===prior.identity[key])&&prior.fingerprint===fingerprint&&Date.now()-prior.at<300000){
      this.syncCoordinator.recordVerification(this.lastCountReport);return differences;
    }
    const catchUp=async()=>{
      check();reportActivity(onActivity,{phase:"checking"});
      const result=await this.syncCoordinator.runNow({branchId,batchSize:10});check();
      if(!result.ok)throw Object.assign(new Error(result.error??"Synchronization will retry before reconciliation can finish."),{code:result.code??"ESYNC"});
      if(result.credentialsInvalid||result.lastError)
        throw Object.assign(new Error(result.lastError??"Synchronization authorization must be verified before reconciliation."),{code:result.credentialsInvalid?"EAUTH":"ESYNC"});
      if(result.deferredTables?.length||result.deferredLocalChanges||result.deferredHeldDeletion||Number(result.pending??0)>0||Number(result.failed??0)>0||Number(result.conflicts??0)>0)
        throw Object.assign(new Error("Reconciliation is waiting for existing local work to be accepted. Pending work is retained."),{code:"ESYNC_PENDING"});
    };
    await catchUp();
    differences=await this.reconcile(branchId,historyDays,{publish:false});check();
    // Large historical recovery belongs to the existing resumable job path.
    // Do not monopolize the upload lane with a repeated full-table snapshot.
    const attempted=new Set();
    for(;;){
      const missing=new Set(differences.filter(row=>!MEMBERSHIP_TABLES.has(row.table)&&!attempted.has(row.table)&&BigInt(row.cloud)>BigInt(row.local)&&BigInt(row.cloud)<=100n).map(row=>row.table));
      const tables=this.registry.tables.filter(table=>missing.has(table.cloudTable)).sort((a,b)=>a.dependencyOrder-b.dependencyOrder||a.cloudTable.localeCompare(b.cloudTable)).slice(0,4);
      if(!tables.length)break;
      for(const table of tables){
        check();attempted.add(table.cloudTable);let pages=0;
        await refreshTable({registry:this.registry,reader:this.reader,cloud:this.cloud,connectionManager:this.connectionManager,branchId,historyDays,tableName:table.cloudTable,onActivity,
          progress:{beforeDownload:async()=>{check();if(pages>=10)throw Object.assign(new Error("Automatic reconciliation reached its safe page limit. Saved work is retained; review the remaining table differences."),{code:"ERECONCILE_BUDGET"});},
            beforeApply:async()=>{check();pages++;},
            save:async(_transaction,page)=>{check();if(page.completed>100)throw Object.assign(new Error("The table changed during recovery; automatic reconciliation stopped at its safe row limit."),{code:"ERECONCILE_BUDGET"});},committed:async()=>check()}});
        check();
      }
      // Give normal uploads/downloads a turn between small recovery groups.
      // Each table is attempted once, so a fifth safe table is processed rather
      // than prematurely presented as a manual conflict or retried forever.
      await catchUp();
      differences=await this.reconcile(branchId,historyDays,{publish:false});check();
    }
    check();this.syncCoordinator.recordVerification(this.lastCountReport);
    this.lastReconciliationAttempt={identity,fingerprint,at:Date.now()};
    // Local-greater rows are never pruned: absence from an authorized snapshot
    // does not prove whether retained offline work may be discarded.
    return differences;
  }
  async repair(branchId,historyDays=90,tableNames=[]){
    const allowed=new Set(this.registry.tables.map(table=>table.cloudTable));
    const requested=[...new Set((tableNames??[]).map(String).filter(table=>allowed.has(table)))];
    if(!requested.length)return this.reconcile(branchId,historyDays);
    const pushed=await this.syncCoordinator.runNow({branchId,batchSize:10});
    if(!pushed.ok)throw Object.assign(new Error(pushed.error??"Synchronization failed before repair."),{code:pushed.code??"ESYNC"});
    for(const tableName of requested)await refreshTable({registry:this.registry,reader:this.reader,cloud:this.cloud,connectionManager:this.connectionManager,branchId,historyDays,tableName});
    const pulled=await this.syncCoordinator.runNow({branchId,batchSize:10});
    if(!pulled.ok)throw Object.assign(new Error(pulled.error??"Synchronization failed after repair."),{code:pulled.code??"ESYNC"});
    return this.reconcile(branchId,historyDays);
  }
  async verify(branchId,historyDays=90,tableNames=[]){
    await this.reconcile(branchId,historyDays);
    const counts=new Map((this.syncCoordinator.snapshot().tables??[]).map(table=>[table.table,table]));
    const report=await verifyTables({connectionManager:this.connectionManager,registry:this.registry,reader:this.reader,cloud:this.cloud,branchId,historyDays,tableNames,onTable:(_table,tables)=>this.syncCoordinator.recordVerification({comparedAt:new Date().toISOString(),verified:false,tables:tables.map(table=>({...counts.get(table.table),...table}))})});
    report.tables=report.tables.map(table=>({...counts.get(table.table),...table}));
    this.syncCoordinator.recordVerification({comparedAt:report.verifiedAt,verified:report.verified,tables:report.tables});
    return report;
  }
}
// Every lifecycle entry shares the same lease as manual/automatic sync.
for (const name of ["ensure", "bootstrap", "retain", "repair", "verify", "reconcile", "reconcileAndRecover", "recoverChangeTrackingGap", "pushWithGapRecovery"]) {
  const work = LocalDataLifecycle.prototype[name];
  LocalDataLifecycle.prototype[name] = function(...args) {
    return this.syncCoordinator.withExclusive
      ? this.syncCoordinator.withExclusive(() => work.apply(this, args))
      : work.apply(this, args);
  };
}
module.exports={LocalDataLifecycle};
