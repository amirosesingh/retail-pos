const { canonicalEntityKey } = require("../sync/entity-key.cjs");
const { tagBootstrapDiagnostic } = require("../diagnostics.cjs");
const {prepareShiftGraphs,applyShiftGraphs} = require("../sync/shift-graph.cjs");
const {reportActivity} = require("../db/startup-activity.cjs");
const SHIFT_GRAPH_TABLES = new Set(["shifts", "shift_cash_counts", "shift_reconciliations",
  "shift_close_events", "shift_notifications", "shift_variance_alerts"]);
async function applySnapshot(cloud, transaction, table, rows, reader, branchId) {
  const changes = rows.map(row => ({entity_id:keyFor(table,row),row_data:row,tombstone:false}));
  if (!changes.length) return {applied:0,alreadyMatching:0};
  const protectedGraph = SHIFT_GRAPH_TABLES.has(table.cloudTable);
  if (protectedGraph && !reader) throw Object.assign(new Error("The local closing-change guard is required before a snapshot can advance."), {code:"ELOCAL_PENDING_UNVERIFIED",table:table.cloudTable});
  const pending = new Set([...(reader ? await reader.unacknowledged(table, changes.map(change=>change.entity_id), transaction, {branchId,changes}) : [])].map(canonicalEntityKey));
  if (protectedGraph && pending.size) throw Object.assign(new Error("The closing snapshot is waiting for pending local uploads; its page remains pending."), {code:"ELOCAL_UPLOAD_PENDING",table:table.cloudTable});
  const safe = changes.filter(change => !pending.has(canonicalEntityKey(change.entity_id)));
  const result = safe.length ? await cloud.applyLocalBatch(transaction,table,{rows:safe,tombstones:[],...(protectedGraph?{branchId}:{})}) : {applied:0,alreadyMatching:0};
  if (protectedGraph && (!result || result.deferred || result.conflicts || result.applied+result.alreadyMatching!==safe.length))
    throw Object.assign(new Error(result?.outcomes?.find(item=>["deferred","conflict"].includes(item.status))?.reason ?? "The closing snapshot was not confirmed locally; its page remains pending."),
      {code:result?.conflicts?"ESYNC_APPLY_CONFLICT":"ESYNC_APPLY_DEFERRED",table:table.cloudTable,outcomes:result?.outcomes});
  // Non-shift callers historically receive selected safe-row progress even
  // when their writer returns no result; retain settings-ready notifications.
  return protectedGraph ? result : {applied:safe.length,alreadyMatching:0};
}
const { readPage,MAX_PAGE_BYTES } = require("../sync/page-policy.cjs");
function keyFor(table,row){const primary=table.columns.filter(column=>column.primaryKey).map(column=>column.cloudColumn);return JSON.stringify(Object.fromEntries(primary.map(column=>[column,row[column]])));}
async function snapshotPage({cloud,connectionManager,table,branchId,historyDays,cursor,size,rowFilter=()=>true}){
  let prepared,selected;const decisions=new Map();
  const page=await readPage(async limit=>{
    prepared=null;
    const batch=await cloud.bootstrapPage({table:table.cloudTable,branchId,historyDays,cursor,limit});
    if(Buffer.byteLength(JSON.stringify(batch),"utf8")>MAX_PAGE_BYTES)throw Object.assign(new Error("Download exceeds the safe page size."),{code:"EOVERSIZED"});
    selected=(batch.rows??[]).filter(row=>{const key=keyFor(table,row);if(!decisions.has(key))decisions.set(key,rowFilter(row));return decisions.get(key);});
    prepared=await prepareShiftGraphs({cloud,connectionManager,branchId,changes:selected.map(row=>({table_name:table.cloudTable,entity_id:keyFor(table,row),row_data:row,tombstone:false}))});
    return batch;
  },size,{table:table.cloudTable});
  return{...page,prepared,selected};
}
async function refreshTable({registry,cloud,connectionManager,branchId,historyDays=90,tableName,rowFilter=()=>true,reader,diagnosticOrigin="refresh",progress=null,onActivity=()=>{}}){
  const table=(registry.tables??[]).find(candidate=>candidate.cloudTable===tableName);
  if(!table)return{completed:0,skipped:true};
  let completed=progress?.completed??0;let cursor=progress?.cursor??null;let size=100;
  let diagnosticPhase="download";
  try{do{
    diagnosticPhase="download";
    reportActivity(onActivity,{phase:"downloading",table:table.cloudTable,processedRows:completed});
    const page=await snapshotPage({cloud,connectionManager,table,branchId,historyDays,cursor,size,rowFilter});const batch=page.batch;size=page.nextLimit;
    diagnosticPhase="local_apply";
    reportActivity(onActivity,{phase:"applying",table:table.cloudTable,processedRows:completed});
    const rows=batch.rows??[];
    const {selected,prepared}=page;
    const sql=connectionManager.sql();const transaction=new sql.Transaction(connectionManager.pool);await transaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
    try{
      await progress?.beforeApply(transaction);
      const graphCount=await applyShiftGraphs({transaction,connectionManager,registry,reader,branchId,prepared});
      const result=await applySnapshot(cloud,transaction,table,selected.filter(row=>!prepared.covers({table_name:table.cloudTable,entity_id:keyFor(table,row),row_data:row})),reader,branchId);
      const nextCursor=batch.cursor??null;
      if(progress&&nextCursor!==null&&nextCursor===cursor)throw Object.assign(new Error("History download cursor did not advance."),{code:"EHISTORY_PROGRESS"});
      const nextCompleted=completed+result.applied+graphCount;
      await progress?.save(transaction,{cursor:nextCursor,completed:nextCompleted});
      await transaction.commit();completed=nextCompleted;cursor=nextCursor;
      reportActivity(onActivity,{phase:"applying",table:table.cloudTable,processedRows:completed});
      await progress?.committed();
    }catch(error){await Promise.resolve(transaction.rollback()).catch(()=>undefined);throw error;}
    rows.length=0;
  }while(cursor);}catch(error){throw tagBootstrapDiagnostic(error,{table:table.cloudTable,phase:diagnosticPhase,origin:diagnosticOrigin});}
  return{completed};
}
async function runBootstrap({registry,cloud,connectionManager,checkpoints,branchId,historyDays=90,context,reader,onActivity=()=>{}}){
  let completed=Number(context.job.completed_rows??0);
  const startIndex=Math.max(0,Number(context.job.dependency_index??0));
  const tables=[...registry.tables].sort((a,b)=>a.dependencyOrder-b.dependencyOrder||a.cloudTable.localeCompare(b.cloudTable));
  for(let index=startIndex;index<tables.length;index++){
    const table=tables[index]; let cursor=index===startIndex?context.job.last_committed_cursor??null:null;
    let diagnosticPhase="local_apply";
    try{
    await context.checkpoint({status:"running",phase:"bootstrap",current_table:table.sqlServerTable,dependency_index:index,last_committed_cursor:cursor,estimated_total_rows:context.job.estimated_total_rows??null});
    const baselineResult=checkpoints ? await connectionManager.pool.request().query("SELECT CHANGE_TRACKING_CURRENT_VERSION() current_version;") : null;
    const baseline=Number(baselineResult?.recordset?.[0]?.current_version??0);
    let size=100;
    do{
      await context.waitWhilePaused();
      diagnosticPhase="download";
      reportActivity(onActivity,{phase:"downloading",table:table.cloudTable,processedRows:completed});
      const page=await snapshotPage({cloud,connectionManager,table,branchId,historyDays,cursor,size});const batch=page.batch;size=page.nextLimit;
      diagnosticPhase="local_apply";
      reportActivity(onActivity,{phase:"applying",table:table.cloudTable,processedRows:completed});
      const rows=batch.rows??[];
      const {prepared}=page;
      const sql=connectionManager.sql(); const transaction=new sql.Transaction(connectionManager.pool); await transaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
      try{
        const graphCount=await applyShiftGraphs({transaction,connectionManager,registry,reader,branchId,prepared});
        const result=await applySnapshot(cloud,transaction,table,rows.filter(row=>!prepared.covers({table_name:table.cloudTable,entity_id:keyFor(table,row),row_data:row})),reader,branchId);
        completed+=result.applied+graphCount; cursor=batch.cursor??null;
        await context.checkpoint({status:"running",phase:"bootstrap",current_table:table.sqlServerTable,dependency_index:index,last_committed_cursor:cursor,completed_rows:completed,batch_number:Number(context.job.batch_number??0)+1},transaction);
        await transaction.commit();
        reportActivity(onActivity,{phase:"applying",table:table.cloudTable,processedRows:completed});
      }catch(error){await Promise.resolve(transaction.rollback()).catch(()=>undefined);throw error;}
      rows.length=0;
    }while(cursor);
    if(checkpoints)await checkpoints.save(branchId,table.sqlServerTable,"push",{change_tracking_version:baseline});
    await context.checkpoint({dependency_index:index+1,last_committed_cursor:null});
    }catch(error){throw tagBootstrapDiagnostic(error,{table:table.cloudTable,phase:diagnosticPhase,origin:"job"});}
  }
  return{completed};
}
module.exports={runBootstrap,keyFor,refreshTable};
