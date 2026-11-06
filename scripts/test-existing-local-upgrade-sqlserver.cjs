// Actual SQL engine acceptance; only a new, uniquely owned LocalDB instance.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { digest, renderExistingLocalUpgrade } = require("./lib/existing-local-upgrade.cjs");
async function main() {
  assert.deepEqual(process.argv.slice(2), ["--run"], "Only --run is accepted; never a connection argument");
  const sql = require("mssql/msnodesqlv8");
  const suffix = randomUUID().replaceAll("-", ""), instance = "CodexAtomic_" + suffix, database = "AtomicFixture_" + suffix;
  let owned = false, created = false, master, pool, server, guid, passed = 0;
  const control = (...args) => {
    const r = spawnSync("C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe", args, { windowsHide: true, timeout: 30000 });
    const decode = v => (v ?? Buffer.alloc(0)).toString(v?.includes(0) ? "utf16le" : "utf8").replace(/^\uFEFF/, "");
    const text = decode(r.stdout), error = decode(r.stderr);
    assert(!r.error && r.status === 0 && !/failed|unexpected error/i.test(text + error), text + error); return text;
  };
  const connect = name => new sql.ConnectionPool({ connectionString: `Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`, pool: { min: 0, max: 2 }, requestTimeout: 20000 }).connect();
  const modules = ["025_shift_financial_bases", "026_shift_financial_operations", "027_shift_branch_sharing"].map(id => {
    const text = readFileSync("database/sqlserver/prepared/" + id + ".sql", "utf8");
    return { id, sql: text, sha256: digest(text), standaloneGuard: true };
  });
  const artifact = list => renderExistingLocalUpgrade({ version: "1.4.82", modules: list, coreValidation: "IF OBJECT_ID(N'dbo.products',N'U') IS NULL THROW 51028,'Missing synthetic core',1;" }).sql;
  const test = async (name, run) => { await run(); passed++; console.log("PASS " + name); };
  const snapshot = async () => (await pool.request().query("SELECT id,payload FROM dbo.products ORDER BY id;SELECT version FROM dbo.pos_schema_migrations ORDER BY version;")).recordsets.map(rows => Array.from(rows));
  try {
    control("create", instance, "-s"); owned = true;
    server = control("info", instance).match(/np:\\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query/)?.[0]; assert(server);
    master = await connect("master"); await master.request().batch(`CREATE DATABASE [${database}]`); created = true; pool = await connect(database);
    guid = (await pool.request().query("SELECT CONVERT(varchar(36),database_guid) guid FROM sys.database_recovery_status WHERE database_id=DB_ID();")).recordset[0].guid;
    await pool.request().input("owner", sql.NVarChar(128), suffix).query("EXEC sys.sp_addextendedproperty @name=N'CodexAtomicFixtureOwner',@value=@owner;");
    await pool.request().batch("CREATE TABLE dbo.pos_schema_migrations(version int PRIMARY KEY);INSERT dbo.pos_schema_migrations VALUES(24);CREATE TABLE dbo.products(id int PRIMARY KEY,payload nvarchar(200));INSERT dbo.products VALUES(1,N'synthetic stock sales queue permissions unchanged');CREATE TABLE dbo.pos_store_settings(allow_multiple_shifts_per_terminal bit NULL);");
    const before = await snapshot(), complete = artifact(modules);
    await test("reject caller transaction without rolling back its saved work", async () => {
      const tx = new sql.Transaction(pool); await tx.begin();
      try {
        await new sql.Request(tx).query("SET XACT_ABORT ON;INSERT dbo.products VALUES(2,N'owned caller work');");
        await assert.rejects(new sql.Request(tx).batch(complete));
        const row = (await new sql.Request(tx).query("SELECT XACT_STATE() state,@@TRANCOUNT depth,(SELECT COUNT(*) FROM dbo.products WHERE id=2) retained;")).recordset[0];
        assert.deepEqual(row, { state: 1, depth: 1, retained: 1 });
      } finally { await tx.rollback(); }
      assert.deepEqual(await snapshot(), before);
    });
    await test("a late module failure rolls back all earlier metadata modules", async () => {
      const body = "SET XACT_ABORT ON;BEGIN TRANSACTION;THROW 51028,'Owned late failure',1;COMMIT;";
      await assert.rejects(pool.request().batch(artifact([...modules, { id: "099_failure", sql: body, sha256: digest(body) }])));
      const row = (await pool.request().query("SELECT OBJECT_ID(N'dbo.pos_sync_shift_financial_bases') bases,OBJECT_ID(N'dbo.pos_sync_shift_financial_origins') origins,COL_LENGTH(N'dbo.pos_store_settings',N'allow_branch_shift_sharing') sharing;")).recordset[0];
      assert.deepEqual(row, { bases: null, origins: null, sharing: null }); assert.deepEqual(await snapshot(), before);
    });
    await test("successful composition commits metadata and preserves original business/ledger rows", async () => {
      await pool.request().batch(complete);
      const row = (await pool.request().query("SELECT CASE WHEN OBJECT_ID(N'dbo.pos_sync_shift_financial_bases') IS NOT NULL AND OBJECT_ID(N'dbo.pos_sync_shift_financial_origins') IS NOT NULL AND COL_LENGTH(N'dbo.pos_store_settings',N'allow_branch_shift_sharing') IS NOT NULL THEN 1 ELSE 0 END installed,@@TRANCOUNT depth;")).recordset[0];
      assert.deepEqual(row, { installed: 1, depth: 0 }); assert.deepEqual(await snapshot(), before);
    });
    await test("an unrecognized already-installed module aborts without partial repair", async () => {
      // Source026 intentionally rejects existing metadata. The final upgrader
      // still needs its separately reviewed exact-shape skip; this tests that
      // the assembler never converts that rejection into a success.
      await assert.rejects(pool.request().batch(complete)); assert.deepEqual(await snapshot(), before);
      assert.equal((await pool.request().query("SELECT COUNT(*) n FROM dbo.pos_sync_shift_financial_origins;")).recordset[0].n, 0);
    });
    console.log(`PASS ${passed} actual atomic-upgrade composition groups; final recovery/history artifact is still pending.`);
  } finally {
    if (created && pool) {
      const row = (await pool.request().query("SELECT DB_NAME() name,CONVERT(varchar(36),database_guid) guid,(SELECT CONVERT(nvarchar(128),value) FROM sys.extended_properties WHERE class=0 AND name=N'CodexAtomicFixtureOwner') owner FROM sys.database_recovery_status WHERE database_id=DB_ID();")).recordset[0];
      assert(owned && /^AtomicFixture_[a-f0-9]{32}$/.test(database) && row.name === database && row.guid === guid && row.owner === suffix, "Refuse cleanup of an unverified database");
    }
    await pool?.close();
    if (created) { assert(owned && guid && /^AtomicFixture_[a-f0-9]{32}$/.test(database)); await master.request().batch(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE [${database}]`); }
    await master?.close(); if (owned) { control("stop", instance, "-k"); control("delete", instance); console.log("Cleaned uniquely owned atomic-upgrade fixture"); }
  }
}
main().catch(error => { console.error(error.message); for (const item of error.precedingErrors ?? []) console.error(item.message); process.exitCode = 1; });
