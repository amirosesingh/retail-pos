// Runs only against a new, disposable PostgreSQL cluster bound to localhost.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const bin = process.env.POSTGRES_TEST_BIN;
assert(bin, "Set POSTGRES_TEST_BIN to the existing portable PostgreSQL bin directory");
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^PG/i.test(key) || /^DATABASE_URL$/i.test(key)) delete env[key];
}

const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(error => error ? reject(error) : resolve(port));
  });
});
const root = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const fixtureRoot = join(root, ".tmp", "pos-sync-feed-foundation");
await mkdir(fixtureRoot, { recursive: true });
assert.equal(await realpath(fixtureRoot), fixtureRoot, "Fixture root must stay in the worktree");
const directory = await mkdtemp(join(fixtureRoot, "owned-"));
const options = { env, windowsHide: true, encoding: "utf8", timeout: 30_000 };
const command = (name, args, extra = {}) => execFileSync(join(bin, `${name}.exe`), args, { ...options, ...extra });
const psql = join(bin, "psql.exe");
const psqlArgs = ["-X", "-qAtw", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres"];
const runSql = input => spawnSync(psql, psqlArgs, { ...options, input });
const sql = input => {
  const { status, stdout, stderr, error } = runSql(input);
  assert.equal(status, 0, error?.message ?? stderr);
  return stdout.replaceAll("\r\n", "\n").trim();
};
const denySql = (input, message) => {
  const result = runSql(input);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, message);
};

