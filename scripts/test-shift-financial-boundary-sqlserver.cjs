// Owned disposable LocalDB only. Never opens POS_Local, configuration or a URL.
const assert=require("node:assert/strict");
const {randomUUID}=require("node:crypto");
const {execFileSync}=require("node:child_process");
const sql=require("mssql/msnodesqlv8");
const {OperationsRepository}=require("../electron/db/repositories/operations.cjs");
const {ShiftSyncJournal}=require("../electron/db/shift-sync-journal.cjs");
const {loadRegistry}=require("../electron/db/schema-registry.cjs");
async function main(){
  assert.deepEqual(process.argv.slice(2),["--run"]);
  const suffix=randomUUID().replaceAll("-",""),instance="CodexFinancial_"+suffix,database="FinancialFixture_"+suffix;
  const control=(...args)=>{const output=execFileSync("C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe",args,{windowsHide:true,timeout:30000});const text=output.toString(output.includes(0)?"utf16le":"utf8").replace(/^\uFEFF/,"");assert(!/failed|unexpected error/i.test(text),text);return text;};
  let owned=false,created=false,master,pool,other,server,passed=0;
  const connect=name=>new sql.ConnectionPool({connectionString:`Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`,pool:{min:0,max:3},requestTimeout:10000}).connect();
  try{
    control("create",instance,"-s");owned=true;server=control("info",instance).match(/np:\\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query/)?.[0];assert(server);
    master=await connect("master");await master.request().batch(`CREATE DATABASE [${database}];`);created=true;pool=await connect(database);other=await connect(database);
    const registry=loadRegistry(),names=["shifts","sales","shift_cash_counts","shift_reconciliations","shift_close_events","shift_notifications","shift_variance_alerts"];
    for(const name of names){const table=registry.tables.find(value=>value.sqlServerTable===name);await pool.request().batch(`CREATE TABLE dbo.[${name}](${table.columns.map(column=>`[${column.sqlServerColumn}] ${column.sqlServerType} ${column.sqlServerColumn==="id"?"NOT NULL":"NULL"}`).join(",")},PRIMARY KEY(id));`);}
    await pool.request().batch("CREATE TABLE dbo.local_operation_receipts(operation_id uniqueidentifier PRIMARY KEY,operation_type nvarchar(80),entity_id nvarchar(128),note nvarchar(max));CREATE TABLE dbo.sync_change_journal(entity_type nvarchar(128),entity_id nvarchar(400),operation nvarchar(16),branch_id nvarchar(128),entity_version bigint,aggregate_id uniqueidentifier);");
    const manager={pool,sql:()=>sql},repository=new OperationsRepository(manager,registry),writer=new ShiftSyncJournal(repository),branch="fixture";
    const shift=randomUUID(),sale=randomUUID();let frozen=0;
    // Only causal metadata persistence is out of this fixture's scope. The real
    // journal, SERIALIZABLE writer, financial SQL, graph checks and rows run.
    writer.intents={verify:async()=>({}),freeze:async()=>{frozen++;return{payloadHash:"fixture"};}};
    const seed=async(hasSale=true)=>{
      for(const name of [...names,"local_operation_receipts","sync_change_journal"])await pool.request().query(`DELETE FROM dbo.[${name}];`);
      await pool.request().input("id",shift).query("INSERT dbo.shifts(id,store_id,state,status,opening_float,row_version,opened_at) VALUES(@id,N'fixture',N'CASH_COUNT_REQUIRED',N'OPEN',10,1,SYSDATETIMEOFFSET());");
      if(hasSale)await pool.request().input("id",sale).input("shift",shift).query("INSERT dbo.sales(id,store_id,shift_id,payment_type,total_amount,is_refunded,payments) VALUES(@id,N'fixture',CONVERT(nvarchar(36),@shift),N'cash',90,0,N'[]');");
    };
    const ops=(expected=100)=>{const count=randomUUID(),recon=randomUUID(),now=new Date().toISOString(),facts={counted_cash:100,counted_card:null,counted_digital:null,expected_cash:expected,expected_card:0,expected_digital:0,variance_cash:100-expected,variance_card:null,variance_digital:null,variance_total:100-expected,variance_status:expected===100?"NO_VARIANCE":"OVER"};return[
      {kind:"insert",table:"shift_cash_counts",rows:[{id:count,shift_id:shift,store_id:branch,kind:"ORIGINAL",counted_cash:100,counted_card:null,counted_digital:null,created_at:now}]},
      {kind:"insert",table:"shift_reconciliations",rows:[{id:recon,shift_id:shift,store_id:branch,count_id:count,created_at:now,...facts}]},
      {kind:"update",table:"shifts",match:{id:shift},values:{store_id:branch,status:"CLOSED",state:"CLOSED",closed_at:now,final_counted_cash:100,...facts}},
    ];};
    const apply=operations=>writer.apply("Synthetic local count",operations,{branchId:branch});
    const count=async table=>Number((await pool.request().query(`SELECT count(*) AS n FROM dbo.[${table}];`)).recordset[0].n);
    const test=async(name,run)=>{await seed();await run();passed++;console.log("PASS "+name);};
    await test("changed refund rejects stale expectations atomically before graph/intent/journal writes",async()=>{
      const before=frozen;await pool.request().query("UPDATE dbo.sales SET is_refunded=1;");
      await assert.rejects(apply(ops()),error=>error.code==="ESHIFT_FINANCIAL_CONFLICT");
      for(const table of ["shift_cash_counts","shift_reconciliations","local_operation_receipts","sync_change_journal"])assert.equal(await count(table),0);
      assert.equal(frozen,before);assert.equal((await pool.request().query("SELECT status FROM dbo.shifts;")).recordset[0].status,"OPEN");
    });
    await test("matching financial snapshot commits complete count and durable journal",async()=>{
      const before=frozen;await apply(ops());assert.equal(frozen,before+1);assert.equal(await count("shift_cash_counts"),1);assert.equal(await count("shift_reconciliations"),1);assert.equal(await count("local_operation_receipts"),1);assert((await count("sync_change_journal"))>=3);
    });
    const actualTotals=repository.shiftExpectedTotals.bind(repository);
    async function contention(mutation,{empty=false}={}){
      if(empty)await seed(false);
      let ready,release;const readReady=new Promise(resolve=>{ready=resolve;}),held=new Promise(resolve=>{release=resolve;});
      repository.shiftExpectedTotals=async(...args)=>{const totals=await actualTotals(...args);ready();await held;return totals;};
      const saving=apply(ops(empty?10:100));
      // Observe both promises immediately so a failed assertion cannot close
      // their pool while the count is still completing.
      const saved=saving.then(()=>null,error=>error);let mutationResult,mutationState="pending";
      try{
        await readReady;
        mutationResult=other.request().input("id",randomUUID()).input("shift",shift).query("SET LOCK_TIMEOUT 5000;"+mutation)
          .then(()=>{mutationState="success";return null;},error=>{mutationState="error";return error;});
        await new Promise(resolve=>setTimeout(resolve,150));
        assert.equal(mutationState,"pending","Concurrent mutation unexpectedly bypassed the financial read lock");
      }finally{release();repository.shiftExpectedTotals=actualTotals;}
      const saveError=await saved;if(saveError)throw saveError;
      const mutationError=await mutationResult;if(mutationError)throw mutationError;
      assert.equal(mutationState,"success");
      assert.equal(await count("shift_cash_counts"),1);
    }
    await test("concurrent refund waits until the atomic financial count completes",()=>contention("UPDATE dbo.sales SET is_refunded=1 WHERE store_id=N'fixture' AND shift_id=CONVERT(nvarchar(36),@shift);"));
    await test("concurrent new sale cannot enter an empty matching range during financial save",()=>contention("INSERT dbo.sales(id,store_id,shift_id,payment_type,total_amount,is_refunded,payments) VALUES(@id,N'fixture',CONVERT(nvarchar(36),@shift),N'cash',90,0,N'[]');",{empty:true}));
    console.log(passed+" isolated SQL Server financial-boundary groups passed.");
  }finally{
    await other?.close();await pool?.close();if(created){assert(owned&&/^FinancialFixture_[a-f0-9]{32}$/.test(database));await master.request().batch(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE [${database}];`);}await master?.close();if(owned){control("stop",instance,"-k");control("delete",instance);console.log("Cleaned owned financial fixture "+instance+" / "+database);}
  }
}
main().catch(error=>{console.error(error.message);for(const preceding of error.precedingErrors??[])console.error(preceding.message);process.exitCode=1;});
