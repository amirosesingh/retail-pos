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
    assert.equal((await checkpoints.get("A","change_history","push")).change_tracking_version,123);assert.equal((await checkpoints.get("A","change_history","push")).committed_cursor,"keep");
    tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);await checkpoints.advanceRecovery("A","change_history","124",tx);await tx.rollback();assert.equal((await checkpoints.get("A","change_history","push")).change_tracking_version,123);
    console.log("PASS real SQL monotonic checkpoint, cursor preservation and rollback");
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
