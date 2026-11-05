// Disposable loopback PostgreSQL only. This harness creates its own cluster;
// it accepts a binaries directory, never an existing database URL or profile.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const argument = process.argv.indexOf("--postgres-bin");
assert(argument >= 0 && process.argv[argument + 1], "Use --postgres-bin <portable PostgreSQL bin directory>");
const binaryDirectory = resolve(process.argv[argument + 1]);
const executable = name => join(binaryDirectory, `${name}${process.platform === "win32" ? ".exe" : ""}`);
const cache = join(root, "node_modules", ".cache");
await mkdir(cache, { recursive: true });
const fixture = await mkdtemp(join(cache, "notification-ack-race-"));
const data = join(fixture, "data"), log = join(fixture, "postgres.log");
const environment = { ...process.env };
for (const key of Object.keys(environment)) if (/^PG/i.test(key) || key === "DATABASE_URL") delete environment[key];
const run = promisify(execFile);
const control = args => new Promise((accept, reject) => {
  // PostgreSQL outlives pg_ctl. Do not wait for inherited output pipe handles.
  const child = spawn(executable("pg_ctl"), args, { env: environment, windowsHide: true, stdio: "ignore" });
  child.once("error", reject);
  child.once("exit", code => code === 0 ? accept() : reject(new Error(`Fixture pg_ctl exited ${code}; see ${log}`)));
});
const children = new Set();
let started = false;
const port = await new Promise((accept, reject) => {
  const probe = createServer(); probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => { const selected = probe.address().port; probe.close(() => accept(selected)); });
});
const pause = () => new Promise(accept => setTimeout(accept, 20));
const quote = value => `'${String(value).replaceAll("'", "''")}'`;

function session(name = `notification-fixture-${randomUUID()}`) {
  const child = spawn(executable("psql"), ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
    "-h", "127.0.0.1", "-p", String(port), "-U", "notification_fixture", "-d", "postgres"], {
    windowsHide: true, env: { ...environment, PGAPPNAME: name }, stdio: ["pipe", "pipe", "pipe"],
  });
  children.add(child);
  const state = { output: "", error: "", done: false };
  child.stdout.on("data", value => { state.output += value; });
  child.stderr.on("data", value => { state.error += value; });
  child.stdin.on("error", () => {});
  const finished = new Promise(accept => {
    child.once("error", error => { state.error += error.message; state.done = true; children.delete(child); accept({ code: -1, ...state }); });
    child.once("close", code => { state.done = true; children.delete(child); accept({ code, ...state }); });
  });
  return { child, state, finished };
}

async function query(sql, name) {
  const current = session(name); current.child.stdin.end(`${sql}\n`);
  const result = await current.finished;
  if (result.code !== 0) throw new Error(result.error || `Fixture psql exited ${result.code}`);
  return result.output.trim();
}

async function holder(sql) {
  const current = session(); current.child.stdin.write(`BEGIN;\n${sql}\nSELECT 'FIXTURE_READY';\n`);
  const deadline = Date.now() + 5000;
  while (!current.state.output.includes("FIXTURE_READY")) {
    if (current.state.done || Date.now() > deadline) throw new Error(`Holder did not become ready: ${current.state.error}`);
    await pause();
  }
  return async action => {
    current.child.stdin.end(`${action};\n\\q\n`);
    const result = await current.finished; assert.equal(result.code, 0, result.error);
  };
}

