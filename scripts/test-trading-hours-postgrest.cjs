"use strict";
// Opt-in, uniquely owned loopback PostgreSQL/PostgREST only. No database URL,
// POS profile, live project or credential is accepted or read.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const { spawn, execFileSync } = require("node:child_process");
assert.deepEqual(process.argv.slice(2), ["--run"]);
const bin = process.env.POSTGRES_TEST_BIN, restBin = process.env.POSTGREST_TEST_EXE;
assert(bin && restBin, "Existing portable PostgreSQL and PostgREST executables required");
const base = path.resolve(".tmp/trading-hours-rest-fixture"); fs.mkdirSync(base, { recursive: true });
const directory = fs.mkdtempSync(path.join(base, "owned-"));
const env = { ...process.env }; for (const key of Object.keys(env)) if (/^PG|^PGRST_/i.test(key) || key === "DATABASE_URL") delete env[key];
const command = (name, args, options = {}) => execFileSync(path.join(bin, `${name}.exe`), args, { env, windowsHide: true, encoding: "utf8", timeout: 30000, ...options });
const freePort = () => new Promise((accept, reject) => { const s = net.createServer(); s.once("error", reject); s.listen(0, "127.0.0.1", () => { const port = s.address().port; s.close(() => accept(port)); }); });
async function main() {
  let started = false, rest, log;
  try {
    const port = await freePort(), apiPort = await freePort();
    command("initdb", ["-D", directory, "-A", "trust", "-U", "postgres", "--encoding=UTF8", "--locale=C", "--no-instructions"]);
    command("pg_ctl", ["-D", directory, "-l", path.join(directory, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port} -c max_connections=8 -c shared_buffers=32MB`, "-w", "start"], { stdio: "ignore" }); started = true;
    const query = sql => command("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres", "--no-password"], { input: sql });
    query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE stores(id text PRIMARY KEY); INSERT INTO stores SELECT 'shop-'||n FROM generate_series(0,99)n;
      CREATE TABLE pos_settings(id integer PRIMARY KEY,integration_settings jsonb); INSERT INTO pos_settings VALUES(1,'{"timeZone":"UTC"}');
      CREATE TABLE products(id text PRIMARY KEY,cost_price numeric);
      CREATE TABLE sales(id text PRIMARY KEY,store_id text,created_at timestamptz,total_amount numeric,tax_amount numeric,rounding_adjustment numeric,is_refunded boolean);
      CREATE TABLE sale_items(id text PRIMARY KEY,sale_id text,product_id text,quantity numeric,unit_cost numeric);
      INSERT INTO sales SELECT 'bill-'||n||'-'||h,'shop-'||n,'2026-11-01T00:00Z'::timestamptz+h*interval'1 hour',10,0,0,false
        FROM generate_series(0,99)n CROSS JOIN generate_series(0,23)h;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
      CREATE FUNCTION fixture_set_rows() RETURNS TABLE(n integer) LANGUAGE sql STABLE AS $$SELECT generate_series(1,2400)$$;
      REVOKE ALL ON FUNCTION fixture_set_rows() FROM PUBLIC; GRANT EXECUTE ON FUNCTION fixture_set_rows() TO service_role;`);
    const artifact=fs.readFileSync("supabase/migrations/20261105170645_bounded_shop_hourly_report.sql", "utf8").replaceAll('\r\n','\n');
    query('CREATE TABLE fixture_hour_ledger(id integer PRIMARY KEY);INSERT INTO fixture_hour_ledger VALUES(1);');
    for(const eol of ['LF','CRLF'])for(const stage of ['late DDL','ledger']){
      const bytes=eol==='CRLF'?artifact.replaceAll('\n','\r\n'):artifact;
      const fault=stage==='ledger'?'INSERT INTO fixture_hour_ledger VALUES(1);':'SELECT 1/0;';
      assert.throws(()=>query('BEGIN;\n'+bytes+'\n'+fault+'\nCOMMIT;'));
      query("DO $$ BEGIN IF to_regprocedure('public.pos_report_store_hours(date,date,text[])') IS NOT NULL OR (SELECT count(*) FROM fixture_hour_ledger)<>1 THEN RAISE EXCEPTION 'owned migration rollback failed';END IF;END $$;");
      console.log('PASS actual '+eol+' tool-owned '+stage+' rollback leaves no function/partial grant');
    }
    query('BEGIN;\n'+artifact+'\nCOMMIT;');
    query("DO $$ BEGIN IF has_function_privilege('anon','public.pos_report_store_hours(date,date,text[])','EXECUTE') OR has_function_privilege('authenticated','public.pos_report_store_hours(date,date,text[])','EXECUTE') OR NOT has_function_privilege('service_role','public.pos_report_store_hours(date,date,text[])','EXECUTE') THEN RAISE EXCEPTION 'hourly ACL changed';END IF;END $$;");
    for(const zone of ['UTC','Asia/Brunei']){
      query("UPDATE pos_settings SET integration_settings=jsonb_build_object('timeZone','"+zone+"');");
      const plan=query("EXPLAIN(ANALYZE,BUFFERS,TIMING OFF) SELECT public.pos_report_store_hours('2026-11-01','2026-11-01',ARRAY(SELECT 'shop-'||n FROM generate_series(0,99)n));");
      console.log('PERF actual '+zone+' 2400groups '+plan.split(/\r?\n/).filter(line=>/Execution Time:/.test(line)).join(' '));
    }
    query("UPDATE pos_settings SET integration_settings=jsonb_build_object('timeZone','UTC');");
    const config = path.join(directory, "postgrest.conf");
    fs.writeFileSync(config, `db-uri = "postgresql://postgres@127.0.0.1:${port}/postgres"\ndb-schemas = "public"\ndb-anon-role = "service_role"\ndb-max-rows = 1000\nserver-host = "127.0.0.1"\nserver-port = ${apiPort}\nlog-level = "error"\n`);
    log = fs.openSync(path.join(directory, "postgrest.log"), "a");
    rest = spawn(restBin, [config], { env, windowsHide: true, stdio: ["ignore", log, log] });
    const origin = `http://127.0.0.1:${apiPort}`;
    for (let retry = 0; retry < 100; retry++) {
      try { const res = await fetch(origin + "/", { signal: AbortSignal.timeout(1000) }); if (res.ok) break; } catch { /* New owned fixture is starting. */ }
      assert(rest.exitCode === null, "Owned PostgREST exited before readiness");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const ordinary = await fetch(origin + "/rpc/fixture_set_rows", { method: "POST", body: "{}", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(5000) });
    assert.equal(ordinary.status, 200); assert.equal((await ordinary.json()).length, 1000, "Fixture must reproduce the actual max_rows=1000 cap");
    for (const count of [42, 100]) {
      const stores = Array.from({ length: count }, (_, n) => `shop-${n}`);
      const response = await fetch(origin + "/rpc/pos_report_store_hours", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ p_from: "2026-11-01", p_to: "2026-11-01", p_store_ids: stores }), signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200); const result = await response.json();
      assert.equal(result.complete, true); assert.equal(result.version, 1); assert.equal(result.row_count, count * 24);
      assert.equal(result.rows.length, count * 24); assert.deepEqual(result.store_ids, stores);
      assert.equal(result.from, "2026-11-01"); assert.equal(result.to, "2026-11-01");
      assert.equal(new Set(result.rows.map(row => `${row.store_id}|${row.hour}`)).size, count * 24);
      assert.equal(result.rows.reduce((sum, row) => sum + row.revenue, 0), count * 24 * 10);
      console.log(`PASS actual PostgREST max_rows=1000: scalar snapshot returns complete ${count * 24} bound hourly groups`);
    }
    console.log("PASS actual row-cap reproduction and complete hourly snapshots; no live data or configuration used.");
  } finally {
    if (rest && rest.exitCode === null) { const closed = new Promise(resolve => rest.once("exit", resolve)); rest.kill(); await closed; }
    if (log !== undefined) fs.closeSync(log);
    if (started) command("pg_ctl", ["-D", directory, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
    assert(path.resolve(directory).startsWith(base + path.sep)); fs.rmSync(directory, { recursive: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