const activeSessions = new Set();
function session() {
  const child = spawn(psql, psqlArgs, { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const state = { child, stdout: "", stderr: "" };
  activeSessions.add(state);
  child.stdout.setEncoding("utf8").on("data", chunk => { state.stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { state.stderr += chunk; });
  child.stdin.on("error", error => { state.stderr += error.message; });
  state.finished = new Promise(resolve => {
    child.on("error", error => { state.stderr += error.message; });
    child.once("close", code => { activeSessions.delete(state); resolve(code); });
  });
  return state;
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 8_000;
  while (!predicate()) {
    assert(Date.now() < deadline, message);
    await delay(25);
  }
}

const epoch = "241360c4-1319-468a-a47b-985d427161e4";
const wrongEpoch = "840c0358-a8fa-40e0-a6e4-e5f7727d9d18";
const schema = "pos_sync_feed_v1";
const group = (scope_id, entity, groupEpoch = epoch) => ({ scope_id, epoch: groupEpoch, changes: [{ entity }] });
const append = (...groups) => `SELECT * FROM ${schema}.append_groups('fixture-org', '${JSON.stringify(groups)}'::jsonb);`;
const state = () => sql(`SELECT scope_id, head_seq, replay_floor FROM ${schema}.feed_heads ORDER BY scope_id;`);
const entries = () => sql(`SELECT scope_id, seq, changes->0->>'entity' FROM ${schema}.feed_groups ORDER BY scope_id, seq;`);

try {
  command("initdb", ["-D", directory, "-A", "trust", "-U", "postgres", "--encoding=UTF8", "--locale=C", "--no-instructions"]);
  command("pg_ctl", ["-D", directory, "-l", join(directory, "fixture.log"), "-o", `-h 127.0.0.1 -p ${port} -c max_connections=6 -c shared_buffers=32MB -c statement_timeout=15000`, "-w", "start"], { stdio: "ignore" });
  sql("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
  const preparation = await readFile(new URL("../supabase/sql/prepared_pos_sync_feed_v1.sql", import.meta.url), "utf8");
  sql(`BEGIN;\n${preparation}\nCOMMIT;`);
  sql(`INSERT INTO ${schema}.feed_heads (organization_id, scope_id, epoch)
       VALUES ('fixture-org', 'A', '${epoch}'), ('fixture-org', 'B', '${epoch}');`);
  assert.equal(state(), "A|0|0\nB|0|0");

  // A later same-scope writer cannot publish ahead of an uncommitted earlier group.
  const holder = session();
  holder.child.stdin.write(`SET application_name = 'pos_feed_holder';\nBEGIN;\n${append(group("A", "first"))}\n\\echo HOLDER_READY\n`);
  await waitFor(() => holder.stdout.includes("HOLDER_READY"), "First append did not acquire its scope lock");
  const waiter = session();
  waiter.child.stdin.end(`SET application_name = 'pos_feed_waiter';\n${append(group("A", "second"))}`);
  await waitFor(() => sql(`SELECT EXISTS (
    SELECT 1 FROM pg_stat_activity waiter JOIN pg_stat_activity blocker
      ON blocker.pid = ANY(pg_blocking_pids(waiter.pid))
    WHERE waiter.application_name = 'pos_feed_waiter' AND blocker.application_name = 'pos_feed_holder'
  );`) === "t", "Later append was not blocked by the first transaction");
  assert.equal(state(), "A|0|0\nB|0|0");
  assert.equal(entries(), "");
  sql(append(group("B", "independent")));
  assert.equal(entries(), "B|1|independent");
  holder.child.stdin.end("COMMIT;\n");
  assert.equal(await holder.finished, 0, holder.stderr);
  assert.equal(await waiter.finished, 0, waiter.stderr);
  const firstEntries = "A|1|first\nA|2|second\nB|1|independent";
  assert.equal(entries(), firstEntries);

  // Both scopes roll back with their enclosing transaction and neither head gains a hole.
  const rolledBack = append(group("B", "rollback-b"), group("A", "rollback-a"));
  assert.equal(sql(`BEGIN; ${rolledBack} ROLLBACK;`).split("\n").sort().join("\n"), `A|${epoch}|3\nB|${epoch}|2`);
  assert.equal(state(), "A|2|0\nB|1|0");
  assert.equal(entries(), firstEntries);

  // An invalid epoch in either scope rejects the whole append.
  denySql(append(group("A", "invalid-a"), group("B", "invalid-b", wrongEpoch)), /POS_FEED_V1_SCOPE_OR_EPOCH_MISMATCH/);
  assert.equal(state(), "A|2|0\nB|1|0");
  assert.equal(entries(), firstEntries);
  const wholeGroup = group("A", "committed-a");
  wholeGroup.changes.push({ entity: "dependent-a" });
  sql(append(group("B", "committed-b"), wholeGroup));
  assert.equal(state(), "A|3|0\nB|2|0");
  assert.equal(entries(), "A|1|first\nA|2|second\nA|3|committed-a\nB|1|independent\nB|2|committed-b");
  assert.deepEqual(JSON.parse(sql(`SELECT changes FROM ${schema}.feed_groups WHERE scope_id='A' AND seq=3;`)), wholeGroup.changes);
  denySql(`SELECT * FROM ${schema}.append_groups('fixture-org', jsonb_build_array(jsonb_build_object(
    'scope_id', 'A', 'epoch', '${epoch}', 'changes', jsonb_build_array(jsonb_build_object('entity', repeat('x', 1048577)))
  )));`, /POS_FEED_V1_INVALID_GROUPS/);
  assert.equal(state(), "A|3|0\nB|2|0");

  // The prepared protocol has no callable or readable surface for application roles.
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.equal(sql(`SELECT has_schema_privilege('${role}', '${schema}', 'USAGE'),
      has_table_privilege('${role}', '${schema}.feed_heads', 'SELECT'),
      has_table_privilege('${role}', '${schema}.feed_groups', 'SELECT'),
      has_function_privilege('${role}', '${schema}.append_groups(text,jsonb)', 'EXECUTE');`), "f|f|f|f");
    denySql(`SET ROLE ${role}; ${append(group("A", "unauthorized"))}`, /permission denied/);
  }
  assert.equal(state(), "A|3|0\nB|2|0");
  console.log("PASS 4 isolated PostgreSQL feed foundation scenarios (commit order, rollback, multi-scope atomicity, role denial)");
} finally {
  for (const running of activeSessions) running.child.kill();
  await Promise.all([...activeSessions].map(running => running.finished));
  const resolvedDirectory = await realpath(directory);
  assert.equal(dirname(resolvedDirectory), fixtureRoot, "Refusing to remove a directory outside the fixture root");
  const hasServer = await access(join(resolvedDirectory, "postmaster.pid")).then(() => true, error => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  if (hasServer) command("pg_ctl", ["-D", resolvedDirectory, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
  await rm(resolvedDirectory, { recursive: true });
}
