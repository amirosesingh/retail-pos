const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, randomUUID } = require("node:crypto");
const sql = require("mssql/msnodesqlv8");
const { reserveStockCounter } = require("../electron/bill-counter.cjs");
const { AggregateRepository } = require("../electron/db/repositories/aggregates.cjs");
async function main() {
  const database = "POS_CounterRegression_" + randomBytes(4).toString("hex");
  assert(/^POS_CounterRegression_[a-f0-9]{8}$/.test(database));
  const connect = name => new sql.ConnectionPool({connectionString:`Driver={ODBC Driver 18 for SQL Server};Server=localhost\\LCRPOS;Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`,options:{trustedConnection:true},connectionTimeout:5000}).connect();
  const master = await connect("master");
  let pool, created = false;
  try {
    await master.request().query(`CREATE DATABASE [${database}]`); created = true;
    pool = await connect(database);
    await pool.request().batch(`
      CREATE TABLE dbo.stock_count_drafts(id uniqueidentifier NOT NULL PRIMARY KEY,reference nvarchar(450) NULL);
      CREATE UNIQUE INDEX UX_stock_count_drafts_reference ON dbo.stock_count_drafts(reference) WHERE reference IS NOT NULL;
      CREATE TABLE dbo.purchase_orders(id uniqueidentifier NOT NULL PRIMARY KEY,reference nvarchar(max) NULL);
      CREATE TABLE dbo.stock_transfers(id uniqueidentifier NOT NULL PRIMARY KEY,ref nvarchar(450) NOT NULL);
      CREATE UNIQUE INDEX UX_stock_transfers_ref ON dbo.stock_transfers(ref);
      CREATE TABLE dbo.products(id uniqueidentifier NOT NULL PRIMARY KEY,barcode nvarchar(450) NOT NULL);
      CREATE UNIQUE INDEX UX_products_barcode ON dbo.products(barcode);
      CREATE TABLE dbo.local_operation_receipts(operation_id uniqueidentifier NOT NULL PRIMARY KEY,note nvarchar(128));
    `);
    await pool.request().batch("CREATE TABLE dbo.pos_schema_migrations(version int PRIMARY KEY,name nvarchar(200));");
    await pool.request().batch(fs.readFileSync(path.join(__dirname,"../database/sqlserver/migrations/018_sql_document_counters.sql"),"utf8"));
    const prefix = "SC-B1-WIN-DEVICE-202610";
    await pool.request().input("ref",prefix+"-0001").query("INSERT dbo.stock_count_drafts VALUES(NEWID(),@ref)");
    await pool.request().input("ref",prefix+"-0041").query("INSERT dbo.purchase_orders VALUES(NEWID(),@ref)");
    await pool.request().input("ref",prefix+"-0060").query("INSERT dbo.stock_transfers VALUES(NEWID(),@ref)");
    let duplicate;
    try { await pool.request().input("ref",prefix+"-0001").query("INSERT dbo.stock_count_drafts VALUES(NEWID(),@ref)"); }
    catch (error) { duplicate=error; }
    assert.equal(duplicate?.number,2601,"Legacy reset must reproduce SQL Server 2601");
    const first = await reserveStockCounter(sql,pool,"B1",prefix,1);
    assert.deepEqual(first,{ok:true,sequence:61});
    await pool.request().input("ref",prefix+"-0061").query("INSERT dbo.stock_count_drafts VALUES(NEWID(),@ref)");
    const otherPool=await connect(database);
    try {
      const simultaneous = await Promise.all(Array.from({length:10},(_,index)=>reserveStockCounter(sql,index%2 ? otherPool : pool,"B1",prefix,1)));
      assert(simultaneous.every(item=>item.ok),JSON.stringify(simultaneous));
      assert.equal(new Set(simultaneous.map(item=>item.sequence)).size,10);
      assert.equal((await reserveStockCounter(sql,otherPool,"B1",prefix,1)).sequence,72,"SQL reservations survive a new connection without Electron storage");
      assert.equal((await reserveStockCounter(sql,otherPool,"B2",prefix,1)).ok,false,"Another branch cannot use an owned prefix");
      assert.equal((await reserveStockCounter(sql,otherPool,"B2","SC-B2-WIN-DEVICE-202610",500)).sequence,500);
      assert.equal((await reserveStockCounter(sql,otherPool,"B2","SC-B2-WIN-DEVICE-202610",1)).sequence,501);
      const branchUuid="A1234567-1234-4234-8234-123456789ABC";
      const uuidPrefix="SC-B3-WIN-DEVICE-202610";
      assert.equal((await reserveStockCounter(sql,otherPool,branchUuid,uuidPrefix,1000)).sequence,1000);
      assert.equal((await reserveStockCounter(sql,otherPool,branchUuid.toLowerCase(),uuidPrefix,1)).sequence,1001);
      assert.equal((await reserveStockCounter(sql,otherPool,"B1234567-1234-4234-8234-123456789ABC",uuidPrefix,1)).ok,false);

    } finally {await otherPool.close();}
    await pool.request().query("INSERT dbo.products VALUES(NEWID(),N'barcode-existing')");
    for (const [table,field,value,index] of [["stock_count_drafts","reference",prefix+"-0001","UX_stock_count_drafts_reference"],["stock_transfers","ref",prefix+"-0060","UX_stock_transfers_ref"],["products","barcode","barcode-existing","UX_products_barcode"]]) {
      const metadata={sqlServerTable:table,columns:[{sqlServerColumn:"id",primaryKey:true}]};
      const operations={pool:()=>pool,tables:new Map([[table,metadata]]),validate:ops=>ops,applyOperation:async transaction=>new sql.Request(transaction).input("value",value).query(`INSERT dbo.[${table}]([id],[${field}]) VALUES(NEWID(),@value)`)};
      const repository = new AggregateRepository({sql:()=>sql},operations);
      await assert.rejects(repository.commit("stock",{operationId:randomUUID(),operations:[{kind:"insert",table,rows:[{id:randomUUID()}]}]}),error=>error.sqlNumber===2601 && error.table===table && error.message.includes(index) && error.message.includes("No changes were committed"));
    }
    const count=await pool.request().query("SELECT COUNT(*) AS count FROM dbo.stock_count_drafts");
    assert.equal(count.recordset[0].count,2,"Duplicate attempts must not change existing drafts");
    console.log("Live SQL Server regression passed: reproduced 2601, recovered past all document types, serialized 10 cross-connection SQL reservations, preserved drafts and verified duplicate diagnostics for three tables.");
  } finally {
    if(pool) await pool.close();
    if(created) {
      assert(/^POS_CounterRegression_[a-f0-9]{8}$/.test(database));
      await master.request().query(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]`);
    }
    await master.close();
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
