// Isolated PostgreSQL fixtures only. Never reads project credentials or connects
// to the operator's database. The captured file contains routine source only.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8').then(text => text.replaceAll('\r\n', '\n'));
const migration = await read('supabase/migrations/20261103105157_preserve_shift_reconciliation_parent_summaries.sql');
const captured = await read('src/lib/__tests__/fixtures/shift-reconcile-now.live.sql');
const schema = await read('supabase/schema.sql');
const md5 = value => createHash('md5').update(value).digest('hex');
const body = text => text.match(/AS (\$[a-z_]*\$)([\s\S]*?)\1/i)?.[2];
const definition = (name, delimiter = '$$;') => {
  const start = schema.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  assert(start >= 0, name);
  const end = schema.indexOf(delimiter, start);
  assert(end > start, name);
  return schema.slice(start, end + delimiter.length);
};
const canonical = definition('public.shift_reconcile_now');
const caller = definition('public.shift_cash_count_submit');
const recount = definition('public.shift_recount_submit');
const graph = definition('pos_sync_private.shift_graph', '$fn$;');
const validate = definition('pos_sync_private.validate_graph', '$fn$;');
assert.equal(md5(body(captured)), '8e70ac04aaa3368aea5cbcbe9bd1434a');
assert.equal(md5(body(canonical)), 'c8d204768ba0a711946401920411f80a');
const assignments = '         expected_cash = e.expected_cash,\n         expected_card = e.expected_card,\n         expected_digital = e.expected_digital,\n         variance_cash = v_var_cash,\n         variance_card = v_var_card,\n         variance_digital = v_var_digital,\n         variance_total = v_total,\n';
const target = '         variance_status = v_status, updated_at = now()';
assert.equal(md5(body(captured).replace(target, assignments + target)), 'de87d75592ce3fe5872de90b4be9a466');
let passed = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); passed++; };
const sqlValue = value => value === null ? 'NULL' : String(value);
const helperSignature = 'public.shift_reconcile_now(uuid,uuid,numeric,numeric,numeric)';
const auditFunction = `CREATE OR REPLACE FUNCTION public.shift_log_event(p_shift uuid,p_event text,p_from text,p_to text,p_detail jsonb,p_terminal text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.shift_close_events(shift_id,store_id,event,detail) SELECT p_shift,store_id,p_event,p_detail FROM public.shifts WHERE id=p_shift; END $$;`;

