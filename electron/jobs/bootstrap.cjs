function keyFor(table,row){const primary=table.columns.filter(column=>column.primaryKey).map(column=>column.cloudColumn);return JSON.stringify(Object.fromEntries(primary.map(column=>[column,row[column]])));}
async function refreshTable({registry,cloud,connectionManager,branchId,historyDays=90,tableName}){
  const table=(registry.tables??[]).find(candidate=>candidate.cloudTable===tableName);
  if(!table)return{completed:0,skipped:true};
  let completed=0;let cursor=null;
  do{
    const batch=await cloud.bootstrapPage({table:table.cloudTable,branchId,historyDays,cursor,limit:10});
    const rows=batch.rows??[];
    const sql=connectionManager.sql();const transaction=new sql.Transaction(connectionManager.pool);await transaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
    try{
      if(rows.length)await cloud.applyLocalBatch(transaction,table,{rows:rows.map(row=>({entity_id:keyFor(table,row),row_data:row,tombstone:false})),tombstones:[]});
      await transaction.commit();completed+=rows.length;cursor=batch.cursor??null;
    }catch(error){await Promise.resolve(transaction.rollback()).catch(()=>undefined);throw error;}
    rows.length=0;
  }while(cursor);
  return{completed};
}
async function runBootstrap({registry,cloud,connectionManager,checkpoints,branchId,historyDays=90,context}){
  let completed=Number(context.job.completed_rows??0);
  const startIndex=Math.max(0,Number(context.job.dependency_index??0));
  const tables=[...registry.tables].sort((a,b)=>a.dependencyOrder-b.dependencyOrder||a.cloudTable.localeCompare(b.cloudTable));
  for(let index=startIndex;index<tables.length;index++){
    const table=tables[index]; let cursor=index===startIndex?context.job.last_committed_cursor??null:null;
    await context.checkpoint({status:"running",phase:"bootstrap",current_table:table.sqlServerTable,dependency_index:index,last_committed_cursor:cursor});
    do{
      await context.waitWhilePaused();
      const batch=await cloud.bootstrapPage({table:table.cloudTable,branchId,historyDays,cursor,limit:Math.min(10,Number(context.job.batch_size)||10)});
      const rows=batch.rows??[];
      const sql=connectionManager.sql(); const transaction=new sql.Transaction(connectionManager.pool); await transaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
      try{
        if(rows.length)await cloud.applyLocalBatch(transaction,table,{rows:rows.map(row=>({entity_id:keyFor(table,row),row_data:row,tombstone:false})),tombstones:[]});
        completed+=rows.length; cursor=batch.cursor??null;
        await context.checkpoint({status:"running",phase:"bootstrap",current_table:table.sqlServerTable,dependency_index:index,last_committed_cursor:cursor,completed_rows:completed,batch_number:Number(context.job.batch_number??0)+1},transaction);
        await transaction.commit();
      }catch(error){await Promise.resolve(transaction.rollback()).catch(()=>undefined);throw error;}
      rows.length=0;
    }while(cursor);
    if(checkpoints)await checkpoints.save(branchId,table.sqlServerTable,"push",{change_tracking_version:await (async()=>{const result=await connectionManager.pool.request().query("SELECT CHANGE_TRACKING_CURRENT_VERSION() current_version;");return Number(result.recordset?.[0]?.current_version??0);})()});
    await context.checkpoint({dependency_index:index+1,last_committed_cursor:null});
  }
  return{completed};
}
module.exports={runBootstrap,keyFor,refreshTable};
