// Test infrastructure only: random owned LocalDB + in-memory PostgreSQL.
// No saved POS profile, connection URL, device credential or existing DB is read.
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { randomUUID, randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { tmpdir } = require('node:os');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');
const { runInNewContext } = require('node:vm');
const root = resolve(__dirname, '../..');
const read = name => readFileSync(resolve(root, name), 'utf8').replaceAll('\r\n', '\n');
const graphNames = ['shifts', 'shift_cash_counts', 'shift_reconciliations', 'shift_close_events', 'shift_notifications', 'shift_variance_alerts'];
const tableNames = [...graphNames, 'sales', 'sale_items', 'payment_transactions', 'activity_events', 'held_orders',
  'bookings', 'booking_items', 'booking_payments', 'pos_settings', 'stores', 'promotions', 'pos_store_settings'];
function sourceFunction(schema, name) {
  const start = schema.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert(start >= 0, `Missing current source function ${name}`);
  const tail = schema.slice(start), delimiter = tail.match(/\bAS\s+(\$[\w]*\$)/i)?.[1];
  assert(delimiter, name);
  const begin = tail.indexOf(delimiter), end = tail.indexOf(delimiter + ';', begin + delimiter.length);
  assert(end > begin, name);
  return tail.slice(0, end + delimiter.length + 1);
}
function sourceTable(schema, name) {
  const start = schema.indexOf(`CREATE TABLE IF NOT EXISTS public.${name} (`);
  assert(start >= 0, name);
  return schema.slice(start, schema.indexOf('\n);', start) + 3);
}
async function createCloud(branch, terminal, { financialRolloutStub = true } = {}) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(), schema = read('supabase/schema.sql');
  const fn = name => sourceFunction(schema, name), table = name => sourceTable(schema, name);
  try {
    // Isolated causal tests only. Full rollout certification explicitly disables
    // this stub and installs the actual default-deny approval/readiness policy.
    if (financialRolloutStub) await db.exec(`CREATE SCHEMA fin62_rollout_preparation;
      CREATE FUNCTION fin62_rollout_preparation.assert_approved(text,text,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;`);
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.auth_role',true) $$;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
      CREATE TABLE app_users(id uuid PRIMARY KEY,user_id text,auth_user_id uuid,role text,role_slug text,permissions jsonb,is_active boolean,store_id text);
      CREATE TABLE terminal_tokens(id text PRIMARY KEY,location_id text,status text,revoked_at timestamptz,platform text DEFAULT 'pc',is_claimed boolean DEFAULT true);
      CREATE TABLE stores(id text PRIMARY KEY,name text); CREATE TABLE pos_settings(id int,notification_settings jsonb);
      CREATE TABLE authorization_requests(id uuid PRIMARY KEY,store_id text,status text,consumed_at timestamptz);
      CREATE TABLE audit_logs(id uuid PRIMARY KEY,store_id text); CREATE TABLE held_orders(store_id text,shift_id text,status text);
      CREATE TABLE sync_idempotency_receipts(batch_id uuid PRIMARY KEY,organization_id text,branch_id text,table_name text,payload_hash text,applied_count int);
      CREATE TABLE sync_change_feed(cursor bigint GENERATED ALWAYS AS IDENTITY,organization_id text,branch_id text,terminal_id text,table_name text,entity_id text,operation text,row_version bigint,tombstone boolean,changed_at timestamptz DEFAULT now());
      ${table('shifts')}
      ALTER TABLE shifts ADD PRIMARY KEY(id), ADD COLUMN state text, ADD COLUMN close_reason text,
        ADD COLUMN closing_started_at timestamptz, ADD COLUMN closing_started_by text,
        ADD COLUMN final_counted_cash numeric, ADD COLUMN variance_status text;
      ${graphNames.slice(1).map(table).join('\n')}
      ${table('sales')}
      ALTER TABLE sales ADD PRIMARY KEY(id), ADD COLUMN branch_id text, ADD COLUMN corrected_at timestamptz;
      ${table('sale_items')}
      ALTER TABLE sale_items ADD PRIMARY KEY(id), ADD COLUMN branch_id text;
      ${table('payment_transactions')}
      ${table('activity_events')}
      ALTER TABLE activity_events ADD PRIMARY KEY(id), ADD COLUMN previous_state text, ADD COLUMN new_state text,
        ADD COLUMN cleared_by text[], ADD COLUMN branch_id text;
      ${table('record_edits')}
      CREATE UNIQUE INDEX fixture_original ON shift_cash_counts(shift_id) WHERE kind='ORIGINAL';
      CREATE UNIQUE INDEX fixture_activity ON activity_events(client_event_id);
      ${fn('pos_sync_validate_scope')}
      ${['pos_sync_assert_shift_ownership','pos_sync_shift_closure_ack','pos_sync_aggregate_shift_closure_ack'].map(fn).join('\n')}
      ${[...graphNames, 'sales', 'sale_items', 'payment_transactions', 'activity_events'].flatMap(name => [fn('sync_apply_' + name),fn('sync_delete_' + name)]).join('\n')}
      ${fn('pos_sync_push_batch')}${fn('pos_sync_push_aggregate')}
      ${['skip_stale_update','bump_row_version','shifts_guard_client_writes','update_updated_at_column','shifts_sync_status','guard_shift_unfinished_tickets','shift_records_immutable','sales_block_closing_shift','shift_expected_totals','pos_admin_correct_closed_shift'].map(fn).join('\n')}
      CREATE TRIGGER shifts_aa_stale_guard BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION skip_stale_update();
      CREATE TRIGGER shifts_bump_row_version BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION bump_row_version();
      CREATE TRIGGER shifts_guard_client_writes BEFORE INSERT OR UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION shifts_guard_client_writes();
      CREATE TRIGGER shifts_set_updated_at BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      CREATE TRIGGER shifts_sync_status_trg BEFORE INSERT OR UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION shifts_sync_status();
      CREATE TRIGGER shifts_unfinished_tickets BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION guard_shift_unfinished_tickets();
      CREATE TRIGGER sales_block_closing_shift BEFORE INSERT ON sales FOR EACH ROW EXECUTE FUNCTION sales_block_closing_shift();
      ${['shift_cash_counts','shift_reconciliations','shift_close_events'].map(name => `CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON ${name} FOR EACH ROW EXECUTE FUNCTION shift_records_immutable();`).join('\n')}
      SELECT set_config('test.auth_role','service_role',false);`);
    await db.query("INSERT INTO terminal_tokens(id,location_id,status,revoked_at) VALUES($1,$2,'active',NULL)", [terminal, branch]);
    for (const name of ['20261030153259_confirm_shift_closure_sync_acknowledgement', '20261030164829_bind_shift_closure_proof_to_requested_revision',
      '20261031031945_preserve_validated_branch_context_for_shift_sync', '20261101052452_prevent_closed_shift_reopening_during_sync',
      '20261102082439_shift_closing_causal_intents', '20261102104005_fix_closed_shift_correction_activity_type', '20261102101610_shift_author_key_registry', '20261102103716_enforce_shift_author_uploads', '20261102153013_bind_signed_closing_start_evidence']) await db.exec(read(`supabase/migrations/${name}.sql`));
    return db;
  } catch (error) { await db.close(); throw error; }
}
async function createLocal(branch) {
  assert.equal(process.platform, 'win32', 'The opt-in fixture needs Windows LocalDB.');
  const sql = require('mssql/msnodesqlv8');
  const suffix = randomUUID().replaceAll('-', ''), instance = 'CodexProtocol_' + suffix, database = 'ProtocolFixture_' + suffix;
  assert(/^CodexProtocol_[a-f0-9]{32}$/.test(instance) && /^ProtocolFixture_[a-f0-9]{32}$/.test(database));
  const control = (...args) => {
    const bytes = execFileSync('C:/Program Files/Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe', args,
      { windowsHide: true, timeout: 30000, stdio: 'pipe' });
    return bytes.toString(bytes.includes(0) ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
  };
  let server, master, pool, owned = false, created = false;
  const connect = name => new sql.ConnectionPool({
    connectionString: `Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${name};Trusted_Connection=Yes;Encrypt=No;TrustServerCertificate=Yes;`,
    options: { trustedConnection: true }, pool: { min: 0, max: 4 }, requestTimeout: 15000,
  }).connect();
  const close = async () => {
    await pool?.close();
    try { if (created && master) await master.request().batch(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}];`); }
    finally { await master?.close(); if (owned) { control('stop', instance, '-k'); control('delete', instance); } }
  };
  try {
    control('create', instance, '-s'); owned = true;
    server = control('info', instance).match(/np:\\\\\.\\pipe\\LOCALDB#[A-Fa-f0-9]+\\tsql\\query/)?.[0];
    assert(server, 'The new owned instance has no private pipe.');
    master = await connect('master');
    await master.request().batch(`CREATE DATABASE [${database}]; ALTER DATABASE [${database}] SET CHANGE_TRACKING=ON(CHANGE_RETENTION=2 DAYS,AUTO_CLEANUP=ON);`);
    created = true; pool = await connect(database);
    const fullRegistry = require(resolve(root, 'electron/db/schema-registry.cjs')).loadRegistry();
    const registry = { ...fullRegistry, tables: fullRegistry.tables.filter(table => tableNames.includes(table.cloudTable)) };
    for (const table of registry.tables) {
      const primary = table.columns.filter(column => column.primaryKey).map(column => column.sqlServerColumn);
      assert(primary.length);
      await pool.request().batch(`CREATE TABLE dbo.[${table.sqlServerTable}](${table.columns.map(column => `[${column.sqlServerColumn}] ${column.sqlServerType} ${primary.includes(column.sqlServerColumn) ? 'NOT NULL' : 'NULL'}`).join(',')},PRIMARY KEY(${primary.map(name => '[' + name + ']').join(',')}));
        ALTER TABLE dbo.[${table.sqlServerTable}] ENABLE CHANGE_TRACKING;`);
    }
    await pool.request().batch(`CREATE UNIQUE INDEX fixture_original ON dbo.shift_cash_counts(shift_id) WHERE kind=N'ORIGINAL';
      CREATE UNIQUE INDEX fixture_client ON dbo.shift_cash_counts(client_key) WHERE client_key IS NOT NULL;
      CREATE TABLE dbo.pos_schema_migrations(version int PRIMARY KEY,name nvarchar(200));
      CREATE TABLE dbo.local_operation_receipts(operation_id uniqueidentifier PRIMARY KEY,operation_type nvarchar(80),entity_id nvarchar(128),note nvarchar(max));
      CREATE TABLE dbo.sync_change_journal(change_id bigint IDENTITY PRIMARY KEY,entity_type nvarchar(128),entity_id nvarchar(400),operation nvarchar(16),branch_id nvarchar(128),entity_version bigint,aggregate_id uniqueidentifier,acknowledged_at datetimeoffset NULL,last_error nvarchar(1000),retry_count int NOT NULL DEFAULT(0));
      CREATE TABLE dbo.sync_checkpoints(organization_id nvarchar(128) NOT NULL DEFAULT(N'default'),branch_id nvarchar(128),entity_type nvarchar(128),direction nvarchar(10),change_tracking_version bigint,committed_cursor nvarchar(400),updated_at datetimeoffset);
      INSERT dbo.pos_settings(id,integration_settings) VALUES(1,N'{}');`);
    await pool.request().batch(read('database/sqlserver/migrations/022_shift_causal_intents.sql'));
    await pool.request().batch(read('database/sqlserver/migrations/023_shift_author_attestations.sql'));
    await pool.request().batch(read('database/sqlserver/migrations/024_shift_closing_start_proofs.sql'));
    const manager = { pool, sql: () => sql };
    const { OperationsRepository } = require(resolve(root, 'electron/db/repositories/operations.cjs'));
    const repository = new OperationsRepository(manager, registry);
    const insert = async (name, row) => {
      const table = registry.tables.find(table => table.cloudTable === name), request = pool.request();
      const entries = Object.entries(row);
      entries.forEach(([column, value], index) => {
        const meta = table.columns.find(item => item.sqlServerColumn === column);
        assert(meta, `${name}.${column}`);
        request.input('v' + index, value !== null && typeof value === 'object' && !(value instanceof Date) ? JSON.stringify(value) : value);
      });
      await request.query(`INSERT dbo.[${name}](${entries.map(([name]) => '[' + name + ']').join(',')}) VALUES(${entries.map((_, index) => '@v' + index).join(',')});`);
    };
    await insert('stores', { id: branch, name: 'Synthetic branch' });
    await pool.request().input('branch', branch).query(`INSERT dbo.sync_checkpoints(branch_id,entity_type,direction,change_tracking_version)
      SELECT @branch,name,N'push',CHANGE_TRACKING_CURRENT_VERSION() FROM sys.tables WHERE name IN(${registry.tables.map(table => "N'" + table.sqlServerTable + "'").join(',')});`);
    return { manager, registry, repository, insert, close,
      async restart() { await pool.close(); pool = await connect(database); manager.pool = pool; } };
  } catch (error) { await close(); throw error; }
}
function mainCalls(repository, writer, branch, terminal, session, shiftAuthority, financialRuntime = null) {
  const source = read('electron/main.cjs'), start = source.indexOf('async function startLocalShiftClose('), end = source.indexOf('\nfunction redactShiftRow(', start);
  assert(start >= 0 && end > start);
  const mainRequire = createRequire(resolve(root, 'electron/main.cjs'));
  const context = { require: mainRequire, shiftFinancialDraftProvider:null, localBranchId: () => branch, operationsRepository: repository, shiftSyncJournal: writer,
    guard: mainRequire('./ipc-guard.cjs'), recordId: mainRequire('./sync/uuid-fields.cjs').recordId, randomUUID, Date,
    shiftMoney: value => Math.round(Number(value ?? 0) * 100) / 100,
    adminSession: session, shiftAuthority,
    terminalStore: { read: () => ({ tokenId: terminal }) }, pendingShiftCloseSync: new Set(),
    publishBusinessChange() {}, scheduleAutomaticSync() {}, ...(financialRuntime ? {shiftFinancialRuntime:financialRuntime} : {}) };
  runInNewContext(source.slice(start, end) + '\nthis.calls={startLocalShiftClose,commitLocalShiftCashCount,commitLocalShiftRecount};', context);
  return context.calls;
}
// Only this randomly owned fixture directory is used. Encryption is a test
// adapter, not Electron safeStorage/DPAPI or a claim about installed vault access.
function createAuthorKeys() {
  const directory = mkdtempSync(resolve(tmpdir(), 'codex-shift-protocol-'));
  const secret = randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, iv);
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    decryptString(value) {
      const cipher = createDecipheriv('aes-256-gcm', secret, value.subarray(0, 12));
      cipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8');
    },
  };
  const reopen = () => require(resolve(root, 'electron/security/shift-author-key.cjs')).createShiftAuthorKeys({ safeStorage, directory: () => directory });
  return { keys: reopen(), reopen,
    close() { rmSync(directory, { recursive: true, force: true }); secret.fill(0); } };
}
module.exports = { createCloud, createLocal, mainCalls, graphNames, createAuthorKeys };
