class SyncCoordinator {
  constructor({ pushWorker, pullWorker, publish = () => {} }) { this.pushWorker=pushWorker; this.pullWorker=pullWorker; this.publish=publish; this.running=false; this.activeRun=null; this.paused=false; this.status={ phase:"idle", pending:0, failed:0, conflicts:0, lastPushAt:null, lastPullAt:null, lastError:null, lastComparedAt:null, lastVerifiedAt:null, tables:[], credentialsInvalid:false }; }
  snapshot() { return { ...this.status, running:this.running, paused:this.paused }; }
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
    if (this.activeRun) return this.activeRun;
    if (this.paused) return { ok:false, ...this.snapshot(), paused:true, code:"ESYNC_PAUSED", error:"Synchronization is paused." };
    this.activeRun=this.runOnce(options);
    try{return await this.activeRun;}finally{this.activeRun=null;}
  }
  async runOnce(options = {}) {
    this.running=true;
    let result;
    try {
      this.status.phase="pushing"; this.publish(this.snapshot());
      const pushed=await this.pushWorker.run(options); this.status.lastPushAt=new Date().toISOString();
      this.status.phase="pulling"; this.publish(this.snapshot());
      const pulled=await this.pullWorker.run(options); this.status.lastPullAt=new Date().toISOString(); this.status.conflicts=Number(pulled.conflicts??this.status.conflicts);
      this.status.phase="idle"; this.status.lastError=null; this.status.credentialsInvalid=false;
      result={ ok:true,...pushed,...pulled };
    } catch(error) {
      this.status.phase="idle"; this.status.lastError=String(error?.message??error);
      const code=String(error?.code??"ESYNC");
      const status=Number(error?.status??error?.statusCode??0);
      this.status.credentialsInvalid=status===401||status===403||code==="HTTP_401"||code==="HTTP_403";
      result={ ok:false,code,error:this.status.lastError };
    } finally {
      this.running=false;
      await this.refresh(options.branchId);
      this.publish(this.snapshot());
    }
    return { ...result, ...this.snapshot() };
  }
  pause(){this.paused=true;this.publish(this.snapshot());return this.snapshot();}
  resume(){this.paused=false;this.publish(this.snapshot());return this.snapshot();}
  recordVerification(report){this.status.lastComparedAt=report.comparedAt??new Date().toISOString();this.status.lastVerifiedAt=report.verified?this.status.lastComparedAt:this.status.lastVerifiedAt;this.status.tables=report.tables??[];this.publish(this.snapshot());return this.snapshot();}
}
module.exports = { SyncCoordinator };
