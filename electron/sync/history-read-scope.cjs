// Main-only history visibility. This is deliberately separate from upload/write
// predicates: retained local facts and pending uploads must never be discarded.
const {recordId}=require('./uuid-fields.cjs');
const {binding}=require('../verified-activation.cjs');
const POLICY='branch-history-v1';
const trusted=new WeakSet();
const policyWitnesses=new WeakMap();
const fail=()=>{throw Object.assign(new Error('The registered history read scope could not be verified. Existing work remains intact.'),{code:'EHISTORY_INDEX_SCOPE',table:'change_history'});};
function captureHistoryScope(cloud,connectionManager,branchId,organizationId='default'){
 const source=cloud?.requestContext?.(false),registration=binding(cloud?.terminalStore?.read?.());
 const branch=recordId(String(branchId??'')),terminalId=recordId(cloud?.terminalId?.());
 if(!registration||!source||!source.pool||source.pool!==connectionManager?.pool||!/^[0-9a-f]{64}$/.test(source.fingerprint)||
  !branch||branch.length>128||typeof terminalId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(terminalId)||terminalId!==registration.id||typeof organizationId!=='string'||!organizationId||organizationId.length>450||
  registration.mode==='operations'&&registration.branchId!==branch)fail();
 const authorityStamp=registration.mode==='management'?cloud.verifiedManagementHistoryScope?.(branch):null;
 if(registration.mode==='management'&&(typeof authorityStamp!=='string'||!/^[0-9a-f]{64}$/.test(authorityStamp)))fail();
 const result=Object.freeze({policy:POLICY,mode:registration.mode,historyScope:registration.mode==='management'?'company':'branch',
  authorityStamp,organizationId,branchId:branch,terminalId,pool:source.pool,fingerprint:source.fingerprint});
 trusted.add(result);return result;
}
function assertHistoryScope(scope,cloud,connectionManager){
 if(!scope||!trusted.has(scope))fail();
 let current;try{current=captureHistoryScope(cloud,connectionManager,scope.branchId,scope.organizationId);}catch{current=null;}
 if(!current||current.pool!==scope.pool||current.fingerprint!==scope.fingerprint||current.mode!==scope.mode||current.terminalId!==scope.terminalId||current.authorityStamp!==scope.authorityStamp)
  throw Object.assign(new Error('The database or terminal changed during history synchronization. Existing progress remains pending.'),{code:'ESYNC_REQUEST_CONTEXT_CHANGED',table:'change_history'});
}
function visibleHistoryRow(row,expected){
 return row&&row.organization_id===expected.organizationId&&(expected.historyScope==='company'||
  row.scope_type==='BRANCH'&&typeof row.scope_id==='string'&&recordId(row.scope_id)===recordId(expected.branchId));
}
function assertHistoryRows(rows,scope){
 if(!scope||!trusted.has(scope)||!Array.isArray(rows)||rows.some(row=>!visibleHistoryRow(row,scope)))fail();
}
function authorityContext(cloud,connectionManager){
 const source=cloud?.requestContext?.(true);
 if(!source||source.pool!==connectionManager?.pool||!/^[0-9a-f]{64}$/.test(source.fingerprint))fail();
 return source;
}
function assertHistoryPolicy(witness,cloud,connectionManager){
 const proof=policyWitnesses.get(witness);if(!proof||proof.cloud!==cloud||proof.connectionManager!==connectionManager)fail();
 try{
  assertHistoryScope(witness.scope,cloud,connectionManager);
  const current=authorityContext(cloud,connectionManager);
  if(current.pool!==proof.authority.pool||current.fingerprint!==proof.authority.fingerprint)
   throw Object.assign(new Error('The operator or privacy context changed during history synchronization. Its progress remains pending.'),{code:'ESYNC_REQUEST_CONTEXT_CHANGED',table:'change_history'});
 }catch(error){policyWitnesses.delete(witness);throw error;}
}
// One invocation/quantum may reuse policy admission, never the begin response's
// IDs, upper bound or counts. A renderer value cannot mint this private proof.
function createHistoryPolicyRun({cloud,connectionManager,branchId,organizationId='default'}){
 let scope=null,authority=null,witness=null,pending=null,sourceChanged=false,generation=0;
 const invalidate=()=>{generation++;if(witness)policyWitnesses.delete(witness);witness=null;};
 const same=()=>{
  if(sourceChanged)throw Object.assign(new Error('The history synchronization context changed. Start a fresh recovery invocation.'),{code:'ESYNC_REQUEST_CONTEXT_CHANGED',table:'change_history'});
  if(!scope)return;
  try{
   assertHistoryScope(scope,cloud,connectionManager);
   const current=authorityContext(cloud,connectionManager);
   if(current.pool!==authority.pool||current.fingerprint!==authority.fingerprint)throw Object.assign(new Error('The operator or privacy context changed during history synchronization. Its progress remains pending.'),{code:'ESYNC_REQUEST_CONTEXT_CHANGED',table:'change_history'});
  }catch(error){sourceChanged=true;invalidate();throw error;}
 };
 return Object.freeze({invalidate,async get(){
  same();if(witness){assertHistoryPolicy(witness,cloud,connectionManager);return witness;}if(pending)return pending;
  if(!scope){scope=captureHistoryScope(cloud,connectionManager,branchId,organizationId);authority=authorityContext(cloud,connectionManager);}
  const admittedGeneration=generation;pending=(async()=>{
   try{
    const expected={organizationId:scope.organizationId,branchId:scope.branchId,terminalId:scope.terminalId,historyScope:scope.historyScope},request={...expected,action:'begin'};
    const result=require('./history-index-protocol.cjs').normalizeIndex(await cloud.historyIndex(request),expected,request);same();
    if(generation!==admittedGeneration)fail();
    witness=Object.freeze({scope,keepCommerce:result.keep_commerce});policyWitnesses.set(witness,{cloud,connectionManager,authority});return witness;
   }catch(error){invalidate();throw error;}
  })();
  try{return await pending;}finally{pending=null;}
 }});
}
// SQL Server string equality otherwise pads trailing spaces and can ignore
// case. Only complete UUID identities have the existing case alias semantics.
const canonicalSql=value=>`CASE WHEN DATALENGTH(${value})=72 AND TRY_CONVERT(uniqueidentifier,${value}) IS NOT NULL THEN CONVERT(nvarchar(36),TRY_CONVERT(uniqueidentifier,${value})) ELSE ${value} END`;
const exactSql=(a,b)=>`(DATALENGTH(${a})=DATALENGTH(${b}) AND CONVERT(varbinary(max),${a})=CONVERT(varbinary(max),${b}))`;
function historyComparisonPredicate(alias='source',scope=null){
 const organization=exactSql(`${alias}.[organization_id]`,'@history_organization');
 if(scope&&trusted.has(scope)&&scope.historyScope==='company')return organization;
 return `${organization} AND ${exactSql(`${alias}.[scope_type]`,"N'BRANCH'")} AND ${exactSql(canonicalSql(`${alias}.[scope_id]`),canonicalSql('@branch'))}`;
}
const historyOrganization=scope=>scope&&trusted.has(scope)?scope.organizationId:'default';
module.exports={POLICY,captureHistoryScope,assertHistoryScope,assertHistoryRows,visibleHistoryRow,historyComparisonPredicate,historyOrganization,createHistoryPolicyRun,assertHistoryPolicy};
