// Classification only. Original v1 rows, opaque cursors and CT proof stay intact.
const {createHash}=require('node:crypto');
const prior=require('./history-recovery.cjs'),{recordId}=require('./uuid-fields.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail=()=>{throw Object.assign(new Error('Retained history job ownership or saved metadata could not be verified. Existing work remains intact.'),{code:'EHISTORY_LEGACY_REVIEW',table:'change_history'});};
function legacyEvidence({rows,cloud,branchId,terminalId,ownsExecution}){
 if(!Array.isArray(rows)||rows.length>50)fail();
 if(rows.length&&ownsExecution!==true)fail();
 const seen=new Set(),proof=[];
 for(const row of rows){
  const id=recordId(row?.job_id),raw=row?.__history_legacy_json;
  if(typeof id!=='string'||!UUID.test(id)||seen.has(id)||typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>16384||
   row.job_type!==prior.TYPE||!['queued','starting','running','paused','retrying','interrupted','failed'].includes(row.status)||
   recordId(row.branch_id)!==branchId||recordId(row.terminal_id)!==terminalId||!Number.isSafeInteger(row.dependency_index)||row.dependency_index<1||row.dependency_index>7300)fail();
  let metadata;try{metadata=JSON.parse(raw);}catch{fail();}
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)||recordId(metadata.job_id)!==id)fail();
  for(const name of ['job_type','status','organization_id','organization_name','branch_id','terminal_id','phase','current_table','dependency_index','last_committed_cursor'])
   if(metadata[name]!==row[name])fail();
  // Date fields are deliberately never converted through JS Date. The SQL
  // JSON string covers their complete datetimeoffset(7) representation.
  for(const name of ['started_at','updated_at'])if(typeof metadata[name]!=='string')fail();
  for(const name of ['completed_rows','completed_bytes','batch_number','retry_count'])if(!Number.isSafeInteger(Number(row[name]))||Number(row[name])<0||Number(metadata[name])!==Number(row[name]))fail();
  let expected;try{expected=prior.scope(cloud,branchId,row.dependency_index);prior.decode(row,{...expected,branchId:row.branch_id,terminalId:row.terminal_id});}catch{fail();}
  if(recordId(expected.terminalId)!==terminalId)fail();
  seen.add(id);proof.push([id,createHash('sha256').update(raw,'utf16le').digest('hex')]);
 }
 proof.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
 return{ids:proof.map(row=>row[0]),hash:createHash('sha256').update(JSON.stringify(proof),'utf8').digest('hex')};
}
module.exports={legacyEvidence};