async function blocked(name) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const waiting = await query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(name)} AND cardinality(pg_blocking_pids(pid))>0);`);
    if (waiting === "t") return;
    await pause();
  }
  throw new Error("Expected independent PostgreSQL session to wait for the competing transaction");
}

const event = (id, branch = "a", cleared = ["first"]) => ({ id, event_type: "approval_requested", severity: "info",
  title: "Original immutable event", message: "Original content", store_id: branch, branch_id: branch,
  meta: {}, whatsapp_status: "skipped", client_event_id: `fixture:${id}`, created_at: "2026-10-30T10:00:00Z", cleared_by: cleared });
const insert = row => `INSERT INTO activity_events SELECT * FROM jsonb_populate_record(NULL::activity_events,${quote(JSON.stringify(row))}::jsonb);`;
const batch = (rows, id = randomUUID()) => `SELECT pos_sync_push_batch(${quote(id)}::uuid,'default','a','t-a','activity_events',${quote(JSON.stringify(rows))}::jsonb,'[]'::jsonb);`;
const snapshot = async id => JSON.parse(await query(`SELECT to_jsonb(e) FROM activity_events e WHERE id=${quote(id)}::uuid;`) || "null");
const schema = await readFile(join(root, "supabase", "schema.sql"), "utf8");
const fn = name => {
  const start = schema.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`); assert(start >= 0);
  const delimiter = schema.slice(start).match(/\bAS\s+(\$[\w]*\$)/i)?.[1]; assert(delimiter);
  const begin = schema.indexOf(delimiter, start), end = schema.indexOf(`${delimiter};`, begin + delimiter.length);
  assert(end > begin); return schema.slice(start, end + delimiter.length + 1);
};
const tableStart = schema.indexOf("CREATE TABLE IF NOT EXISTS public.activity_events ("); assert(tableStart >= 0);
const table = schema.slice(tableStart, schema.indexOf("\n);", tableStart) + 3);
let passed = 0;
async function test(name, work) {
  await query("TRUNCATE activity_events,sync_idempotency_receipts;");
  await work(); passed++; console.log(`PASS ${name}`);
}

