const { scopedWhere } = require("../db/branch-scope.cjs");

const exactCount = (value) => String(value ?? "0");

async function reconcile({ registry, localCounts, cloudCounts, branchId }) {
  const differences = [];
  for (const table of registry.tables) {
    const [local, cloud] = await Promise.all([localCounts(table.sqlServerTable, branchId), cloudCounts(table.cloudTable, branchId)]);
    if (exactCount(local) !== exactCount(cloud)) differences.push({ table: table.cloudTable, local: exactCount(local), cloud: exactCount(cloud) });
  }
  return { ok: differences.length === 0, differences };
}
async function localTableCounts(connectionManager,registry,branchId,historyDays=90,terminalId=""){
  if(!branchId)throw Object.assign(new Error("A branch is required for verification."),{code:"EBRANCH"});
  const cutoff=new Date(Date.now()-Math.max(30,Number(historyDays)||90)*86400000);
  const request=connectionManager.pool.request().input("branch",String(branchId)).input("terminal",String(terminalId??"")).input("cutoff",cutoff);
  // Reconciliation used to make one SQL Server round trip per table. Apart
  // from being slow on a busy till, a renderer waiting for all of those calls
  // could look like a central-server timeout. The registry is a trusted build
  // artifact, so combine the exact counts into one parameterised request.
  const statements=registry.tables.map((table)=>{
    const where=scopedWhere(registry,table,{historyDays,alias:"source"});
    const name=String(table.cloudTable).replaceAll("'","''");
    return `SELECT '${name}' table_name,CONVERT(varchar(40),COUNT_BIG(*)) row_count FROM dbo.[${table.sqlServerTable}] source WHERE ${where}`;
  });
  if(!statements.length)return{};
  const result=await request.query(statements.join(" UNION ALL "));
  return Object.fromEntries((result.recordset??[]).map((row)=>[String(row.table_name),exactCount(row.row_count)]));
}
module.exports = { reconcile, localTableCounts, exactCount };
