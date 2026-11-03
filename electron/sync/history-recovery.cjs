const TYPE="history_gap_recovery_v1";
function failure(message,code="EHISTORY_RECOVERY"){return Object.assign(new Error(message),{code});}
function version(value){const text=String(value??"");if(!/^(0|[1-9][0-9]*)$/.test(text)||BigInt(text)>9223372036854775807n||typeof value==="number"&&!Number.isSafeInteger(value))throw failure("Invalid history recovery version.");return text;}
function scope(cloud,branchId,historyDays){
  const terminalId=String(cloud.terminalId?.()??"").trim();
  let origin;try{const url=new URL(cloud.backendUrl());if(url.username||url.password)throw Error();origin=url.origin+url.pathname.replace(/\/+$/,"");}catch{throw failure("History recovery requires a valid backend identity.");}
  if(origin.length>256)throw failure("History recovery backend identity exceeds local metadata capacity.");
  if(!terminalId||!branchId||!Number.isSafeInteger(historyDays)||historyDays<1)throw failure("History recovery requires its registered terminal and branch.");
  return{protocol:TYPE,branchId:String(branchId),terminalId,origin,table:"change_history",historyDays};
}
// Recovery-only job metadata: phase carries the original CT baseline and completion
// marker; dependency_index carries historyDays; organization_name carries backend
// identity. The existing 512-character cursor column remains fully opaque.
function phase(state){return `hr:${state.finalized?"final":state.snapshotComplete?"done":"page"}:${version(state.baseline)}`;}
function decode(job,expected){
  const match=/^hr:(page|done|final):(0|[1-9][0-9]*)$/.exec(job?.phase??"");
  if(!job||!match||job.job_type!==TYPE||job.branch_id!==expected.branchId||job.terminal_id!==expected.terminalId||job.organization_id!=="default"||job.organization_name!==expected.origin||Number(job.dependency_index)!==expected.historyDays||job.current_table!=="change_history")throw failure("Saved history recovery belongs to a different scope or has invalid progress.");
  const state={...expected,baseline:version(match[2]),cursor:job.last_committed_cursor??null,snapshotComplete:match[1]!=="page",finalized:match[1]==="final"};
  if(!(state.cursor===null||typeof state.cursor==="string"&&state.cursor.length>0&&state.cursor.length<=512)||state.snapshotComplete&&state.cursor!==null||!Number.isSafeInteger(Number(job.completed_rows))||Number(job.completed_rows)<0||!state.snapshotComplete&&state.cursor===null&&Number(job.completed_rows)>0)throw failure("Saved history recovery progress is inconsistent.");
  return state;
}
async function retained(connectionManager,transaction,baseline=null){
  const request=transaction?new(connectionManager.sql().Request)(transaction):connectionManager.pool.request();
  const result=await request.query("SELECT CHANGE_TRACKING_CURRENT_VERSION() current_version, CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID('dbo.change_history')) min_valid_version;");
  const row=result.recordset?.[0]??{};const current=version(row.current_version),minimum=version(row.min_valid_version);
  if(baseline!==null&&(BigInt(baseline)<BigInt(minimum)||BigInt(baseline)>BigInt(current)))throw failure("Saved history recovery baseline has expired; recovery requires review.","EHISTORY_BASELINE_EXPIRED");
  return current;
}
async function transaction(connectionManager,handler){const sql=connectionManager.sql(),tx=new sql.Transaction(connectionManager.pool);await tx.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);try{const value=await handler(tx);await tx.commit();return value;}catch(error){await Promise.resolve(tx.rollback()).catch(()=>undefined);throw error;}}
async function recover(lifecycle,branchId,historyDays,refreshTable){
  const {cloud,connectionManager,jobRepository,jobManager,checkpoints}=lifecycle;
  if(!lifecycle.reader?.unacknowledged)throw failure("Local pending history verification is unavailable.","ELOCAL_PENDING_UNVERIFIED");
  if(jobManager.running)throw failure("Another local data job is running.","EJOB_BUSY");
  const expected=scope(cloud,branchId,historyDays);
  let job=await jobRepository.recovery(TYPE,branchId,expected.terminalId);
  // A finalized earlier recovery belongs to its original scope and must not
  // prevent a fresh gap after an operator changes history depth or backend.
  let state=job?decode(job,{...expected,origin:job.organization_name,historyDays:Number(job.dependency_index)}):null;
  if(state?.finalized){job=null;state=null;}
  else if(job)state=decode(job,expected);
  if(!job){
    state={...expected,baseline:await retained(connectionManager,null),cursor:null,snapshotComplete:false,finalized:false};
    const {randomUUID}=require("node:crypto");
    job={job_id:randomUUID(),job_type:TYPE,status:"queued",organization_id:"default",organization_name:expected.origin,branch_name:null,branch_code:null,terminal_name:null,estimated_total_rows:null,next_retry_at:null,branch_id:String(branchId),terminal_id:expected.terminalId,phase:phase(state),current_table:"change_history",dependency_index:historyDays,last_committed_cursor:null,completed_rows:0,batch_number:0,batch_size:100,completed_bytes:0,retry_count:0};
    await jobRepository.create(job);
  }
  await retained(connectionManager,null,state.baseline);
  if(lifecycle.releaseHistoryCache)await lifecycle.releaseHistoryCache(branchId,historyDays,job);
  const jobId=job.job_id;
  await jobManager.run(TYPE,async context=>{
    // Always reload committed storage, never JobManager's mutable checkpoint object.
    job=await jobRepository.get(jobId);state=decode(job,expected);
    if(!state.snapshotComplete){
      let serialized=JSON.stringify([job.phase,job.last_committed_cursor,job.completed_rows]),pendingPatch;
      await refreshTable({registry:lifecycle.registry,reader:lifecycle.reader,cloud,connectionManager,branchId,historyDays,tableName:"change_history",diagnosticOrigin:"gap_recovery",progress:{
        cursor:state.cursor,completed:Number(job.completed_rows),
        beforeApply:async tx=>{if(JSON.stringify(scope(cloud,branchId,historyDays))!==JSON.stringify(expected))throw failure("History recovery scope changed.");const saved=await jobRepository.get(jobId,tx);decode(saved,expected);if(JSON.stringify([saved.phase,saved.last_committed_cursor,saved.completed_rows])!==serialized)throw failure("History recovery was advanced by another process.","EHISTORY_CONFLICT");await retained(connectionManager,tx,state.baseline);},
        save:async(tx,page)=>{const next={...state,cursor:page.cursor,snapshotComplete:page.cursor===null};pendingPatch={last_committed_cursor:next.cursor,completed_rows:page.completed,phase:phase(next)};await jobRepository.checkpoint(jobId,pendingPatch,tx);},
        committed:async()=>{job=await jobRepository.get(jobId);state=decode(job,expected);serialized=JSON.stringify([job.phase,job.last_committed_cursor,job.completed_rows]);Object.assign(context.job,job);jobManager.emit(context.job);}
      }});
    }
    await transaction(connectionManager,async tx=>{
      if(JSON.stringify(scope(cloud,branchId,historyDays))!==JSON.stringify(expected))throw failure("History recovery scope changed.");
      const saved=await jobRepository.get(jobId,tx),complete=decode(saved,expected);
      if(!complete.snapshotComplete)throw failure("History snapshot is incomplete.");
      await retained(connectionManager,tx,complete.baseline);
      await checkpoints.advanceRecovery(branchId,"change_history",complete.baseline,tx);
      await jobRepository.checkpoint(jobId,{last_committed_cursor:null,phase:phase({...complete,finalized:true}),status:"completed",finished_at:new Date()},tx);
    });
  },job);
  job=await jobRepository.get(jobId);state=decode(job,expected);
  if(!state.finalized)throw failure("History recovery was not finalized.");
  return{table:"change_history",completed:Number(job.completed_rows),currentVersion:Number(state.baseline)<=Number.MAX_SAFE_INTEGER?Number(state.baseline):state.baseline};
}
async function cleanup(lifecycle,branchId,historyDays){
  if(lifecycle.jobManager.running)return;
  const expected=scope(lifecycle.cloud,branchId,historyDays),job=await lifecycle.jobRepository.recovery(TYPE,branchId,expected.terminalId);
  if(!job||job.status==="completed")return;
  const savedScope={...expected,origin:job.organization_name,historyDays:Number(job.dependency_index)};
  const state=decode(job,savedScope);if(!state.finalized)return;
  await transaction(lifecycle.connectionManager,async tx=>{
    const saved=await lifecycle.jobRepository.get(job.job_id,tx),committed=decode(saved,savedScope);if(!committed.finalized)return;
    const checkpoint=await lifecycle.checkpoints.get(branchId,"change_history","push",tx);
    if(!checkpoint||BigInt(version(checkpoint.change_tracking_version))<BigInt(committed.baseline))throw failure("Finalized history recovery checkpoint is missing.");
    await lifecycle.jobRepository.checkpoint(job.job_id,{status:"completed",phase:phase(committed),finished_at:new Date(),error_code:null,error_message:null},tx);
  });
}
module.exports={TYPE,scope,decode,version,retained,recover,cleanup};
