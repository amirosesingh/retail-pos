// Opt-in disposable LocalDB only. No application profile or POS_Local access.
const assert=require("node:assert/strict");const{execFileSync}=require("node:child_process");const{readFileSync}=require("node:fs");const{randomUUID}=require("node:crypto");const sql=require("mssql/msnodesqlv8");const{CheckpointRepository}=require("../electron/sync/checkpoints.cjs");const{JobRepository}=require("../electron/jobs/repository.cjs");
async function main(){assert.deepEqual(process.argv.slice(2),["--run"]);
  const localdb = "C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe";
  const suffix = randomUUID().replaceAll("-", "");
  const instance = "CodexHistoryResume_" + suffix, database = "HistoryResumeFixture_" + suffix;
  assert(/^CodexHistoryResume_[a-f0-9]{32}$/.test(instance));
  assert(/^HistoryResumeFixture_[a-f0-9]{32}$/.test(database));
  const control = (...args) => {
    const output = execFileSync(localdb, args, { windowsHide: true, timeout: 30_000, stdio: "pipe" });
    return output.toString(output.includes(0) ? "utf16le" : "utf8").replace(/^\uFEFF/, "");
  };
  let server;
  const connect = name => new sql.ConnectionPool({
    connectionString: `Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`,
    options: { trustedConnection: true },
    pool: { min: 0, max: 4 }, requestTimeout: 10_000,
  }).connect();
  let owned=false,databaseCreated=false,master,pool,other;
  try{
    control("create",instance,"-s");owned=true;
    const information=control("info",instance);
    server = information.match(/np:\\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query/)?.[0];
    assert(server,"Private LocalDB pipe missing: "+JSON.stringify(information));master=await connect("master");await master.request().query(`CREATE DATABASE [${database}];`);databaseCreated=true;pool=await connect(database);
    const source=readFileSync(require("node:path").join(__dirname,"../database/sqlserver/schema.sql"),"utf8");
    await pool.request().batch(source.slice(source.indexOf("IF OBJECT_ID(N'dbo.pos_jobs'"),source.indexOf("IF OBJECT_ID(N'dbo.sync_change_journal'")));
    const cm={pool,sql:()=>sql},checkpoints=new CheckpointRepository(cm),jobs=new JobRepository(cm);
    await checkpoints.save("A","change_history","push",{change_tracking_version:123,committed_cursor:"keep"});
    let tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);await checkpoints.advanceRecovery("A","change_history","99",tx);await tx.commit();
    assert.equal(String((await checkpoints.get("A","change_history","push")).change_tracking_version),"123");assert.equal((await checkpoints.get("A","change_history","push")).committed_cursor,"keep");
    tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);await checkpoints.advanceRecovery("A","change_history","124",tx);await tx.rollback();assert.equal(String((await checkpoints.get("A","change_history","push")).change_tracking_version),"123");
    console.log("PASS real SQL monotonic checkpoint, cursor preservation and rollback");
    await master.request().batch(`ALTER DATABASE [${database}] SET CHANGE_TRACKING=ON (CHANGE_RETENTION=2 DAYS,AUTO_CLEANUP=ON);`);
    await pool.request().batch("CREATE TABLE dbo.change_history(id nvarchar(64) NOT NULL PRIMARY KEY,branch_id nvarchar(64) NOT NULL,note nvarchar(max)); ALTER TABLE dbo.change_history ENABLE CHANGE_TRACKING WITH (TRACK_COLUMNS_UPDATED=ON); INSERT dbo.change_history VALUES('seed','fixture','seed'); DELETE dbo.change_history WHERE id='seed';");
    const {recover}=require("../electron/sync/history-recovery.cjs"),{refreshTable}=require("../electron/jobs/bootstrap.cjs"),{JobManager}=require("../electron/jobs/manager.cjs");
    const registry={tables:[{cloudTable:"change_history",sqlServerTable:"change_history",columns:[{primaryKey:true,cloudColumn:"id"}]}]};
    const fixture=branch=>{
      const calls=[];let failNext=false,failPageSave=false;
      const repository=new JobRepository(cm),originalCheckpoint=repository.checkpoint.bind(repository);
      repository.checkpoint=async(id,patch,transaction)=>{await originalCheckpoint(id,patch,transaction);if(transaction&&patch.phase?.startsWith("hr:page:")&&failPageSave){failPageSave=false;throw Error("fixture page rollback");}};
      const cloud={terminalId:()=>"isolated-terminal",backendUrl:()=>"https://isolated.invalid",bootstrapPage:async({cursor})=>{calls.push(cursor);if(cursor&&failNext)throw Error("fixture network interruption");return{rows:[{id:branch+(cursor?"-two":"-one"),branch_id:branch,note:"fixture"}],cursor:cursor?null:"next"};},applyLocalBatch:async(transaction,table,{rows})=>{for(const {row_data:row} of rows)await new sql.Request(transaction).input("id",row.id).input("branch",row.branch_id).input("note",row.note).query("INSERT dbo.change_history(id,branch_id,note) VALUES(@id,@branch,@note);");}};
      const lifecycle={connectionManager:cm,cloud,registry,jobRepository:repository,jobManager:new JobManager(repository),checkpoints,reader:{unacknowledged:async()=>[]}};
      return{calls,lifecycle,failNetwork:()=>{failNext=true;},allowNetwork:()=>{failNext=false;},failPageSave:()=>{failPageSave=true;}};
    };
    const resumed=fixture("B");resumed.failNetwork();
    await assert.rejects(recover(resumed.lifecycle,"B",90,refreshTable),/fixture network interruption/);
    let job=await jobs.recovery("history_gap_recovery_v1","B","isolated-terminal");assert.equal(job.last_committed_cursor,"next");assert.equal(await checkpoints.get("B","change_history","push"),null);
    const baseline=job.phase.split(":").at(-1);resumed.allowNetwork();await recover(resumed.lifecycle,"B",90,refreshTable);
    assert.deepEqual(resumed.calls,[null,"next","next"]);assert.equal(String((await checkpoints.get("B","change_history","push")).change_tracking_version),baseline);
    job=await jobs.get(job.job_id);assert.equal(job.status,"completed");assert.equal(job.phase,`hr:final:${baseline}`);
    assert.equal((await pool.request().query("SELECT COUNT(*) n FROM dbo.change_history WHERE branch_id='B'")).recordset[0].n,2);
    console.log("PASS real SQL committed-page resume, original baseline and atomic finalization");
    const rolledBack=fixture("C");rolledBack.failPageSave();
    await assert.rejects(recover(rolledBack.lifecycle,"C",90,refreshTable),/fixture page rollback/);
    assert.equal((await pool.request().query("SELECT COUNT(*) n FROM dbo.change_history WHERE branch_id='C'")).recordset[0].n,0);
    assert.equal((await jobs.recovery("history_gap_recovery_v1","C","isolated-terminal")).last_committed_cursor,null);
    assert.equal(await checkpoints.get("C","change_history","push"),null);
    await recover(rolledBack.lifecycle,"C",90,refreshTable);assert.deepEqual(rolledBack.calls,[null,null,"next"]);
    console.log("PASS real SQL page and cursor roll back together before retry");
    other=await connect(database);tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try{await jobs.get(job.job_id,tx);await assert.rejects(other.request().input("job",job.job_id).query("SET LOCK_TIMEOUT 250; SELECT * FROM dbo.pos_jobs WITH (UPDLOCK,HOLDLOCK) WHERE job_id=@job;"),error=>error.number===1222);}
    finally{await tx.rollback();}
    console.log("PASS real SQL recovery job lock excludes a concurrent writer");
  } finally {
    if (other) await other.close(); if (pool) await pool.close();
    if (databaseCreated) {
      assert(owned && /^HistoryResumeFixture_[a-f0-9]{32}$/.test(database));
      await master.request().query(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}];`);
    }
    if (master) await master.close();
    if (owned) {
      assert(/^CodexHistoryResume_[a-f0-9]{32}$/.test(instance));
      control("stop", instance, "-k"); control("delete", instance);
    }
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
