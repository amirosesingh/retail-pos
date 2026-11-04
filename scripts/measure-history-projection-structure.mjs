// Opt-in native PostgreSQL reproduction with synthetic shape-only fixtures.
// Creates its own loopback cluster; never reads an application connection.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, mkdtemp, mkdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

assert.equal(process.argv[2], '--run');
const bin = process.env.POSTGRES_TEST_BIN;
assert(bin, 'Provide an existing portable POSTGRES_TEST_BIN for an isolated fixture.');
const root = fileURLToPath(new URL('../', import.meta.url));
const profile = process.argv.includes('--profile');
const candidatePath = process.argv[3] && process.argv[3] !== '--profile' ? process.argv[3] : 'supabase/migrations/20261103091907_optimize_protected_history_projection.sql';
assert(resolve(root, candidatePath).startsWith(resolve(root) + sep), 'Candidate must be a project test artifact.');
const original = await readFile(join(root, 'supabase/migrations/20261103074926_protected_byte_bounded_history_download.sql'), 'utf8');
const helper = sql => sql.match(/CREATE OR REPLACE FUNCTION public\.pos_sync_history_project_v1\([\s\S]*?\$projection\$;/)?.[0];
const baseline = helper(original);
const candidate = helper(await readFile(resolve(root, candidatePath), 'utf8'));
assert(baseline && candidate, 'Expected the bounded pure projection helper.');
const reference = {};
runInNewContext(ts.transpileModule(await readFile(join(root, 'src/lib/sync-download-redaction.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: reference, Object, Set, Array, require: createRequire(new URL('../src/lib/sync-download-redaction.ts',import.meta.url)) });
const base = join(root, '.tmp/projection-structure');
await mkdir(base, { recursive: true });
const directory = await mkdtemp(join(base, 'native-'));
const executable = name => join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
const command = (name, args, options = {}) => execFileSync(executable(name), args, {
  encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024, ...options,
});
const port = await new Promise((resolvePort, reject) => {
  const server = createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolvePort(port)); });
});
const sql = text => command('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres'], { input: text });
const literal = text => "'" + text.replaceAll("'", "''") + "'";
let started = false;
try {
  command('initdb', ['-D', directory, '-A', 'trust', '-U', 'postgres', '--encoding=UTF8', '--locale=C', '--no-instructions']);
  started = true;
  command('pg_ctl', ['-D', directory, '-l', join(directory, 'fixture.log'), '-o', `-h 127.0.0.1 -p ${port} -c max_connections=5 -c shared_buffers=32MB -c track_functions=pl`, '-w', 'start'], { stdio: 'ignore' });
  sql(baseline.replaceAll('pos_sync_history_project_v1', 'pos_sync_history_project_baseline') + '\n' + candidate + '\nCREATE TABLE fixture(name text PRIMARY KEY,input jsonb,expected jsonb);');
  const candidateFingerprint = sql("SELECT md5(replace(prosrc,E'\\r\\n',E'\\n')) FROM pg_proc WHERE oid='public.pos_sync_history_project_v1(jsonb,text,boolean)'::regprocedure;").trim();
  const cases = [
    ['widePrimitive', { note: 'x'.repeat(1_649_340) }],
    ['flat57899', Object.fromEntries(Array.from({ length: 57_899 }, (_, index) => [String(index).padStart(5, '0'), index < 3 ? true : 'x']))],
    ['oldNew57899', (() => {
      const map = Object.fromEntries(Array.from({ length: 57_899 }, (_, index) => [String(index).padStart(5, '0'), index < 3 ? true : 'x']));
      const record = { id: 'synthetic', name: 'fixture', price: 2, qty: 0, active: true, category: 'test', version: 1, updated: '2026-11-03', nested: { map } };
      return { table_name: 'products', old_value: record, new_value: record };
    })()],
    ['array10000', { table_name: 'products', rows: Array.from({ length: 10_000 }, (_, index) => ({ quantity: index, price: 3, ecom_price: 9, safe: 'fixture' })) }],
    ['settingsArray', { table_name: 'settings_scoped', key: 'product_price:fixture', value: [{ ecom_price: 9, safe: true }, '雪', null] }],
  ];
  const results = [];
  for (const [name, value] of cases) {
    const expected = JSON.parse(JSON.stringify(reference.redactSyncDownload(value, 'change_history', false)));
    sql(`INSERT INTO fixture VALUES(${literal(name)},${literal(JSON.stringify(value))}::jsonb,${literal(JSON.stringify(expected))}::jsonb);`);
    for (const implementation of profile ? ['v1'] : ['baseline', 'v1']) {
      try {
        sql('SELECT pg_stat_reset();');
        const output = sql(`SET statement_timeout='8s'; WITH projected AS MATERIALIZED (SELECT public.pos_sync_history_project_${implementation}(input,'change_history',false) AS value,expected FROM fixture WHERE name=${literal(name)}) SELECT json_build_object('case',${literal(name)},'implementation',${literal(implementation)},'matches',value=expected,'bytes',octet_length(value::text),'statementMs',round(extract(epoch FROM (clock_timestamp()-statement_timestamp()))*1000,3)) FROM projected;`);
        const result = JSON.parse(output.trim()); assert.equal(result.matches, true);
        result.functionStats = JSON.parse(sql("SELECT COALESCE(json_agg(json_build_object('function',funcname,'calls',calls,'totalMs',total_time,'selfMs',self_time)),'[]'::json) FROM pg_stat_user_functions WHERE funcname LIKE 'pos_sync_history_project_%';").trim());
        results.push(result);
      } catch (error) {
        const detail = String(error.stderr ?? error.message);
        if (implementation === 'baseline' && detail.includes('statement timeout')) results.push({ case: name, implementation, timeoutAtMs: 8000 });
        else throw error;
      }
    }
  }
  for (const numeric of ['1e400','-1e400','1.7976931348623158e308','1.7976931348623159e308','1e-400','-0']) {
    const input = `[${numeric}]`, expected = JSON.parse(JSON.stringify(JSON.parse(input)));
    const actual = sql(`SELECT public.pos_sync_history_project_v1(${literal(input)}::jsonb,'change_history',false)::text;`).trim();
    assert.deepEqual(JSON.parse(actual), expected);
  }
  console.log(JSON.stringify({ nativePostgres: command('postgres', ['--version']).trim(), candidateFingerprint, deadlineMs: 8000, source: 'synthetic shape-only records; no operator data', numericParity: 6, results }, null, 2));
} finally {
  if (started) {
    assert(resolve(directory).startsWith(resolve(base) + sep));
    command('pg_ctl', ['-D', directory, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' });
  }
}
