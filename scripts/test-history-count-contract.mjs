// Owned disposable PostgreSQL only. No operator URL/profile/credentials.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const sourceMigration = await read('supabase/migrations/20261106020500_complete_change_history_sync_count.sql');
const capture = JSON.parse(await read('src/lib/__tests__/fixtures/history-count-contract-live-metadata.json'));
const registry = JSON.parse(await read('database/sqlserver/schema-registry.json'));
const native = process.argv.includes('--native');
const args = process.argv.slice(2);
assert(args.every(value => value === '--native' || /^--line-endings=(lf|crlf)$/.test(value)));
assert.equal(new Set(args).size, args.length);
const formatArgs = args.filter(value => value.startsWith('--line-endings='));
assert(formatArgs.length <= 1);
const format = formatArgs[0]?.split('=')[1] ?? 'working';
const normalizeArtifact = (source, eol) => source.replaceAll('\r\n', '\n').replaceAll('\n', eol);
const migration = format === 'working' ? sourceMigration : normalizeArtifact(sourceMigration, format === 'crlf' ? '\r\n' : '\n');
console.log('Artifact line endings: ' + format);
const factory = native ? await import('data:text/javascript;base64,' + Buffer.from(await read('scripts/test-seven-shift-summary-native.fixture.mjs') + '\nexport {createNativeFixture};').toString('base64')) : null;
const db = native ? await factory.createNativeFixture() : new PGlite();
if (native) {
  const exec = db.exec;
  db.exec = async text => {
    if (/^\s*--[\s\S]*\bBEGIN;[\s\S]*COMMIT;\s*$/.test(text)) {
      await exec(text.replace(/COMMIT;\s*$/, '')); return exec('COMMIT;');
    }
    return exec(text);
  };
}
const md5 = value => createHash('md5').update(value).digest('hex');
const literal = value => "E'" + value.replaceAll('\\', '\\\\').replaceAll("'", "''").replaceAll('\r', '\\r').replaceAll('\n', '\\n') + "'";
const qualified = signature => 'public.' + signature;
const applyDefinition = async definition => {
  const match = definition.match(/AS (\$\w*\$)([\s\S]*?)\1/); assert(match);
  await db.exec(definition.replace(match[0], () => 'AS ' + literal(match[2])));
};
const wrapper = capture.functions.find(row => row.signature === 'pos_sync_counts(text,text,text,integer)');
const delegate = capture.functions.find(row => row.signature.startsWith('pos_sync_counts_scoped'));
const bootstrap = capture.functions.find(row => row.signature.startsWith('pos_sync_bootstrap_scoped'));
let passed = 0;
const check = async (label, work) => { await work(); passed++; console.log('PASS ' + label); };
const counts = async (branch = 'A', terminal = 'ops-A', days = 90) => (await db.query('SELECT * FROM public.pos_sync_counts($1,$2,$3,$4) ORDER BY table_name', ['default', branch, terminal, days])).rows;
const state = async () => (await db.query(`SELECT jsonb_build_object(
 'routines',(SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'name',p.proname,'body',p.prosrc,'acl',p.proacl::text,'config',p.proconfig,'owner',p.proowner,'definer',p.prosecdef,'cost',p.procost) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('pos_sync_counts','pos_sync_counts_scoped','pos_sync_bootstrap_scoped')),
 'history',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM change_history h),
 'sales',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM sales s),
 'vouchers',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM issued_vouchers v)) value`)).rows[0].value;
