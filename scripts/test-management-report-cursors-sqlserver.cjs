// Opt-in, uniquely owned disposable LocalDB. Never opens POS_Local or device profiles.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const sql = require('mssql/msnodesqlv8');
const { readManagementReport } = require('../electron/db/repositories/management-reports.cjs');
assert.deepEqual(process.argv.slice(2), ['--run']);
const suffix = randomUUID().replaceAll('-', ''), instance = 'CodexMgmtCursor_' + suffix, database = 'MgmtCursorFixture_' + suffix;
const control = (...args) => { const value = execFileSync('C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe', args,
  { windowsHide: true, timeout: 30000 }); return value.toString(value.includes(0) ? 'utf16le' : 'utf8').replace(/^\uFEFF/, ''); };
let owned = false, created = false, master, pool, server, groups = 0;
const connect = name => new sql.ConnectionPool({ connectionString: `Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`,
  pool: { min: 0, max: 3 }, requestTimeout: 10000 }).connect();
const pass = name => { groups++; console.log('PASS ' + name); };
const id = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000001`;
const seeds = [
  [id(2), '2026-11-01T10:00:00.1234567+00:00'],
  [id(1), '2026-11-01T10:00:00.1234567+00:00'],
  [id(9), '2026-11-01T10:00:00.1234566+00:00'],
  [id(8), '2026-11-01T18:00:00.1234565+08:00'],
  [id(7), '2026-11-01T06:00:00.1234565-04:00'],
  [id(6), '2026-11-01T10:00:00.0000000+00:00'],
  [id(5), '2026-11-01T00:00:00.0000000+00:00'],
  [id(4), '2026-10-31T23:59:59.9999999+00:00'],
  [id(3), '2026-11-02T00:00:00.0000000+00:00'],
  [id(14), '2026-11-02T00:00:00.0000000+08:00'],
  [id(13), '2026-11-01T23:59:59.9999999+08:00'],
];
const expected = [id(14), id(13), id(2), id(1), id(9), id(8), id(7), id(6), id(5)];
// Style127 may omit zero fractions and normalize offsets to UTC; SQL equality
// below proves precision, rather than mistaking formatting for completeness.
const exactTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/;
(async () => {
  try {
    control('create', instance, '-s'); owned = true;
    server = control('info', instance).match(/np:\\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query/)?.[0];
    assert(server, 'Owned LocalDB named pipe missing');
    assert(/^MgmtCursorFixture_[0-9a-f]{32}$/.test(database));
    master = await connect('master'); await master.request().batch(`CREATE DATABASE [${database}];`); created = true; pool = await connect(database);
    await pool.request().batch(`CREATE TABLE dbo.stores(id nvarchar(128) NOT NULL PRIMARY KEY);
      CREATE TABLE dbo.pos_jobs(branch_id nvarchar(128),job_type nvarchar(64),status nvarchar(32),updated_at datetimeoffset(7));
      CREATE TABLE dbo.products(id uniqueidentifier NOT NULL PRIMARY KEY,cost_price decimal(18,4));
      CREATE TABLE dbo.sales(id uniqueidentifier NOT NULL PRIMARY KEY,store_id nvarchar(128),created_at datetimeoffset(7),shift_id nvarchar(128),total_amount decimal(18,4),tax_amount decimal(18,4),rounding_adjustment decimal(18,4),is_refunded bit);
      CREATE TABLE dbo.sale_items(id uniqueidentifier NOT NULL PRIMARY KEY,sale_id uniqueidentifier,product_id uniqueidentifier,unit_cost decimal(18,4),quantity decimal(18,4));
      CREATE TABLE dbo.shifts(id uniqueidentifier NOT NULL PRIMARY KEY,store_id nvarchar(128),opened_at datetimeoffset(7),expected_cash decimal(18,4));
      INSERT dbo.stores VALUES(N'A'),(N'B');
      INSERT dbo.pos_jobs VALUES(N'A',N'bootstrap_7300',N'completed','2026-11-01T00:00:00+00:00'),(N'B',N'bootstrap_7300',N'completed','2026-11-01T00:00:00+00:00');`);
    const product = randomUUID(); await pool.request().input('id', product).query('INSERT dbo.products VALUES(@id,6);');
    for (const [value, timestamp] of seeds) {
      await pool.request().input('id', value).input('stamp', timestamp).input('item', randomUUID()).input('product', product).query(`
        INSERT dbo.shifts VALUES(@id,N'A',CONVERT(datetimeoffset(7),@stamp),99);
        INSERT dbo.sales VALUES(@id,N'A',CONVERT(datetimeoffset(7),@stamp),@id,10,0,0,0);
        INSERT dbo.sale_items VALUES(@item,@id,@product,12.345,1);`);
    }
    const foreign = id(99); await pool.request().input('id', foreign).query("INSERT dbo.sales VALUES(@id,N'B','2026-11-01T12:00:00.1234567+00:00',NULL,10,0,0,0);INSERT dbo.shifts VALUES(@id,N'B','2026-11-01T12:00:00.1234567+00:00',99);");
    const before = await pool.request().query('SELECT (SELECT COUNT(*) FROM dbo.sales) sales,(SELECT COUNT(*) FROM dbo.shifts) shifts,(SELECT COUNT(*) FROM dbo.sale_items) items,(SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.sales) sales_hash,(SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.shifts) shifts_hash;');
    const permissions = new Set(['can_view_sales_reports', 'can_open_shift']);
    const session = { hasPosAuthority: () => true, hasLevel: () => false, hasPermission: key => permissions.has(key), branchId: () => null, identity: () => ({ permissions: {} }) };
    const deps = { manager: { pool, isConnected: () => true }, databaseService: { snapshot: () => ({ tradingReady: true }) }, session, management: true };
    const options = { storeIds: ['A'], from: '2026-11-01', to: '2026-11-01', zone: 'UTC' };
    const seenPrivate = [];
    const redactShift = row => { seenPrivate.push(Object.hasOwn(row, '__pos_report_cursor_at')); const { expected_cash, ...rest } = row; return rest; };
    const read = (kind, patch = {}, dependencyPatch = {}) => readManagementReport({ ...deps, ...dependencyPatch, options: { ...options, kind, ...patch }, redactShift });
    const pages = async (kind, limit, patch = {}) => {
      let cursor = null; const rows = [], cursors = [];
      for (let count = 0; count < 30; count++) {
        const result = await read(kind, { limit, cursor, ...patch }); assert(result.complete); assert(result.rows.length <= limit);
        for (const row of result.rows) assert(!Object.hasOwn(row, '__pos_report_cursor_at'));
        rows.push(...result.rows);
        if (!result.hasMore) return { rows, cursors, last: result };
        assert(result.cursor && exactTime.test(result.cursor.ts), 'Full SQL time missing: ' + JSON.stringify(result.cursor));
        const original = seeds.find(([value]) => value === result.cursor.id)?.[1]; assert(original);
        const same = await pool.request().input('original', original).input('cursor', result.cursor.ts).query('SELECT CASE WHEN CONVERT(datetimeoffset(7),@original)=CONVERT(datetimeoffset(7),@cursor) THEN 1 ELSE 0 END same;');
        assert.equal(same.recordset[0].same, 1, 'A cursor lost SQL timestamp precision');
        assert.notDeepEqual(result.cursor, cursor); cursors.push(result.cursor); cursor = result.cursor;
      }
      assert.fail('Report cursor did not terminate');
    };
    for (const kind of ['sales', 'shifts']) for (const limit of [1, 2]) {
      const result = await pages(kind, limit); assert.deepEqual(result.rows.map(row => row.id), expected);
      assert.equal(new Set(result.rows.map(row => row.id)).size, expected.length);
      assert(result.cursors.some(cursor => cursor.ts.includes('.1234567')));
      if (limit === 1) assert.equal(result.last.cursor, null);
      pass(kind + ' limit' + limit + ' preserves100ns, same-time-ID, absolute-offset and date boundaries');
    }
    assert(seenPrivate.length && seenPrivate.every(value => value === false)); pass('Private SQL aliases are stripped before shift redaction and public row serialization');
    const exact = await read('sales', { limit: 1, cursor: { ts: '2026-11-01T10:00:00.1234567+00:00', id: id(2) } });
    assert.equal(exact.rows[0].id, id(1)); assert.equal(exact.rows[0].created_at, '2026-11-01T10:00:00.123Z');
    const old = await read('sales', { limit: 1, cursor: { ts: exact.rows[0].created_at, id: id(2) } });
    assert.notEqual(old.rows[0].id, id(1)); pass('Original millisecond boundary reproduces skipped rows; exact timestamp retains existing public Date shape');
    const offset = await read('sales', { limit: 1, cursor: { ts: '2026-11-01T18:00:00.1234565+08:00', id: id(8) } });
    assert.equal(offset.rows[0].id, id(7)); pass('Different offsets denoting the same instant retain descending ID continuation');
    const local = await pages('sales', 2, { zone: 'Asia/Brunei' });
    assert(local.rows.some(row => row.id === id(13))); assert(!local.rows.some(row => row.id === id(14))); pass('Local midnight upper boundary stays exclusive at100ns precision');
    for (const kind of ['sales', 'shifts']) {
      const empty = await read(kind, { from: '2026-11-10', to: '2026-11-10', limit: 1 });
      assert.deepEqual(empty.rows, []); assert.equal(empty.hasMore, false); assert.equal(empty.cursor, null);
    }
    pass('Empty pages retain null cursor and completion semantics');
    const hidden = await read('sales', { limit: 1 }); assert.equal(hidden.rows[0].sale_items[0].unit_cost, null);
    permissions.add('can_view_cost_margin'); const visible = await read('sales', { limit: 1 }); assert.equal(Number(visible.rows[0].sale_items[0].unit_cost), 12.345); permissions.delete('can_view_cost_margin');
    const masked = await read('shifts', { limit: 1 }); assert(!Object.hasOwn(masked.rows[0], 'expected_cash')); pass('Cost and shift amount redaction remain effective');
    await assert.rejects(() => read('sales', {}, { management: false }), { code: 'PERMISSION_DENIED' });
    await assert.rejects(() => read('sales', {}, { session: { ...session, branchId: () => 'B' } }), { code: 'PERMISSION_DENIED' });
    await assert.rejects(() => read('sales', {}, { session: { ...session, hasPermission: () => false } }), { code: 'PERMISSION_DENIED' });
    await assert.rejects(() => read('sales', {}, { databaseService: { snapshot: () => ({ tradingReady: false }) } }), { code: 'EDATABASE_NOT_READY' });
    pass('Normal-terminal, branch, permission and readiness denials remain');
    await pool.request().query("UPDATE dbo.pos_jobs SET status=N'running' WHERE branch_id=N'A';");
    await assert.rejects(() => read('sales'), { code: 'EMANAGEMENT_REPLICA_INCOMPLETE' });
    await pool.request().query("UPDATE dbo.pos_jobs SET status=N'completed' WHERE branch_id=N'A';"); pass('Incomplete replica cannot produce complete report pages');
    const after = await pool.request().query('SELECT (SELECT COUNT(*) FROM dbo.sales) sales,(SELECT COUNT(*) FROM dbo.shifts) shifts,(SELECT COUNT(*) FROM dbo.sale_items) items,(SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.sales) sales_hash,(SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.shifts) shifts_hash;');
    assert.deepEqual(after.recordset, before.recordset); pass('Read-only pagination preserves all synthetic business rows');
    console.log('PASS ' + groups + ' actual isolated SQL Server Management cursor groups');
  } finally {
    await pool?.close().catch(() => {});
    if (created) { assert(/^MgmtCursorFixture_[0-9a-f]{32}$/.test(database)); await master.request().batch(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;DROP DATABASE [${database}];`); }
    await master?.close().catch(() => {});
    if (owned) { control('stop', instance, '-k'); control('delete', instance); }
    console.log('Cleaned uniquely owned Management cursor LocalDB fixture');
  }
})().catch(error => { console.error(error.code ?? '', error.message); process.exitCode = 1; });
