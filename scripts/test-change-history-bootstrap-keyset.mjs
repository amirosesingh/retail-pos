// Disposable in-memory PostgreSQL only. Optional input is a read-only routine
// capture, never a connection string. No live POS rows or configuration are used.
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const schema = await read('supabase/schema.sql');
const migration = await read('supabase/migrations/20261031105517_change_history_bootstrap_uuid_keyset.sql');
const signature = 'public.pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)';
const oldTail = `AND (p_after_cursor IS NULL OR jsonb_build_object('id',x."id")::text>p_after_cursor) ORDER BY jsonb_build_object('id',x."id")::text LIMIT `;
const newTail = `AND (p_after_cursor IS NULL OR x."id">((p_after_cursor::jsonb)->>'id')::uuid) ORDER BY x."id" LIMIT `;
const auditCase = definition => definition.match(/WHEN 'change_history' THEN SELECT COALESCE\(jsonb_agg[\s\S]*?;/)?.[0];
const functionSql = (name, first = false) => {
  const matches = [...schema.matchAll(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\bAS (\\$[a-zA-Z_]*\\$)[\\s\\S]*?\\1;`, 'g'))];
  assert(matches.length, `Missing canonical ${name}`);
  return (first ? matches[0] : matches.at(-1))[0];
};
const argument = process.argv.indexOf('--live-definitions');
const captured = argument >= 0 ? JSON.parse(await readFile(process.argv[argument + 1], 'utf8')) : null;
const liveFunction = name => captured?.routines.find(item => item.identity.startsWith(name + '('))?.definition;
const canonicalBootstrap = functionSql('pos_sync_bootstrap', true)
  .replace('public.pos_sync_bootstrap(', 'public.pos_sync_bootstrap_scoped(')
  .replace('PERFORM public.pos_sync_validate_scope(', 'PERFORM public.pos_sync_validate_read_scope(');
const sourceBootstrap = captured ? liveFunction('pos_sync_bootstrap_scoped') : canonicalBootstrap;
assert(sourceBootstrap, 'Capture is missing the exact seven-argument scoped bootstrap');
const sourceCase = auditCase(sourceBootstrap);
assert(sourceCase, 'Missing captured audit case');
// The canonical installer already has this fix. Reconstruct only its old audit
// range/order tail for the prepatch regression; captured live code is unaltered.
const baseline = sourceBootstrap.replace(sourceCase, sourceCase.replace(newTail, oldTail));
const validators = ['pos_sync_validate_scope', 'pos_sync_validate_read_scope']
  .map(name => captured ? liveFunction(name) : functionSql(name));
assert(validators.every(Boolean), 'Capture must include both real scope validators');
const minimum = baseline.includes('GREATEST(p_limit,10)') ? 10 : 100;
const tableStart = schema.indexOf('CREATE TABLE IF NOT EXISTS public.change_history (');
const table = schema.slice(tableStart, schema.indexOf('\n);', tableStart) + 3);
assert(tableStart >= 0 && table.endsWith(');'));
const db = new PGlite();
let passed = 0;
const check = async (name, run) => { await run(); passed++; console.log('PASS ' + name); };
const metadata = async () => (await db.query(`SELECT pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS attributes FROM pg_proc p WHERE p.oid=$1::regprocedure`, [signature])).rows[0];
const page = async (cursor = null, limit = 10, branch = 'A', terminal = 'ops-a', organization = 'default') =>
  (await db.query('SELECT public.pos_sync_bootstrap_scoped($1,$2,$3,$4,$5,$6,$7) AS value',
    [organization, branch, terminal, 'change_history', cursor, 90, limit])).rows[0].value;
const pages = async (branch = 'A', terminal = 'ops-a') => {
  const result = []; let cursor = null;
  do { const value = await page(cursor, 10, branch, terminal); result.push(value); cursor = value.cursor;
    assert(result.length < 50, 'Unbounded fixture paging'); } while (cursor);
  return result;
};
async function denied(query, pattern) { await assert.rejects(query, pattern); }
const userId = '00000000-0000-4000-8000-000000000001';
const authId = '00000000-0000-4000-8000-000000000002';
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('test.auth_role',true),''),'service_role') $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '${authId}'::uuid $$;
    CREATE TABLE app_users(id uuid PRIMARY KEY,auth_user_id uuid,is_active boolean,role text,permissions jsonb,store_id text);
    CREATE TABLE stores(id text PRIMARY KEY);
    CREATE TABLE terminal_tokens(id text PRIMARY KEY,location_id text,status text,revoked_at timestamptz,
      platform text,management_sync_enabled boolean,is_claimed boolean);
    INSERT INTO stores VALUES ('A'),('B');
    INSERT INTO terminal_tokens VALUES
      ('ops-a','A','active',NULL,'pc',false,true),('ops-b','B','used',NULL,'pc',false,true),
      ('revoked-a','A','active',now(),'pc',false,true),('inactive-a','A','revoked',NULL,'pc',false,true),
      ('management',NULL,'active',NULL,'pc',true,true),('management-phone',NULL,'active',NULL,'android',true,true);
    INSERT INTO app_users VALUES ('${userId}','${authId}',true,'cashier','{}','A');
    ${table}
    ALTER TABLE change_history ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON change_history FROM PUBLIC,anon,authenticated;
    GRANT SELECT ON change_history TO service_role;
    INSERT INTO change_history(id,organization_id,entity_type,entity_id,action,old_value,new_value,revision,scope_type,scope_id,source_application,server_timestamp)
      SELECT md5('audit-keyset:'||n)::uuid,CASE WHEN n%7=0 THEN 'other-org' ELSE 'default' END,
        'fixture','item-'||n,'update',jsonb_build_object('old',n-1),jsonb_build_object('value',n,'note',repeat('audit',20)),
        n,CASE WHEN n%3=0 THEN 'GLOBAL' ELSE 'BRANCH' END,CASE WHEN n%2=0 THEN 'B' ELSE 'A' END,
        'fixture',timestamptz '2020-01-01Z'+make_interval(days=>n) FROM generate_series(1,257)n;
    INSERT INTO change_history(id,entity_type,entity_id,action,revision,scope_type) VALUES
      ('00000000-0000-0000-0000-000000000000','fixture','zero','insert',1,'GLOBAL'),
      ('10000000-0000-0000-0000-000000000000','fixture','one','insert',1,'GLOBAL'),
      ('A0000000-0000-0000-0000-000000000000','fixture','a','insert',1,'GLOBAL'),
      ('EFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF','fixture','e','insert',1,'GLOBAL'),
      ('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF','fixture','f','insert',1,'GLOBAL');`);
  for (const validator of validators) await db.exec(validator);
  await db.exec(baseline);
  await db.exec(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`);
  const before = await metadata();
  const baselinePages = {};
  for (const [branch, terminal] of [['A','ops-a'],['B','ops-b'],['A','management'],['B','management']])
    baselinePages[branch + ':' + terminal] = await pages(branch, terminal);
  const boundPages = new Map();
  for (const limit of [null,-1,0,1,10,100,500,3000]) boundPages.set(limit, await page(null, limit));
  const originalRows = (await db.query('SELECT jsonb_agg(to_jsonb(x) ORDER BY id) AS rows FROM change_history x')).rows[0].rows;
  await db.exec(migration);
  const after = await metadata();
  await check('only the inspected audit UUID range/order tail changes; all other source and function attributes/ACLs remain exact', async () => {
    assert.notEqual(after.definition, before.definition);
    assert.equal(after.definition.replace(auditCase(after.definition), auditCase(after.definition).replace(newTail, oldTail)), before.definition);
    assert.deepEqual(after.attributes, before.attributes);
    assert.equal(auditCase(after.definition).split(newTail).length - 1, 1);
  });
  for (const [branch, terminal] of [['A','ops-a'],['B','ops-b'],['A','management'],['B','management']]) {
    await check(`all rows, page boundaries and old JSON cursors remain identical: ${branch}/${terminal}`, async () => {
      const values = await pages(branch, terminal);
      assert.deepEqual(values, baselinePages[branch + ':' + terminal]);
      const all = values.flatMap(value => value.rows);
      assert.equal(all.length, 262); assert.equal(new Set(all.map(row => row.id)).size, 262);
      assert(values.length >= 3); assert.equal(values.at(-1).cursor, null);
      for (const prior of values.filter(value => value.cursor))
        assert.deepEqual(await page(prior.cursor, 10, branch, terminal), await page(JSON.stringify(JSON.parse(prior.cursor)), 10, branch, terminal));
    });
  }
  await check('every persisted legacy page cursor resumes at exactly the same next page', async () => {
    const prior = baselinePages['A:ops-a'];
    for (let n = 0; n < prior.length - 1; n++) assert.deepEqual(await page(prior[n].cursor), prior[n + 1]);
  });
  await check(`live/installer minimum${minimum}, NULL limits and upper bound behavior are unchanged`, async () => {
    for (const [limit, expected] of boundPages) assert.deepEqual(await page(null, limit), expected);
    assert.equal((await page(null, 1)).rows.length, minimum);
  });
  await check('existing audit predicates are unchanged, including GLOBAL, other-branch, other-organization and old history rows', async () => {
    const rows = (await pages()).flatMap(value => value.rows);
    assert(rows.some(row => row.organization_id === 'other-org'));
    assert(rows.some(row => row.scope_type === 'GLOBAL'));
    assert(rows.some(row => row.scope_id === 'B'));
    assert(rows.some(row => row.server_timestamp < '2021'));
    assert.deepEqual((await db.query('SELECT jsonb_agg(to_jsonb(x) ORDER BY id) AS rows FROM change_history x')).rows[0].rows, originalRows);
  });
  for (const [name, branch, terminal, organization, pattern] of [
    ['foreign normal branch','B','ops-a','default',/SYNC_TERMINAL_SCOPE_FORBIDDEN/],
    ['unknown branch management','C','management','default',/SYNC_TERMINAL_SCOPE_FORBIDDEN/],
    ['missing terminal','A','','default',/SYNC_TERMINAL_REQUIRED/],
    ['blank branch','','ops-a','default',/SYNC_TERMINAL_REQUIRED/],
    ['unknown terminal','A','missing','default',/SYNC_TERMINAL_SCOPE_FORBIDDEN/],
    ['revoked terminal','A','revoked-a','default',/SYNC_TERMINAL_SCOPE_FORBIDDEN/],
    ['inactive terminal','A','inactive-a','default',/SYNC_TERMINAL_SCOPE_FORBIDDEN/],
    ['phone management','A','management-phone','default',/SYNC_TERMINAL_SCOPE_FORBIDDEN/],
    ['foreign organization','A','ops-a','foreign',/SYNC_ORGANIZATION_FORBIDDEN/],
  ]) await check(`retained scope denial: ${name}`, () => denied(page(null, 10, branch, terminal, organization), pattern));
  await check('service-only execution is preserved; anonymous and authenticated direct calls remain denied', async () => {
    const grants = (await db.query(`SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,has_function_privilege('service_role',$1,'EXECUTE') AS service`, [signature])).rows[0];
    assert.deepEqual(grants, { anon:false, authenticated:false, service:true });
    for (const role of ['anon','authenticated']) {
      await db.exec('SET ROLE ' + role);
      try { await denied(page(), /permission denied/); } finally { await db.exec('RESET ROLE'); }
    }
  });
  await check('retained internal active-account/permission/branch checks do not grant a cashier wider access', async () => {
    await db.exec("SET test.auth_role='authenticated'");
    try {
      await denied(page(), /SYNC_FORBIDDEN/);
      await db.exec(`UPDATE app_users SET permissions='{"can_manage_sync_backup":true}'`);
      assert((await page()).rows.length > 0);
      await denied(page(null, 10, 'B', 'ops-b'), /SYNC_BRANCH_FORBIDDEN/);
      await db.exec('UPDATE app_users SET is_active=false');
      await denied(page(), /SYNC_FORBIDDEN/);
    } finally { await db.exec('RESET test.auth_role'); }
  });
  await check('empty collection and cursor beyond the final UUID return no rows and a null cursor', async () => {
    assert.deepEqual(await page(JSON.stringify({id:'ffffffff-ffff-ffff-ffff-ffffffffffff'})), { rows:[],cursor:null });
    await db.exec('BEGIN; TRUNCATE change_history');
    try { assert.deepEqual(await page(), { rows:[],cursor:null }); } finally { await db.exec('ROLLBACK'); }
  });
  await check('malformed JSON/UUID cursors fail closed without a query fallback or row mutation', async () => {
    for (const value of ['not-json','{"id":"not-uuid"}','{"id":1}',`{"id":"'; DROP TABLE change_history; --"}`])
      await denied(page(value), /invalid input syntax/);
    for (const value of ['{}','[]','null','{"id":null}']) assert.deepEqual(await page(value), { rows:[],cursor:null });
    assert.deepEqual((await db.query('SELECT jsonb_agg(to_jsonb(x) ORDER BY id) AS rows FROM change_history x')).rows[0].rows, originalRows);
  });
  await check('valid JSON cursors tolerate whitespace and UUID casing while retaining canonical output', async () => {
    const cursor = baselinePages['A:ops-a'][0].cursor;
    assert.deepEqual(await page(JSON.stringify({id:JSON.parse(cursor).id.toUpperCase()},null,2)), await page(cursor));
  });
  await check('reapplication is idempotent with identical definition, owner, OID, security attributes and grants', async () => {
    await db.exec(migration); assert.deepEqual(await metadata(), after);
  });
  const variations = [
    ['predicate',definition => definition.replace(auditCase(definition),auditCase(definition).replace('WHERE (true)', 'WHERE (false)'))],
    ['projection',definition => definition.replace(auditCase(definition),auditCase(definition).replace('to_jsonb(page.row_data)',"to_jsonb(page.row_data)-'old_value'"))],
    ['order',definition => definition.replace(auditCase(definition),auditCase(definition).replace('ORDER BY x."id" LIMIT','ORDER BY x."id" DESC LIMIT'))],
    ['page bound',definition => definition.replace(auditCase(definition),auditCase(definition).replace(',2000)',',4000)'))],
    ['duplicate marker',definition => definition.replace('CASE p_table', "-- WHEN 'change_history' THEN duplicate\n CASE p_table")],
  ];
  for (const [name, alter] of variations) await check(`unknown ${name} aborts atomically, including an already-upgraded case`, async () => {
    await db.exec(alter(after.definition)); const changed = await metadata();
    try { await denied(db.exec(migration), /audit bootstrap/); assert.deepEqual(await metadata(), changed); }
    finally { await db.exec(after.definition); }
  });
  await check('missing function aborts without creating an alternative or changing grants', async () => {
    await db.exec(`ALTER FUNCTION ${signature} RENAME TO fixture_missing_bootstrap`);
    try { await denied(db.exec(migration), /Missing inspected audit bootstrap function/); }
    finally { await db.exec('ALTER FUNCTION fixture_missing_bootstrap(text,text,text,text,text,integer,integer) RENAME TO pos_sync_bootstrap_scoped'); }
    assert.deepEqual(await metadata(), after);
  });
  await check('missing UUID index fails before routine replacement and rolls back cleanly', async () => {
    await db.exec('BEGIN; ALTER TABLE change_history DROP CONSTRAINT change_history_pkey');
    try { await denied(db.exec(migration), /Unrecognized audit UUID index contract/); }
    finally { await db.exec('ROLLBACK'); }
    assert.deepEqual(await metadata(), after);
  });
  await check('synthetic EXPLAIN uses the existing UUID index range without the full JSON-expression sort', async () => {
    await db.exec(`INSERT INTO change_history(id,entity_type,entity_id,action,revision)
      SELECT md5('scale:'||n)::uuid,'fixture','scale-'||n,'insert',1 FROM generate_series(1,15000)n;
      ANALYZE change_history;`);
    const cursor = JSON.stringify({id:'a0000000-0000-0000-0000-000000000000'});
    const inner = definition => auditCase(definition).match(/FROM \(SELECT ([\s\S]*)\) page;/)[1];
    // Use a concrete saved cursor to prove index-range capability. PostgreSQL
    // may choose a generic cached plan for the optional-cursor OR in production;
    // that inherited plan can scan the index in order and filter from its start.
    const plan = async definition => (await db.query('EXPLAIN (FORMAT JSON) SELECT ' + inner(definition)
      .replaceAll('p_after_cursor',`'${cursor}'::text`).replace('p_limit','10'))).rows[0]['QUERY PLAN'];
    const oldPlan = JSON.stringify(await plan(before.definition)), newPlan = JSON.stringify(await plan(after.definition));
    assert(oldPlan.includes('"Node Type":"Sort"'),oldPlan); assert(newPlan.includes('"Index Cond"'),newPlan);
    assert(newPlan.includes('change_history_pkey')); assert(!newPlan.includes('"Node Type":"Sort"'));
    const preparedPlan = JSON.stringify((await db.query('EXPLAIN (FORMAT JSON) SELECT ' + inner(after.definition)
      .replaceAll('p_after_cursor','$1').replace('p_limit','10'),[cursor])).rows[0]['QUERY PLAN']);
    assert(preparedPlan.includes('change_history_pkey')); assert(!preparedPlan.includes('"Node Type":"Sort"'));
  });
  await check('actual generator emits exactly the reviewed canonical case without writing or changing other generated cases', async () => {
    const generator = await read('scripts/generate-supabase-sync-contract.cjs');
    const execute = source => {
      let generated;
      runInNewContext(source, { require:name => name === 'node:fs' ? {
        ...require('node:fs'),writeFileSync:(target,value) => {
          assert.equal(target,fileURLToPath(new URL('../supabase/schema.sql',import.meta.url))); generated=value;
        },
      } : require(name), __dirname:fileURLToPath(new URL('.',import.meta.url)),
      process:{argv:['node','generate-supabase-sync-contract.cjs']},console:{log(){}} });
      assert(generated);return generated;
    };
    const generated = execute(generator);
    assert.equal(auditCase(generated),auditCase(schema));
    const legacy = execute(generator.replace('const auditUuidKey = table.cloudTable === "change_history";', 'const auditUuidKey = false;'));
    assert.notEqual(generated,legacy);
    const restored = generated.replace(auditCase(generated),auditCase(generated).replace(newTail,oldTail));
    const mismatch = [...restored].findIndex((character,index) => character !== legacy[index]);
    assert.equal(mismatch,-1,`Generator differs beyond audit tail at ${mismatch}: ${restored.slice(mismatch,mismatch+220)} / ${legacy.slice(mismatch,mismatch+220)}`);
    assert.equal(restored.length,legacy.length);
  });
  console.log(`${passed} isolated change_history keyset scenarios passed (${captured ? 'captured live definition' : 'canonical installer'}, minimum ${minimum})`);
} finally { await db.close(); }