async function reset() {
  for (const fn of [bootstrap, delegate, wrapper]) {
    await applyDefinition(fn.definition);
    await db.exec(`REVOKE ALL ON FUNCTION ${qualified(fn.signature)} FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION ${qualified(fn.signature)} TO service_role;`);
  }
}
async function reject(label, mutate, pattern, candidate = migration) {
  await reset(); await mutate(); const before = await state();
  await assert.rejects(db.exec(candidate), pattern); await db.exec('ROLLBACK');
  assert.deepEqual(await state(), before); passed++; console.log('PASS ' + label);
}
try {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
   CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT 'service_role'::text$$;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULL::uuid$$;`);
  // Empty synthetic tables preserve the real 69-way UNION. Authority adapters
  // below are controlled fixtures; this is not a claim of deployed RLS acceptance.
  const columns = `id uuid,store_id text,branch_id text,scope text,scope_id text,scope_type text,key text,section text,
   booking_id uuid,po_id uuid,product_id uuid,foc_product_id uuid,transfer_id uuid,from_store_id text,to_store_id text,
   created_at timestamptz,terminal_id text,movement_id uuid,terminal_token_id text,slug text,group_id text,
   owner_store_id text,stock_by_store jsonb,server_timestamp timestamptz,organization_id text,entity_type text,
   entity_id text,action text,old_value jsonb,new_value jsonb,revision bigint,changed_by text,source_application text,
   device_id text,auth_user_id uuid,is_active boolean,role text,permissions jsonb`;
  for (const table of registry.tables) await db.exec(`CREATE TABLE public."${table.cloudTable}"(${table.cloudTable === 'stores' ? columns.replace('id uuid,', 'id text,') : columns});`);
  await db.exec(`CREATE FUNCTION public.pos_sync_validate_read_scope(org text,branch text,terminal text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
   IF org<>'default' OR branch NOT IN ('A','B') THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN';END IF;
   IF terminal IN ('ops-A','management-A') AND branch<>'A' THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN';END IF;
   IF terminal NOT IN ('ops-A','management-A','management-all') THEN RAISE EXCEPTION 'SYNC_TERMINAL_FORBIDDEN';END IF;
  END$$;
  CREATE FUNCTION public.product_available_in_catalogue(product uuid,branch text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM products p WHERE p.id=product AND p.owner_store_id=branch)$$;
  INSERT INTO stores(id,group_id) VALUES('A','G1'),('B','G2');
  INSERT INTO issued_vouchers(id,store_id) VALUES(md5('voucher-A')::uuid,'A'),(md5('voucher-B')::uuid,'B');
  INSERT INTO sales(id,store_id,created_at) VALUES(md5('sale-A')::uuid,'A',now()),(md5('sale-B')::uuid,'B','2000-01-01Z');
  INSERT INTO change_history(id,scope_type,scope_id,server_timestamp) VALUES
   (md5('history-old-A')::uuid,'BRANCH','A','2000-01-01Z'),(md5('history-old-B')::uuid,'BRANCH','B','2000-01-01Z'),
   (md5('history-global')::uuid,'GLOBAL','',now());`);
  await reset();
  const before = await counts(); assert.equal(before.length, 69); assert(!before.some(row => row.table_name === 'change_history'));
  const original = await state(); const wrapperOid = original.routines.find(row => row.name === 'pos_sync_counts').oid;
  await check('the original incomplete 69-row contract fails complete registry coverage', async () => {
    const { createRequire } = await import('node:module'); const { validatedCloudCounts } = createRequire(import.meta.url)('../electron/sync/reconciliation.cjs');
    assert.throws(() => validatedCloudCounts(registry, before), { code: 'ERECONCILE_COUNTS' });
  });
  await db.exec(migration);
  await check('one history count completes all70 unique registered rows with no duplicate voucher row', async () => {
    const after = await counts(); assert.equal(after.length, 70); assert.equal(new Set(after.map(row => row.table_name)).size, 70);
    assert.equal(String(after.find(row => row.table_name === 'change_history').row_count), '3');
    assert.deepEqual(after.filter(row => row.table_name !== 'change_history'), before);
    const { createRequire } = await import('node:module'); const { validatedCloudCounts } = createRequire(import.meta.url)('../electron/sync/reconciliation.cjs');
    assert.equal(Object.keys(validatedCloudCounts(registry, after)).length, 70);
  });
  await check('existing vouchers remain organization-wide and all earlier count rows are unchanged', async () => {
    assert.equal(String((await counts()).find(row => row.table_name === 'issued_vouchers').row_count), '2');
    assert.deepEqual((await state()).history, original.history); assert.deepEqual((await state()).sales, original.sales);
    assert.deepEqual((await state()).vouchers, original.vouchers);
  });
  await check('history count exactly matches the current authorized bootstrap with no new cutoff or scope', async () => {
    for (const days of [30, 90, 7300]) {
      const page = (await db.query("SELECT public.pos_sync_bootstrap_scoped('default','A','ops-A','change_history',NULL,$1,10) AS page", [days])).rows[0].page;
      assert.equal(page.rows.length, 3); assert.equal(String((await counts('A', 'ops-A', days)).find(row => row.table_name === 'change_history').row_count), String(page.rows.length));
    }
  });
  await check('only the exact wrapper tail changes; its OID/ACL/metadata and both delegated routines remain intact', async () => {
    const after = await state(); const actual = after.routines.find(row => row.name === 'pos_sync_counts');
    assert.equal(actual.oid, wrapperOid); assert.equal(md5(actual.body), 'f5a89946adfbd7611366a7cf3b860b8e');
    const prior = original.routines.find(row => row.name === 'pos_sync_counts'); assert.deepEqual({ ...actual, body: prior.body }, prior);
    assert.deepEqual(after.routines.filter(row => row.name !== 'pos_sync_counts'), original.routines.filter(row => row.name !== 'pos_sync_counts'));
  });
  await check('exact replay is a no-op without business or routine changes', async () => { const before = await state(); await db.exec(migration); assert.deepEqual(await state(), before); });
  await check('replay from the other artifact line-ending format is the same no-op', async () => {
    const before = await state();
    await db.exec(normalizeArtifact(migration, migration.includes('\r\n') ? '\n' : '\r\n'));
    assert.deepEqual(await state(), before);
  });
  for (const [branch, terminal, pattern] of [['B', 'ops-A', /SYNC_BRANCH_FORBIDDEN/], ['B', 'management-A', /SYNC_BRANCH_FORBIDDEN/], ['A', 'unknown', /SYNC_TERMINAL_FORBIDDEN/]])
    await check('unchanged admission denies ' + terminal + '/' + branch, async () => { const before = await state(); await assert.rejects(counts(branch, terminal), pattern); assert.deepEqual(await state(), before); });
  await check('authorized management retains its existing granted branch read', async () => { assert.equal((await counts('B', 'management-all')).length, 70); });
  for (const role of ['anon', 'authenticated']) await check('service-only counts remain unavailable to ' + role, async () => {
    await db.exec('SET ROLE ' + role); try { await assert.rejects(counts(), /permission denied/); } finally { await db.exec('RESET ROLE'); }
  });
  await reject('unknown wrapper source aborts without overwriting it', () => applyDefinition(wrapper.definition.replace('BEGIN', 'BEGIN PERFORM 1;')), /WRAPPER_CHANGED/);
  await reject('changed delegate source aborts', () => applyDefinition(delegate.definition.replace('BEGIN', 'BEGIN PERFORM 1;')), /SOURCE_CHANGED/);
  await reject('changed history selector aborts', () => applyDefinition(bootstrap.definition.replace('WHERE (true)', 'WHERE (false)')), /SOURCE_CHANGED|SELECTOR_CHANGED/);
  await reject('changed wrapper grants abort', () => db.exec('GRANT EXECUTE ON FUNCTION public.pos_sync_counts(text,text,text,integer) TO authenticated'), /METADATA_CHANGED/);
  await reject('changed wrapper security mode aborts', () => db.exec('ALTER FUNCTION public.pos_sync_counts(text,text,text,integer) SECURITY INVOKER'), /METADATA_CHANGED/);
  await reject('changed wrapper search path aborts', () => db.exec('ALTER FUNCTION public.pos_sync_counts(text,text,text,integer) SET search_path=pg_catalog'), /METADATA_CHANGED/);
  await reject('changed delegate metadata aborts', () => db.exec('ALTER FUNCTION public.pos_sync_counts_scoped(text,text,text,integer) COST 101'), /METADATA_CHANGED/);
  const marker = 'IF md5(body)<>new_hash OR replace(body,new_select,old_select) IS DISTINCT FROM original_body';
  assert.equal(migration.split(marker).length, 2);
  await reject('an injected late failure rolls the routine replacement back', async () => {}, /fixture late failure/,
    migration.replace(marker, "RAISE EXCEPTION 'fixture late failure'; " + marker));
  console.log(`PASS ${passed} isolated history count contract scenarios`);
} catch (error) {
  console.error(error.name + ': ' + error.message);
  process.exitCode = 1;
} finally { await db.close(); }
