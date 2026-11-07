const { comparisonWhere } = require("../db/branch-scope.cjs");

const exactCount = (value) => String(value ?? "0");

async function reconcile({ registry, localCounts, cloudCounts, branchId }) {
  const differences = [];
  for (const table of registry.tables) {
    const [local, cloud] = await Promise.all([localCounts(table.sqlServerTable, branchId), cloudCounts(table.cloudTable, branchId)]);
    if (exactCount(local) !== exactCount(cloud)) differences.push({ table: table.cloudTable, local: exactCount(local), cloud: exactCount(cloud) });
  }
  return { ok: differences.length === 0, differences };
}
async function localTableCounts(connectionManager,registry,branchId,historyDays=90,terminalId="",historyScope=null){
  if(!branchId)throw Object.assign(new Error("A branch is required for verification."),{code:"EBRANCH"});
  const cutoff=new Date(Date.now()-Math.max(30,Number(historyDays)||90)*86400000);
  const request=connectionManager.pool.request().input("branch",String(branchId)).input("terminal",String(terminalId??"")).input("cutoff",cutoff);
  if(registry.tables.some(table=>table.cloudTable==='change_history'))request.input('history_organization',require('./history-read-scope.cjs').historyOrganization(historyScope));
  // Reconciliation used to make one SQL Server round trip per table. Apart
  // from being slow on a busy till, a renderer waiting for all of those calls
  // could look like a central-server timeout. The registry is a trusted build
  // artifact, so combine the exact counts into one parameterised request.
  const statements=registry.tables.map((table)=>{
    const where=comparisonWhere(registry,table,{historyDays,alias:"source",historyScope});
    const name=String(table.cloudTable).replaceAll("'","''");
    return `SELECT '${name}' table_name,CONVERT(varchar(40),COUNT_BIG(*)) row_count FROM dbo.[${table.sqlServerTable}] source WHERE ${where}`;
  });
  if(!statements.length)return{};
  const result=await request.query(statements.join(" UNION ALL "));
  return validatedCloudCounts(registry,result.recordset,"local");
}
const MEMBERSHIP_TABLES = new Set(["members", "membership_tiers", "member_verifications"]);
function validatedCloudCounts(registry, rows, source="central") {
  const invalid = () => Object.assign(new Error(`The ${source} table counts are incomplete or invalid. Synchronization will retry; matching data has not been confirmed.`), {code:"ERECONCILE_COUNTS"});
  if (!Array.isArray(rows)) throw invalid();
  const counts = Object.create(null), registered = new Set(registry.tables.map(table => table.cloudTable));
  for (const row of rows) {
    const name = row?.table_name, value = row?.row_count;
    if (typeof name !== "string" || !registered.has(name) || Object.hasOwn(counts, name) ||
        !(typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value) || typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) throw invalid();
    counts[name] = String(value);
  }
  if (registry.tables.some(table => !MEMBERSHIP_TABLES.has(table.cloudTable) && !Object.hasOwn(counts, table.cloudTable))) throw invalid();
  return counts;
}
function reconciliationError(differences) {
  const details = differences.map(row => `${row.table} (local ${row.local}, cloud ${row.cloud})`).join(", ");
  return Object.assign(new Error(`Automatic synchronization could not safely reconcile ${details}. Saved local work is retained; Administrator review is required.`), {code:"ERECONCILE",differences});
}
module.exports = { reconcile, localTableCounts, exactCount, validatedCloudCounts, reconciliationError, MEMBERSHIP_TABLES };
