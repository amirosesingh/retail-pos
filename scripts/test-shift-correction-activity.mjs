// Disposable PostgreSQL only. No URL, profile or existing database accepted.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
assert.equal(process.argv.length, 2, 'No database/connection arguments are accepted.');
const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8').then(value => value.replaceAll('\r\n', '\n'));
const schema = await read('supabase/schema.sql');
const migration = await read('supabase/migrations/20261102104005_fix_closed_shift_correction_activity_type.sql');
const signature = 'public.pos_admin_correct_closed_shift(uuid,numeric,numeric,numeric,text,text,text,text,text)';
const fn = name => {
  const start = schema.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`); assert(start >= 0, name);
  const tail = schema.slice(start), delimiter = tail.match(/\bAS\s+(\$[\w]*\$)/i)?.[1]; assert(delimiter, name);
  const begin = tail.indexOf(delimiter); return tail.slice(0, tail.indexOf(delimiter + ';', begin + delimiter.length) + delimiter.length + 1);
};
const table = name => { const start = schema.indexOf(`CREATE TABLE IF NOT EXISTS public.${name} (`); assert(start >= 0, name); return schema.slice(start, schema.indexOf('\n);', start) + 3); };
const oldColumns = 'INSERT INTO public.activity_events\n    (severity, title, message, actor_id, actor_name, actor_role, terminal_id, store_id,';
const newColumns = 'INSERT INTO public.activity_events\n    (event_type, severity, title, message, actor_id, actor_name, actor_role, terminal_id, store_id,';
const oldValues = "VALUES\n    ('warning', 'Closed shift corrected',";
const newValues = "VALUES\n    ('shift_close_corrected', 'warning', 'Closed shift corrected',";
const db = new PGlite(), shift = randomUUID(), clientKey = randomUUID();
const scalar = async (query, args = []) => Object.values((await db.query(query, args)).rows[0])[0];
const definition = () => scalar('SELECT pg_get_functiondef($1::regprocedure)', [signature]);
const metadata = () => db.query('SELECT oid,proowner,proacl,proconfig,prosecdef,provolatile,proparallel,prorettype,pg_get_function_arguments(oid) args FROM pg_proc WHERE oid=$1::regprocedure', [signature]).then(result => result.rows[0]);
const image = async () => Object.fromEntries(await Promise.all(['shifts', 'shift_cash_counts', 'shift_reconciliations', 'record_edits', 'activity_events'].map(async name => [name, (await db.query(`SELECT to_jsonb(t) value FROM public.${name} t ORDER BY id`)).rows.map(row => row.value)])));
const correct = (cash = 130, key = clientKey) => scalar(`SELECT public.pos_admin_correct_closed_shift($1::uuid,$2::numeric,NULL,NULL,'Approved test correction','admin-id','Administrator','terminal',$3)`, [shift, cash, key]);
let passed = 0;
const test = async (name, work) => { await work(); passed++; console.log('PASS ' + name); };
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE fixture_grantee;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE TABLE pos_settings(id int,notification_settings jsonb); INSERT INTO pos_settings VALUES(1,'{}');
    CREATE TABLE authorization_requests(id uuid PRIMARY KEY,status text,consumed_at timestamptz);
    ${table('shifts')}
    ALTER TABLE shifts ADD PRIMARY KEY(id), ADD COLUMN state text, ADD COLUMN close_reason text, ADD COLUMN closing_started_at timestamptz,
      ADD COLUMN closing_started_by text, ADD COLUMN final_counted_cash numeric, ADD COLUMN variance_status text;
    ${['shift_cash_counts','shift_reconciliations','record_edits','activity_events','sales'].map(table).join('\n')}
    ALTER TABLE activity_events ADD PRIMARY KEY(id);
    ${table('notification_deliveries')}
    CREATE UNIQUE INDEX fixture_original ON shift_cash_counts(shift_id) WHERE kind='ORIGINAL';
    CREATE UNIQUE INDEX fixture_client ON shift_cash_counts(client_key) WHERE client_key IS NOT NULL;
    CREATE UNIQUE INDEX fixture_activity ON activity_events(client_event_id);
    ${['shift_expected_totals','shifts_guard_client_writes','shift_records_immutable','apply_in_app_notification_preference','pos_resolve_late_approval_notification','queue_notification_rule_deliveries','pos_admin_correct_closed_shift'].map(fn).join('\n')}
    CREATE TRIGGER shifts_guard_client_writes BEFORE INSERT OR UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION shifts_guard_client_writes();
    CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON shift_cash_counts FOR EACH ROW EXECUTE FUNCTION shift_records_immutable();
    CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON shift_reconciliations FOR EACH ROW EXECUTE FUNCTION shift_records_immutable();
    CREATE TRIGGER apply_in_app_notification_preference BEFORE INSERT ON activity_events FOR EACH ROW EXECUTE FUNCTION apply_in_app_notification_preference();
    CREATE TRIGGER pos_resolve_late_approval_notification BEFORE INSERT ON activity_events FOR EACH ROW EXECUTE FUNCTION pos_resolve_late_approval_notification();
    CREATE TRIGGER queue_notification_rule_deliveries AFTER INSERT ON activity_events FOR EACH ROW EXECUTE FUNCTION queue_notification_rule_deliveries();
    REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,anon,authenticated;
    GRANT EXECUTE ON FUNCTION ${signature} TO service_role,fixture_grantee;
    ALTER FUNCTION ${signature} SET statement_timeout='3s';
    SET pos.shift_fn='on';`);
  await db.query("INSERT INTO shifts(id,store_id,terminal_id,opened_by_name,opening_float,status,state,opened_at,closed_at,counted_cash,final_counted_cash,closing_float,expected_cash,expected_card,expected_digital,variance_cash,variance_total,variance_status) VALUES($1,'branch','terminal','Original cashier',20,'CLOSED','CLOSED','2026-11-01T01:00:00.123456Z','2026-11-01T09:00:00.654321Z',100,100,100,100,0,0,0,0,'NO_VARIANCE')", [shift]);
  await db.query("INSERT INTO sales(id,bill_number,store_id,shift_id,total_amount,payment_type,payments) VALUES($1,'TEST-1','branch',$2,80,'cash','[]')", [randomUUID(), shift]);
  await db.query("WITH c AS(INSERT INTO shift_cash_counts(shift_id,store_id,kind,counted_cash,counted_by_name,client_key) VALUES($1,'branch','ORIGINAL',100,'Original cashier','original') RETURNING id) INSERT INTO shift_reconciliations(shift_id,store_id,count_id,expected_cash,expected_card,expected_digital,counted_cash,variance_cash,variance_total,variance_status) SELECT $1,'branch',id,100,0,0,100,0,0,'NO_VARIANCE' FROM c", [shift]);
  await db.exec("SET pos.shift_fn=''");
  const beforeDefinition = await definition(), beforeMetadata = await metadata(), original = await image();
  await test('current canonical web routine reproduces missing required event_type and rolls back all earlier writes', async () => {
    await assert.rejects(correct(), /null value in column "event_type"/); assert.deepEqual(await image(), original);
  });
  await test('migration and canonical append are byte-equivalent and change only the reviewed event INSERT', async () => {
    const block = schema.split('-- SHIFT_CORRECTION_ACTIVITY_TYPE_BEGIN\n')[1]?.split('-- SHIFT_CORRECTION_ACTIVITY_TYPE_END')[0];
    assert.equal(block?.trim(), migration.trim()); await db.exec(migration);
    assert.equal(await definition(), beforeDefinition.replace(oldColumns, newColumns).replace(oldValues, newValues));
    assert.deepEqual(await metadata(), beforeMetadata);
  });
  await test('fixed real routine preserves expected totals, original timestamps, actors and complete audit defaults', async () => {
    const result = await correct(); assert.equal(result.ok, true); assert.equal(result.replayed, false);
    assert.equal(Number(result.variance_total), 30); assert.equal(result.variance_status, 'OVER');
    const saved = await image(), parent = saved.shifts[0], event = saved.activity_events[0];
    assert.equal(Number(parent.counted_cash), 130); assert.equal(Number(parent.expected_cash), 100);
    assert.equal(parent.closed_at, original.shifts[0].closed_at); assert.equal(parent.opened_at, original.shifts[0].opened_at);
    assert.equal(event.event_type, 'shift_close_corrected'); assert.equal(event.title, 'Closed shift corrected');
    assert.equal(event.actor_id, 'admin-id'); assert.equal(event.actor_role, 'admin'); assert.equal(event.store_id, 'branch');
    assert.equal(event.client_event_id, 'shift-correction:' + clientKey); assert.equal(event.whatsapp_status, 'skipped');
    assert(event.id && event.created_at && event.meta.reconciliation_id); assert.equal(saved.shift_cash_counts.length, 2);
    assert.equal(saved.record_edits[0].action_key, 'SHIFT_CLOSE_CORRECTED'); assert.deepEqual(saved.record_edits[0].stock_deltas, {});
  });
  await test('exact saved retry emits no second event/count/reconciliation; changed retry retains saved facts', async () => {
    const saved = await image(); assert.equal((await correct()).replayed, true); assert.deepEqual(await image(), saved);
    await assert.rejects(correct(131), /different counted amounts/); assert.deepEqual(await image(), saved);
  });
  await test('failure after financial writes rolls back atomically and the identical correction can retry', async () => {
    const saved = await image(), retry = randomUUID();
    await db.exec("CREATE FUNCTION fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$; CREATE TRIGGER fixture_failure BEFORE INSERT ON record_edits FOR EACH ROW EXECUTE FUNCTION fixture_failure();");
    await assert.rejects(correct(140, retry), /fixture audit failure/); assert.deepEqual(await image(), saved);
    await db.exec('DROP TRIGGER fixture_failure ON record_edits; DROP FUNCTION fixture_failure();');
    assert.equal((await correct(140, retry)).replayed, false); assert.equal((await correct(140, retry)).replayed, true);
    assert.equal((await image()).activity_events.length, 2);
  });
  await test('idempotent reapplication retains function OID, ACL, owner, config and all business records', async () => {
    const saved = await image(), fixedDefinition = await definition(); await db.exec(migration);
    assert.equal(await definition(), fixedDefinition); assert.deepEqual(await metadata(), beforeMetadata); assert.deepEqual(await image(), saved);
    for (const role of ['anon', 'authenticated']) { await db.exec('SET ROLE ' + role); await assert.rejects(correct(), /permission denied for function/); await db.exec('RESET ROLE'); }
  });
  await test('unknown routine shape aborts without rewriting it or any business row', async () => {
    const fixed = await definition(), changed = fixed.replace("'shift_close_corrected'", "'unreviewed_event'");
    assert.notEqual(fixed, changed); await db.exec(changed); const saved = await image();
    await assert.rejects(db.exec(migration), /SHIFT_CORRECTION_ACTIVITY_UNRECOGNIZED_ROUTINE/); await db.exec('ROLLBACK');
    assert.equal(await definition(), changed); assert.deepEqual(await image(), saved); await db.exec(fixed);
  });
  await test('missing prerequisite aborts and cannot invent a replacement routine', async () => {
    await db.exec(`DROP FUNCTION ${signature};`); await assert.rejects(db.exec(migration), /SHIFT_CORRECTION_ACTIVITY_REQUIRES_REVIEWED_ROUTINE/);
    await db.exec('ROLLBACK'); assert.equal(await scalar('SELECT to_regprocedure($1)', [signature]), null);
  });
  console.log(`PASS ${passed} isolated web correction audit-event scenarios; no live database used`);
} finally { await db.close(); }