async function fixture(source = captured) {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE fixture_operator;
    CREATE SCHEMA auth; CREATE SCHEMA pos_sync_private;
    CREATE TABLE public.shifts(id uuid PRIMARY KEY,store_id text NOT NULL,terminal_id text DEFAULT 'fixture-terminal',terminal_name text DEFAULT 'Fixture till',
      opened_by_name text DEFAULT 'Fixture cashier',opening_float numeric DEFAULT 10,opened_at timestamptz DEFAULT '2026-01-01T01:00:00Z',created_at timestamptz DEFAULT '2026-01-01T01:00:00Z',
      closed_at timestamptz,updated_at timestamptz,status text DEFAULT 'OPEN',state text DEFAULT 'CLOSING_STARTED',note text DEFAULT 'preserve fixture note',row_version bigint DEFAULT 7,
      closed_by_name text DEFAULT 'Fixture operator',closed_by_staff_id text DEFAULT 'fixture-staff',closed_by_role text DEFAULT 'cashier',close_reason text DEFAULT 'end of day',
      counted_cash numeric,counted_card numeric,counted_digital numeric,final_counted_cash numeric,closing_float numeric,
      expected_cash numeric,expected_card numeric,expected_digital numeric,variance_cash numeric,variance_card numeric,variance_digital numeric,variance_total numeric,variance_status text);
    CREATE TABLE public.shift_cash_counts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shift_id uuid NOT NULL REFERENCES public.shifts,store_id text,terminal_id text,kind text,
      counted_cash numeric,counted_card numeric,counted_digital numeric,reason text,counted_by_name text,counted_by_staff_id text,counted_by_user_id uuid,client_key text,created_at timestamptz DEFAULT now());
    CREATE UNIQUE INDEX fixture_original_count ON public.shift_cash_counts(shift_id) WHERE kind='ORIGINAL';
    CREATE TABLE public.shift_reconciliations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shift_id uuid NOT NULL REFERENCES public.shifts,store_id text,count_id uuid REFERENCES public.shift_cash_counts,
      expected_cash numeric,expected_card numeric,expected_digital numeric,counted_cash numeric,counted_card numeric,counted_digital numeric,
      variance_cash numeric,variance_card numeric,variance_digital numeric,variance_total numeric,variance_status text,created_at timestamptz DEFAULT now());
    CREATE TABLE public.shift_close_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shift_id uuid,store_id text,event text,detail jsonb);
    CREATE TABLE public.shift_notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shift_id uuid,store_id text);
    CREATE TABLE public.shift_variance_alerts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shift_id uuid,store_id text,reconciliation_id uuid UNIQUE,variance_total numeric,variance_status text,severity text,message text);
    CREATE TABLE public.activity_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_type text,severity text,title text,message text,actor_name text,terminal_id text,store_id text,
      branch_id text,entity_type text,entity_id text,amount numeric,meta jsonb,client_event_id text UNIQUE,created_at timestamptz);
    CREATE TABLE public.stores(id text PRIMARY KEY,name text); INSERT INTO public.stores VALUES('A','Fixture branch A'),('B','Fixture branch B');
    CREATE TABLE public.sales(id uuid DEFAULT gen_random_uuid(),shift_id text,total_amount numeric,is_refunded boolean);
    CREATE TABLE public.fixture_stock(id text PRIMARY KEY,quantity numeric); INSERT INTO public.fixture_stock VALUES('preserve-stock',37);
    CREATE TABLE public.fixture_expected(shift_id uuid PRIMARY KEY,expected_cash numeric,expected_card numeric,expected_digital numeric);
    CREATE FUNCTION public.shift_expected_totals(p_shift uuid) RETURNS TABLE(expected_cash numeric,expected_card numeric,expected_digital numeric) LANGUAGE sql STABLE AS $$ SELECT expected_cash,expected_card,expected_digital FROM public.fixture_expected WHERE shift_id=p_shift $$;
    CREATE FUNCTION public.pos_rules_get() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"variance_pin_threshold":10}'::jsonb $$;
    CREATE FUNCTION public.has_perm(p text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT p=ANY(string_to_array(COALESCE(current_setting('fixture.permissions',true),''),',')) $$;
    CREATE FUNCTION public.store_visible(p text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT p=COALESCE(current_setting('fixture.branch',true),'A') $$;
    CREATE FUNCTION public.current_app_user() RETURNS TABLE(full_name text,user_id text) LANGUAGE sql STABLE AS $$ SELECT 'Fixture cashier'::text,'fixture-staff'::text $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-4000-8000-000000000001'::uuid $$;
    ${auditFunction}`);
  await db.exec(source);
  await db.exec(`REVOKE ALL ON FUNCTION ${helperSignature} FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION ${helperSignature} TO service_role;
    ${caller} ${recount} ${graph} ${validate}
    GRANT EXECUTE ON FUNCTION public.shift_cash_count_submit(uuid,numeric,numeric,numeric,text,text),public.shift_recount_submit(uuid,numeric,text,numeric,numeric,text) TO authenticated;`);
  return db;
}
const rows = async (db, sql) => (await db.query(sql)).rows;
const metadata = async db => (await rows(db, `SELECT oid,proowner,proacl::text,prosecdef,proisstrict,provolatile,proconfig,prorettype,proretset,proargtypes::text,proallargtypes,proargmodes,proargnames,proparallel,proleakproof,procost,prorows FROM pg_proc WHERE oid='${helperSignature}'::regprocedure`))[0];
const sourceHash = async db => (await rows(db, `SELECT md5(replace(prosrc,E'\r\n',E'\n')) AS hash FROM pg_proc WHERE oid='${helperSignature}'::regprocedure`))[0].hash;
const snapshot = db => rows(db, `SELECT (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.shifts s) shifts,
  (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM public.shift_cash_counts c) counts,
  (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.shift_reconciliations r) reconciliations,
  (SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM public.shift_close_events e) events,
  (SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM public.shift_variance_alerts a) alerts,
  (SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM public.activity_events a) activity,
  (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.sales s) sales,
  (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.fixture_stock s) stock`);
async function seed(db, expected = [100, 20, 5], branch = 'A') {
  const id = randomUUID();
  await db.exec(`INSERT INTO public.shifts(id,store_id) VALUES('${id}','${branch}'); INSERT INTO public.fixture_expected VALUES('${id}',${expected.map(sqlValue).join(',')}); INSERT INTO public.sales(shift_id,total_amount,is_refunded) VALUES('${id}',99,false);`);
  return id;
}
async function asCashier(db, work, permissions = 'can_close_shift,can_shift_cash_recount', branch = 'A') {
  await db.exec(`SELECT set_config('fixture.permissions','${permissions}',false),set_config('fixture.branch','${branch}',false); SET ROLE authenticated;`);
  try { return await work(); } finally { await db.exec('RESET ROLE;'); }
}
const close = (db, id, values) => asCashier(db, () => rows(db, `SELECT public.shift_cash_count_submit('${id}',${values.map(sqlValue).join(',')},'fixture-${id}','fixture-terminal') AS state`));
const assertGraph = async (db, id) => { await db.query(`SELECT pos_sync_private.validate_graph(pos_sync_private.shift_graph('${id}'),'A','${id}',false)`); passed++; };

const db = await fixture();
try {
  // Reproduce the live omission with the captured unmodified routine, then
  // prove applying this migration does not silently repair that history.
  const historical = await seed(db);
  await close(db, historical, [100, null, null]);
  await assert.rejects(assertGraph(db, historical), /SYNC_SHIFT_GRAPH_CONFLICT/); passed++;
  const historicalBefore = await snapshot(db), metadataBefore = await metadata(db);
  await db.exec(migration);
  check(await snapshot(db), historicalBefore);
  check(await metadata(db), metadataBefore);
  check(await sourceHash(db), 'de87d75592ce3fe5872de90b4be9a466');
  await assert.rejects(assertGraph(db, historical), /SYNC_SHIFT_GRAPH_CONFLICT/); passed++;
  const idempotentBefore = await metadata(db);
  await db.exec(migration); check(await metadata(db), idempotentBefore); check(await snapshot(db), historicalBefore);
  await db.exec(`SET ROLE authenticated;`);
  try { await assert.rejects(db.query(`SELECT * FROM public.shift_reconcile_now('${historical}',NULL,1,NULL,NULL)`), /permission denied/); passed++; }
  finally { await db.exec('RESET ROLE;'); }

  for (const scenario of [
    {name:'mixed',expected:[100,20,5],counted:[100,20,5],variance:[0,0,0,0],status:'NO_VARIANCE'},
    {name:'cash-only',expected:[100,20,5],counted:[100,null,null],variance:[0,null,null,0],status:'NO_VARIANCE'},
    {name:'partial-null',expected:[100,20,5],counted:[100,null,5],variance:[0,null,0,0],status:'NO_VARIANCE'},
    {name:'all-zero',expected:[0,0,0],counted:[0,0,0],variance:[0,0,0,0],status:'NO_VARIANCE'},
    {name:'over',expected:[100,20,5],counted:[110,22,6],variance:[10,2,1,13],status:'OVER'},
    {name:'short',expected:[100,20,5],counted:[80,19,4],variance:[-20,-1,-1,-22],status:'SHORT'},
    {name:'rounding',expected:[100.01,20,5],counted:[105.005,20,5],variance:[5,0,0,5],status:'OVER'},
  ]) {
    const id=await seed(db,scenario.expected);
    const before=(await rows(db,`SELECT opened_at,created_at,opening_float,note,terminal_id,closed_by_name,closed_by_staff_id,closed_by_role,row_version FROM public.shifts WHERE id='${id}'`))[0];
    const untouched=await rows(db,'SELECT * FROM public.fixture_stock;');
    check((await close(db,id,scenario.counted))[0].state,'CLOSED');
    const parent=(await rows(db,`SELECT expected_cash,expected_card,expected_digital,variance_cash,variance_card,variance_digital,variance_total,variance_status FROM public.shifts WHERE id='${id}'`))[0];
    check(Object.values(parent).map(value=>value===null?null:typeof value==='string'&&value!=='NO_VARIANCE'&&value!=='OVER'&&value!=='SHORT'?Number(value):value),[...scenario.expected,...scenario.variance,scenario.status]);
    check((await rows(db,`SELECT opened_at,created_at,opening_float,note,terminal_id,closed_by_name,closed_by_staff_id,closed_by_role,row_version FROM public.shifts WHERE id='${id}'`))[0],before);
    check(await rows(db,'SELECT * FROM public.fixture_stock;'),untouched);
    await assertGraph(db,id);
    const retryBefore=await snapshot(db);await close(db,id,scenario.counted);check(await snapshot(db),retryBefore);
    if(scenario.name==='mixed') {
      const originalCounts=await rows(db,`SELECT * FROM public.shift_cash_counts WHERE shift_id='${id}' AND kind='ORIGINAL'`);
      const closedAt=(await rows(db,`SELECT closed_at FROM public.shifts WHERE id='${id}'`))[0];
      await asCashier(db,()=>db.query(`SELECT public.shift_recount_submit('${id}',101,'fixture recount',22,NULL,'fixture-terminal')`));
      check(await rows(db,`SELECT * FROM public.shift_cash_counts WHERE shift_id='${id}' AND kind='ORIGINAL'`),originalCounts);
      check((await rows(db,`SELECT closed_at FROM public.shifts WHERE id='${id}'`))[0],closedAt);
      await assertGraph(db,id);
    }
  }

  // Permissions and branch denials still run in the unchanged public caller.
  const denied=await seed(db), beforeDenied=await snapshot(db);
  await assert.rejects(asCashier(db,()=>db.query(`SELECT public.shift_cash_count_submit('${denied}',100,NULL,NULL,NULL,NULL)`),''),/permission/);passed++;
  check(await snapshot(db),beforeDenied);
  await assert.rejects(asCashier(db,()=>db.query(`SELECT public.shift_cash_count_submit('${denied}',100,NULL,NULL,NULL,NULL)`),'can_close_shift','B'),/another branch/);passed++;
  check(await snapshot(db),beforeDenied);
  await assert.rejects(close(db,denied,[-1,0,0]),/cash counted/);passed++;check(await snapshot(db),beforeDenied);

  for(const table of ['shift_reconciliations','activity_events','shift_close_events']) {
    const id=await seed(db),before=await snapshot(db);
    await db.exec(`CREATE FUNCTION public.fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture atomic failure'; END $$;
      CREATE TRIGGER fixture_fail BEFORE INSERT ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.fixture_fail();`);
    await assert.rejects(close(db,id,[80,20,5]),/fixture atomic failure/);passed++;
    check(await snapshot(db),before);
    await db.exec(`DROP TRIGGER fixture_fail ON public.${table}; DROP FUNCTION public.fixture_fail();`);
    await close(db,id,[80,20,5]);await assertGraph(db,id);
  }
} finally { await db.close(); }

for(const alteration of [
  `ALTER FUNCTION ${helperSignature} SECURITY INVOKER`,
  `ALTER FUNCTION ${helperSignature} STABLE`,
  `ALTER FUNCTION ${helperSignature} STRICT`,
  `ALTER FUNCTION ${helperSignature} SET search_path=public`,
  `ALTER FUNCTION ${helperSignature} OWNER TO fixture_operator`,
]) {
  const isolated=await fixture();try{await isolated.exec(alteration);const before=await metadata(isolated);await assert.rejects(isolated.exec(migration),/ATTRIBUTES_UNEXPECTED/);passed++;check(await metadata(isolated),before);}finally{await isolated.close();}
}
for(const variant of ['unknown-body','crlf','canonical','custom-grant']) {
  const source=variant==='unknown-body'?captured.replace('v_threshold numeric := 0','v_threshold numeric := 1'):variant==='crlf'?captured.replaceAll('\n','\r\n'):variant==='canonical'?canonical:captured;
  const isolated=await fixture(source);try{
    if(variant==='custom-grant')await isolated.exec(`GRANT EXECUTE ON FUNCTION ${helperSignature} TO fixture_operator`);
    const before=await metadata(isolated);
    if(variant==='unknown-body'){await assert.rejects(isolated.exec(migration),/SOURCE_UNEXPECTED/);passed++;check(await metadata(isolated),before);}
    else {await isolated.exec(migration);check(await metadata(isolated),before);check(await sourceHash(isolated),variant==='canonical'?'c8d204768ba0a711946401920411f80a':'de87d75592ce3fe5872de90b4be9a466');const id=await seed(isolated);await close(isolated,id,[100,20,5]);await assertGraph(isolated,id);}
  }finally{await isolated.close();}
}
console.log(`PASS ${passed} isolated shift-reconciliation summary scenarios`);
