'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { verifyPackage } = require('./prepare-stock-report-beta-db.cjs');
const { createActualStockWriter } = require('./lib/stock-actual-writer-fixture.cjs');
const { createLocal } = require('./lib/shift-protocol-integration-fixture.cjs');

assert.deepEqual(process.argv.slice(2), ['--run']);
const { manifest, payloads } = verifyPackage();

async function testHosted() {
  // Reuse the stock runner's owned localhost-only PostgreSQL transport.
  const fixture = fs.readFileSync('scripts/test-stock-history-concurrency-postgres.cjs', 'utf8');
  const boundary = fixture.indexOf('let started=false;const sessions=[];');
  assert(boundary > 0);
  const bootstrap = fixture.slice(0, boundary).replace('.tmp/stock-history-concurrency', '.tmp/stock401-package-pg');
  const { base, directory, command, freePort, connection } = new Function('require', 'process',
    bootstrap + ';return {base,directory,command,freePort,connection};')(require, process);
  let started = false, client;
  try {
    const port = await freePort();
    command('initdb', ['-D', directory, '-A', 'trust', '-U', 'postgres', '--encoding=UTF8', '--locale=C', '--no-instructions']);
    command('pg_ctl', ['-D', directory, '-l', path.join(directory, 'fixture.log'), '-o',
      `-h 127.0.0.1 -p ${port} -c max_connections=4 -c shared_buffers=32MB`, '-w', 'start'], { stdio: 'ignore' });
    started = true;
    client = connection(port);
    await client.ready;
    const sql = statement => client.query(statement);
    const fixtureLiteral = value => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
    const db = { exec: sql, query: async (statement, values = []) => ({
      rows: await sql(statement.replace(/\$(\d+)\b/g, (_, n) => fixtureLiteral(values[Number(n) - 1]))),
    }), close: () => {} };
    const f = await createActualStockWriter({ db, async installStockHistory() {
      await sql(`ALTER TABLE stores ADD COLUMN code text;
        CREATE SCHEMA supabase_migrations;
        CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
        INSERT INTO supabase_migrations.schema_migrations VALUES('20261121000000','existing_fixture',ARRAY['existing']);`);
      const [before] = await sql(payloads.preflight);
      assert.match(before.system_id, /^\d{19,20}$/);
      assert.notEqual(before.system_id, manifest.supabase.systemId);
      assert.equal(before.stock_relations, '0');
      await assert.rejects(sql(`BEGIN;${payloads.hosted}COMMIT;`), /STOCK401_BETA_TARGET_UNVERIFIED/);
      await sql('ROLLBACK;');
      console.log('PASS unchanged hosted payload refuses the unrelated physical PostgreSQL cluster');

      // The only fixture substitution is the immutable target identity.
      const testPayload = payloads.hosted.replace(manifest.supabase.systemId, before.system_id);
      const testLedger = `INSERT INTO supabase_migrations.schema_migrations VALUES('20261121000000',
        '${manifest.supabase.migrationName}',ARRAY['fixture transaction']);`;
      await assert.rejects(sql(`BEGIN;${testPayload}${testLedger}COMMIT;`), error => error.code === '23505');
      await sql('ROLLBACK;');
      assert.deepEqual((await sql(payloads.preflight))[0], before);
      const existing = await sql('SELECT name,statements FROM supabase_migrations.schema_migrations');
      assert.deepEqual(existing, [{ name: 'existing_fixture', statements: '{existing}' }]);
      console.log('PASS failed outer ledger insert rolls back all hosted tables, routines, grants and triggers');

      await sql(`BEGIN;${testPayload}${testLedger.replace('20261121000000', '20261121000001')}COMMIT;`);
      const [after] = await sql(payloads.postflight);
      assert.equal(after.system_id, before.system_id);
      assert.deepEqual(JSON.parse(after.tool_migration), [{ version: '20261121000001', name: manifest.supabase.migrationName, statements: 1 }]);
      assert.equal(after.capture_fingerprints_match, 't');
      assert.equal(after.enrolled_branches, '0');
      assert.equal(after.pause_leases, '0');
      assert.equal(after.opened_baselines, '0');
      assert.equal(after.replica_service_access, 't');
      assert.equal(after.replica_user_access, 'f');
      await assert.rejects(sql(`BEGIN;${testPayload}COMMIT;`), /STOCK401_EXISTING_SCHEMA_REVIEW_REQUIRED/);
      await sql('ROLLBACK;');
      assert.deepEqual((await sql(payloads.postflight))[0], after);
    } });
    assert.equal(await f.stock(), '10');
    console.log('PASS guarded hosted schema and one ledger row commit together with no baseline, lease or changes to fixture stock');
  } finally {
    client?.close();
    if (started) command('pg_ctl', ['-D', directory, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
    const target = path.resolve(directory);
    assert(target.startsWith(base + path.sep) && path.basename(target).startsWith('owned-'));
    fs.rmSync(target, { recursive: true });
  }
}

async function testWindows() {
  const identities = new Set();
  for (const slot of ['A', 'B']) {
    const f = await createLocal('stock401-approval-fixture', { extraTables: ['products'], stockReportSlot: slot });
    try {
      const request = () => f.manager.pool.request();
      const [target] = (await request().query(`SELECT DB_NAME() name,LOWER(CONVERT(varchar(36),database_guid)) guid
        FROM sys.database_recovery_status WHERE database_id=DB_ID();`)).recordset;
      assert.equal(target.name, 'POS_Stock401_Beta_Till_' + slot);
      assert(!identities.has(target.guid));
      identities.add(target.guid);
      const apply = guid => request().input('guid', guid).query(`
        DECLARE @reviewed uniqueidentifier=CONVERT(uniqueidentifier,@guid);
        EXEC sys.sp_set_session_context @key=N'pos_stock401_database_guid',@value=@reviewed;
        ${payloads.native}`);
      await assert.rejects(apply(randomUUID()), /STOCK401_BETA_NATIVE_TARGET_UNVERIFIED/);
      assert.equal((await request().query("SELECT OBJECT_ID(N'dbo.stock_history_heads',N'U') relation;")).recordset[0].relation, null);

      if (slot === 'A') {
        await request().query('CREATE TABLE dbo.stock_history_stocktake_fences(owned_fixture int);');
        await assert.rejects(apply(target.guid), /STOCK_HISTORY_STOCKTAKE_EXISTING_SCHEMA_REVIEW_REQUIRED/);
        const [rolledBack] = (await request().query(`SELECT OBJECT_ID(N'dbo.stock_history_heads',N'U') report,
          OBJECT_ID(N'dbo.stock_history_stocktake_fences',N'U') guard,
          (SELECT COUNT(1) FROM dbo.pos_schema_migrations WHERE version=31) ledger;`)).recordset;
        assert.equal(rolledBack.report, null);
        assert(rolledBack.guard);
        assert.equal(rolledBack.ledger, 0);
        await request().query('DROP TABLE dbo.stock_history_stocktake_fences;');
      }
      await apply(target.guid);
      const [installed] = (await request().query(`SELECT (SELECT COUNT(1) FROM dbo.pos_schema_migrations WHERE version=31) ledger,
        (SELECT COUNT(1) FROM dbo.stock_history_stocktake_fences) active,
        OBJECT_ID(N'dbo.TR_stock_history_stocktake_products',N'TR') fence;`)).recordset;
      assert.equal(installed.ledger, 1);
      assert.equal(installed.active, 0);
      assert(installed.fence);
      await assert.rejects(apply(target.guid), /STOCK_HISTORY_STOCKTAKE_EXISTING_SCHEMA_REVIEW_REQUIRED/);
    } finally { await f.close(); }
  }
  assert.equal(identities.size, 2);
  console.log('PASS exact Windows payload rolls back late failure, rejects wrong GUIDs and installs on two owned named fixtures without arming a fence');
}

(async () => {
  await testHosted();
  await testWindows();
})().catch(error => { console.error(error); process.exitCode = 1; });
