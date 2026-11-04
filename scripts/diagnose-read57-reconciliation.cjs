// Isolated diagnosis of the actual lifecycle reader. No database, network,
// credentials, files, timers, or application profile are opened or changed.
// This asserts reproduction of a known risk, NOT acceptance of a correction.
const assert = require("node:assert/strict");
const { LocalDataLifecycle } = require("../electron/jobs/lifecycle.cjs");
const defer = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function fixture() {
  const local = [], cloud = [], published = [];
  const pool = () => ({ request() { return {
    input() { return this; },
    query() { const read = defer(); local.push(read); return read.promise; },
  }; } });
  const manager = { pool: pool() };
  const databaseService = { snapshot: () => ({profile:{database:"synthetic-before"}}) };
  const lifecycle = new LocalDataLifecycle({
    connectionManager: manager,
    databaseService,
    registry:{tables:[{cloudTable:"shifts",sqlServerTable:"shifts",columns:[]}]},
    cloud:{terminalId:()=>"synthetic-terminal",counts(){const read=defer();cloud.push(read);return read.promise;}},
    syncCoordinator:{recordVerification(report){published.push(report);}},
  });
  return {lifecycle,manager,databaseService,pool,local,cloud,published};
}
function complete(f, index, value) {
  f.local[index].resolve({recordset:[{table_name:"shifts",row_count:String(value)}]});
  f.cloud[index].resolve([{table_name:"shifts",row_count:String(value)}]);
}
async function main() {
  if(!process.argv.includes("--run")) {
    console.log("Opt in with --run: isolated READ57 diagnostic, not a fix acceptance test.");
    return;
  }
  const duplicate=fixture();
  const first=duplicate.lifecycle.reconcile("synthetic-branch",90);
  const second=duplicate.lifecycle.reconcile("synthetic-branch",90);
  assert.equal(duplicate.local.length,2);
  assert.equal(duplicate.cloud.length,2);
  complete(duplicate,0,1);complete(duplicate,1,1);
  await Promise.all([first,second]);
  const switched=fixture();
  const read=switched.lifecycle.reconcile("synthetic-branch",90);
  const oldPool=switched.manager.pool;
  switched.manager.pool=switched.pool();
  switched.databaseService.snapshot=()=>({profile:{database:"synthetic-after"}});
  assert.notEqual(switched.manager.pool,oldPool);
  complete(switched,0,7);
  await read;
  assert.equal(switched.published.length,1);
  assert.equal(switched.published[0].tables[0].local,"7");
  console.log(JSON.stringify({
    classification:"known-risk reproduction; NOT corrected",
    actualModule:"electron/jobs/lifecycle.cjs:LocalDataLifecycle.reconcile",
    concurrentIdenticalComparisons:{calls:2,localCountQueries:duplicate.local.length,cloudCountRequests:duplicate.cloud.length},
    profileSwitchWhileReadPending:{oldComparisonPublishedAfterPoolReplacement:true},
    liveDatabaseAccess:false,networkAccess:false,runtimeChanged:false,
    conclusion:"Do not add completed-result reuse without a complete context/mutation proof. Preserve manual fresh comparisons.",
  }));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
