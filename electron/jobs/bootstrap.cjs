const { canonicalEntityKey } = require("../sync/entity-key.cjs");
async function applySnapshot(cloud, transaction, table, rows, reader) {
  const changes = rows.map(row => ({entity_id:keyFor(table,row),row_data:row,tombstone:false}));
  const pending = new Set([...(reader ? await reader.unacknowledged(table, changes.map(change=>change.entity_id), transaction) : [])].map(canonicalEntityKey));
  const safe = changes.filter(change => !pending.has(canonicalEntityKey(change.entity_id)));
  if (safe.length) await cloud.applyLocalBatch(transaction,table,{rows:safe,tombstones:[]});
}
const { readPage } = require("../sync/page-policy.cjs");
function keyFor(table,row){const primary=table.columns.filter(column=>column.primaryKey).map(column=>column.cloudColumn);return JSON.stringify(Object.fromEntries(primary.map(column=>[column,row[column]])));}
async function refreshTable({registry,cloud,connectionManager,branchId,historyDays=90,tableName,rowFilter=()=>true,reader}){
  const table=(registry.tables??[]).find(candidate=>candidate.cloudTable===tableName);
  if(!table)return{completed:0,skipped:true};
  let completed=0;let cursor=null;let size=100;
  do{
    const page=await readPage(limit=>cloud.bootstrapPage({table:table.cloudTable,branchId,historyDays,cursor,limit}),size);const batch=page.batch;size=page.nextLimit;
    const rows=batch.rows??[];
    const selected=rows.filter(rowFilter);
    const sql=connectionManager.sql();const transaction=new sql.Transaction(connectionManager.pool);await transaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
    try{
      await applySnapshot(cloud,transaction,table,selected,reader);
      await transaction.commit();completed+=selected.length;cursor=batch.cursor??null;
    }catch(error){await Promise.resolve(transaction.rollback()).catch(()=>undefined);throw error;}
    rows.length=0;
  }while(cursor);
  return{completed};
}
async function runBootstrap({registry,cloud,connectionManager,checkpoints,branchId,historyDays=90,context,reader}){
  let completed=Number(context.job.completed_rows??0);
  const startIndex=Math.max(0,Number(context.job.dependency_index??0));
  const tables=[...registry.tables].sort((a,b)=>a.dependencyOrder-b.dependencyOrder||a.cloudTable.localeCompare(b.cloudTable));
  for(let index=startIndex;index<tables.length;index++){
    const table=tables[index]; let cursor=index===startIndex?context.job.last_committed_cursor??null:null;
    await context.checkpoint({status:"running",phase:"bootstrap",current_table:table.sqlServerTable,dependency_index:index,last_committed_cursor:cursor,estimated_total_rows:context.job.estimated_total_rows??null});
    const baselineResult=checkpoints ? await connectionManager.pool.request().query("SELECT CHANGE_TRACKING_CURRENT_VERSION() current_version;") : null;
    const baseline=Number(baselineResult?.recordset?.[0]?.current_version??0);
    let size=100;
    do{
      await context.waitWhilePaused();
      const page=await readPage(limit=>cloud.bootstrapPage({table:table.cloudTable,branchId,historyDays,cursor,limit}),size);const batch=page.batch;size=page.nextLimit;
      const rows=batch.rows??[];
      const sql=connectionManager.sql(); const transaction=new sql.Transaction(connectionManager.pool); await transaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
      try{
        await applySnapshot(cloud,transaction,table,rows,reader);
        completed+=rows.length; cursor=batch.cursor??null;
        await context.checkpoint({status:"running",phase:"bootstrap",current_table:table.sqlServerTable,dependency_index:index,last_committed_cursor:cursor,completed_rows:completed,batch_number:Number(context.job.batch_number??0)+1},transaction);
        await transaction.commit();
      }catch(error){await Promise.resolve(transaction.rollback()).catch(()=>undefined);throw error;}
      rows.length=0;
    }while(cursor);
    if(checkpoints)await checkpoints.save(branchId,table.sqlServerTable,"push",{change_tracking_version:baseline});
    await context.checkpoint({dependency_index:index+1,last_committed_cursor:null});
  }
  return{completed};
}
module.exports={runBootstrap,keyFor,refreshTable};
