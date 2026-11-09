// Runs only against a new, disposable PostgreSQL cluster bound to localhost.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { verifyInboxFoundation } from "./lib/pos-sync-inbox-foundation-fixture.mjs";

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
  assert.equal(status, 0, stderr || error?.message);
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
const sqlText = value => value === null ? "NULL" : `'${value.replaceAll("'", "''")}'`;
const pullCall = (scope, after, { upper = null, limit = 100, scopeEpoch = epoch, org = "fixture-org" } = {}) =>
  `${schema}.pull_groups(${[org, scope, scopeEpoch, after, upper].map(sqlText).join(", ")}, ${limit})`;
const pull = (scope, after, options) => JSON.parse(sql(`SELECT ${pullCall(scope, after, options)};`));
const pinCall = (scope, scopeEpoch = epoch) => `${schema}.create_snapshot_pin('fixture-org', ${sqlText(scope)}, ${sqlText(scopeEpoch)})`;
const retireCall = (scope, through, limit = 1000) =>
  `${schema}.retire_groups('fixture-org', ${sqlText(scope)}, '${epoch}', ${sqlText(through)}, ${limit})`;
const retire = (scope, through, limit) => JSON.parse(sql(`SELECT ${retireCall(scope, through, limit)};`));

async function verifyFeedFixture() {
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
  assert.deepEqual(pull("A", "0"), {
    status: "OK", scope_id: "A", epoch, next_seq: "0", upper_seq: "0", has_more: false, groups: [],
  });
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
      has_table_privilege('${role}', '${schema}.snapshot_pins', 'SELECT'),
      has_function_privilege('${role}', '${schema}.append_groups(text,jsonb)', 'EXECUTE'),
      has_function_privilege('${role}', '${schema}.pull_groups(text,text,uuid,text,text,integer)', 'EXECUTE'),
      has_function_privilege('${role}', '${schema}.create_snapshot_pin(text,text,uuid,integer)', 'EXECUTE'),
      has_function_privilege('${role}', '${schema}.retire_groups(text,text,uuid,text,integer)', 'EXECUTE');`), "f|f|f|f|f|f|f|f");
    denySql(`SET ROLE ${role}; ${append(group("A", "unauthorized"))}`, /permission denied/);
    denySql(`SET ROLE ${role}; SELECT ${pullCall("A", "0")};`, /permission denied/);
    denySql(`SET ROLE ${role}; SELECT ${pinCall("A")};`, /permission denied/);
    denySql(`SET ROLE ${role}; SELECT ${retireCall("A", "1")};`, /permission denied/);
  }
  assert.equal(state(), "A|3|0\nB|2|0");
  console.log("PASS 4 isolated PostgreSQL feed foundation scenarios (commit order, rollback, multi-scope atomicity, role denial)");

  // A continuation uses the captured upper sequence even after another commit.
  const firstPage = pull("A", "0", { limit: 1 });
  assert.deepEqual(firstPage, {
    status: "OK", scope_id: "A", epoch, next_seq: "1", upper_seq: "3", has_more: true,
    groups: [{ seq: "1", operation_id: null, changes: [{ entity: "first" }] }],
  });
  sql(append(group("A", "after-window")));
  const lastPage = pull("A", firstPage.next_seq, { upper: firstPage.upper_seq, limit: 2 });
  assert.equal(lastPage.has_more, false);
  assert.equal(lastPage.next_seq, "3");
  assert.deepEqual(lastPage.groups.map(item => item.seq), ["2", "3"]);
  assert.deepEqual(lastPage.groups[1].changes, wholeGroup.changes);
  assert.deepEqual(pull("A", "3").groups.map(item => item.seq), ["4"]);
  assert.deepEqual(pull("B", "0").groups.map(item => item.changes[0].entity), ["independent", "committed-b"]);
  assert.deepEqual(pull("A", "0", { org: "other-org" }), { status: "SCOPE_UNAVAILABLE" });

  // The page byte budget defers a whole group rather than splitting it.
  sql(`INSERT INTO ${schema}.feed_heads (organization_id, scope_id, epoch)
       VALUES ('fixture-org', 'wide', '${epoch}');`);
  const wideAppend = `SELECT * FROM ${schema}.append_groups('fixture-org', jsonb_build_array(jsonb_build_object(
    'scope_id', 'wide', 'epoch', '${epoch}', 'changes', jsonb_build_array(jsonb_build_object('entity', repeat('x', 1048000)))
  )));`;
  sql(wideAppend);
  sql(wideAppend);
  const widePage = (after, options) => sql(`SELECT page->>'next_seq', page->>'upper_seq', page->>'has_more',
    jsonb_array_length(page->'groups'), octet_length(page::text) <= 2097152
    FROM (SELECT ${pullCall("wide", after, options)} AS page) AS result;`);
  assert.equal(widePage("0"), "1|2|true|1|t");
  assert.equal(widePage("1", { upper: "2" }), "2|2|false|1|t");

  // Compare and return full bigint cursors without JavaScript rounding.
  const highStart = "9007199254740992";
  const highNext = "9007199254740993";
  sql(`INSERT INTO ${schema}.feed_heads (organization_id, scope_id, epoch, head_seq, replay_floor)
       VALUES ('fixture-org', 'high', '${epoch}', ${highStart}, ${highStart});`);
  sql(append(group("high", "exact")));
  const highPage = pull("high", highStart);
  assert.equal(highPage.next_seq, highNext);
  assert.equal(highPage.upper_seq, highNext);
  assert.equal(highPage.groups[0].seq, highNext);
  assert.deepEqual(pull("high", "9223372036854775808"), { status: "INVALID_CURSOR" });
  assert.deepEqual(pull("high", "1e3"), { status: "INVALID_CURSOR" });
  assert.deepEqual(pull("high", highNext, { upper: highStart }), { status: "INVALID_CURSOR" });
  assert.deepEqual(pull("high", highStart, { upper: "9007199254740994" }), { status: "INVALID_CURSOR" });

  assert.deepEqual(pull("A", "0", { scopeEpoch: wrongEpoch }), { status: "SNAPSHOT_REQUIRED", reason: "EPOCH_MISMATCH" });
  sql(`BEGIN;
       UPDATE ${schema}.feed_heads SET replay_floor = 1 WHERE organization_id = 'fixture-org' AND scope_id = 'A';
       DELETE FROM ${schema}.feed_groups WHERE organization_id = 'fixture-org' AND scope_id = 'A' AND seq = 1;
       COMMIT;`);
  assert.deepEqual(pull("A", "0"), { status: "SNAPSHOT_REQUIRED", reason: "REPLAY_EXPIRED" });
  assert.equal(pull("A", "1").groups[0].seq, "2");
  sql(`DELETE FROM ${schema}.feed_groups WHERE organization_id = 'fixture-org' AND scope_id = 'A' AND seq = 3;`);
  assert.deepEqual(pull("A", "2"), { status: "SNAPSHOT_REQUIRED", reason: "FEED_GAP" });
  console.log("PASS 4 isolated PostgreSQL feed reader scenarios (fixed bounds and scope, whole-group byte budget, exact cursors, recovery outcomes)");

  // A pin protects every change after the snapshot baseline, while older
  // groups can be removed in bounded transactions.
  const pin = JSON.parse(sql(`SELECT ${pinCall("B")};`));
  assert.equal(pin.status, "OK");
  assert.equal(pin.protected_seq, "2");
  assert.equal(pin.epoch, epoch);
  assert.equal(JSON.parse(sql(`SELECT ${pinCall("B", wrongEpoch)};`)).status, "SNAPSHOT_REQUIRED");
  sql(append(group("B", "post-pin-1")));
  sql(append(group("B", "post-pin-2")));
  assert.deepEqual(retire("B", "4", 1), { status: "OK", replay_floor: "1", has_more: true, blocked_by_pin: true });
  assert.deepEqual(retire("B", "4"), { status: "OK", replay_floor: "2", has_more: false, blocked_by_pin: true });
  assert.deepEqual(pull("B", pin.protected_seq).groups.map(item => item.seq), ["3", "4"]);

  // Cleanup and floor movement roll back together. An expired pin can no
  // longer protect the groups and is pruned by the same bounded cleanup.
  sql(`UPDATE ${schema}.snapshot_pins SET expires_at = clock_timestamp() - interval '1 second'
       WHERE organization_id = 'fixture-org' AND scope_id = 'B' AND pin_id = '${pin.pin_id}';`);
  sql(`BEGIN; SELECT ${retireCall("B", "4")}; ROLLBACK;`);
  assert.equal(sql(`SELECT count(*) FROM ${schema}.snapshot_pins WHERE pin_id = '${pin.pin_id}';`), "1");
  assert.deepEqual(pull("B", "2").groups.map(item => item.seq), ["3", "4"]);
  assert.deepEqual(retire("B", "4", 1), { status: "OK", replay_floor: "3", has_more: true, blocked_by_pin: false });
  assert.equal(sql(`SELECT count(*) FROM ${schema}.snapshot_pins WHERE pin_id = '${pin.pin_id}';`), "0");
  assert.deepEqual(pull("B", "2"), { status: "SNAPSHOT_REQUIRED", reason: "REPLAY_EXPIRED" });
  assert.deepEqual(pull("B", "3").groups.map(item => item.seq), ["4"]);
  assert.deepEqual(retire("B", "4"), { status: "OK", replay_floor: "4", has_more: false, blocked_by_pin: false });
  assert.deepEqual(pull("B", "4").groups, []);
  console.log("PASS 2 isolated PostgreSQL snapshot retention scenarios (active pin and bounded cleanup, rollback and expiry)");

  await verifyInboxFoundation({ sql, denySql });
}

try {
  command("initdb", ["-D", directory, "-A", "trust", "-U", "postgres", "--encoding=UTF8", "--locale=C", "--no-instructions"]);
  command("pg_ctl", ["-D", directory, "-l", join(directory, "fixture.log"), "-o", `-h 127.0.0.1 -p ${port} -c max_connections=6 -c shared_buffers=32MB -c statement_timeout=15000`, "-w", "start"], { stdio: "ignore" });
  sql("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
  const preparation = await readFile(new URL("./preparation/pos-sync-feed-v1.sql", import.meta.url), "utf8");
  sql(`BEGIN;\n${preparation}\nCOMMIT;`);
  if (process.argv.includes("--installed-registry")) {
    const require = createRequire(import.meta.url);
    const { compareInstalledRegistry } = require("./lib/pos-sync-installed-registry.cjs");
    const { createLocal } = require("./lib/shift-protocol-integration-fixture.cjs");
    const { tables } = require("../database/sqlserver/schema-registry.json");
    const local = await createLocal(randomUUID());
    try {
      const sqlRead = await readFile(join(root, "docs/database/pos-sync-sqlserver-inventory.readonly.sql"), "utf8");
      const pgRead = await readFile(join(root, "docs/database/pos-sync-postgres-inventory.readonly.sql"), "utf8");
      const results = await local.manager.pool.request().batch(sqlRead);
      const inventory = JSON.parse(results.recordsets.at(-1)[0].pos_sync_sqlserver_inventory);
      for (const field of ["relations", "columns"])
        inventory[field] = inventory[field].filter(row => row.relation_name === "pos_store_settings");
      const settings = tables.find(table => table.cloudTable === "pos_store_settings");
      const registry = { tables: [{ ...settings, columns: settings.columns.filter(column => column.cloudColumn === "store_id") }] };
      sql("CREATE TABLE public.pos_store_settings (store_id text); CREATE TABLE public.schema_migrations (version text);");
      assert.deepEqual(compareInstalledRegistry(registry, inventory, JSON.parse(sql(pgRead))), []);
      sql("ALTER TABLE public.pos_store_settings RENAME COLUMN store_id TO wrong; CREATE TABLE pos_sync_feed_v1.unreviewed_scope (id text);");
      assert.deepEqual(compareInstalledRegistry(registry, inventory, JSON.parse(sql(pgRead))), [
        "Postgres mapped column unavailable: public.pos_store_settings.store_id",
        "Postgres unclassified relation: pos_sync_feed_v1.unreviewed_scope (r)",
      ]);
      assert.throws(() => compareInstalledRegistry(registry, { ...inventory, can_view_database_definition: 0 }, {}), /VIEW DEFINITION/);
      console.log("PASS disposable SQL Server and PostgreSQL relation inventory and mapped-column drift check");
    } finally { await local.close(); }
  } else if (process.argv.includes("--named-approval-wake")) {
    const { verifyNamedApprovalWake } = await import("./lib/pos-named-approval-wake-fixture.mjs");
    await verifyNamedApprovalWake({ sql, denySql });
  } else if (process.argv.includes("--cash-bridge") || process.argv.includes("--cash-wire") || process.argv.includes("--cash-receiving") ||
      process.argv.includes("--cash-attested") || process.argv.includes("--cash-attested-relay")) {
    const { verifyCashBridge } = await import("./lib/pos-sync-cash-bridge-fixture.mjs");
    const useCashRelay = process.argv.includes("--cash-attested-relay");
    const attested = useCashRelay || process.argv.includes("--cash-attested");
    let wire;
    if (process.argv.includes("--cash-wire") || process.argv.includes("--cash-receiving") || attested) {
      const source = execFileSync(process.execPath, [join(root, "scripts/test-pos-sale-outbox-sqlserver.cjs"), attested ? "--attested-wire" : "--wire"],
        { cwd: root, windowsHide: true, encoding: "utf8", timeout: 120_000 });
      const line = source.split(/\r?\n/).find(value => value.startsWith("POS_CASH_WIRE "));
      assert(line, "The disposable SQL Server fixture must produce its saved cash wire evidence");
      wire = JSON.parse(line.slice("POS_CASH_WIRE ".length));
    }
    const receiving = process.argv.includes("--cash-receiving")
      ? await (await import("./lib/pos-sync-cash-receive-fixture.mjs")).cashReceivingFixture(root) : undefined;
    const relay = useCashRelay ? (await import("./lib/pos-sync-cash-relay-fixture.mjs")).verifyAttestedCashRelay : undefined;
    await verifyCashBridge({ sql, denySql, wire, receiving, session, waitFor, attested, relay });
  } else if (process.argv.includes("--store-settings") || process.argv.includes("--store-settings-native")) {
    const { verifyStoreSettingsPilot } = await import("./lib/pos-sync-store-settings-fixture.mjs");
    const applyNative = process.argv.includes("--store-settings-native") ? evidence => {
      const output = execFileSync(process.execPath, [join(root, "scripts/test-pos-sync-grouped-sqlserver.cjs"), "--postgres-wire"], {
        cwd: root, windowsHide: true, encoding: "utf8", input: JSON.stringify(evidence), timeout: 120_000,
      });
      console.log(output.trim());
    } : undefined;
    await verifyStoreSettingsPilot({ sql, denySql, session, waitFor, applyNative });
  } else if (process.argv.includes("--grouped-gateway") || process.argv.includes("--grouped-gateway-native") ||
      process.argv.includes("--mixed-grouped-gateway") || process.argv.includes("--paged-mixed-gateway") ||
      process.argv.includes("--settings-edit") || process.argv.includes("--settings-edit-gateway") || process.argv.includes("--settings-edit-relay")) {
    const { verifyGroupedGateway } = await import("./lib/pos-sync-grouped-gateway-fixture.mjs");
    const editRelay = process.argv.includes("--settings-edit-relay");
    await verifyGroupedGateway({ sql, denySql, native: process.argv.includes("--grouped-gateway-native"),
      mixedGateway: process.argv.includes("--mixed-grouped-gateway") || process.argv.includes("--paged-mixed-gateway"),
      pagedRecovery: process.argv.includes("--paged-mixed-gateway"),
      settingsEdit: process.argv.includes("--settings-edit"), editGateway: editRelay || process.argv.includes("--settings-edit-gateway"), editRelay });
  } else {
    await verifyFeedFixture();
  }
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
