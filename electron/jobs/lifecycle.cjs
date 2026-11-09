const historyRecovery = require("../sync/history-recovery.cjs");
const historyIndex = require('../sync/history-index-recovery.cjs');
const { runBootstrap, refreshTable } = require("./bootstrap.cjs");
const { runRetention } = require("./retention.cjs");
const { localTableCounts, validatedCloudCounts, reconciliationError, MEMBERSHIP_TABLES } = require("../sync/reconciliation.cjs");
const { verifyTables } = require("../sync/verifier.cjs");
const { recordId } = require("../sync/uuid-fields.cjs");
const { binding } = require("../verified-activation.cjs");
const {ShiftGapRecovery,TABLES:SHIFT_GRAPH_TABLES}=require('../sync/shift-gap-recovery.cjs');
const { reportActivity } = require("../db/startup-activity.cjs");
const {createHistoryPolicyRun}=require('../sync/history-read-scope.cjs');
const HISTORY_POLICY_UNAVAILABLE='EHISTORY_POLICY_UNAVAILABLE';

class LocalDataLifecycle {
  constructor({connectionManager,databaseService,jobManager,jobRepository,registry,cloud,syncCoordinator,checkpoints,reader,publish=()=>{},historyExecutionProof=()=>false,recoverHeldStatuses=null}){
    Object.assign(this,{connectionManager,databaseService,jobManager,jobRepository,registry,cloud,syncCoordinator,checkpoints,reader,publish});
    this.recoverHeldStatuses=recoverHeldStatuses;
    this.historyIndexRecovery=new historyIndex.HistoryIndexRecovery({connectionManager,cloud,jobRepository,jobManager,executionProof:historyExecutionProof,
      onApplied:({branchId})=>this.publish({kind:'general',branchId,source:'cloud',tables:['change_history']})});
  }
  historyIndexAvailable(){return typeof this.cloud.historyIndex==='function'&&typeof this.cloud.historyMissingRows==='function'&&typeof this.cloud.requestContext==='function';}
  async unavailableHistoryPolicy(branchId){
    if(typeof this.cloud.isHistoryPolicyUnavailable!=='function'||!this.registry.tables.some(table=>table.cloudTable==='change_history'))return null;
    try{await createHistoryPolicyRun({cloud:this.cloud,connectionManager:this.connectionManager,branchId}).get();return null;}
    catch(error){if(this.cloud.isHistoryPolicyUnavailable(error,branchId))return error;throw error;}
  }
  deferHistoryPolicy(branchId,error){
    if(!this.cloud.isHistoryPolicyUnavailable?.(error,branchId))
      throw Object.assign(new Error('The history synchronization context changed. Saved progress remains pending.'),{code:'ESYNC_REQUEST_CONTEXT_CHANGED',table:'change_history'});
    const source=this.cloud.requestContext(false),nextRetryAt=new Date(Date.now()+60_000).toISOString();
    const previous=this.historyPending(branchId)?this.historyRecoveryState:null;
    this.deferredHistoryPolicy=error;
    this.historyRecoveryIdentity={pool:source.pool,fingerprint:source.fingerprint,scopeTag:''};
    this.historyRecoveryState={branchId,status:'retrying',pending:true,membershipOnly:true,jobId:previous?.jobId??null,completedRows:previous?.completedRows??0,
      code:HISTORY_POLICY_UNAVAILABLE,error:error.message,nextRetryAt};
    this.syncCoordinator.recordHistoryRecovery?.(this.historyRecoveryState);
    return{pending:true,status:'retrying',code:HISTORY_POLICY_UNAVAILABLE,next_retry_at:nextRetryAt};
  }
  async historyStep(branchId,{force=false,scopeTag='',onActivity=()=>{}}={}){
    if(this.syncCoordinator.paused||this.jobManager.paused)return{pending:true,paused:true};
    if(!this.historyIndexAvailable())throw Object.assign(new Error('The protected history recovery protocol is unavailable. Saved work remains pending.'),{code:'EHISTORY_INDEX_UNAVAILABLE',table:'change_history'});
    if(!scopeTag&&this.deferredHistoryPolicy&&this.historyPending(branchId)){
      const unavailable=await this.unavailableHistoryPolicy(branchId);
      if(unavailable)return this.deferHistoryPolicy(branchId,unavailable);
      this.deferredHistoryPolicy=null;
      force=true;
    }
    const source=this.cloud.requestContext(false),prior=this.historyRecoveryIdentity;
    const samePrior=prior&&prior.pool===source.pool&&prior.fingerprint===source.fingerprint&&prior.scopeTag===scopeTag&&this.historyRecoveryState?.branchId===branchId;
    this.historyIndexRecovery.onActivity=onActivity;
    const result=await this.historyIndexRecovery.step({branchId,force,scopeTag});
    const current=this.cloud.requestContext(false);
    if(current.pool!==source.pool||current.fingerprint!==source.fingerprint)throw Object.assign(new Error('The database or terminal changed during history recovery.'),{code:'ESYNC_REQUEST_CONTEXT_CHANGED',table:'change_history'});
    const waiting=result.busy||result.paused,previous=samePrior?this.historyRecoveryState:null;
    const status=result.status??result.job?.status??(result.completed?'completed':result.paused?'paused':result.retrying?'retrying':'queued');
    this.historyRecoveryState={branchId,status,pending:Boolean(result.pending),membershipOnly:true,jobId:result.job_id??result.job?.job_id??previous?.jobId??null,
      completedRows:Number(result.completed_rows??result.job?.completed_rows??previous?.completedRows??0),code:waiting?previous?.code??null:result.error_code??result.job?.error_code??null,error:waiting?previous?.error??null:result.error_message??result.job?.error_message??null,
      nextRetryAt:result.next_retry_at??result.job?.next_retry_at??null};
    this.historyRecoveryIdentity={pool:source.pool,fingerprint:source.fingerprint,scopeTag};
    this.syncCoordinator.recordHistoryRecovery?.(this.historyRecoveryState);
    return result;
  }
  historyPending(branchId){try{const source=this.cloud.requestContext(false),identity=this.historyRecoveryIdentity;return Boolean(identity&&identity.pool===source.pool&&identity.fingerprint===source.fingerprint&&this.historyRecoveryState?.branchId===branchId&&this.historyRecoveryState.pending);}catch{return false;}}
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
  async inspectCachedSnapshot(branchId,historyDays,historyJob,{requireOperationalBounds=false,inspectShiftGaps=false}={}){
    const identity=this.cacheIdentity(branchId,historyDays);
    if(!identity)return null;
    const expiredShiftTables=[];
    let indexProof=null;
    let legacyProof=null;
    if(!historyJob&&this.historyIndexAvailable()){
      // Existing operational-cache readiness must not acquire a new GUID/read
      // permission dependency when there is no pending history job to exempt.
      const candidate=await this.jobRepository.recovery(historyIndex.TYPE,branchId,this.cloud.terminalId());
      if(candidate&&candidate.status!=='completed'){
        indexProof=await this.historyIndexRecovery.current(branchId);
        historyJob=indexProof?.job??null;
      }
      const old=await this.jobRepository.legacyHistory?.(branchId,this.cloud.terminalId())??[];
      const oldIndex=await this.jobRepository.legacyIndexHistory?.(branchId,this.cloud.terminalId())??[];
      if(old.length||oldIndex.length)legacyProof=indexProof?.scope??await this.historyIndexRecovery.capture(branchId);
    }else if(historyJob?.job_type===historyIndex.TYPE){
      indexProof=await this.historyIndexRecovery.current(branchId);
      if(indexProof?.job.job_id!==historyJob.job_id)return null;
    }
    const allowedLegacyIds=(indexProof?.scope??legacyProof)?.legacyIds??[];
    const completed=await this.jobRepository.startupSnapshot(this.bootstrapType(historyDays),branchId,historyJob?.job_id??null,allowedLegacyIds);
    if(!completed||await this.jobRepository.hasOtherActiveJobs(historyJob?.job_id??null,{allowedLegacyIds}))return null;
    const result=await identity.pool.request().input("branch",String(branchId))
      .query("SELECT TOP (1) id FROM dbo.stores WHERE id=@branch;");
    if(!result.recordset?.length)return null;
    if(historyJob||legacyProof||requireOperationalBounds){
      const expected=indexProof?.scope??legacyProof??historyRecovery.scope(this.cloud,branchId,historyDays);
      const decode=indexProof?historyIndex.decode:historyRecovery.decode;
      if(historyJob)decode(await this.jobRepository.get(historyJob.job_id),expected);
      const tables=this.registry.tables.filter(table=>table.direction!=="pull"&&table.sqlServerTable!=="change_history"&&table.columns.some(column=>column.primaryKey));
      // This exemption is for audit history only. Operational tables must not
      // require their own recovery before an existing snapshot can be exposed.
      const bounds=await identity.pool.request().input("tables",JSON.stringify(tables.map(table=>table.sqlServerTable))).input("branch",String(branchId)).query(`
        SELECT names.[value] table_name, CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(QUOTENAME('dbo')+'.'+QUOTENAME(names.[value]))) minimum_version,
          CHANGE_TRACKING_CURRENT_VERSION() current_version, checkpoints.change_tracking_version checkpoint_version,
          checkpoints.organization_id checkpoint_organization_id
        FROM OPENJSON(@tables) names LEFT JOIN dbo.sync_checkpoints checkpoints
          ON checkpoints.entity_type=names.[value] AND checkpoints.branch_id=@branch AND checkpoints.direction='push';`);
      const rows=bounds.recordset??[];
      if(rows.length!==tables.length)return null;
      const seen=new Set();
      for(const row of rows){
        const table=tables.find(candidate=>candidate.sqlServerTable===row.table_name);
        if(seen.has(row.table_name)||!table)return null;
        seen.add(row.table_name);
        const minimum=BigInt(historyRecovery.version(row.minimum_version)),current=BigInt(historyRecovery.version(row.current_version));
        const since=BigInt(historyRecovery.version(row.checkpoint_version??0));
        if(minimum>current||since>current||requireOperationalBounds&&(row.checkpoint_version==null||row.checkpoint_organization_id!=='default'))return null;
        if(minimum>since&&(since>0n||requireOperationalBounds)){
          if(!inspectShiftGaps||since===0n||table.cloudTable!==row.table_name||!SHIFT_GRAPH_TABLES.includes(row.table_name))return null;
          expiredShiftTables.push(row.table_name);
        }
      }
      // Recheck scope and baseline after metadata reads; a profile change while
      // awaiting SQL must not publish readiness from an obsolete connection.
      if(historyJob)decode(await this.jobRepository.get(historyJob.job_id),expected);
      if(indexProof||legacyProof)await this.historyIndexRecovery.check(indexProof?.scope??legacyProof);
      else if(historyJob)await historyRecovery.retained(this.connectionManager,null,historyRecovery.decode(historyJob,expected).baseline);
    }
    if(!this.sameCacheIdentity(identity,branchId,historyDays))return null;
    return {identity,expiredShiftTables};
  }
  async cachedSnapshotReady(branchId,historyDays,historyJob=null,options={}){
    const snapshot=await this.inspectCachedSnapshot(branchId,historyDays,historyJob,options);
    if(!snapshot||snapshot.expiredShiftTables.length)return false;
    this.cachedReadyProof={...snapshot.identity,branchId,historyDays};
    return true;
  }
  async prepareWithoutHistoryReader(branchId,historyDays,unavailable,onActivity){
    this.cachedReadyProof=null;
    const snapshot=await this.inspectCachedSnapshot(branchId,historyDays,null,{requireOperationalBounds:true,inspectShiftGaps:true});
    if(!snapshot)throw unavailable;
    const assertSource=()=>{
      if(snapshot.expiredShiftTables.length&&(this.syncCoordinator.paused||this.jobManager.paused)){
        this.cachedReadyProof=null;
        throw unavailable;
      }
      const terminal=binding(this.cloud.terminalStore?.read?.());
      if(!terminal||terminal.mode!=='operations'||terminal.platform!=='pc'||terminal.branchId!==recordId(branchId)||
        !this.sameCacheIdentity(snapshot.identity,branchId,historyDays)||!this.cloud.isHistoryPolicyUnavailable?.(unavailable,branchId)){
        this.cachedReadyProof=null;
        throw Object.assign(new Error('The registered recovery source changed. Saved progress remains pending.'),{code:'ESYNC_REQUEST_CONTEXT_CHANGED',table:'shifts'});
      }
    };
    assertSource();
    if(!snapshot.expiredShiftTables.length){
      this.cachedReadyProof={...snapshot.identity,branchId,historyDays};
      return;
    }
    // An expired shift checkpoint is a separate protected recovery. Try only
    // the proved shift gaps, then require all operational bounds again.
    for(const tableName of snapshot.expiredShiftTables){
      assertSource();
      await this.recoverChangeTrackingGap(branchId,historyDays,tableName,onActivity,assertSource);
    }
    assertSource();
    if(!await this.cachedSnapshotReady(branchId,historyDays,null,{requireOperationalBounds:true}))throw unavailable;
    assertSource();
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
  async recoverChangeTrackingGap(branchId,historyDays,tableName,onActivity=()=>{},assertSource){
    const table=this.registry.tables.find(candidate=>candidate.sqlServerTable===tableName);
    if(!table)throw Object.assign(new Error(`The expired Change Tracking table ${tableName} is not registered.`),{code:"ESCHEMA_REGISTRY"});
    if(table.sqlServerTable==="change_history"&&table.cloudTable==="change_history")return this.historyStep(branchId,{onActivity});
    if(SHIFT_GRAPH_TABLES.includes(table.sqlServerTable)){
      const recovery=await new ShiftGapRecovery({connectionManager:this.connectionManager,registry:this.registry,reader:this.reader,checkpoints:this.checkpoints,branchId,tableName:table.sqlServerTable,cloud:this.cloud,historyDays,
        assertSource,requireExpiredCheckpoint:typeof assertSource==='function'}).begin();
      const refreshed=await refreshTable({registry:this.registry,reader:this.reader,cloud:this.cloud,connectionManager:this.connectionManager,branchId,historyDays,tableName:table.cloudTable,diagnosticOrigin:'gap_recovery',recovery,onActivity});
      await recovery.proveMissing(this.cloud);
      const proof=await recovery.finish();return {table:table.sqlServerTable,completed:refreshed.completed,...proof};
    }
    // The failed push has already uploaded durable aggregate-journal work. Pull
    // an authoritative branch-scoped snapshot before establishing a new SQL
    // Change Tracking baseline; never advance the checkpoint first.
    const version=await this.connectionManager.pool.request().query("SELECT CHANGE_TRACKING_CURRENT_VERSION() current_version;");
    const currentVersion=Number(version.recordset?.[0]?.current_version??0);
    const saveBaseline = transaction => this.checkpoints.save(branchId,table.sqlServerTable,"push",
      {change_tracking_version:currentVersion},transaction);
    const settings = table.cloudTable === "pos_store_settings";
    const progress = settings ? { save: (transaction, { cursor }) => { if (!cursor) return saveBaseline(transaction); } } : null;
    const refreshed=await refreshTable({registry:this.registry,reader:this.reader,cloud:this.cloud,connectionManager:this.connectionManager,branchId,historyDays,tableName:table.cloudTable,diagnosticOrigin:"gap_recovery",onActivity,progress});
    if (!settings) await saveBaseline(null);
    return{table:table.sqlServerTable,completed:refreshed.completed,currentVersion};
  }
  async pushWithGapRecovery(branchId,historyDays,onActivity=()=>{}){
    const recovered=new Set();let heldRecoveryAttempted=false;
    while(true){
      try{
        reportActivity(onActivity,{phase:"uploading"});
        const result=await this.syncCoordinator.runPush({branchId,batchSize:500,onProgress:progress=>reportActivity(onActivity,{phase:"uploading",table:progress.table})});
        if(this.jobRepository?.recovery&&this.cloud.terminalId?.())await historyRecovery.cleanup(this,branchId,historyDays);
        return{result,recovered:[...recovered]};
      }catch(error){
        if(error?.code!=="ECHANGEGAP"||!error?.table)throw error;
        const tableName=String(error.table);
        if(!heldRecoveryAttempted&&SHIFT_GRAPH_TABLES.includes(tableName)&&typeof this.recoverHeldStatuses==='function'){
          heldRecoveryAttempted=true;
          // A blocked closing must not suppress an independently proven held
          // completion. This optional bounded read has no shift/CT authority;
          // its own refusal must never replace the original closing guard.
          try{await this.recoverHeldStatuses({branchId,onActivity});}catch{/* The original shift recovery/denial below remains authoritative. */}
        }
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
    const unavailable=await this.unavailableHistoryPolicy(branchId);
    if(unavailable)await this.prepareWithoutHistoryReader(branchId,historyDays,unavailable,onActivity);
    await this.resume(branchId,historyDays,onActivity);
    const completed=await this.jobRepository.completed(this.bootstrapType(historyDays),branchId);
    // Upload local changes before refreshing shared reference rows. Older
    // databases may have a completed bootstrap from before store_groups was
    // part of the registry, leaving stores.group_id without its local parent.
    const initialPush=await this.pushWithGapRecovery(branchId,historyDays,onActivity);
    const recoveredGap=initialPush.recovered.length>0;
    if(!unavailable&&((force&&!recoveredGap)||!completed)){
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
    if(unavailable){
      const unrelatedFailure=[...(this.syncCoordinator.unresolved?.().values()??[])].some(failure=>failure.branchId===String(branchId)&&failure.table!=='change_history');
      // A history row can block an entire mixed feed page. Even equal
      // counts cannot certify that the other rows' updates were applied.
      if(!synced.ok||unrelatedFailure||synced.credentialsInvalid||synced.lastError&&!synced.historyHoldOnly||
        synced.deferredTables?.some(table=>table!=='change_history')||synced.deferredLocalChanges||synced.deferredHeldDeletion||synced.membershipDeferred||Number(synced.failed??0)>0||Number(synced.conflicts??0)>0)
        throw Object.assign(new Error(synced.error??synced.lastError??'Operational synchronization must complete before protected history can wait.'),{code:synced.code??'ESYNC'});
      const differences=await this.reconcile(branchId,historyDays,{unavailable});
      if(differences.length)throw reconciliationError(differences);
      if(!await this.cachedSnapshotReady(branchId,historyDays,null,{requireOperationalBounds:true}))throw unavailable;
      this.deferHistoryPolicy(branchId,unavailable);
      const detail={phase:'history_recovery',syncReady:false,historyPending:true,code:HISTORY_POLICY_UNAVAILABLE,branchId,historyDays};
      this.databaseService.markReady(detail);
      return{ok:true,...detail,differences};
    }
    if(!synced.ok)throw Object.assign(new Error(synced.error??"Final synchronization failed."),{code:"ESYNC"});
    if(this.deferredHistoryPolicy&&this.historyPending(branchId))await this.historyStep(branchId,{force:true,onActivity});
    reportActivity(onActivity,{phase:"retaining"});
    await this.retain(branchId,historyDays);
    reportActivity(onActivity,{phase:"checking"});
    const differences=await this.reconcileAndRecover(branchId,historyDays,onActivity);
    const blockers=differences.filter(row=>row.table!=='change_history'||!this.historyPending(branchId));
    if(blockers.length)throw reconciliationError(blockers);
    if(this.historyPending(branchId)){
      if(!await this.cachedSnapshotReady(branchId,historyDays))throw reconciliationError(differences);
      this.databaseService.markReady({phase:'history_recovery',syncReady:false,branchId,historyDays});
    }else this.databaseService.markReady({phase:"ready",branchId,historyDays});
    return{ok:true,branchId,historyDays,differences,historyPending:this.historyPending(branchId)};
  }
  async reconcile(branchId,historyDays=90,{publish=true,unavailable=null}={}){
    const identity=this.reconciliationIdentity(branchId,historyDays);
    if(!unavailable&&this.cloud.isHistoryPolicyUnavailable?.(this.deferredHistoryPolicy,branchId))unavailable=this.deferredHistoryPolicy;
    const terminalId=this.cloud.terminalId?.()??"";
    const historyScope=this.registry.tables.some(table=>table.cloudTable==='change_history')?
      require('../sync/history-read-scope.cjs').captureHistoryScope(this.cloud,this.connectionManager,branchId):null;
    const [local,cloudRows]=await Promise.all([localTableCounts(this.connectionManager,this.registry,branchId,historyDays,terminalId,historyScope),this.cloud.counts({branchId,historyDays})]);
    const cloud=validatedCloudCounts(this.registry,cloudRows);
    this.assertReconciliationIdentity(identity,branchId,historyDays);
    const historyUnavailable=this.cloud.isHistoryPolicyUnavailable?.(unavailable,branchId)===true;
    if(unavailable&&!historyUnavailable)throw Object.assign(new Error('The history synchronization context changed. Existing counts remain unverified.'),{code:'ESYNC_REQUEST_CONTEXT_CHANGED',table:'change_history'});
    const verifiedAt=new Date().toISOString();
    const tables=this.registry.tables.filter(table=>cloud[table.cloudTable]!==undefined&&!(historyUnavailable&&table.cloudTable==='change_history')).map(table=>({
      table:table.cloudTable,
      local:String(local[table.cloudTable]??"0"),
      cloud:String(cloud[table.cloudTable]??"0"),
      status:String(local[table.cloudTable]??"0")===String(cloud[table.cloudTable]??"0")?"SYNCED":"DIFFERENT",
      verified:false,
      comparedAt:verifiedAt,
    }));
    this.lastCountReport={comparedAt:verifiedAt,verified:false,tables,...(historyUnavailable?{historyPending:true}:{})};
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
      scope:JSON.stringify([branchId,historyDays,source?.fingerprint??[this.cloud.backendUrl?.(),this.cloud.terminalId?.()]]),
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
    if(differences.some(row=>row.table==='change_history')&&this.historyIndexAvailable()){
      await this.historyStep(branchId,{force:true,onActivity});check();
      differences=await this.reconcile(branchId,historyDays,{publish:false});check();
    }
    if(!differences.length||differences.every(row=>MEMBERSHIP_TABLES.has(row.table)||row.table==='change_history'&&this.historyPending(branchId))){
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
      if(result.credentialsInvalid||result.lastError&&!result.historyHoldOnly)
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
      const missing=new Set(differences.filter(row=>!MEMBERSHIP_TABLES.has(row.table)&&!(row.table==='change_history'&&this.historyIndexAvailable())&&!attempted.has(row.table)&&BigInt(row.cloud)>BigInt(row.local)&&BigInt(row.cloud)<=100n).map(row=>row.table));
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
    for(const tableName of requested){
      if(tableName==='change_history')await this.historyStep(branchId,{force:true});
      else await refreshTable({registry:this.registry,reader:this.reader,cloud:this.cloud,connectionManager:this.connectionManager,branchId,historyDays,tableName});
    }
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
for (const name of ["ensure", "bootstrap", "retain", "repair", "verify", "reconcile", "reconcileAndRecover", "recoverChangeTrackingGap", "pushWithGapRecovery", "historyStep"]) {
  const work = LocalDataLifecycle.prototype[name];
  LocalDataLifecycle.prototype[name] = function(...args) {
    return this.syncCoordinator.withExclusive
      ? this.syncCoordinator.withExclusive(() => work.apply(this, args))
      : work.apply(this, args);
  };
}
module.exports={LocalDataLifecycle};
