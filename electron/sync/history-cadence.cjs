// Scheduling state only: the existing Main timer and coordinator own execution.
class HistoryCadence {
 constructor({now=Date.now,jitter=()=>Math.floor(Math.random()*250)}={}){this.now=now;this.jitter=jitter;this.revision=0;this.completedRevision=-1;this.coreDue=0;this.historyDue=Infinity;this.historyPending=false;this.lastCoreOk=false;}
 requestCore(){this.revision++;}
 beginCore(){return this.revision;}
 finishCore(revision,{ok,nextMs}){this.completedRevision=revision;this.lastCoreOk=ok===true;this.coreDue=this.now()+Math.max(250,Number(nextMs)||60000);}
 historyOutcome(result){
  if(result?.completed===true||result?.status==='completed'){this.historyPending=false;this.historyDue=Infinity;return;}
  // An unknown/partial result is never successful completion evidence.
  this.historyPending=true;const due=Date.parse(result?.next_retry_at??result?.job?.next_retry_at);
  const delay=result?.paused===true?60000:Number.isFinite(due)?Math.max(500,Math.min(300000,due-this.now())):1000+Math.max(0,Math.min(250,Number(this.jitter())||0));
  this.historyDue=this.now()+delay;
 }
 historyFailure(){this.historyPending=true;this.historyDue=this.now()+60000;this.lastCoreOk=false;this.coreDue=Math.min(this.coreDue,this.now()+60000);}
 decision(){if(this.revision>this.completedRevision||this.now()>=this.coreDue)return'core';if(this.lastCoreOk&&this.historyPending&&this.now()>=this.historyDue)return'history';return'wait';}
 nextDelay(){if(this.revision>this.completedRevision)return 250;return Math.max(250,Math.min(this.coreDue,this.lastCoreOk?this.historyDue:Infinity)-this.now());}
}
module.exports={HistoryCadence};
