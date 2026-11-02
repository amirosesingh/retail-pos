// Opt-in isolated SQL Server regression. Creates/deletes only this invocation's
// randomly named LocalDB instance/database; never reads a POS profile or URL.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const sql = require("mssql/msnodesqlv8");
const { CloudClient } = require("../electron/sync/cloud-client.cjs");
const { ShiftSyncJournal } = require("../electron/db/shift-sync-journal.cjs");
const { ConnectionManager } = require("../electron/db/connection-manager.cjs");

// Capture SQL's exact error number on the server. ODBC can emit a later 3621
// termination message instead of exposing the first error on its JS wrapper.
const outcome = statement => `BEGIN TRY ${statement}\nSELECT 0 error_number; END TRY BEGIN CATCH SELECT ERROR_NUMBER() error_number; END CATCH;`;
const number = result => result.recordsets.at(-1)[0].error_number;

async function main() {
  assert.deepEqual(process.argv.slice(2), ["--run"], "Use --run; existing servers, databases and connection URLs are not accepted.");
  assert.equal(process.platform, "win32", "This isolated harness requires Windows LocalDB.");
  const localdb = "C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe";
  const suffix = randomUUID().replaceAll("-", "");
  const instance = "CodexShift34_" + suffix, database = "Shift34Fixture_" + suffix;
  assert(/^CodexShift34_[a-f0-9]{32}$/.test(instance));
  assert(/^Shift34Fixture_[a-f0-9]{32}$/.test(database));
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
  const migration = readFileSync(path.join(__dirname, "../database/sqlserver/migrations/021_shift_count_original_uniqueness.sql"), "utf8");
  const registry = JSON.parse(readFileSync(path.join(__dirname, "../database/sqlserver/schema-registry.json"), "utf8"));
  const table = registry.tables.find(table => table.cloudTable === "shift_cash_counts");
  const shift = randomUUID();
  let owned = false, databaseCreated = false, master, pool, other;
  let passed = 0;
  const test = async (name, work) => { await work(); passed++; console.log("PASS " + name); };
  try {
    control("create", instance, "-s"); owned = true;
    const information = control("info", instance);
    server = information.match(/np:\\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query/)?.[0];
    assert(server, "The newly owned LocalDB instance did not provide its private pipe: " + JSON.stringify(information));
    master = await connect("master");
    await master.request().query(`CREATE DATABASE [${database}];`);
    databaseCreated = true;
    pool = await connect(database);
    await pool.request().batch("CREATE TABLE dbo.pos_schema_migrations(version int PRIMARY KEY,name nvarchar(200));");
    const reset = async (index, types = {}) => {
      await pool.request().batch(`DROP TABLE IF EXISTS dbo.shift_cash_counts;
        CREATE TABLE dbo.shift_cash_counts(${table.columns.map(column => `[${column.sqlServerColumn}] ${types[column.sqlServerColumn] || column.sqlServerType}${column.nullable ? " NULL" : " NOT NULL"}${column.sqlServerColumn === "kind" ? " DEFAULT ('ORIGINAL')" : ""}`).join(",")},PRIMARY KEY(id));
        CREATE UNIQUE INDEX UX_shift_cash_counts_client_key ON dbo.shift_cash_counts(client_key) WHERE client_key IS NOT NULL;
        ${index || ""}`);
      assert.equal(number(await insert("ORIGINAL", "original")), 0);
    };
    const insert = (kind, key, shiftId = shift) => pool.request().input("id", sql.UniqueIdentifier, randomUUID())
      .input("shift", sql.UniqueIdentifier, shiftId).input("kind", kind).input("key", key)
      .query(outcome("INSERT dbo.shift_cash_counts(id,shift_id,store_id,kind,counted_cash,client_key,created_at) VALUES(@id,@shift,N'fixture',@kind,100,@key,'2026-11-02T03:00:00Z');"));
    const image = async () => (await pool.request().query("SELECT * FROM dbo.shift_cash_counts ORDER BY id FOR JSON PATH,INCLUDE_NULL_VALUES;")).recordset;
    const indexes = async () => (await pool.request().query("SELECT name,type,is_unique,is_disabled,has_filter,filter_definition FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.shift_cash_counts') ORDER BY name FOR JSON PATH,INCLUDE_NULL_VALUES;")).recordset;
    await reset("CREATE UNIQUE INDEX UX_shift_cash_counts_shift_id ON dbo.shift_cash_counts(shift_id);");
    await test("real legacy index upgrades without rewriting original facts", async () => {
      const before = await image(); await pool.request().batch(migration); assert.deepEqual(await image(), before);
      const index = (await pool.request().query("SELECT has_filter,filter_definition FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND name=N'UX_shift_cash_counts_shift_id';")).recordset[0];
      assert.equal(index.has_filter, true); assert.match(index.filter_definition, /ORIGINAL/);
    });
    await test("one original and multiple recounts preserve unique client keys", async () => {
      assert.equal(number(await insert("RECOUNT", "recount-1")), 0); assert.equal(number(await insert("RECOUNT", "recount-2")), 0);
      assert([2601,2627].includes(number(await insert("ORIGINAL", "different-original"))));
      assert([2601,2627].includes(number(await insert("RECOUNT", "recount-1"))));
      assert.equal((await pool.request().query("SELECT COUNT(*) n FROM dbo.shift_cash_counts;")).recordset[0].n, 3);
    });
    await test("actual cloud client downloads another recount under local index parity", async () => {
      const client = new CloudClient({});
      class FixturePool extends sql.ConnectionPool {
        constructor(config) {
          assert(config.connectionString.includes(`Server=tcp:(localdb)\\${instance};`));
          // LocalDB has no TCP listener. Substitute only this invocation's
          // verified private pipe; keep the actual manager/driver SET defaults.
          super({...config,connectionString:config.connectionString.replace(/Server=[^;]+;/,`Server=${server};`)});
        }
      }
      const manager = new ConnectionManager({driver:{...sql,ConnectionPool:FixturePool}});
      try {
        await manager.open({host:"(localdb)",instanceName:instance,database,authMode:"windows",encrypt:false,trustServerCertificate:true,connectionTimeoutMs:8000,requestTimeoutMs:10000});
        const options = (await manager.pool.request().query("SELECT SESSIONPROPERTY('ANSI_NULLS') ansi_nulls,SESSIONPROPERTY('QUOTED_IDENTIFIER') quoted_identifier,SESSIONPROPERTY('ANSI_PADDING') ansi_padding,SESSIONPROPERTY('ANSI_WARNINGS') ansi_warnings,SESSIONPROPERTY('ARITHABORT') arithabort,SESSIONPROPERTY('CONCAT_NULL_YIELDS_NULL') concat_null,SESSIONPROPERTY('NUMERIC_ROUNDABORT') numeric_roundabort;")).recordset[0];
        // ODBC's explicit ARITHABORT bit can be OFF while ANSI_WARNINGS makes
        // its arithmetic behavior implicit. Prove filtered-index DML below
        // using the untouched runtime connection instead of changing options.
        for(const [name,value] of Object.entries(options)) if(name !== "arithabort") assert.equal(value,name === "numeric_roundabort" ? 0 : 1,name);
        await client.applyLocalBatchToPool(manager, table, [{ row_data: {
          id: randomUUID(), shift_id: shift, store_id: "fixture", kind: "RECOUNT", counted_cash: 120,
          client_key: "cloud-recount", created_at: "2026-11-02T03:00:00Z",
        } }], {branchId:"fixture"});
      } finally { await manager.close(); }
      assert.equal((await pool.request().query("SELECT COUNT(*) n FROM dbo.shift_cash_counts;")).recordset[0].n, 4);
    });
    await test("a duplicate original rolls back the preceding recount in the same transaction", async () => {
      const before = await image(); const tx = new sql.Transaction(pool); await tx.begin();
      try {
        await new sql.Request(tx).input("shift", sql.UniqueIdentifier, shift).query("INSERT dbo.shift_cash_counts(id,shift_id,store_id,kind,counted_cash,created_at) VALUES(NEWID(),@shift,N'fixture',N'RECOUNT',120,SYSDATETIMEOFFSET());");
        await assert.rejects(new sql.Request(tx).input("shift", sql.UniqueIdentifier, shift).query("INSERT dbo.shift_cash_counts(id,shift_id,store_id,kind,counted_cash,created_at) VALUES(NEWID(),@shift,N'fixture',N'ORIGINAL',120,SYSDATETIMEOFFSET());"));
      } finally { await tx.rollback(); }
      assert.deepEqual(await image(), before);
    });
    await test("concurrent independent connections cannot create two originals", async () => {
      other = await connect(database); const concurrentShift = randomUUID();
      const create = connection => connection.request().input("shift", sql.UniqueIdentifier, concurrentShift).query(outcome("INSERT dbo.shift_cash_counts(id,shift_id,store_id,kind,counted_cash,created_at) VALUES(NEWID(),@shift,N'fixture',N'ORIGINAL',100,SYSDATETIMEOFFSET());"));
      const results = (await Promise.all([create(pool), create(other)])).map(number);
      assert.equal(results.filter(result => result === 0).length, 1);
      assert.equal(results.filter(result => [2601,2627].includes(result)).length, 1);
    });
    await test("reapplication preserves index and row before-images", async () => {
      const rows = await image(), metadata = await indexes(); await pool.request().batch(migration);
      assert.deepEqual(await image(), rows); assert.deepEqual(await indexes(), metadata);
    });
    for (const [name, index, types] of [
      ["wrong key", "CREATE UNIQUE INDEX UX_shift_cash_counts_shift_id ON dbo.shift_cash_counts(id);"],
      ["included column", "CREATE UNIQUE INDEX UX_shift_cash_counts_shift_id ON dbo.shift_cash_counts(shift_id) INCLUDE(store_id);"],
      ["descending key", "CREATE UNIQUE INDEX UX_shift_cash_counts_shift_id ON dbo.shift_cash_counts(shift_id DESC);"],
      ["wrong filter", "CREATE UNIQUE INDEX UX_shift_cash_counts_shift_id ON dbo.shift_cash_counts(shift_id) WHERE kind=N'UNKNOWN';"],
      ["nonunique", "CREATE INDEX UX_shift_cash_counts_shift_id ON dbo.shift_cash_counts(shift_id);"],
      ["unknown other index", "CREATE UNIQUE INDEX operator_shift_counts ON dbo.shift_cash_counts(shift_id);"],
      ["operator RECOUNT filter", "CREATE UNIQUE INDEX operator_shift_counts ON dbo.shift_cash_counts(shift_id) WHERE kind=N'RECOUNT';"],
      ["operator nonnull filter", "CREATE UNIQUE INDEX operator_shift_counts ON dbo.shift_cash_counts(shift_id) WHERE shift_id IS NOT NULL;"],
      ["operator shift/kind key", "CREATE UNIQUE INDEX operator_shift_counts ON dbo.shift_cash_counts(shift_id,kind);", {kind:"nvarchar(8)"}],
      ["operator shift/actor key", "CREATE UNIQUE INDEX operator_shift_counts ON dbo.shift_cash_counts(shift_id,counted_by_staff_id);", {counted_by_staff_id:"nvarchar(128)"}],
      ["IGNORE_DUP_KEY option", "CREATE UNIQUE INDEX UX_shift_cash_counts_shift_id ON dbo.shift_cash_counts(shift_id) WITH(IGNORE_DUP_KEY=ON);"],
      ["fill factor option", "CREATE UNIQUE INDEX UX_shift_cash_counts_shift_id ON dbo.shift_cash_counts(shift_id) WITH(FILLFACTOR=80);"],
      ["operator lock option", "CREATE UNIQUE INDEX UX_shift_cash_counts_shift_id ON dbo.shift_cash_counts(shift_id) WITH(ALLOW_PAGE_LOCKS=OFF);"],
      ["operator compression", "CREATE UNIQUE INDEX UX_shift_cash_counts_shift_id ON dbo.shift_cash_counts(shift_id) WITH(DATA_COMPRESSION=ROW);"],
    ]) await test("refuses " + name + " before DDL/data changes", async () => {
      await reset(index, types); const rows = await image(), metadata = await indexes();
      assert.equal(number(await pool.request().batch(outcome(migration))), 51021);
      assert.deepEqual(await image(), rows); assert.deepEqual(await indexes(), metadata);
    });
    await test("refuses a disabled named index before DDL", async () => {
      await reset("CREATE UNIQUE INDEX UX_shift_cash_counts_shift_id ON dbo.shift_cash_counts(shift_id); ALTER INDEX UX_shift_cash_counts_shift_id ON dbo.shift_cash_counts DISABLE;");
      const metadata = await indexes(); assert.equal(number(await pool.request().batch(outcome(migration))), 51021); assert.deepEqual(await indexes(), metadata);
    });
    await test("duplicate original data remains unchanged and blocks index creation", async () => {
      await reset(); assert.equal(number(await insert("ORIGINAL", "second-original")), 0); const rows = await image(), metadata = await indexes();
      assert.equal(number(await pool.request().batch(outcome(migration))), 51021);
      assert.deepEqual(await image(), rows); assert.deepEqual(await indexes(), metadata);
    });
    await test("unsupported kind/default remains unchanged and blocks DDL", async () => {
      await reset(); assert.equal(number(await insert("UNKNOWN", "invalid-kind")), 0);
      const rows = await image(), metadata = await indexes();
      assert.equal(number(await pool.request().batch(outcome(migration))), 51021);
      assert.deepEqual(await image(), rows); assert.deepEqual(await indexes(), metadata);
      await reset();
      const name = (await pool.request().query("SELECT dc.name FROM sys.default_constraints dc JOIN sys.columns c ON c.default_object_id=dc.object_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND c.name=N'kind';")).recordset[0].name;
      assert(/^DF__/.test(name));
      await pool.request().batch(`ALTER TABLE dbo.shift_cash_counts DROP CONSTRAINT [${name}]; ALTER TABLE dbo.shift_cash_counts ADD DEFAULT ('RECOUNT') FOR kind;`);
      const before = await image(); assert.equal(number(await pool.request().batch(outcome(migration))), 51021); assert.deepEqual(await image(), before);
    });
    await test("actual replay verifier accepts an old recount after a later correction and rejects changed intent", async () => {
      await reset(); await pool.request().batch(migration);
      for (const name of ["shifts","shift_reconciliations","shift_close_events","shift_notifications","shift_variance_alerts"]) {
        const metadata = registry.tables.find(table => table.cloudTable === name);
        await pool.request().batch(`CREATE TABLE dbo.[${name}](${metadata.columns.map(column => `[${column.sqlServerColumn}] ${column.sqlServerType} ${column.sqlServerColumn === "id" ? "NOT NULL" : "NULL"}`).join(",")},PRIMARY KEY(id));`);
      }
      const write = async (name,row) => {
        const request = pool.request(), entries = Object.entries(row);
        entries.forEach(([,value],index) => request.input("fixtureValue"+index, value && typeof value === "object" ? JSON.stringify(value) : value));
        await request.query(`INSERT dbo.[${name}](${entries.map(([key])=>`[${key}]`).join(",")}) VALUES(${entries.map((_,index)=>"@fixtureValue"+index).join(",")});`);
      };
      await write("shifts",{id:shift,store_id:"fixture",terminal_id:"terminal",state:"CLOSED",status:"CLOSED",closed_at:"2026-11-02T03:00:00Z",row_version:99,
        counted_cash:130,final_counted_cash:130,counted_card:null,counted_digital:null,expected_cash:100,expected_card:0,expected_digital:0,
        variance_cash:30,variance_card:null,variance_digital:null,variance_total:30,variance_status:"OVER"});
      for (const [cash,key,time] of [[120,"historical-recount","2026-11-02T03:30:00Z"],[130,"later-recount","2026-11-02T04:00:00Z"]]) {
        const countId = randomUUID();
        await write("shift_cash_counts",{id:countId,shift_id:shift,store_id:"fixture",terminal_id:"terminal",kind:"RECOUNT",counted_cash:cash,counted_card:null,counted_digital:null,
          client_key:key,reason:"Reviewed",counted_by_name:"manager",counted_by_staff_id:"manager",created_at:time});
        await write("shift_reconciliations",{id:randomUUID(),shift_id:shift,store_id:"fixture",count_id:countId,expected_cash:100,expected_card:0,expected_digital:0,
          counted_cash:cash,counted_card:null,counted_digital:null,variance_cash:cash-100,variance_card:null,variance_digital:null,variance_total:cash-100,variance_status:"OVER",created_at:time});
        await write("shift_close_events",{id:randomUUID(),shift_id:shift,store_id:"fixture",terminal_id:"terminal",event:"recount_submitted",to_state:"CLOSED",
          detail:{count_id:countId,reason:"Reviewed"},actor_name:"manager",actor_staff_id:"manager",created_at:time});
      }
      const writer = new ShiftSyncJournal({connectionManager:{pool,sql:()=>sql},tables:new Map(registry.tables.map(table=>[table.sqlServerTable,table]))});
      const intent = {branchId:"fixture",shiftId:shift,clientKey:"historical-recount",reason:"Reviewed",actor:"manager",terminalId:"terminal",cash:120,card:null,digital:null};
      const before = await image(); assert.equal(await writer.recountReplay(intent),true); assert.deepEqual(await image(),before);
      await assert.rejects(writer.recountReplay({...intent,cash:121}),error=>error.code === "EIDEMPOTENCY");
      await assert.rejects(writer.recountReplay({...intent,branchId:"foreign"}),error=>error.code === "SYNC_BRANCH_FORBIDDEN");
    });
    console.log(`${passed} isolated LocalDB scenarios passed; no POS database/profile used.`);
  } finally {
    if (other) await other.close(); if (pool) await pool.close();
    if (databaseCreated) {
      assert(owned && /^Shift34Fixture_[a-f0-9]{32}$/.test(database));
      await master.request().query(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}];`);
    }
    if (master) await master.close();
    if (owned) {
      assert(/^CodexShift34_[a-f0-9]{32}$/.test(instance));
      control("stop", instance, "-k"); control("delete", instance);
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
