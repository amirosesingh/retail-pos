const { runBootstrap, refreshTable } = require("./bootstrap.cjs");
const { runRetention } = require("./retention.cjs");
const { localTableCounts } = require("../sync/reconciliation.cjs");
const { verifyTables } = require("../sync/verifier.cjs");

class LocalDataLifecycle {
  constructor({connectionManager,databaseService,jobManager,jobRepository,registry,cloud,syncCoordinator,checkpoints,reader,publish=()=>{}}){
    Object.assign(this,{connectionManager,databaseService,jobManager,jobRepository,registry,cloud,syncCoordinator,checkpoints,reader,publish});
  }
  bootstrapType(historyDays){return `bootstrap_${historyDays}`;}
  async bootstrap(branchId,historyDays,existing=null){return this.jobManager.run(this.bootstrapType(historyDays),context=>runBootstrap({registry:this.registry,reader:this.reader,cloud:this.cloud,connectionManager:this.connectionManager,checkpoints:this.checkpoints,branchId,historyDays,context}),existing,{branchId});}
  async retain(branchId,historyDays,existing=null){if(historyDays===7300)return{status:"completed",skipped:true};return this.jobManager.run("retention",context=>runRetention({connectionManager:this.connectionManager,days:historyDays,context}),existing,{branchId});}
  async resume(branchId,historyDays){const active=await this.jobRepository.active();if(!active||String(active.branch_id??"")!==String(branchId))return null;if(String(active.job_type).startsWith("bootstrap_"))return this.bootstrap(branchId,Number(String(active.job_type).slice(10))||historyDays,active);if(active.job_type==="retention")return this.retain(branchId,historyDays,active);return null;}
  async recoverChangeTrackingGap(branchId,historyDays,tableName){
    const table=this.registry.tables.find(candidate=>candidate.sqlServerTable===tableName);
    if(!table)throw Object.assign(new Error(`The expired Change Tracking table ${tableName} is not registered.`),{code:"ESCHEMA_REGISTRY"});
    // The failed push has already uploaded durable aggregate-journal work. Pull
    // an authoritative branch-scoped snapshot before establishing a new SQL
    // Change Tracking baseline; never advance the checkpoint first.
    const version=await this.connectionManager.pool.request().query("SELECT CHANGE_TRACKING_CURRENT_VERSION() current_version;");
    const currentVersion=Number(version.recordset?.[0]?.current_version??0);
    const refreshed=await refreshTable({registry:this.registry,reader:this.reader,cloud:this.cloud,connectionManager:this.connectionManager,branchId,historyDays,tableName:table.cloudTable});
    await this.checkpoints.save(branchId,table.sqlServerTable,"push",{change_tracking_version:currentVersion});
    return{table:table.sqlServerTable,completed:refreshed.completed,currentVersion};
  }
  async pushWithGapRecovery(branchId,historyDays){
    const recovered=new Set();
    while(true){
      try{
        const result=await this.syncCoordinator.runPush({branchId,batchSize:500});
        return{result,recovered:[...recovered]};
      }catch(error){
        if(error?.code!=="ECHANGEGAP"||!error?.table)throw error;
        const tableName=String(error.table);
        // A checkpoint reset must make progress. Seeing the same table twice
        // means the recovery did not establish a usable baseline, so surface
        // the original failure instead of looping forever.
        if(recovered.has(tableName))throw error;
        await this.recoverChangeTrackingGap(branchId,historyDays,tableName);
        recovered.add(tableName);
      }
    }
  }
  async ensure({branchId,historyDays=90,force=false}){
    if(!branchId)throw Object.assign(new Error("This terminal needs a branch before local data can be prepared."),{code:"EBRANCH"});
    this.databaseService.transition("enabled_bootstrapping",{phase:"resume"});
    // Identity must arrive even if an unrelated upload or a large catalogue
    // delays bootstrap. Also repairs installations with old bootstrap markers.
    // refreshTable preserves rows with unacknowledged local edits.
    for(const tableName of ["pos_settings","settings_scoped"]){
      const refreshed=await refreshTable({registry:this.registry,reader:this.reader,cloud:this.cloud,connectionManager:this.connectionManager,branchId,historyDays,tableName});
      if(refreshed.completed)this.publish({kind:"general",branchId,source:"cloud",tables:[tableName]});
    }
    await this.resume(branchId,historyDays);
    const completed=await this.jobRepository.completed(this.bootstrapType(historyDays),branchId);
    // Upload local changes before refreshing shared reference rows. Older
    // databases may have a completed bootstrap from before store_groups was
    // part of the registry, leaving stores.group_id without its local parent.
    const initialPush=await this.pushWithGapRecovery(branchId,historyDays);
    const recoveredGap=initialPush.recovered.length>0;
    if((force&&!recoveredGap)||!completed){
      // A reused till database can contain completed offline sales before it
      // has a bootstrap checkpoint. Upload every locally tracked transaction
      // first; otherwise bootstrap could establish a new baseline over work
      // that head office has never acknowledged.
      await this.bootstrap(branchId,historyDays);
    }
    // Always repair this small parent table, including databases whose old
    // completed bootstrap marker would otherwise skip newly-added tables.
    await refreshTable({registry:this.registry,reader:this.reader,cloud:this.cloud,connectionManager:this.connectionManager,branchId,historyDays,tableName:"store_groups"});
    const synced=await this.syncCoordinator.runNow({branchId,batchSize:10});
    if(!synced.ok)throw Object.assign(new Error(synced.error??"Final synchronization failed."),{code:"ESYNC"});
    await this.retain(branchId,historyDays);
    const differences=await this.reconcile(branchId,historyDays);
    if(differences.length)throw Object.assign(new Error(`Final reconciliation found ${differences.length} table differences.`),{code:"ERECONCILE",differences});
    this.databaseService.markReady({phase:"ready",branchId,historyDays});
    return{ok:true,branchId,historyDays,differences:[]};
  }
  async reconcile(branchId,historyDays=90){
    const terminalId=this.cloud.terminalId?.()??"";
    const [local,cloudRows]=await Promise.all([localTableCounts(this.connectionManager,this.registry,branchId,historyDays,terminalId),this.cloud.counts({branchId,historyDays})]);
    const cloud=Object.fromEntries((Array.isArray(cloudRows)?cloudRows:[]).map(row=>[row.table_name,String(row.row_count??"0")]));
    const verifiedAt=new Date().toISOString();
    const tables=this.registry.tables.filter(table=>cloud[table.cloudTable]!==undefined).map(table=>({
      table:table.cloudTable,
      local:String(local[table.cloudTable]??"0"),
      cloud:String(cloud[table.cloudTable]??"0"),
      status:String(local[table.cloudTable]??"0")===String(cloud[table.cloudTable]??"0")?"SYNCED":"DIFFERENT",
      verified:false,
      comparedAt:verifiedAt,
    }));
    this.syncCoordinator.recordVerification({comparedAt:verifiedAt,verified:false,tables});
    return tables.filter(table=>table.status!=="SYNCED");
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
for (const name of ["ensure", "bootstrap", "retain", "repair", "verify", "recoverChangeTrackingGap", "pushWithGapRecovery"]) {
  const work = LocalDataLifecycle.prototype[name];
  LocalDataLifecycle.prototype[name] = function(...args) {
    return this.syncCoordinator.withExclusive
      ? this.syncCoordinator.withExclusive(() => work.apply(this, args))
      : work.apply(this, args);
  };
}
module.exports={LocalDataLifecycle};