try {
  await run(executable("initdb"), ["-D", data, "--auth=trust", "--username=notification_fixture", "--no-locale", "--encoding=UTF8"], { env: environment, windowsHide: true });
  await control(["-D", data, "-l", log, "-o", `-h 127.0.0.1 -p ${port} -F -c max_connections=10 -c shared_buffers=16MB`, "-w", "start"]);
  started = true;
  await query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE TABLE app_users(id uuid,user_id text,role text,permissions jsonb,store_id text,auth_user_id uuid,is_active boolean);
    CREATE TABLE terminal_tokens(id text PRIMARY KEY,location_id text,status text,revoked_at timestamptz);
    INSERT INTO terminal_tokens VALUES('t-a','a','active',NULL),('t-b','b','active',NULL);
    CREATE TABLE sync_idempotency_receipts(batch_id uuid PRIMARY KEY,organization_id text,branch_id text,table_name text,payload_hash text,applied_count int);
    ${table}
    ALTER TABLE activity_events ADD PRIMARY KEY(id),ADD UNIQUE(client_event_id),ADD COLUMN cleared_by text[] DEFAULT '{}',
      ADD COLUMN previous_state jsonb,ADD COLUMN new_state jsonb,ADD COLUMN branch_id text;
    ${fn("activity_events_immutable")}
    CREATE TRIGGER activity_events_no_update BEFORE UPDATE OR DELETE ON activity_events FOR EACH ROW EXECUTE FUNCTION activity_events_immutable();
    ${fn("pos_sync_validate_scope")}
    ${fn("sync_delete_activity_events")}
    ${fn("pos_sync_push_batch")}
    ${await readFile(join(root, "supabase/migrations/20261030234813_guard_activity_acknowledgement_branch_ownership.sql"), "utf8")}`);

  for (const branch of ["b", "a"]) await test(`concurrent ${branch === "b" ? "foreign" : "same"}-branch insert commits before the waiting native conflict`, async () => {
    const id = randomUUID(), original = event(id, branch), finish = await holder(insert(original));
    const name = `notification-wait-${randomUUID()}`;
    const pending = query(batch([{ ...event(id), title: "Untrusted replacement", cleared_by: ["manager-a"] }]), name);
    // Attach the rejection before allowing the blocking transaction to finish.
    const outcome = pending.then(value => ({ value }), error => ({ error }));
    await blocked(name); await finish("COMMIT");
    const result = await outcome, current = await snapshot(id);
    if (branch === "b") {
      assert.match(result.error?.message ?? "Unexpected success", /SYNC_BRANCH_FORBIDDEN/);
      assert.deepEqual(current.cleared_by, ["first"]);
      assert.equal(await query("SELECT count(*) FROM sync_idempotency_receipts;"), "0");
    } else {
      assert.equal(result.error, undefined); assert.equal(JSON.parse(result.value).ok, true);
      assert.deepEqual(current.cleared_by.sort(), ["first", "manager-a"]);
    }
    assert.equal(current.store_id, branch); assert.equal(current.title, original.title);
  });
  await test("a rolled-back competing foreign insertion leaves the waiting legitimate new event usable", async () => {
    const id = randomUUID(), finish = await holder(insert(event(id, "b"))), name = `notification-wait-${randomUUID()}`;
    const pending = query(batch([event(id)]), name); const outcome = pending.then(value => ({ value }), error => ({ error }));
    await blocked(name); await finish("ROLLBACK"); const result = await outcome;
    assert.equal(result.error, undefined); assert.equal(JSON.parse(result.value).applied, 1);
    assert.equal((await snapshot(id)).store_id, "a");
  });
  await test("concurrent stale recipient clears union against the locked current event", async () => {
    const id = randomUUID(); await query(insert(event(id)));
    const finish = await holder(batch([{ ...event(id), cleared_by: ["manager-a"] }]));
    const name = `notification-wait-${randomUUID()}`, pending = query(batch([{ ...event(id), cleared_by: ["admin-a"] }]), name);
    const outcome = pending.then(value => ({ value }), error => ({ error }));
    await blocked(name); await finish("COMMIT"); const result = await outcome; assert.equal(result.error, undefined);
    assert.deepEqual((await snapshot(id)).cleared_by.sort(), ["admin-a", "first", "manager-a"]);
  });
  await test("a late foreign conflict rolls back earlier writes and the waiting batch receipt", async () => {
    const id = randomUUID(), ownId = randomUUID(), batchId = randomUUID(), finish = await holder(insert(event(id, "b")));
    const name = `notification-wait-${randomUUID()}`, pending = query(batch([event(ownId), event(id)], batchId), name);
    const outcome = pending.then(value => ({ value }), error => ({ error }));
    await blocked(name); await finish("COMMIT"); const result = await outcome;
    assert.match(result.error?.message ?? "Unexpected success", /SYNC_BRANCH_FORBIDDEN/); assert.equal(await snapshot(ownId), null);
    assert.equal(await query(`SELECT count(*) FROM sync_idempotency_receipts WHERE batch_id=${quote(batchId)}::uuid;`), "0");
  });
  await test("concurrent replay of one batch waits for its receipt and applies only once", async () => {
    const id = randomUUID(), batchId = randomUUID(), command = batch([event(id)], batchId), finish = await holder(command);
    const name = `notification-wait-${randomUUID()}`, pending = query(command, name);
    const outcome = pending.then(value => ({ value }), error => ({ error }));
    await blocked(name); await finish("COMMIT"); const result = await outcome;
    assert.equal(result.error, undefined); assert.equal(JSON.parse(result.value).replayed, true);
    assert.equal(await query("SELECT count(*) FROM activity_events;"), "1");
    assert.equal(await query("SELECT count(*) FROM sync_idempotency_receipts;"), "1");
  });
  console.log(`${passed} passed real two-session PostgreSQL notification acknowledgement races; no existing database used.`);
} finally {
  for (const child of children) { child.stdin.destroy(); child.kill(); }
  if (started) await control(["-D", data, "-m", "immediate", "-w", "stop"]);
  assert.equal(dirname(resolve(fixture)), resolve(cache)); assert(basename(fixture).startsWith("notification-ack-race-"));
  await rm(fixture, { recursive: true, force: true });
}
