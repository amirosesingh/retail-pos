const ALLOWED_DAYS=new Set([30,90,180,365,730,7300]);
const HISTORICAL=["sale_items","payment_transactions","item_activity_logs","audit_logs","sales"];
const DATE_COLUMN={sale_items:"created_at",payment_transactions:"updated_at",item_activity_logs:"created_at",audit_logs:"created_at",sales:"created_at"};
const SAFE_WHERE={
  sale_items:` AND NOT EXISTS(SELECT 1 FROM dbo.payment_transactions payment WHERE payment.sale_id=target.sale_id AND payment.status NOT IN ('completed','settled','paid'))
    AND NOT EXISTS(SELECT 1 FROM dbo.sales sale JOIN dbo.shifts shift ON shift.id=sale.shift_id WHERE sale.id=target.sale_id AND (shift.closed_at IS NULL OR shift.status NOT IN ('closed','completed')))`,
  payment_transactions:" AND target.status IN ('completed','settled','paid')",
  item_activity_logs:"",
  audit_logs:"",
  sales:` AND target.is_refunded IN (0,1)
    AND NOT EXISTS(SELECT 1 FROM dbo.payment_transactions payment WHERE payment.sale_id=target.id AND payment.status NOT IN ('completed','settled','paid'))
    AND NOT EXISTS(SELECT 1 FROM dbo.shifts shift WHERE shift.id=target.shift_id AND (shift.closed_at IS NULL OR shift.status NOT IN ('closed','completed')))`,
};
async function runRetention({connectionManager,days,context}){
  if(!ALLOWED_DAYS.has(days))throw new Error("Unsupported retention period.");
  if(days===7300)return{deleted:0};
  let deleted=0;
  const startIndex=Math.max(0,Number(context.job.dependency_index??0));
  for(let index=startIndex;index<HISTORICAL.length;index++){
    const table=HISTORICAL[index]; let affected=0;
    do{
      await context.waitWhilePaused();
      const sql=connectionManager.sql();const transaction=new sql.Transaction(connectionManager.pool);await transaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
      try{
      const request=new sql.Request(transaction).input("cutoff",new Date(Date.now()-days*86400000));
      const result=await request.query(`WITH CHANGE_TRACKING_CONTEXT (0x4C4F43414C) DELETE TOP (500) target FROM dbo.[${table}] target
       WHERE target.[${DATE_COLUMN[table]}]<@cutoff
       ${SAFE_WHERE[table]} AND NOT EXISTS(SELECT 1 FROM dbo.sync_change_journal j WHERE j.entity_type='${table}' AND j.entity_id=CONCAT('{"id":"',CONVERT(nvarchar(36),target.id),'"}') AND j.acknowledged_at IS NULL)
       AND NOT EXISTS(SELECT 1 FROM dbo.sync_conflicts c WHERE c.entity_type='${table}' AND c.entity_id=CONCAT('{"id":"',CONVERT(nvarchar(36),target.id),'"}') AND c.status='unresolved'); SELECT @@ROWCOUNT affected;`);
      affected=Number(result.recordset?.[0]?.affected??0); deleted+=affected;
      await context.checkpoint({phase:"retention",current_table:table,dependency_index:index,completed_rows:deleted,batch_number:Number(context.job.batch_number??0)+1},transaction);
      await transaction.commit();
      }catch(error){await Promise.resolve(transaction.rollback()).catch(()=>undefined);throw error;}
    }while(affected===500);
    await context.checkpoint({dependency_index:index+1,last_committed_cursor:null});
  }
  return{deleted};
}
module.exports={runRetention,ALLOWED_DAYS,HISTORICAL};
