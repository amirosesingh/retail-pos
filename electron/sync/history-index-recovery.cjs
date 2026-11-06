// Main-owned ID-membership recovery. This never acknowledges local uploads,
// advances a feed/CT checkpoint, or replaces an existing immutable history row.
const {createHash,randomUUID}=require('node:crypto');
const {PROJECTION,MAX_INDEX,MAX_ROWS,normalizeIndex,normalizeRows}=require('./history-index-protocol.cjs');
const {recordId}=require('./uuid-fields.cjs');
const {binding}=require('../verified-activation.cjs');
const {reportActivity}=require('../db/startup-activity.cjs');
const {legacyEvidence}=require('./history-index-legacy.cjs');
const TYPE='history_index_recovery_v1',UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail=(message,code='EHISTORY_INDEX_PROGRESS')=>{throw Object.assign(new Error(message),{code,table:'change_history'});};
const integer=value=>{const text=String(value??'');if(!/^(0|[1-9][0-9]*)$/.test(text)||text.length>19||BigInt(text)>9223372036854775807n)fail('Saved history membership progress is invalid.');return text;};
const safe=value=>{const n=Number(integer(value));if(!Number.isSafeInteger(n))fail('Saved history recovery totals exceed their supported range.');return n;};
function cursor(value){
 let p;try{p=typeof value==='string'&&value.length<=512?JSON.parse(value):null;}catch{fail('Saved history recovery progress is invalid.');}
 if(!p||Object.keys(p).sort().join(',')!=='a,m,n,s,u,v'||p.v!==1||!['begin','page','finish','done'].includes(p.s)||
  ![p.a,p.u].every(x=>x===null||typeof x==='string'&&UUID.test(x))||typeof p.n!=='string'||!(p.m===null||typeof p.m==='boolean')||
  p.a!==null&&(p.u===null||p.a>p.u)||p.s==='begin'&&(p.a!==null||p.u!==null||p.m!==null||p.n!=='0')||
  p.s!=='begin'&&p.m===null||p.u===null&&(p.a!==null||p.n!=='0'||p.s==='page')||
  (p.n==='0')!==(p.a===null))fail('Saved history recovery progress is invalid.');
 integer(p.n);return p;
}
const initial=()=>({v:1,s:'begin',u:null,a:null,n:'0',m:null});
const encode=p=>{const text=JSON.stringify(p);cursor(text);return text;};
const token=job=>JSON.stringify([job.last_committed_cursor,String(job.completed_rows),String(job.completed_bytes),Number(job.batch_number)]);
function decode(job,scope){
 if(!job||job.job_type!==TYPE||job.organization_id!==scope.organizationId||job.organization_name!==scope.hash||
  recordId(job.branch_id)!==scope.branchId||recordId(job.terminal_id)!==scope.terminalId||job.current_table!=='change_history')
  fail('Saved history recovery belongs to a different database or terminal.','EHISTORY_INDEX_SCOPE');
 safe(job.completed_rows);safe(job.completed_bytes);safe(job.batch_number);return cursor(job.last_committed_cursor);
}
function retryDelay(job,terminalId){
 const exponent=Math.min(6,safe(job.retry_count??0)),jitter=parseInt(createHash('sha256').update(terminalId+':'+exponent).digest('hex').slice(0,4),16)%3000;
 return Math.min(300000,5000*2**exponent)+jitter;
}
// Existing coordinator eligibility only, not a separate timer/network loop.
// Stable terminal jitter staggers fleet membership scans; payloads remain absent-only.
function membershipInterval(terminalId){return 15*60*1000+parseInt(createHash('sha256').update('history-membership:'+terminalId).digest('hex').slice(0,8),16)%60000;}
function safeMessage(code){
 if(code==='ELOCAL_PENDING_UNVERIFIED')return'Retained local history work needs verification before this page can advance. Existing records remain intact.';
 if(/^(?:HTTP_(?:429|500|502|503|504)|EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EOFFLINE)$/.test(code))return'The central history service did not answer. Recovery will retry from its saved progress.';
 return'History recovery could not be verified. Existing records and committed progress remain intact.';
}
class HistoryIndexStore {
 constructor(connectionManager){this.connectionManager=connectionManager;}
 request(tx=null){return tx?new(this.connectionManager.sql().Request)(tx):this.connectionManager.pool.request();}
 async guid(tx=null){
  const result=await this.request(tx).query('SELECT LOWER(CONVERT(nvarchar(36),database_guid)) database_guid FROM sys.database_recovery_status WHERE database_id=DB_ID();');
  const rows=result.recordset??[];if(rows.length!==1||typeof rows[0].database_guid!=='string'||!UUID.test(rows[0].database_guid))fail('The local database identity cannot be verified.','EHISTORY_INDEX_SCOPE');
  return rows[0].database_guid;
 }
 async present(ids,tx=null){
  if(ids.length>MAX_INDEX||ids.some(id=>!UUID.test(id))||new Set(ids).size!==ids.length)fail('The requested history index is invalid.');
  if(!ids.length)return new Set();
  const result=await this.request(tx).input('ids',JSON.stringify(ids)).query(`SELECT LOWER(CONVERT(nvarchar(36),h.id)) id FROM dbo.change_history h ${tx?'WITH(UPDLOCK,HOLDLOCK)':''}
    INNER JOIN OPENJSON(@ids) names ON h.id=CONVERT(uniqueidentifier,names.[value]);`);
  const rows=result.recordset??[],set=new Set(rows.map(row=>row.id));
  if(set.size!==rows.length||[...set].some(id=>!ids.includes(id)))fail('The local history membership response is invalid.');
  return set;
 }
 async pending(tx){
  // Lock pending metadata as well as absent PK ranges. An unknown/overflowing
  // key cannot be silently classified as safe to replace.
  const result=await this.request(tx).query(`SELECT TOP(1001) entity_id FROM dbo.sync_change_journal WITH(UPDLOCK,HOLDLOCK)
    WHERE entity_type=N'change_history' AND acknowledged_at IS NULL ORDER BY change_id;`);
  const rows=result.recordset??[];if(rows.length>1000)fail('Retained local history uploads need review before recovery can continue.','ELOCAL_PENDING_UNVERIFIED');
  const ids=new Set();for(const row of rows){let key;try{key=JSON.parse(row.entity_id);}catch{fail('A retained history upload key cannot be verified.','ELOCAL_PENDING_UNVERIFIED');}
   if(!key||Object.keys(key).join(',')!=='id'||typeof key.id!=='string'||!UUID.test(recordId(key.id)))fail('A retained history upload key cannot be verified.','ELOCAL_PENDING_UNVERIFIED');ids.add(recordId(key.id));}
  return ids;
 }
 async insert(tx,row){
  const names=['id','organization_id','entity_type','entity_id','action','old_value','new_value','revision','scope_type','scope_id','changed_by','source_application','device_id','terminal_id','server_timestamp'];
  const request=this.request(tx);for(const name of names)request.input(name,name==='old_value'||name==='new_value'?row[name+'_json']:row[name]);
  // Values are already bounded/losslessly validated by the Main protocol.
  await request.query(`WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544) INSERT dbo.change_history(${names.map(x=>'['+x+']').join(',')})
    VALUES(CONVERT(uniqueidentifier,@id),@organization_id,@entity_type,@entity_id,@action,@old_value,@new_value,CONVERT(bigint,@revision),@scope_type,@scope_id,@changed_by,@source_application,@device_id,@terminal_id,CONVERT(datetimeoffset(7),@server_timestamp,127));`);
 }
 async transaction(handler){
  // msnodesqlv8 Transaction.begin sets isolation on the pooled session and
  // does not restore it. Pin one public Request connection instead; each
  // participating data read already takes explicit UPDLOCK,HOLDLOCK ranges.
  const sql=this.connectionManager.sql(),pool=this.connectionManager.pool;
  const lease=await new Promise((resolve,reject)=>pool.acquire(new sql.Request(pool),(error,connection,config)=>error?reject(error):resolve({connection,config})));
  let active=false,beginAttempted=false,discard=false;
  const tx={config:lease.config,connected:true,
   acquire(_request,callback){if(active)return queueMicrotask(()=>callback(Object.assign(new Error('A history transaction request is already active.'),{code:'EREQINPROG'})));active=true;queueMicrotask(()=>callback(null,lease.connection,lease.config));},
   release(connection){if(connection===lease.connection)active=false;}};
  const query=text=>this.request(tx).query(text);
  try{
   // No FROM: an inherited IMPLICIT_TRANSACTIONS setting must not start a
   // transaction merely while checking whether this helper can own one.
   const guard=(await query('SELECT @@TRANCOUNT transactions,@@OPTIONS options;')).recordset?.[0];
   if(!guard||Number(guard.transactions)!==0||(Number(guard.options)&2)!==0)fail('The history page cannot own this SQL session transaction.','EHISTORY_INDEX_TRANSACTION');
   beginAttempted=true;await query('BEGIN TRANSACTION;');
   const value=await handler(tx);
   const committed=(await query("IF @@TRANCOUNT<>1 THROW 51000,'History page transaction ownership changed.',1;COMMIT TRANSACTION;SELECT @@TRANCOUNT transactions;")).recordset?.[0];
   if(Number(committed?.transactions)!==0)fail('The history page commit could not be verified.','EHISTORY_INDEX_TRANSACTION');
   beginAttempted=false;return value;
  }finally{
   if(beginAttempted){try{const restored=(await query('IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;SELECT @@TRANCOUNT transactions;')).recordset?.[0];if(Number(restored?.transactions)!==0)discard=true;}catch{discard=true;}}
   try{if(discard){lease.connection.hasError=true;await new Promise(resolve=>lease.connection.close(()=>resolve()));}}
   finally{pool.release(lease.connection);}
  }
 }
}
class HistoryIndexRecovery {
 constructor({connectionManager,cloud,jobRepository,jobManager,store=null,now=()=>Date.now(),onActivity=()=>{},onApplied=()=>{},executionProof=()=>false}){
  Object.assign(this,{connectionManager,cloud,jobRepository,jobManager,now,onActivity,onApplied,executionProof});this.store=store??new HistoryIndexStore(connectionManager);
 }
 source(branchId){
  const source=this.cloud.requestContext?.(false),terminalId=recordId(this.cloud.terminalId?.()),branch=recordId(String(branchId??''));
  const registered=binding(this.cloud.terminalStore?.read?.());
  if(!source||typeof source.fingerprint!=='string'||!/^[0-9a-f]{64}$/.test(source.fingerprint)||!source.pool||source.pool!==this.connectionManager.pool||
   !terminalId||!UUID.test(terminalId)||!branch||branch.length>128||!registered||registered.mode==='operations'&&registered.branchId!==branch)
   fail('The registered history recovery scope cannot be verified.','EHISTORY_INDEX_SCOPE');
  return{pool:source.pool,fingerprint:source.fingerprint,organizationId:'default',branchId:branch,terminalId};
 }
 same(scope){try{if(scope.invalidated)return false;const current=this.source(scope.branchId);return current.pool===scope.pool&&current.fingerprint===scope.fingerprint&&current.terminalId===scope.terminalId;}catch{return false;}}
 assert(scope){if(!this.same(scope))fail('The database or terminal changed during history recovery.','ESYNC_REQUEST_CONTEXT_CHANGED');}
 async capture(branchId,scopeTag=''){
  if(scopeTag!==''&&!/^[0-9a-f]{64}$/.test(scopeTag))fail('The authorized history scope is invalid.','EHISTORY_INDEX_SCOPE');
  const scope={...this.source(branchId),databaseGuid:await this.store.guid()};this.assert(scope);
  const legacy=await this.legacy(scope);
  return{...scope,legacyHash:legacy.hash,legacyIds:legacy.ids,hash:'hi1:'+createHash('sha256').update(JSON.stringify([TYPE,PROJECTION,scope.fingerprint,scope.databaseGuid,scopeTag,legacy.hash])).digest('hex')};
 }
 async legacy(scope,tx=null){
  this.assert(scope);const rows=await this.jobRepository.legacyHistory?.(scope.branchId,scope.terminalId,tx)??[];this.assert(scope);
  const current=this.jobManager.running,own=!current||current.job_type===TYPE&&recordId(current.job_id)===recordId(scope.indexJobId);
  const ownsExecution=rows.length&&own?await this.executionProof({jobId:scope.indexJobId??null,source:scope,requestParent:tx}):false;this.assert(scope);
  return legacyEvidence({rows,cloud:this.cloud,branchId:scope.branchId,terminalId:scope.terminalId,ownsExecution});
 }
 async current(branchId,scopeTag=''){
  const scope=await this.capture(branchId,scopeTag),job=await this.jobRepository.recovery(TYPE,scope.branchId,scope.terminalId);await this.check(scope);
  if(!job||job.organization_name!==scope.hash)return null;decode(job,scope);scope.indexJobId=job.job_id;return{job,scope};
 }
 async check(scope,tx=null){this.assert(scope);if(await this.store.guid(tx)!==scope.databaseGuid){scope.invalidated=true;fail('The local database changed during history recovery.','EHISTORY_INDEX_SCOPE');}
  const legacy=await this.legacy(scope,tx);if(legacy.hash!==scope.legacyHash){scope.invalidated=true;fail('Retained history job metadata changed during recovery.','EHISTORY_INDEX_SCOPE');}this.assert(scope);}
 async commit(scope,job,context,next,handler=async()=>({})){const prior=token(job);let applied=0;
  await this.store.transaction(async tx=>{
   await this.check(scope,tx);const saved=await this.jobRepository.get(job.job_id,tx);decode(saved,scope);
   if(token(saved)!==prior)fail('Another history recovery step advanced this job.','EHISTORY_INDEX_CONFLICT');
   const extra=await handler(tx,saved);applied=extra.completed_rows===undefined?0:safe(extra.completed_rows)-safe(saved.completed_rows);await this.check(scope,tx);
   await this.jobRepository.checkpoint(job.job_id,{last_committed_cursor:encode(next),phase:next.s==='done'?'membership_complete':next.s==='finish'?'confirming_membership':'history_index',
    error_code:null,error_message:null,next_retry_at:null,retry_count:0,...extra},tx);
  });
  await this.check(scope);
  if(applied>0)reportActivity(this.onApplied,{branchId:scope.branchId,table:'change_history',rows:applied});
  Object.assign(job,await this.jobRepository.get(job.job_id));decode(job,scope);this.assert(scope);
  Object.assign(context.job,job);this.jobManager.emit(context.job);
 }
 async quantum(scope,job,context){
  let progress=decode(job,scope);if(progress.s==='done')return{completed:true};
  const wireScope={organizationId:scope.organizationId,branchId:scope.branchId,terminalId:scope.terminalId,...(progress.m===null?{}:{keepCommerce:progress.m})};
  reportActivity(this.onActivity,{phase:'checking',table:'change_history',processedRows:safe(job.completed_rows)});await this.check(scope);
  if(progress.s==='finish'){
   const request={...wireScope,action:'finish',upperId:progress.u},result=normalizeIndex(await this.cloud.historyIndex(request),wireScope,request);await this.check(scope);
   if(BigInt(result.range_count)<BigInt(progress.n))fail('Immutable history membership changed unexpectedly.','EHISTORY_INDEX_INVARIANT');
   if(result.range_count!==progress.n){await this.commit(scope,job,context,initial());return{pending:true};}
   await this.commit(scope,job,context,{...progress,s:'done'});return{completed:true};
  }
  const request={...wireScope,action:progress.s==='begin'?'begin':'page',afterId:progress.a,upperId:progress.u};
  const page=normalizeIndex(await this.cloud.historyIndex(request),wireScope,request);await this.check(scope);
  if(progress.s==='begin'){
   progress={...progress,s:page.ids.length?'page':'finish',u:page.upper_id,m:page.keep_commerce};await this.commit(scope,job,context,progress);
   if(!page.ids.length)return{pending:true};
  }
  const present=await this.store.present(page.ids);await this.check(scope);const missing=page.ids.filter(id=>!present.has(id)).slice(0,MAX_ROWS);
  let rows=[];
  if(missing.length){
   reportActivity(this.onActivity,{phase:'downloading',table:'change_history',processedRows:safe(job.completed_rows)});
   rows=normalizeRows(await this.cloud.historyMissingRows({...wireScope,keepCommerce:progress.m,ids:missing}),{...wireScope,keepCommerce:progress.m},missing).rows;
   await this.check(scope);
  }
  const next={...progress};
  await this.commit(scope,job,context,next,async(tx,saved)=>{
   const current=await this.store.present(page.ids,tx),pending=await this.store.pending(tx);let inserted=0,bytes=0;
   for(const row of rows)if(!current.has(row.id)){
    if(pending.has(row.id))fail('A missing history fact has retained local work; its upload remains pending.','ELOCAL_PENDING_UNVERIFIED');
    await this.store.insert(tx,row);current.add(row.id);inserted++;bytes+=Buffer.byteLength(JSON.stringify(row),'utf8');
   }
   let resolved=0;for(const id of page.ids){if(!current.has(id))break;resolved++;}
   if(page.ids.length&&!resolved)fail('No history membership progress could be committed.','ELOCAL_PENDING_UNVERIFIED');
   if(resolved){next.a=page.ids[resolved-1];next.n=integer(BigInt(progress.n)+BigInt(resolved));}
   if(resolved===page.ids.length&&page.complete)next.s='finish';
   return{completed_rows:safe(saved.completed_rows)+inserted,completed_bytes:safe(saved.completed_bytes)+bytes,batch_number:safe(saved.batch_number)+1};
  });
  return{pending:true};
 }
 async step({branchId,force=false,scopeTag=''}={}){
  if(this.jobManager.paused)return{pending:true,paused:true};
  if(this.jobManager.running)return{pending:true,busy:true};
  const scope=await this.capture(branchId,scopeTag);let job=await this.jobRepository.recovery(TYPE,scope.branchId,scope.terminalId);await this.check(scope);
  if(job&&job.organization_name===scope.hash){
   const p=decode(job,scope),finished=Date.parse(job.finished_at);
   if(job.status==='completed'&&p.s==='done'&&!force&&Number.isFinite(finished)&&this.now()-finished>=0&&this.now()-finished<membershipInterval(scope.terminalId))
    return{completed:true,membershipOnly:true,job};
   if(job.status==='completed'&&p.s==='done')job=null;
   else if(job.next_retry_at&&Date.parse(job.next_retry_at)>this.now())return{pending:true,retrying:true,job};
  }else job=null; // Preserve another bound job; never relabel its evidence.
  if(await this.jobRepository.hasOtherActiveJobs?.(job?.job_id??null,{ignoreHistoryIndex:true,allowedLegacyIds:scope.legacyIds})){this.assert(scope);return{pending:true,busy:true};}
  if(!job){
   job={job_id:randomUUID(),job_type:TYPE,status:'queued',organization_id:scope.organizationId,organization_name:scope.hash,branch_id:scope.branchId,branch_name:null,branch_code:null,terminal_id:scope.terminalId,terminal_name:null,
    phase:'history_index',current_table:'change_history',dependency_index:0,last_committed_cursor:encode(initial()),completed_rows:0,estimated_total_rows:null,completed_bytes:0,batch_number:0,batch_size:MAX_INDEX,retry_count:0,next_retry_at:null};
   this.assert(scope);await this.jobRepository.create(job);this.assert(scope);
  }
  scope.indexJobId=job.job_id;
  const result=await this.jobManager.runStep(TYPE,async context=>{
   try{return await this.quantum(scope,job,context);}catch(error){
    if(!this.same(scope))throw error;const rawCode=String(error?.code??''),code=/^[A-Z][A-Z0-9_]{0,63}$/.test(rawCode)?rawCode:'EHISTORY_INDEX_RECOVERY',status=Number(error?.status??error?.statusCode??0);
    if([401,403].includes(status)||/AUTH|PERMISSION|PRIVILEGE|SCOPE|CONTEXT_CHANGED/.test(code))throw error;
    const retry=safe(job.retry_count??0)+1;
    await context.checkpoint({error_code:code,error_message:safeMessage(code),retry_count:retry,next_retry_at:new Date(this.now()+retryDelay(job,scope.terminalId)),status:'retrying'});
    return{pending:true,status:'retrying'};
   }
  },job,{}, {checkpointAllowed:()=>this.same(scope)});
  this.assert(scope);return{...result,membershipOnly:true};
 }
}
module.exports={TYPE,initial,cursor,encode,decode,retryDelay,membershipInterval,HistoryIndexStore,HistoryIndexRecovery};
