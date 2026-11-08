const { AsyncLocalStorage } = require("node:async_hooks");
const { bootstrapDiagnostic, tagBootstrapDiagnostic } = require("../diagnostics.cjs");
const { posFeedEvidence } = require("./status-evidence.cjs");
const { pilotEnrollment } = require("./grouped-store-settings.cjs");
function retainDiagnostic(target, source) {
  const { bootstrapPhase: phase, bootstrapOrigin: origin, ...fields } = bootstrapDiagnostic(source, []);
  try {
    const privateFields = Object.getOwnPropertyDescriptor(source, "bootstrapDiagnostic")?.value;
    const table = Object.getOwnPropertyDescriptor(privateFields, "table")?.value;
    if (typeof table === "string" && /^[a-z][a-z0-9_]{0,62}$/.test(table)) fields.table = table;
  } catch { /* Diagnostics never replace the original outcome. */ }
  return tagBootstrapDiagnostic(target, { ...fields, ...(phase ? { phase } : {}), ...(origin ? { origin } : {}) });
}
const syncLease = new AsyncLocalStorage();
const authorHold = error => /^(?:ESYNC_SHIFT_AUTHOR_|ESHIFT_AUTHOR_)/.test(String(error?.code??""));
class SyncCoordinator {
  #groupedSettingsPilot;
  constructor({ pushWorker, pullWorker, publish = () => {}, recoverHeldStatuses = null, groupedSettingsPilot = null }) { this.pushWorker=pushWorker; this.pullWorker=pullWorker; this.publish=publish; this.recoverHeldStatuses=recoverHeldStatuses; this.#groupedSettingsPilot=pilotEnrollment(groupedSettingsPilot); this.running=false; this.activeRun=null; this.activeOptions=null; this.paused=false; this.status={ phase:"idle", pending:0, failed:0, conflicts:0, lastPushAt:null, lastPullAt:null, lastError:null, lastComparedAt:null, lastVerifiedAt:null, tables:[], recentTables:[], credentialsInvalid:false, membershipDeferred:false, membershipMirrored:0 }; }
  snapshot() { return { ...this.status, running:this.running, paused:this.paused }; }
  unresolved() { return this.unresolvedFailures??=new Map(); }
  publishFailureStatus(branchId) {
    const failures=[...this.unresolved().values()].filter(failure=>failure.branchId===String(branchId??""));
    const history=(this.historyHolds??=new Map()).get(String(branchId??''))??null;
    this.status.historyUploadHeld=history;
    this.status.lastError=[...new Set([...failures.map(failure=>failure.error),...(history?[history.message]:[])])].join(' ')||null;
    this.status.credentialsInvalid=failures.some(failure=>failure.credentialsInvalid);
  }
  rememberFailure(error,options,direction) {
    const table=String(error?.table??error?.detail??"").trim(),raw=String(error?.message??error);
    const message=table&&!raw.includes(table)?`${raw} (table: ${table})`:raw;
    const code=String(error?.code??"ESYNC"),status=Number(error?.status??error?.statusCode??0);
    const branchId=String(options.branchId??""),includeActivity=direction==="push"&&options.includeActivity!==false,skipMembership=direction==="pull"&&Boolean(options.skipMembership);
    const domain=direction==="pull"&&posFeedEvidence(error,branchId)==="failed"?"pos_feed":"unspecified";
    // Bound entries by actual work scope, never an arbitrary error message.
    const key=JSON.stringify([branchId,direction,includeActivity,skipMembership,domain]),previous=this.unresolved().get(key);
    const denied=!authorHold(error)&&(status===401||status===403||code==="HTTP_401"||code==="HTTP_403");
    this.unresolved().set(key,{branchId,direction,includeActivity,skipMembership,domain,table,error:message,credentialsInvalid:Boolean(previous?.credentialsInvalid||denied)});
    this.publishFailureStatus(branchId);
    return message;
  }
  clearSuccessfulFailures(options,direction,result) {
    // A deferred Membership read is not a POS-feed failure. Only the worker's
    // private matching-branch completion evidence can resolve that domain;
    // unknown/full-scope failures still require their full successful pass.
    const deferredTables=Boolean(result?.deferredTables?.length);
    const pendingFeed=Boolean(result?.deferredLocalChanges||result?.deferredHeldDeletion);
    for(const [key,failure] of this.unresolved()) {
      if(failure.branchId!==String(options.branchId??"")||failure.direction!==direction||failure.includeActivity&&options.includeActivity===false)continue;
      if(direction==='push'&&result?.historyUploadHeld&&(!failure.table||failure.table==='change_history'||failure.table==='transaction batch'))continue;
      if(direction==="pull"&&failure.domain==="pos_feed") {
        if(!deferredTables&&!pendingFeed&&posFeedEvidence(result,options.branchId)==="complete")this.unresolved().delete(key);
        continue;
      }
      if(deferredTables||pendingFeed||result?.membershipDeferred)continue;
      if(direction==="pull"&&!failure.skipMembership&&options.skipMembership)continue;
      this.unresolved().delete(key);
    }
  }
  async withExclusive(work) {
    if (syncLease.getStore() === this) return work();
    const prior = this.exclusiveTail ?? Promise.resolve();
    let release;
    this.exclusiveTail = new Promise(resolve => { release = resolve; });
    await prior.catch(() => undefined);
    try { return await syncLease.run(this, work); } finally { release(); }
  }
  runPush(options) { return this.withExclusive(() => this.pushWorker.run(options)); }
  ownsExclusive(){return syncLease.getStore()===this;}

  // Explicit isolated caller only. The installed runNow path still owns the
  // legacy feed until its settings writers have a verified handoff.
  runGroupedSettingsPilot() {
    const enrollment = this.#groupedSettingsPilot;
    if (!enrollment) return Promise.resolve({ status: "DISABLED", reason: null, branchId: null, position: null });
    return this.withExclusive(async () => {
      let result;
      if (this.paused) {
        result = { status: "PAUSED", reason: null, branchId: enrollment.branchId,
          position: this.status.groupedSettingsPilot?.position ?? null };
      } else {
        try {
          result = await this.pullWorker.runGroupedSettingsPilot(enrollment, () => this.paused);
        } catch (error) {
          const refused = ["ESYNC_GROUPED_SCOPE", "ESYNC_GROUPED_DATABASE_CHANGED", "ESYNC_GROUPED_DATABASE_UNVERIFIED",
            "ESYNC_REQUEST_CONTEXT_CHANGED"].includes(error?.code);
          result = { status: refused ? "REFUSED" : "RETRY", reason: refused ? error.code : "ESYNC_GROUPED_RETRY",
            branchId: enrollment.branchId, position: null };
        }
      }
      this.status.groupedSettingsPilot = result;
      this.publish(this.snapshot());
      return result;
    });
  }

  async refresh(branchId) {
    try {
      const reader=this.pushWorker?.reader;
      if (reader?.connectionManager?.pool) Object.assign(this.status,await reader.pendingSummary(branchId));
    } catch {
      // A status counter must never break sales or hide the last useful state.
    }
    return this.snapshot();
  }
  async runNow(options = {}) {
    // Startup restore, the periodic timer and a manual click can converge on
    // the same tick. Share the active result instead of reporting a false
    // synchronization failure to two of those callers.
    if (syncLease.getStore() === this) return this.runOnce(options);
    if (this.activeRun) {
      const active = this.activeRun;
      if (JSON.stringify(this.activeOptions) === JSON.stringify(options)) return active;
      // A different caller (notably the final shift-close pass) must still get
      // its own run even if the background pass itself rejects unexpectedly.
      await active.catch(() => undefined);
      return this.runNow(options);
    }
    if (this.paused) return { ok:false, ...this.snapshot(), paused:true, code:"ESYNC_PAUSED", error:"Synchronization is paused." };
    this.activeOptions={ ...options };
    this.activeRun=this.withExclusive(() => this.runOnce(options));
    try{return await this.activeRun;}finally{this.activeRun=null;this.activeOptions=null;}
  }
  async runFinal(options = {}) {
    // A distinct option makes a shift-close request wait for an already
    // running periodic cycle and then perform its own catch-up pass. It never
    // overlaps the active coordinator run.
    // Closing needs central acknowledgement of outgoing records. Downloading
    // unrelated history must not turn an acknowledged close into a failure.
    const result=await this.runNow({ ...options, includeActivity:true, final:true, pushOnly:true });
    if(!result.ok)return result;
    if(result.historyUploadHeld)return{...result,ok:false,allUploaded:false,code:'EHISTORY_UPLOAD_REVIEW',error:result.historyUploadHeld.message};
    if(result.deferredTables?.length)return {...result,ok:false,code:"ESYNC_AUTH_PENDING",error:`Settings changes still need an authorized sign-in: ${result.deferredTables.join(", ")}.`};
    const reader=this.pushWorker?.reader;
    const remaining=reader?.pendingSummary
      ? await reader.pendingSummary(options.branchId)
      : { pending:0,failed:0 };
    if(Number(remaining.pending??0)>0||Number(remaining.failed??0)>0){
      return {
        ...result,
        ...remaining,
        ok:false,
        code:"ESYNC_PENDING",
        error:"Required local transactions are still waiting for central acknowledgement.",
      };
    }
    return { ...result, ...remaining, final:true };
  }
  async runOnce(options = {}) {
    this.running=true;
    Object.assign(this.status, { pushed:0, merged:0, currentTable:null, startedAt:new Date().toISOString() });
    this.publishFailureStatus(options.branchId);
    const workerOptions = { ...options, onProgress: progress => {
      const field = progress.direction === "push" ? "pushed" : "merged";
      this.status[field] += Number(progress.completed) || 0;
      this.status.currentTable = progress.table;
      this.status.lastProgressAt = new Date().toISOString();
      // A bounded local activity view is enough to answer which tables moved
      // without querying the cloud audit log on every status refresh.
      const table=String(progress.table??"").trim();
      if(table) this.status.recentTables.unshift({table,direction:progress.direction,rows:Number(progress.completed)||0,at:this.status.lastProgressAt});
      this.status.recentTables.length=Math.min(this.status.recentTables.length,50);
      this.publish(this.snapshot());
    } };
    let result;let failedDirection="push";
    try {
      this.status.phase="pushing"; this.publish(this.snapshot());
      let pushError = null; let pushed = {};
      try { if (!options.pullOnly) { pushed=await this.pushWorker.run(workerOptions); this.status.lastPushAt=new Date().toISOString();
        if(pushed?.historyUploadHeld)(this.historyHolds??=new Map()).set(String(options.branchId??''),pushed.historyUploadHeld);
        else (this.historyHolds??=new Map()).delete(String(options.branchId??''));
        this.clearSuccessfulFailures(options,"push",pushed);this.publishFailureStatus(options.branchId); } }
      catch(error) { pushError=error;this.rememberFailure(error,options,"push"); }
      if(pushError?.code==="ECHANGEGAP" && ["shifts","shift_cash_counts","shift_reconciliations","shift_close_events","shift_notifications","shift_variance_alerts"].includes(pushError.table) && this.recoverHeldStatuses) {
        // A verified terminal-state adoption is independent of full shift
        // recovery. Preserve the original guard, feed cursor and failure status.
        try { this.status.heldStatusRecovery=await this.recoverHeldStatuses({branchId:options.branchId}); }
        catch { this.status.heldStatusRecovery={updated:0,reviewRequired:0,deferred:true,code:"EHELD_STATUS_RETRY"}; }
      }
      if (pushError && (pushError.code === "ECHANGEGAP" || (!authorHold(pushError)&&[401,403].includes(Number(pushError.status))))) throw pushError;
      let pulled = {};
      if (!options.pushOnly) {
        failedDirection="pull";
        this.status.phase="pulling"; this.status.currentTable=null; this.publish(this.snapshot());
        pulled=(await this.pullWorker.run(workerOptions)) ?? {}; this.status.lastPullAt=new Date().toISOString(); this.status.conflicts=Number(pulled.conflicts??this.status.conflicts); this.status.membershipDeferred=Boolean(pulled.membershipDeferred); this.status.membershipMirrored=Number(pulled.membershipMirrored??0);
        this.clearSuccessfulFailures(options,"pull",pulled);this.publishFailureStatus(options.branchId);
      }
      this.status.pushed=Number(pushed.pushed??this.status.pushed); this.status.merged=Number(pulled.merged??this.status.merged);
      if (pushError) { failedDirection="push"; throw pushError; }
      this.status.phase="idle"; this.publishFailureStatus(options.branchId);
      result={ ok:true,...pushed,...pulled,historyHoldOnly:Boolean(this.status.historyUploadHeld&&![...this.unresolved().values()].some(failure=>failure.branchId===String(options.branchId??''))) };
    } catch(error) {
      const failedTable=String(error?.table??error?.detail??"").trim();
      this.status.phase="idle";
      const message=this.rememberFailure(error,options,failedDirection);
      const code=String(error?.code??"ESYNC");
      result=retainDiagnostic({ ok:false,code,error:message,table:failedTable||null },error);
    } finally {
      this.running=false;
      this.status.currentTable=null;
      await this.refresh(options.branchId);
      this.publish(this.snapshot());
    }
    return retainDiagnostic({ ...result, ...this.snapshot() }, result);
  }
  pause(){this.paused=true;this.publish(this.snapshot());return this.snapshot();}
  resume(){this.paused=false;this.publish(this.snapshot());return this.snapshot();}
  recordVerification(report){this.status.lastComparedAt=report.comparedAt??new Date().toISOString();this.status.lastVerifiedAt=report.verified?this.status.lastComparedAt:this.status.lastVerifiedAt;this.status.tables=report.tables??[];this.publish(this.snapshot());return this.snapshot();}
  recordHistoryRecovery(state){this.status.historyRecovery={...state};this.publish(this.snapshot());return this.snapshot();}
}
module.exports = { SyncCoordinator };
