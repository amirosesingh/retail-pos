// Disposable in-memory PostgreSQL; optional races create their own loopback
// cluster from supplied binaries, never an existing URL/database profile.
import { PGlite } from "@electric-sql/pglite";
import { readFile, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve, dirname, basename } from "node:path";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { PushWorker } = require("../electron/sync/push-worker.cjs");
const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const firstMigration = await readFile(new URL("../supabase/migrations/20261030153259_confirm_shift_closure_sync_acknowledgement.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261030164829_bind_shift_closure_proof_to_requested_revision.sql", import.meta.url), "utf8");
const contextMigration = await readFile(new URL("../supabase/migrations/20261031031945_preserve_validated_branch_context_for_shift_sync.sql", import.meta.url), "utf8");
const lifecycleMigration = await readFile(new URL("../supabase/migrations/20261101052452_prevent_closed_shift_reopening_during_sync.sql", import.meta.url), "utf8");
const lifecyclePart = part => lifecycleMigration.split(`-- SHIFT_CLOSED_SYNC_${part}_BEGIN`)[1]
  .split(`-- SHIFT_CLOSED_SYNC_${part}_END`)[0].trim();
const lifecyclePredicate = lifecyclePart("PREDICATE"), lifecycleValidation = lifecyclePart("VALIDATION");
const capturedArgument = process.argv.indexOf("--captured-routines");
const captured = capturedArgument < 0 ? null : JSON.parse(await readFile(process.argv[capturedArgument + 1], "utf8"));
const sourceFunction = (name, source = schema) => {
  source = source.replaceAll("\r\n", "\n");
  const start = source.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert(start >= 0, name);
  const delimiter = source.slice(start).match(/\bAS\s+(\$[\w]*\$)/i)?.[1];
  assert(delimiter, name);
  const bodyStart = source.indexOf(delimiter, start);
  return source.slice(start, source.indexOf(`${delimiter};`, bodyStart + delimiter.length) + delimiter.length + 1);
};
// Execute the real generator with writes captured, never rewriting the checkout.
const generatorSource = await readFile(new URL("./generate-supabase-sync-contract.cjs", import.meta.url), "utf8");
let generatedSchema;
runInNewContext(generatorSource, { require: name => name === "node:fs" ? {
  ...require("node:fs"), writeFileSync: (target, value) => {
    assert.equal(target, fileURLToPath(new URL("../supabase/schema.sql", import.meta.url)));
    generatedSchema = value;
  },
} : require(name), __dirname: fileURLToPath(new URL(".",import.meta.url)),
process: { argv: ["node","generate-supabase-sync-contract.cjs"] }, console: { log() {} } });
assert(generatedSchema);
const generatedContract = generatedSchema.split("-- SQLSERVER_SYNC_CONTRACT_BEGIN")[1].split("-- SQLSERVER_SYNC_CONTRACT_END")[0];
const originalApply = sourceFunction("sync_apply_shifts");
const originalAggregate = sourceFunction("pos_sync_push_aggregate");
const originalBatch = sourceFunction("pos_sync_push_batch");
const id = "11111111-1111-4111-8111-111111111111";
const operator = "22222222-2222-4222-8222-222222222222";
const opened = "2026-10-01T00:00:00.000Z";
const closed = "2026-10-01T08:00:00.000Z";
const db = new PGlite();
const tableStart = schema.indexOf("CREATE TABLE IF NOT EXISTS public.shifts (");
const table = schema.slice(tableStart, schema.indexOf("\n);", tableStart) + 3);
const fixtureSql = `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.auth_role',true) $$;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${operator}'::uuid $$;
  CREATE TABLE app_users(id text,auth_user_id uuid,role text,permissions jsonb,is_active boolean,store_id text);
  CREATE TABLE terminal_tokens(id text PRIMARY KEY,location_id text,status text,revoked_at timestamptz);
  CREATE TABLE audit_logs(id uuid PRIMARY KEY,store_id text);
  CREATE TABLE sync_idempotency_receipts(batch_id uuid PRIMARY KEY,organization_id text,branch_id text,
    table_name text,payload_hash text,applied_count int);
  CREATE TABLE sync_change_feed(cursor bigint GENERATED ALWAYS AS IDENTITY,organization_id text,branch_id text,
    terminal_id text,table_name text,entity_id text,operation text,row_version bigint,tombstone boolean,changed_at timestamptz DEFAULT now());
  CREATE TABLE held_orders(store_id text,shift_id text,status text);
  ${table}
  ALTER TABLE shifts ADD PRIMARY KEY(id),ADD COLUMN state text,ADD COLUMN close_reason text,
    ADD COLUMN closing_started_at timestamptz,ADD COLUMN closing_started_by text,
    ADD COLUMN final_counted_cash numeric,ADD COLUMN variance_status text;
  CREATE FUNCTION sync_apply_audit_logs(p_rows jsonb) RETURNS int LANGUAGE plpgsql AS $$
    DECLARE applied int; BEGIN INSERT INTO audit_logs SELECT * FROM jsonb_populate_recordset(NULL::audit_logs,p_rows)
      ON CONFLICT DO NOTHING; GET DIAGNOSTICS applied=ROW_COUNT; RETURN applied; END $$;
  CREATE FUNCTION sync_delete_audit_logs(jsonb,text,text) RETURNS int LANGUAGE sql AS $$ SELECT 0 $$;
  ${sourceFunction("pos_sync_validate_scope")}
  ${sourceFunction("sync_delete_shifts")}
  ${originalApply}
  ${originalBatch}
  ${originalAggregate}
  ${["skip_stale_update","bump_row_version","shifts_guard_client_writes","update_updated_at_column",
    "shifts_sync_status","guard_shift_unfinished_tickets","sync_feed_shifts"].map(name => sourceFunction(name)).join("\n")}
  CREATE TRIGGER shifts_aa_stale_guard BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION skip_stale_update();
  CREATE TRIGGER shifts_bump_row_version BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION bump_row_version();
  CREATE TRIGGER shifts_guard_client_writes BEFORE INSERT OR UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION shifts_guard_client_writes();
  CREATE TRIGGER shifts_set_updated_at BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  CREATE TRIGGER shifts_sync_status_trg BEFORE INSERT OR UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION shifts_sync_status();
  CREATE TRIGGER shifts_unfinished_tickets BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION guard_shift_unfinished_tickets();
  CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON shifts FOR EACH ROW EXECUTE FUNCTION sync_feed_shifts();
  INSERT INTO terminal_tokens VALUES('t-a','a','active',NULL),('t-b','b','active',NULL),('management',NULL,'active',NULL);
  SELECT set_config('test.auth_role','service_role',false);`;
await db.exec(fixtureSql);

function row(overrides = {}) {
  return { id, store_id: "a", terminal_id: "t-a", terminal_name: "A till", opened_by_name: "Cashier",
    opened_by_staff_id: "cashier", opened_by_role: "cashier", closed_by_name: "Cashier",
    closed_by_staff_id: "cashier", closed_by_role: "cashier", opened_at: opened, closed_at: closed,
    opening_float: 10, counted_cash: 110, expected_cash: 110, note: "", overdue: false,
    created_at: opened, updated_at: closed, status: "CLOSED", closing_float: 10, user_id: operator,
    row_version: 2, counted_card: 50, counted_digital: 25, expected_card: 50, expected_digital: 25,
    variance_cash: 0, variance_card: 0, variance_digital: 0, variance_total: 0, state: "CLOSED",
    close_reason: "END_OF_DAY", closing_started_at: closed, closing_started_by: "cashier",
    final_counted_cash: 110, variance_status: "MATCH", ...overrides };
}
const openRow = overrides => row({ status: "OPEN", state: "ACTIVE", closed_at: null, closed_by_name: null,
  closed_by_staff_id: null, closed_by_role: null, row_version: 1, ...overrides });
const cleanOpen = overrides => openRow({ counted_cash: null, counted_card: null, counted_digital: null,
  closing_float: null, final_counted_cash: null, variance_cash: null, variance_card: null,
  variance_digital: null, variance_total: null, variance_status: null, close_reason: null,
  closing_started_at: null, closing_started_by: null, ...overrides });
const operation = rows => ({ table: "shifts", rows, changes: [] });
const aggregate = (operations, batchId = randomUUID(), branch = "a", terminal = "t-a") =>
  db.query("SELECT pos_sync_push_aggregate($1::uuid,'default',$2,$3,$4::jsonb) result", [batchId, branch, terminal, JSON.stringify(operations)]);
const batch = (rows, batchId = randomUUID(), branch = "a", terminal = "t-a") =>
  db.query("SELECT pos_sync_push_batch($1::uuid,'default',$2,$3,'shifts',$4::jsonb,'[]'::jsonb) result", [batchId, branch, terminal, JSON.stringify(rows)]);
const state = async () => (await db.query("SELECT status,state,row_version,store_id,counted_cash,closed_at FROM shifts WHERE id=$1::uuid", [id])).rows[0];
async function seed(value = openRow()) {
  await db.exec("TRUNCATE shifts,sync_idempotency_receipts,audit_logs,sync_change_feed,held_orders; SELECT set_config('test.auth_role','service_role',false); SELECT set_config('pos.shift_fn','on',false);");
  await db.query("INSERT INTO shifts SELECT * FROM jsonb_populate_record(NULL::shifts,$1::jsonb)", [JSON.stringify(value)]);
  await db.exec("SELECT set_config('pos.shift_fn','',false)");
}
let passed = 0;
async function test(name, work) { await seed(); await work(); console.log(`PASS ${name}`); passed++; }

try {
  await test("legacy equal-version closure receives misleading ok:true/applied0", async () => {
    const response = (await aggregate([operation([row({ row_version: 1 })])])).rows[0].result;
    assert.equal(response.ok, true); assert.equal(response.applied, 0);
    assert.equal((await state()).status, "OPEN");
    assert.equal(response.shift_closure_ack_version, undefined);
  });
  await db.exec(firstMigration);
  await test("first proof version falsely rejects a valid closure across independent revision clocks", async () => {
    await seed(openRow({ row_version: 4 }));
    await assert.rejects(aggregate([operation([row({ row_version: 8 })])]), /SYNC_SHIFT_CLOSURE_CONFLICT/);
    assert.equal((await state()).status,"OPEN");
  });
  await db.exec(migration);
  await test("equal-version ignored closure fails atomically and cannot save a receipt", async () => {
    await assert.rejects(aggregate([operation([row({ row_version: 1 })])]), /SYNC_SHIFT_CLOSURE_CONFLICT/);
    assert.equal((await state()).status, "OPEN");
    assert.equal((await db.query("SELECT count(*)::int n FROM sync_idempotency_receipts")).rows[0].n, 0);
  });
  await test("newer closure persists and returns exact same-branch proof", async () => {
    const response = (await aggregate([operation([row()])])).rows[0].result;
    assert.equal(response.shift_closure_ack_version, 2);
    assert.deepEqual(response.shift_closures, [{ id, store_id: "a", row_version: 2, requested_row_version: 2 }]);
    assert.equal((await state()).status, "CLOSED");
  });
  await test("sparse offline closure revisions acknowledge actual PostgreSQL OLD+1 and requested snapshot separately", async () => {
    await seed(openRow({ row_version: 4 }));
    const key=randomUUID(); const operations=[operation([row({ row_version: 8 })])];
    const response=(await aggregate(operations,key)).rows[0].result;
    assert.deepEqual(response.shift_closures,[{ id,store_id:"a",row_version:5,requested_row_version:8 }]);
    assert.equal(response.shift_closure_ack_version,2); assert.equal((await state()).status,"CLOSED");
    const replay=(await aggregate(operations,key)).rows[0].result;
    assert.equal(replay.replayed,true); assert.deepEqual(replay.shift_closures,response.shift_closures);
    assert.equal((await state()).row_version,5);
  });
  await test("table recovery proof also keeps independent revision clocks across sparse updates", async () => {
    await seed(openRow({ row_version: 3 }));
    const response=(await batch([row({ row_version: 20 })])).rows[0].result;
    assert.deepEqual(response.shift_closures,[{ id,store_id:"a",row_version:4,requested_row_version:20 }]);
  });
  await test("authoritative unfinished-ticket guard still rolls back a closure and acknowledgement", async () => {
    await db.query("INSERT INTO held_orders VALUES('a',$1,'draft')",[id]);
    await assert.rejects(aggregate([operation([row()])]),/Complete or cancel all draft/);
    assert.equal((await state()).status,"OPEN");
    assert.equal((await db.query("SELECT count(*)::int n FROM sync_idempotency_receipts")).rows[0].n,0);
  });
  await test("equivalent equal and higher-revision cloud closures remain idempotent", async () => {
    await seed(row({ row_version: 5 }));
    const response = (await aggregate([operation([row({ row_version: 2 })])])).rows[0].result;
    assert.equal(response.applied, 0); assert.equal(response.shift_closures[0].row_version, 5);
    await seed(row()); assert.equal((await batch([row()])).rows[0].result.applied, 0);
  });
  await test("older conflicting closing counts are not acknowledged", async () => {
    await seed(row({ row_version: 5 }));
    await assert.rejects(aggregate([operation([row({ row_version: 2, counted_cash: 109 })])]), /SYNC_SHIFT_CLOSURE_CONFLICT/);
    assert.equal((await state()).counted_cash, "110");
  });
  await test("matching same-key retry and SQL-normalized timestamps/numbers replay", async () => {
    const key = randomUUID(); const operations = [operation([row({ counted_cash: "110.00", closed_at: "2026-10-01T16:00:00+08:00" })])];
    await aggregate(operations, key); const response = (await aggregate(operations, key)).rows[0].result;
    assert.equal(response.replayed, true); assert.equal(response.shift_closure_ack_version, 2);
    assert.equal((await db.query("SELECT count(*)::int n FROM sync_idempotency_receipts")).rows[0].n, 1);
  });
  await test("old incorrect aggregate receipt cannot bypass the postcondition", async () => {
    const key = randomUUID(); const operations = [operation([row({ row_version: 1 })])];
    await db.query("INSERT INTO sync_idempotency_receipts VALUES($1,'default','a','__aggregate__',md5($2::jsonb::text),0)", [key, JSON.stringify(operations)]);
    await assert.rejects(aggregate(operations, key), /SYNC_SHIFT_CLOSURE_CONFLICT/);
  });
  await test("table batches reject ignored closure and old bad receipts too", async () => {
    const rows = [row({ row_version: 1 })]; const key = randomUUID();
    await assert.rejects(batch(rows), /SYNC_SHIFT_CLOSURE_CONFLICT/);
    await db.query("INSERT INTO sync_idempotency_receipts VALUES($1,'default','a','shifts',md5('shifts'||$2::jsonb::text||'[]'::jsonb::text),0)", [key, JSON.stringify(rows)]);
    await assert.rejects(batch(rows, key), /SYNC_SHIFT_CLOSURE_CONFLICT/);
  });
  await test("table batch replay canonicalizes SQL-equivalent branch metadata", async () => {
    const key = randomUUID(); const rows = [row({ store_id: "A " })];
    await batch(rows, key); const response = (await batch(rows, key)).rows[0].result;
    assert.equal(response.replayed, true); assert.deepEqual(response.shift_closures, [{ id, store_id: "a", row_version: 2, requested_row_version: 2 }]);
  });
  await test("mixed aggregate rollback includes preceding successful non-shift writes", async () => {
    await assert.rejects(aggregate([{ table: "audit_logs", rows: [{ id: randomUUID(), store_id: "a" }], changes: [] },operation([row({ row_version: 1 })])]), /SYNC_SHIFT_CLOSURE_CONFLICT/);
    assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs")).rows[0].n, 0);
  });
  await test("one applied closure cannot hide another skipped closure in the same aggregate", async () => {
    const second = randomUUID();
    await db.query("INSERT INTO shifts SELECT * FROM jsonb_populate_record(NULL::shifts,$1::jsonb)", [JSON.stringify(openRow({ id: second }))]);
    await assert.rejects(aggregate([operation([row(),row({ id: second,row_version: 1 })])]), /SYNC_SHIFT_CLOSURE_CONFLICT/);
    assert.equal((await state()).status, "OPEN");
    assert.equal((await db.query("SELECT count(*)::int n FROM sync_idempotency_receipts")).rows[0].n, 0);
  });
  await test("conflicting closed metadata/state cannot be hidden behind higher cloud revision", async () => {
    await seed(row({ row_version: 5 }));
    for (const patch of [{ closed_by_staff_id: "other" },{ closed_at: "2026-10-01T08:01Z" },{ variance_total: 1 },{ state: "ACTIVE" },{ status: "OPEN" }])
      await assert.rejects(aggregate([operation([row(patch)])]), /SYNC_SHIFT_CLOSURE_CONFLICT/);
  });
  await test("normal and management-class terminals cannot forge another registered branch", async () => {
    for (const terminal of ["t-a","management"])
      await assert.rejects(aggregate([operation([row({ store_id: "b" })])], randomUUID(), "b", terminal), /SYNC_TERMINAL_SCOPE_FORBIDDEN/);
    await assert.rejects(aggregate([operation([row({ store_id: "b" })])]), /SYNC_BRANCH_FORBIDDEN/);
  });
  await test("same-id branch collision cannot reassign an existing row", async () => {
    await seed(openRow({ store_id: "b", terminal_id: "t-b" }));
    await assert.rejects(aggregate([operation([row({ row_version: 99 })])]), /SYNC_BRANCH_FORBIDDEN/);
    assert.equal((await state()).store_id, "b");
  });
  await test("unrelated and open-shift aggregates retain existing zero-applied semantics", async () => {
    const response = (await aggregate([operation([openRow()])])).rows[0].result;
    assert.equal(response.ok, true); assert.equal(response.applied, 0); assert.deepEqual(response.shift_closures, []);
  });
  await test("changed payload under an existing retry key remains forbidden", async () => {
    const key=randomUUID(); await aggregate([operation([row()])],key);
    await assert.rejects(aggregate([operation([row({ counted_cash: 999 })])],key), /SYNC_IDEMPOTENCY_MISMATCH/);
    assert.equal((await state()).counted_cash,"110");
  });
  await test("ambiguous response loss retries once without duplicate closure or journal loss", async () => {
    await seed(openRow({ row_version: 4 }));
    const pending = new Set(["closure"]); let calls = 0; const failures = [];
    const localRow = row({ row_version: 8 });
    // This older fixture isolates the parent acknowledgement contract. Supply
    // the reader's now-required complete graph, then project its synthetic
    // children out of this shift-only PostgreSQL schema. The companion native
    // graph integration script exercises the real child DDL/functions/FKs.
    const countId = randomUUID(), reconciliationId = randomUUID();
    const graph = [
      { table: "shifts", rows: [localRow] },
      { table: "shift_cash_counts", rows: [{ id: countId, store_id: "a", shift_id: id }] },
      { table: "shift_reconciliations", rows: [{ id: reconciliationId, store_id: "a", shift_id: id, count_id: countId }] },
      ...["shift_close_events", "shift_notifications", "shift_variance_alerts"].map(table => ({ table, rows: [] })),
    ];
    const shiftTable = { cloudTable: "shifts", sqlServerTable: "shifts", dependencyOrder: 0,
      columns: [{ cloudColumn: "id", sqlServerColumn: "id", primaryKey: true },{ cloudColumn: "store_id", sqlServerColumn: "store_id" }] };
    const childTables = graph.slice(1, 3).map(({ table }) => ({ cloudTable: table, sqlServerTable: table, dependencyOrder: 1 }));
    const worker = new PushWorker({ registry: { tables: [shiftTable, ...childTables] }, reader: {
      pendingAggregates: async (_branch,_limit,deferred = []) => pending.has("closure") && !deferred.includes("closure")
        ? [{ aggregateId: "closure", changes: [{ entity_type: "shifts", entity_id: JSON.stringify({ id }), key: { id }, operation: "update" }] }] : [],
      rows: async () => [localRow], acknowledgeAggregate: async key => pending.delete(key),
      closedShiftGraphs: async (branch, ids) => {
        assert.equal(branch, "a"); assert.deepEqual(ids, [id]);
        return structuredClone(graph);
      },
      failAggregate: async (_key,error) => failures.push(error.code),
    }, cloud: { terminalId: () => "t-a", pushAggregate: async value => {
      assert.deepEqual(value.operations.map(op => op.table).sort(), ["shift_cash_counts", "shift_reconciliations", "shifts"]);
      const response = (await aggregate(value.operations.filter(op => op.table === "shifts"), value.batchId)).rows[0].result;
      if (++calls === 1) throw Object.assign(new Error("Response lost after commit"),{ code: "ETIMEDOUT" });
      return response;
    } } });
    await worker.pushAggregates("a",100,true); assert(pending.has("closure")); assert.equal(failures[0], "ETIMEDOUT");
    await worker.pushAggregates("a",100,true); assert.equal(pending.size, 0); assert.equal(calls, 2);
    assert.equal((await db.query("SELECT count(*)::int n FROM sync_idempotency_receipts")).rows[0].n, 1);
    assert.equal((await state()).row_version, 5);
  });
  await test("new helper privileges remain service-only without changing original sync privileges", async () => {
    const { rows } = await db.query("SELECT has_function_privilege('authenticated','pos_sync_shift_closure_ack(jsonb,text)','EXECUTE') AS ordinary,has_function_privilege('service_role','pos_sync_shift_closure_ack(jsonb,text)','EXECUTE') AS service");
    assert.equal(rows[0].ordinary, false); assert.equal(rows[0].service, true);
  });
  await test("migration is repeatable and leaves stored rows and receipts unchanged", async () => {
    await aggregate([operation([row()])]);
    const before = await db.query("SELECT row_to_json(s) row FROM shifts s");
    const receipts = await db.query("SELECT * FROM sync_idempotency_receipts");
    await db.exec(migration);
    assert.deepEqual((await db.query("SELECT row_to_json(s) row FROM shifts s")).rows, before.rows);
    assert.deepEqual((await db.query("SELECT * FROM sync_idempotency_receipts")).rows, receipts.rows);
  });
  await test("generated contract retains the proof plus reviewed fresh/replay validation", async () => {
    for (const name of ["pos_sync_assert_shift_ownership","pos_sync_shift_closure_ack","pos_sync_aggregate_shift_closure_ack"]) {
      let expected = sourceFunction(name, name === "pos_sync_shift_closure_ack" ? migration : firstMigration);
      if (name === "pos_sync_shift_closure_ack") expected = expected.replace(
        "PERFORM public.pos_sync_assert_shift_ownership(p_rows,p_branch_id);",
        "PERFORM public.pos_sync_assert_shift_ownership(p_rows,p_branch_id);\n\n" + lifecycleValidation);
      assert.equal(sourceFunction(name, generatedContract), expected);
    }
    await db.exec(["sync_apply_shifts","pos_sync_push_batch","pos_sync_push_aggregate"]
      .map(name => sourceFunction(name,generatedContract)).join("\n"));
    await assert.rejects(aggregate([operation([row({ row_version: 1 })])]), /SYNC_SHIFT_CLOSURE_CONFLICT/);
    const key = randomUUID(); const operations = [operation([row()])];
    await aggregate(operations,key);
    const response = (await aggregate(operations,key)).rows[0].result;
    assert.equal(response.replayed,true); assert.equal(response.shift_closure_ack_version,2);
    assert.deepEqual(response.shift_closures,[{ id,store_id:"a",row_version:2,requested_row_version:2 }]);
    await db.exec(migration); // Regeneration followed by migration is safe too.
  });
  // The deployed entry points had older independent amendments and omitted
  // this context even though current generated source already includes it.
  // Model that pre-upgrade contract instead of testing only a fresh installer.
  const signatures = ["public.pos_sync_push_aggregate(uuid,text,text,text,jsonb)",
    "public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb)"];
  const definitions = async () => (await db.query("SELECT oid::regprocedure::text signature,pg_get_functiondef(oid) definition,proacl::text acl,prosecdef,proowner,proconfig FROM pg_proc WHERE oid=ANY($1::regprocedure[]) ORDER BY oid::regprocedure::text", [signatures])).rows;
  await test("context upgrade is a byte-preserving no-op on already-correct generated routines", async () => {
    const before = await definitions(); await db.exec(contextMigration);
    assert.deepEqual(await definitions(), before);
  });
  const readyDefinitions = await definitions();
  for (const routine of readyDefinitions) {
    const context = "PERFORM set_config('pos.sync_branch',p_branch_id,true);";
    assert.equal(routine.definition.split(context).length, 2);
    await db.exec(routine.definition.replace(context, ""));
  }
  await test("older validated aggregate without branch context rejects a genuinely new OPEN shift", async () => {
    const incoming = openRow({ id: randomUUID() });
    await assert.rejects(aggregate([operation([incoming])]), /SYNC_BRANCH_FORBIDDEN/);
    assert.equal((await db.query("SELECT count(*)::int n FROM shifts WHERE id=$1::uuid", [incoming.id])).rows[0].n, 0);
  });
  await test("older table recovery without branch context rejects OPEN and CLOSED uploads", async () => {
    await assert.rejects(batch([openRow({ id: randomUUID() })]), /SYNC_BRANCH_FORBIDDEN/);
    await assert.rejects(aggregate([operation([row()])]), /SYNC_BRANCH_FORBIDDEN/);
    assert.equal((await state()).status, "OPEN");
  });
  await test("older missing-context failure rolls back preceding rows and saves no receipt", async () => {
    await assert.rejects(aggregate([{ table: "audit_logs", rows: [{ id: randomUUID(), store_id: "a" }], changes: [] },operation([openRow({ id: randomUUID() })])]), /SYNC_BRANCH_FORBIDDEN/);
    assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs")).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int n FROM sync_idempotency_receipts")).rows[0].n, 0);
  });
  const beforeContextUpgrade = await definitions();
  await db.exec(contextMigration);
  await test("context upgrade changes only the validated branch assignment and retains routine metadata", async () => {
    const after = await definitions();
    for (let index = 0; index < after.length; index++) {
      assert.deepEqual({ ...after[index], definition: beforeContextUpgrade[index].definition }, beforeContextUpgrade[index]);
      assert.equal(after[index].definition,
        beforeContextUpgrade[index].definition.replace("PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);",
          "PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);\n PERFORM pg_catalog.set_config('pos.sync_branch',p_branch_id,true);"));
    }
  });
  await test("corrected aggregate stores a new OPEN shift and safely replays its exact retry", async () => {
    const incoming = openRow({ id: randomUUID() }); const key = randomUUID(); const operations = [operation([incoming])];
    assert.equal((await aggregate(operations,key)).rows[0].result.applied, 1);
    assert.equal((await aggregate(operations,key)).rows[0].result.replayed, true);
    assert.deepEqual((await db.query("SELECT status,state,store_id,terminal_id FROM shifts WHERE id=$1::uuid", [incoming.id])).rows,
      [{ status: "OPEN", state: "ACTIVE", store_id: "a", terminal_id: "t-a" }]);
  });
  await test("corrected table recovery stores a new OPEN shift without changing its branch", async () => {
    const incoming = openRow({ id: randomUUID() }); const key = randomUUID();
    assert.equal((await batch([incoming],key)).rows[0].result.applied, 1);
    assert.equal((await batch([incoming],key)).rows[0].result.replayed, true);
    assert.equal((await db.query("SELECT store_id FROM shifts WHERE id=$1::uuid", [incoming.id])).rows[0].store_id, "a");
  });
  await test("corrected entry point retains sparse-revision CLOSED proof and exact closing facts", async () => {
    await seed(openRow({ row_version: 4 }));
    const response = (await aggregate([operation([row({ row_version: 8 })])])).rows[0].result;
    assert.deepEqual(response.shift_closures, [{ id, store_id: "a", row_version: 5, requested_row_version: 8 }]);
    assert.equal(response.shift_closure_ack_version, 2); assert.equal((await state()).status, "CLOSED");
  });
  await test("corrected context does not authorize a different terminal or a foreign branch row", async () => {
    await assert.rejects(aggregate([operation([openRow({ id: randomUUID(), store_id: "b" })])]), /SYNC_BRANCH_FORBIDDEN/);
    await assert.rejects(aggregate([operation([openRow({ id: randomUUID() })])],randomUUID(),"a","t-b"), /SYNC_TERMINAL_SCOPE_FORBIDDEN/);
    await assert.rejects(batch([openRow({ id: randomUUID() })],randomUUID(),"a","t-b"), /SYNC_TERMINAL_SCOPE_FORBIDDEN/);
  });
  await test("corrected context preserves existing ownership and atomic rollback", async () => {
    await seed(openRow({ store_id: "b", terminal_id: "t-b" }));
    await assert.rejects(aggregate([{ table: "audit_logs", rows: [{ id: randomUUID(), store_id: "a" }], changes: [] },operation([row({ row_version: 99 })])]), /SYNC_BRANCH_FORBIDDEN/);
    assert.equal((await state()).store_id, "b");
    assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs")).rows[0].n, 0);
  });
  await test("corrected context preserves changed-payload replay denial and transaction-local lifetime", async () => {
    const incoming = openRow({ id: randomUUID() }); const key = randomUUID();
    await aggregate([operation([incoming])],key);
    await assert.rejects(aggregate([operation([{ ...incoming, opening_float: 999 }])],key), /SYNC_IDEMPOTENCY_MISMATCH/);
    assert.notEqual((await db.query("SELECT current_setting('pos.sync_branch',true) branch")).rows[0].branch, "a");
  });
  await test("context upgrade is repeatable and retains rows, receipts and routine privileges", async () => {
    await aggregate([operation([openRow({ id: randomUUID() })])]);
    const before = { definitions: await definitions(), rows: (await db.query("SELECT row_to_json(s) row FROM shifts s ORDER BY id")).rows,
      receipts: (await db.query("SELECT * FROM sync_idempotency_receipts ORDER BY batch_id")).rows };
    await db.exec(contextMigration);
    assert.deepEqual(await definitions(), before.definitions);
    assert.deepEqual((await db.query("SELECT row_to_json(s) row FROM shifts s ORDER BY id")).rows, before.rows);
    assert.deepEqual((await db.query("SELECT * FROM sync_idempotency_receipts ORDER BY batch_id")).rows, before.receipts);
  });
  await test("context upgrade rejects extra branch logic rather than silently accepting it", async () => {
    const correct = await definitions();
    await db.exec(correct[0].definition.replace("PERFORM pg_catalog.set_config('pos.sync_branch',p_branch_id,true);",
      "PERFORM pg_catalog.set_config('pos.sync_branch',p_branch_id,true);\n PERFORM set_config( 'pos.sync_branch', 'other', true);"));
    const before = await definitions();
    await assert.rejects(db.exec(contextMigration), /Unexpected existing branch-context logic/);
    assert.deepEqual(await definitions(), before);
    await db.exec(correct.map(routine => routine.definition).join(";\n"));
  });
  await test("unexpected second validation anchor aborts without partially upgrading the first routine", async () => {
    const correct = await definitions();
    for (const [index,routine] of correct.entries()) {
      let definition = routine.definition.replace("PERFORM pg_catalog.set_config('pos.sync_branch',p_branch_id,true);", "");
      if (index===1) definition=definition.replace("PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);",
        "PERFORM public.pos_sync_validate_scope( p_organization_id,p_branch_id,p_terminal_id);");
      await db.exec(definition);
    }
    const before = await definitions();
    await assert.rejects(db.exec(contextMigration), /Unexpected terminal-validation anchor/);
    assert.deepEqual(await definitions(), before);
    await db.exec(correct.map(routine => routine.definition).join(";\n"));
  });
  // The earlier cases retain their original revision/context contracts. These
  // additional cases can install exact captured definitions before guard review.
  if (captured) {
    for (const routine of captured.routines) await db.exec(routine.definition);
    for (const trigger of captured.triggers ?? []) {
      assert(/^[a-z_]+$/.test(trigger.name));
      await db.exec(`DROP TRIGGER IF EXISTS "${trigger.name}" ON shifts;${trigger.definition};`);
    }
  }
  await db.exec(`REVOKE ALL ON FUNCTION public.sync_apply_shifts(jsonb) FROM PUBLIC,anon,authenticated;
    GRANT EXECUTE ON FUNCTION public.sync_apply_shifts(jsonb) TO service_role;`);
  const applyDefinition = async () => (await db.query("SELECT pg_get_functiondef('public.sync_apply_shifts(jsonb)'::regprocedure) definition")).rows[0].definition;
  const proofDefinition = async () => (await db.query("SELECT pg_get_functiondef('public.pos_sync_shift_closure_ack(jsonb,text)'::regprocedure) definition")).rows[0].definition;
  const removeLifecycle = definition => definition.replace(lifecyclePredicate, "").replace(lifecycleValidation, "");
  const allRoutineMetadata = async () => (await db.query(`SELECT p.oid::regprocedure::text identity,
    pg_get_functiondef(p.oid) definition,p.proacl::text acl,p.prosecdef,p.proowner,p.proconfig
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' ORDER BY p.oid::regprocedure::text`)).rows;
  const allShiftRows = async () => (await db.query("SELECT to_jsonb(s) row FROM shifts s ORDER BY id")).rows;
  await test("baseline reproduces a delayed higher-revision OPEN reopening a saved CLOSED shift", async () => {
    await db.exec(removeLifecycle(await applyDefinition()));
    await db.exec(removeLifecycle(await proofDefinition()));
    await seed(row({ row_version: 5 }));
    assert.equal((await aggregate([operation([cleanOpen({ row_version: 99 })])])).rows[0].result.applied, 1);
    assert.equal((await state()).status, "OPEN");
  });
  await test("lifecycle migration changes only the upsert and existing shared replay validator", async () => {
    await seed(row({ row_version: 5 }));
    const before = await allRoutineMetadata(), rows = await allShiftRows();
    await db.exec(lifecycleMigration);
    const after = await allRoutineMetadata();
    assert.equal(after.length, before.length);
    for (let index = 0; index < before.length; index++) {
      if (before[index].identity === "sync_apply_shifts(jsonb)") {
        assert.deepEqual({ ...after[index], definition: before[index].definition }, before[index]);
        assert.equal(after[index].definition, before[index].definition
          .replace('WHERE EXCLUDED."row_version">public."shifts"."row_version" AND EXCLUDED."store_id"=public."shifts"."store_id"',
            'WHERE EXCLUDED."row_version">public."shifts"."row_version" AND EXCLUDED."store_id"=public."shifts"."store_id" ' + lifecyclePredicate));
      } else if (before[index].identity === "pos_sync_shift_closure_ack(jsonb,text)") {
        assert.deepEqual({ ...after[index], definition: before[index].definition }, before[index]);
        assert.equal(after[index].definition, before[index].definition.replace(
          "PERFORM public.pos_sync_assert_shift_ownership(p_rows,p_branch_id);",
          "PERFORM public.pos_sync_assert_shift_ownership(p_rows,p_branch_id);\n\n" + lifecycleValidation));
      } else assert.deepEqual(after[index], before[index]);
    }
    assert.deepEqual(await allShiftRows(), rows);
  });
  for (const version of [1, 5, 99]) await test(`a clean obsolete OPEN revision ${version} cannot replace any saved closing facts`, async () => {
    await seed(row({ row_version: 5 })); const before = await allShiftRows();
    const response = (await aggregate([operation([cleanOpen({ row_version: version })])])).rows[0].result;
    assert.equal(response.ok, true); assert.equal(response.applied, 0);
    assert.deepEqual(response.shift_closures, []); assert.deepEqual(await allShiftRows(), before);
  });
  await test("clean obsolete table uploads and lost-response replay receive a safe server acknowledgement", async () => {
    await seed(row({ row_version: 5 })); const before = await allShiftRows();
    const input = cleanOpen({ row_version: 99 }), key = randomUUID();
    const response = (await batch([input], key)).rows[0].result;
    assert.equal(response.ok, true); assert.equal(response.applied, 0);
    assert.equal((await batch([input], key)).rows[0].result.replayed, true);
    assert.deepEqual(await allShiftRows(), before);
    assert.equal((await db.query("SELECT count(*)::int n FROM sync_idempotency_receipts")).rows[0].n, 1);
  });
  for (const patch of [{ note: "A newer correction" }, { opening_float: 999 }, { terminal_id: "another" },
    { counted_cash: 0 }, { final_counted_cash: 110 }, { close_reason: "OTHER" },
    { state: "CASH_COUNT_REQUIRED" }, { overdue: true }])
    await test(`changed nonfinal facts remain pending instead of being discarded: ${JSON.stringify(patch)}`, async () => {
      await seed(row({ row_version: 5 })); const before = await allShiftRows();
      await assert.rejects(aggregate([operation([cleanOpen({ row_version: 99, ...patch })])]), /SYNC_SHIFT_CLOSURE_CONFLICT/);
      assert.deepEqual(await allShiftRows(), before);
      assert.equal((await db.query("SELECT count(*)::int n FROM sync_idempotency_receipts")).rows[0].n, 0);
    });
  await test("a conflicting nonfinal snapshot rolls back preceding mixed-aggregate writes", async () => {
    await seed(row({ row_version: 5 }));
    await assert.rejects(aggregate([{ table: "audit_logs", rows: [{ id: randomUUID(), store_id: "a" }], changes: [] },
      operation([cleanOpen({ row_version: 99, note: "Preserve this pending change" })])]), /SYNC_SHIFT_CLOSURE_CONFLICT/);
    assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs")).rows[0].n, 0);
    assert.equal((await state()).status, "CLOSED");
  });
  await test("new OPEN shifts and later normal closing/recount retain exact timestamps and proof", async () => {
    await seed(cleanOpen());
    await aggregate([operation([cleanOpen({ row_version: 2, note: "Active note" })])]);
    assert.equal((await state()).status, "OPEN");
    const final = row({ row_version: 9, note: "Active note" });
    const response = (await aggregate([operation([final])])).rows[0].result;
    assert.equal(response.shift_closure_ack_version, 2);
    assert.equal(new Date((await state()).closed_at).toISOString(), closed);
    const recount = { ...final, row_version: 20, counted_cash: 111, final_counted_cash: 111 };
    await aggregate([operation([recount])]); assert.equal(Number((await state()).counted_cash), 111);
    assert.equal(new Date((await state()).closed_at).toISOString(), closed);
  });
  await test("the lifecycle guard preserves foreign branch, terminal and ordinary-role denial", async () => {
    await seed(row({ row_version: 5 }));
    await assert.rejects(aggregate([operation([cleanOpen({ row_version: 99, store_id: "b" })])]), /SYNC_BRANCH_FORBIDDEN/);
    await assert.rejects(batch([cleanOpen({ row_version: 99 })],randomUUID(),"a","t-b"), /SYNC_TERMINAL_SCOPE_FORBIDDEN/);
    await db.exec("SET ROLE authenticated");
    try { await assert.rejects(db.query("SELECT sync_apply_shifts('[]'::jsonb)"), /permission denied for function/); }
    finally { await db.exec("RESET ROLE"); }
    assert.equal((await state()).status, "CLOSED");
  });
  await test("lifecycle upgrade is a byte-preserving no-op after application", async () => {
    await seed(row({ row_version: 5 })); await batch([cleanOpen({ row_version: 99 })]);
    const before = { routines: await allRoutineMetadata(), rows: await allShiftRows(),
      receipts: (await db.query("SELECT * FROM sync_idempotency_receipts ORDER BY batch_id")).rows };
    await db.exec(lifecycleMigration);
    assert.deepEqual(await allRoutineMetadata(), before.routines); assert.deepEqual(await allShiftRows(), before.rows);
    assert.deepEqual((await db.query("SELECT * FROM sync_idempotency_receipts ORDER BY batch_id")).rows, before.receipts);
  });
  await test("an already guarded CRLF definition is preserved byte for byte", async () => {
    const correct = [await applyDefinition(), await proofDefinition()];
    await db.exec(correct.map(definition => definition.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n")).join(";\n"));
    const before = await allRoutineMetadata(); await db.exec(lifecycleMigration);
    assert.deepEqual(await allRoutineMetadata(), before); await db.exec(correct.join(";\n"));
  });
  await test("unexpected or partial lifecycle definitions abort without touching rows or authority", async () => {
    const correct = await applyDefinition();
    for (const changed of [correct.replace('EXCLUDED."state"=\'CLOSED\'', 'EXCLUDED."state"=\'ACTIVE\''),
      removeLifecycle(correct).replace('EXCLUDED."row_version">public."shifts"."row_version"','EXCLUDED."row_version">=public."shifts"."row_version"')]) {
      await db.exec(changed); const before = await allRoutineMetadata(), rows = await allShiftRows();
      await assert.rejects(db.exec(lifecycleMigration), /Unexpected partial shift lifecycle guard|Unexpected shift sync update anchors/);
      await db.exec("ROLLBACK");
      assert.deepEqual(await allRoutineMetadata(), before); assert.deepEqual(await allShiftRows(), rows);
    }
    await db.exec(correct);
  });
  await test("an unexpected proof anchor aborts both routine upgrades atomically", async () => {
    const correct = [await applyDefinition(), await proofDefinition()];
    await db.exec(removeLifecycle(correct[0]));
    await db.exec(removeLifecycle(correct[1]).replace("PERFORM public.pos_sync_assert_shift_ownership(p_rows,p_branch_id);",
      "PERFORM public.pos_sync_assert_shift_ownership( p_rows,p_branch_id);"));
    const before = await allRoutineMetadata(), rows = await allShiftRows();
    await assert.rejects(db.exec(lifecycleMigration), /Unexpected shift sync update anchors/); await db.exec("ROLLBACK");
    assert.deepEqual(await allRoutineMetadata(), before); assert.deepEqual(await allShiftRows(), rows);
    await db.exec(correct.join(";\n"));
  });
  for (const transport of ["aggregate", "batch"]) for (const patch of [
    { note: "A genuine pending note" }, { opening_float: 20 }, { counted_cash: 0 },
  ]) await test(`legacy zero-applied ${transport} receipt cannot discard ${JSON.stringify(patch)} on replay`, async () => {
    const correct = [await applyDefinition(), await proofDefinition()];
    await db.exec(correct.map(removeLifecycle).join(";\n")); await seed(row({ row_version: 5 }));
    const input = cleanOpen({ row_version: 1, ...patch }), key = randomUUID();
    const send = (value = input, receipt = key) => transport === "aggregate" ? aggregate([operation([value])], receipt) : batch([value], receipt);
    assert.equal((await send()).rows[0].result.applied, 0);
    const before = { rows: await allShiftRows(), receipts: (await db.query("SELECT * FROM sync_idempotency_receipts ORDER BY batch_id")).rows };
    await db.exec(correct.join(";\n"));
    await assert.rejects(send(), /SYNC_SHIFT_CLOSURE_CONFLICT/);
    await assert.rejects(send(input, randomUUID()), /SYNC_SHIFT_CLOSURE_CONFLICT/);
    await assert.rejects(send({ ...input, note: "A different payload" }), /SYNC_IDEMPOTENCY_MISMATCH/);
    assert.deepEqual(await allShiftRows(), before.rows);
    assert.deepEqual((await db.query("SELECT * FROM sync_idempotency_receipts ORDER BY batch_id")).rows, before.receipts);
  });
  for (const transport of ["aggregate", "batch"]) await test(`clean legacy ${transport} receipts retain normalized ownership and unchanged empty closure proof`, async () => {
    const correct = [await applyDefinition(), await proofDefinition()];
    await db.exec(correct.map(removeLifecycle).join(";\n")); await seed(row({ row_version: 5 }));
    const input = cleanOpen({ row_version: 1, store_id: "A" }), key = randomUUID();
    const send = (branch = "a", terminal = "t-a") => transport === "aggregate"
      ? aggregate([operation([input])], key, branch, terminal) : batch([input], key, branch, terminal);
    assert.equal((await send()).rows[0].result.applied, 0);
    const before = { rows: await allShiftRows(), receipts: (await db.query("SELECT * FROM sync_idempotency_receipts ORDER BY batch_id")).rows };
    await db.exec(correct.join(";\n")); const replay = (await send()).rows[0].result;
    assert.equal(replay.replayed, true); assert.equal(replay.shift_closure_ack_version, 2); assert.deepEqual(replay.shift_closures, []);
    await assert.rejects(send("a", "t-b"), /SYNC_TERMINAL_SCOPE_FORBIDDEN/);
    await assert.rejects(send("b", "t-a"), /SYNC_TERMINAL_SCOPE_FORBIDDEN/);
    assert.deepEqual(await allShiftRows(), before.rows);
    assert.deepEqual((await db.query("SELECT * FROM sync_idempotency_receipts ORDER BY batch_id")).rows, before.receipts);
  });
  await test("legacy mixed OPEN and CLOSED replay cannot hide a pending opening correction", async () => {
    const correct = [await applyDefinition(), await proofDefinition()]; await db.exec(correct.map(removeLifecycle).join(";\n"));
    await seed(row({ row_version: 5 })); const second = row({ id: randomUUID(), row_version: 5 });
    await db.exec("SELECT set_config('pos.shift_fn','on',false)");
    await db.query("INSERT INTO shifts SELECT * FROM jsonb_populate_record(NULL::shifts,$1::jsonb)", [JSON.stringify(second)]);
    await db.exec("SELECT set_config('pos.shift_fn','',false)");
    const operations = [operation([cleanOpen({ row_version: 1, note: "Keep this correction pending" }), { ...second, row_version: 1 }])], key = randomUUID();
    assert.equal((await aggregate(operations, key)).rows[0].result.applied, 0);
    const before = { rows: await allShiftRows(), receipts: (await db.query("SELECT * FROM sync_idempotency_receipts ORDER BY batch_id")).rows };
    await db.exec(correct.join(";\n"));
    await assert.rejects(aggregate(operations, key), /SYNC_SHIFT_CLOSURE_CONFLICT/);
    assert.deepEqual(await allShiftRows(), before.rows);
    assert.deepEqual((await db.query("SELECT * FROM sync_idempotency_receipts ORDER BY batch_id")).rows, before.receipts);
  });
  await test("the shared replay validator preserves the v2 empty-input contract", async () => {
    const proof = (await db.query("SELECT pos_sync_shift_closure_ack('[]'::jsonb,'a') result")).rows[0].result;
    assert.deepEqual(proof, { shift_closure_ack_version: 2, shift_closures: [] });
  });
  await test("busy SQL responses stay transient through the real relay/client/worker and retain their payload-bound journal", async () => {
    await seed(row({ row_version: 5 })); const before = await allShiftRows();
    const relaySource = await readFile(new URL("../src/lib/sync-endpoint.server.ts", import.meta.url), "utf8");
    const relayBlock = relaySource.match(/return new Response\(await response\.text\(\), \{\s+status: response\.status,\s+headers: \{ "content-type": "application\/json" \},\s+\}\);/g);
    assert.equal(relayBlock?.length, 1, "exercise the unchanged native sync response-forwarding block");
    const forward = runInNewContext(`async function forward(response) { ${relayBlock[0]} } forward;`, { Response });
    const workerModule = { exports: {} }, delays = [];
    runInNewContext(await readFile(new URL("../electron/sync/push-worker.cjs", import.meta.url), "utf8"), {
      module: workerModule, exports: workerModule.exports, Buffer,
      require: createRequire(new URL("../electron/sync/push-worker.cjs", import.meta.url)),
      setTimeout: (callback, delay) => { delays.push(delay); queueMicrotask(callback); },
    });
    const { CloudClient } = require("../electron/sync/cloud-client.cjs");
    const cloud = new CloudClient({ configStore: { get: () => "https://fixture.invalid" },
      terminalStore: { read: () => ({ tokenId: "t-a" }) } });
    const pending = new Set(["opening"]), failures = [], packets = [], local = cleanOpen({ row_version: 99 });
    const worker = new workerModule.exports.PushWorker({ registry: { tables: [{ cloudTable: "shifts", sqlServerTable: "shifts",
      dependencyOrder: 0, columns: [{ cloudColumn: "id", sqlServerColumn: "id", primaryKey: true },
        { cloudColumn: "store_id", sqlServerColumn: "store_id" }] }] }, reader: {
      pendingAggregates: async (_branch, _limit, deferred = []) => pending.has("opening") && !deferred.includes("opening")
        ? [{ aggregateId: "opening", changes: [{ entity_type: "shifts", entity_id: JSON.stringify({ id }), key: { id }, operation: "update" }] }] : [],
      rows: async () => [local], acknowledgeAggregate: async key => pending.delete(key),
      failAggregate: async (_key, error) => failures.push({ code: error.code, status: error.status, message: error.message }),
    }, cloud });
    const originalFetch = globalThis.fetch; let busy = true;
    globalThis.fetch = async (url, request) => {
      assert.equal(url, "https://fixture.invalid/api/v1/pos/sync");
      const body = JSON.parse(request.body); assert.equal(body.terminalToken, "t-a"); packets.push(body.sqlServerAggregate);
      // PostgREST documents SQLSTATE 55* as HTTP 500. This is the real relay
      // fragment and native decoder/retry path, not a live gateway/JWT test.
      if (busy) return forward(Response.json({ code: "55P03", message: "SYNC_SHIFT_CLOSURE_BUSY", details: null, hint: null }, { status: 500 }));
      const packet = body.sqlServerAggregate;
      return forward(Response.json((await aggregate(packet.operations, packet.batchId)).rows[0].result));
    };
    try {
      assert.equal(await worker.pushAggregates("a", 100, true), 0);
      assert.equal(pending.size, 1); assert.equal(packets.length, 5); assert.deepEqual(delays, [1000, 2000, 4000, 5000]);
      assert.deepEqual(failures, [{ code: "55P03", status: 500, message: "SYNC_SHIFT_CLOSURE_BUSY" }]);
      assert.equal(new Set(packets.map(packet => packet.batchId)).size, 1);
      assert.equal((await db.query("SELECT count(*)::int n FROM sync_idempotency_receipts")).rows[0].n, 0);
      assert.deepEqual(await allShiftRows(), before);
      busy = false; assert.equal(await worker.pushAggregates("a", 100, true), 1);
      assert.equal(pending.size, 0); assert.equal(packets.length, 6);
      assert.equal(new Set(packets.map(packet => packet.batchId)).size, 1);
      assert.equal((await db.query("SELECT count(*)::int n FROM sync_idempotency_receipts")).rows[0].n, 1);
      assert.deepEqual(await allShiftRows(), before);
    } finally { globalThis.fetch = originalFetch; }
  });
  await test("fresh generator and canonical install preserve the identical guarded lifecycle", async () => {
    for (const source of [generatedSchema, schema]) {
      const generated = sourceFunction("sync_apply_shifts", source), proof = sourceFunction("pos_sync_shift_closure_ack", source);
      assert(generated.includes(lifecyclePredicate)); assert(!generated.includes(lifecycleValidation)); assert(proof.includes(lifecycleValidation));
      await db.exec(generated); await db.exec(firstMigration); await db.exec(migration); await db.exec(proof); await db.exec(lifecycleMigration);
      await seed(row({ row_version: 5 })); const before = await allShiftRows();
      assert.equal((await batch([cleanOpen({ row_version: 99 })])).rows[0].result.applied, 0);
      assert.deepEqual(await allShiftRows(), before);
      await assert.rejects(aggregate([operation([cleanOpen({ row_version: 99, note: "Do not lose this" })])]), /SYNC_SHIFT_CLOSURE_CONFLICT/);
    }
  });
  console.log(`${passed} isolated shift closure synchronization scenarios passed.`);
} finally { await db.close(); }

// Opt-in real concurrency. No database URL, credentials, existing cluster or
// machine service is accepted: these binaries create a disposable fixture only.
const postgresArgument = process.argv.indexOf("--postgres-bin");
if (postgresArgument >= 0) await runLifecycleRaces(process.argv[postgresArgument + 1]);
async function runLifecycleRaces(binaryPath) {
  assert(binaryPath, "Use --postgres-bin <portable PostgreSQL bin directory>");
  const bin = resolve(binaryPath), executable = name => join(bin, name + (process.platform === "win32" ? ".exe" : ""));
  const cache = fileURLToPath(new URL("../node_modules/.cache/", import.meta.url));
  await mkdir(cache, { recursive: true });
  const fixture = await mkdtemp(join(cache, "shift-lifecycle-race-")), data = join(fixture, "data"), log = join(fixture, "postgres.log");
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) if (/^PG/i.test(key) || key === "DATABASE_URL") delete environment[key];
  const control = args => new Promise((accept, reject) => {
    const child = spawn(executable("pg_ctl"), args, { env: environment, windowsHide: true, stdio: "ignore" });
    child.once("error", reject); child.once("exit", code => code === 0 ? accept() : reject(new Error(`Fixture pg_ctl exited ${code}; see ${log}`)));
  });
  const port = await new Promise((accept, reject) => {
    const probe = createServer(); probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => { const chosen = probe.address().port; probe.close(() => accept(chosen)); });
  });
  const children = new Set(), quote = value => "'" + String(value).replaceAll("'", "''") + "'";
  const pause = () => new Promise(accept => setTimeout(accept, 20));
  let started = false, races = 0;
  function session(name = "shift-fixture-" + randomUUID()) {
    const child = spawn(executable("psql"), ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1",
      "-p", String(port), "-U", "shift_fixture", "-d", "postgres"],
    { env: { ...environment, PGAPPNAME: name }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    children.add(child); const state = { output: "", error: "", done: false };
    child.stdout.on("data", value => { state.output += value; }); child.stderr.on("data", value => { state.error += value; });
    child.stdin.on("error", () => {});
    const finished = new Promise(accept => {
      child.once("error", error => { state.error += error.message; state.done = true; children.delete(child); accept({ code: -1, ...state }); });
      child.once("close", code => { state.done = true; children.delete(child); accept({ code, ...state }); });
    });
    child.stdin.write("\\set VERBOSITY verbose\nSET test.auth_role='service_role';\n");
    return { child, state, finished };
  }
  async function query(sql, name) {
    const current = session(name); current.child.stdin.end(sql + "\n"); const result = await current.finished;
    if (result.code !== 0) throw new Error(result.error || `Fixture psql exited ${result.code}`);
    return result.output.trim();
  }
  async function holder(sql) {
    const current = session(); current.child.stdin.write("BEGIN;\n" + sql + "\nSELECT 'FIXTURE_READY';\n");
    const deadline = Date.now() + 5000;
    while (!current.state.output.includes("FIXTURE_READY")) {
      if (current.state.done || Date.now() > deadline) throw new Error("Holder did not become ready: " + current.state.error);
      await pause();
    }
    const finish = async action => { const result = await finish.raw(action + ";"); assert.equal(result.code, 0, result.error); };
    finish.raw = async sql => { current.child.stdin.end(sql + "\n\\q\n"); return current.finished; };
    return finish;
  }
  async function blocked(name) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(name)} AND cardinality(pg_blocking_pids(pid))>0);`) === "t") return;
      await pause();
    }
    throw new Error("Expected independent PostgreSQL session to block behind the competing transaction");
  }
  const insert = value => `SET pos.shift_fn='on';INSERT INTO shifts SELECT * FROM jsonb_populate_record(NULL::shifts,${quote(JSON.stringify(value))}::jsonb);SET pos.shift_fn='';`;
  const aggregateSql = (operations, batchId = randomUUID()) => `SELECT pos_sync_push_aggregate(${quote(batchId)}::uuid,'default','a','t-a',${quote(JSON.stringify(operations))}::jsonb);`;
  const snapshot = async () => JSON.parse(await query(`SELECT to_jsonb(s) FROM shifts s WHERE id=${quote(id)}::uuid;`));
  const receiptSnapshot = async key => JSON.parse(await query(`SELECT to_jsonb(r) FROM sync_idempotency_receipts r WHERE batch_id=${quote(key)}::uuid;`));
  async function legacyReceipt(input) {
    const guarded = JSON.parse(await query(`SELECT jsonb_build_object(
      'apply',pg_get_functiondef('public.sync_apply_shifts(jsonb)'::regprocedure),
      'proof',pg_get_functiondef('public.pos_sync_shift_closure_ack(jsonb,text)'::regprocedure));`));
    const strip = definition => definition.replace(lifecyclePredicate, "").replace(lifecycleValidation, "");
    await query(strip(guarded.apply) + ";\n" + strip(guarded.proof));
    const key = randomUUID(), result = JSON.parse(await query(aggregateSql([operation(Array.isArray(input) ? input : [input])], key)));
    assert.equal(result.applied, 0); await query(guarded.apply + ";\n" + guarded.proof);
    return { key, saved: await receiptSnapshot(key) };
  }
  const seedRace = async () => query("TRUNCATE shifts,sync_idempotency_receipts,audit_logs,sync_change_feed,held_orders;" + insert(cleanOpen()));
  async function race(name, work) { await seedRace(); await work(); races++; console.log("PASS real two-session " + name); }
  async function waitForHolder(command, finish, action = "COMMIT") {
    const name = "shift-wait-" + randomUUID(), pending = query(command, name);
    const outcome = pending.then(value => ({ value }), error => ({ error }));
    await blocked(name); await finish(action); return outcome;
  }
  try {
    await promisify(execFile)(executable("initdb"), ["-D", data, "--auth=trust", "--username=shift_fixture", "--no-locale", "--encoding=UTF8"],
      { env: environment, windowsHide: true });
    await control(["-D", data, "-l", log, "-o", `-h 127.0.0.1 -p ${port} -F -c max_connections=10 -c shared_buffers=16MB`, "-w", "start"]); started = true;
    await query(fixtureSql + firstMigration + migration + contextMigration);
    if (captured) {
      await query(captured.routines.map(routine => routine.definition + ";").join("\n"));
      for (const trigger of captured.triggers ?? []) {
        assert(/^[a-z_]+$/.test(trigger.name)); await query(`DROP TRIGGER IF EXISTS "${trigger.name}" ON shifts;${trigger.definition};`);
      }
    }
    await query(lifecycleMigration);
    await race("closing commit wins over a blocked delayed clean opening", async () => {
      const finish = await holder(aggregateSql([operation([row({ row_version: 9 })])]));
      const result = await waitForHolder(aggregateSql([operation([cleanOpen({ row_version: 99 })])]), finish);
      assert.equal(result.error, undefined); assert.equal(JSON.parse(result.value).applied, 0);
      const saved = await snapshot(); assert.equal(saved.status, "CLOSED"); assert.equal(new Date(saved.closed_at).toISOString(), closed);
    });
    await race("a genuine closing still wins after an earlier opening commits", async () => {
      const finish = await holder(aggregateSql([operation([cleanOpen({ row_version: 2 })])]));
      const result = await waitForHolder(aggregateSql([operation([row({ row_version: 9 })])]), finish);
      assert.equal(result.error, undefined); assert.equal(JSON.parse(result.value).shift_closure_ack_version, 2);
      assert.equal((await snapshot()).status, "CLOSED");
    });
    await race("rolled-back closing does not invent a saved closure", async () => {
      const finish = await holder(aggregateSql([operation([row({ row_version: 9 })])]));
      const result = await waitForHolder(aggregateSql([operation([cleanOpen({ row_version: 99 })])]), finish, "ROLLBACK");
      assert.equal(result.error, undefined); assert.equal(JSON.parse(result.value).applied, 1);
      assert.equal((await snapshot()).status, "OPEN");
    });
    await race("changed opening metadata conflicts after a concurrent closing", async () => {
      const finish = await holder(aggregateSql([operation([row({ row_version: 9 })])]));
      const result = await waitForHolder(aggregateSql([operation([cleanOpen({ row_version: 99, note: "Pending genuine change" })])]), finish);
      assert.match(result.error?.message ?? "Unexpected success", /SYNC_SHIFT_CLOSURE_CONFLICT/);
      const saved = await snapshot(); assert.equal(saved.status, "CLOSED"); assert.equal(saved.note, "");
      assert.equal(await query("SELECT count(*) FROM sync_idempotency_receipts;"), "1");
    });
    await race("a raced foreign owner still receives branch denial and no receipt", async () => {
      await query("TRUNCATE shifts,sync_idempotency_receipts,sync_change_feed;");
      const finish = await holder(insert(row({ store_id: "b", terminal_id: "t-b", row_version: 5 })));
      const result = await waitForHolder(aggregateSql([operation([cleanOpen({ row_version: 99 })])]), finish);
      assert.match(result.error?.message ?? "Unexpected success", /SYNC_BRANCH_FORBIDDEN/);
      assert.equal((await snapshot()).store_id, "b"); assert.equal(await query("SELECT count(*) FROM sync_idempotency_receipts;"), "0");
    });
    await race("a late conflicting open rolls back earlier mixed writes and its receipt", async () => {
      const finish = await holder(aggregateSql([operation([row({ row_version: 9 })])]));
      const result = await waitForHolder(aggregateSql([{ table: "audit_logs", rows: [{ id: randomUUID(), store_id: "a" }], changes: [] },
        operation([cleanOpen({ row_version: 99, note: "Keep pending" })])]), finish);
      assert.match(result.error?.message ?? "Unexpected success", /SYNC_SHIFT_CLOSURE_CONFLICT/);
      assert.equal(await query("SELECT count(*) FROM audit_logs;"), "0"); assert.equal(await query("SELECT count(*) FROM sync_idempotency_receipts;"), "1");
    });
    await race("old changed-note receipt is busy before commit, then conflicts without deleting its receipt", async () => {
      await query("TRUNCATE shifts,sync_idempotency_receipts,sync_change_feed;" + insert(cleanOpen({ row_version: 5 })));
      const input = cleanOpen({ row_version: 1, note: "A genuine pending note" }), receipt = await legacyReceipt(input);
      const finish = await holder(aggregateSql([operation([row({ row_version: 9 })])]));
      await assert.rejects(query(aggregateSql([operation([input])], receipt.key)), /55P03:.*SYNC_SHIFT_CLOSURE_BUSY/);
      await finish("COMMIT");
      await assert.rejects(query(aggregateSql([operation([input])], receipt.key)), /SYNC_SHIFT_CLOSURE_CONFLICT/);
      assert.equal((await snapshot()).status, "CLOSED"); assert.equal((await snapshot()).note, "");
      assert.deepEqual(await receiptSnapshot(receipt.key), receipt.saved);
    });
    await race("old clean receipt is busy before commit and succeeds only after a stable closing", async () => {
      await query("TRUNCATE shifts,sync_idempotency_receipts,sync_change_feed;" + insert(cleanOpen({ row_version: 5 })));
      const input = cleanOpen({ row_version: 1 }), receipt = await legacyReceipt(input);
      const finish = await holder(aggregateSql([operation([row({ row_version: 9 })])]));
      await assert.rejects(query(aggregateSql([operation([input])], receipt.key)), /55P03:.*SYNC_SHIFT_CLOSURE_BUSY/);
      await finish("COMMIT"); const response = JSON.parse(await query(aggregateSql([operation([input])], receipt.key)));
      assert.equal(response.replayed, true); assert.deepEqual(response.shift_closures, []);
      assert.equal((await snapshot()).status, "CLOSED"); assert.deepEqual(await receiptSnapshot(receipt.key), receipt.saved);
    });
    await race("busy receipt retains the pre-existing OPEN replay contract after closing rollback", async () => {
      await query("TRUNCATE shifts,sync_idempotency_receipts,sync_change_feed;" + insert(cleanOpen({ row_version: 5 })));
      const input = cleanOpen({ row_version: 1, note: "Pre-existing ignored OPEN metadata" }), receipt = await legacyReceipt(input);
      const finish = await holder(aggregateSql([operation([row({ row_version: 9 })])]));
      await assert.rejects(query(aggregateSql([operation([input])], receipt.key)), /55P03:.*SYNC_SHIFT_CLOSURE_BUSY/);
      await finish("ROLLBACK"); assert.equal(JSON.parse(await query(aggregateSql([operation([input])], receipt.key))).replayed, true);
      assert.equal((await snapshot()).status, "OPEN"); assert.deepEqual(await receiptSnapshot(receipt.key), receipt.saved);
    });
    const secondId = "33333333-3333-4333-8333-333333333333";
    const parents = [id, secondId];
    const seedClosedParents = async () => query("TRUNCATE shifts,sync_idempotency_receipts,sync_change_feed;" +
      parents.map(parent => insert(row({ id: parent, row_version: 5 }))).join("\n"));
    await race("a waiting replay can deadlock with the existing opposite-order closing writer (isolated characterization)", async () => {
      await seedClosedParents(); const inputs = parents.map(parent => cleanOpen({ id: parent, row_version: 1 }));
      const receipt = await legacyReceipt(inputs);
      const finalProof = await query("SELECT pg_get_functiondef('public.pos_sync_shift_closure_ack(jsonb,text)'::regprocedure);");
      assert(finalProof.includes("FOR SHARE OF locked_row NOWAIT"));
      await query(finalProof.replace("FOR SHARE OF locked_row NOWAIT", "FOR SHARE OF locked_row"));
      try {
        // Split the existing B->A writer statements inside one transaction to
        // expose its real row-lock boundary; no production writer is changed.
        const finish = await holder(aggregateSql([operation([row({ id: secondId, row_version: 9 })])]));
        const replayName = "shift-replay-" + randomUUID();
        const replay = query(aggregateSql([operation(inputs)], receipt.key), replayName)
          .then(value => ({ value }), error => ({ error }));
        await blocked(replayName);
        const writer = finish.raw(aggregateSql([operation([row({ row_version: 9 })])]) + "COMMIT;");
        const [replayed, written] = await Promise.all([replay, writer]);
        assert.match([replayed.error?.message ?? "", written.error].join("\n"), /40P01:.*deadlock detected/);
        assert(written.code === 0 || replayed.error === undefined, "one transaction should recover after its peer rolls back");
        assert.equal(await query("SELECT bool_and(status='CLOSED') FROM shifts;"), "t");
        assert.deepEqual(await receiptSnapshot(receipt.key), receipt.saved);
      } finally { await query(finalProof); }
    });
    for (const writerOrder of [parents, [...parents].reverse()]) for (const inputOrder of [parents, [...parents].reverse()])
      await race(`NOWAIT releases partial replay locks for writer ${writerOrder.join("/")} and input ${inputOrder.join("/")}`, async () => {
        await seedClosedParents(); const inputs = inputOrder.map(parent => cleanOpen({ id: parent, row_version: 1 }));
        const receipt = await legacyReceipt(inputs);
        const finish = await holder(aggregateSql([operation([row({ id: writerOrder[0], row_version: 9 })])]));
        const startedAt = Date.now();
        await assert.rejects(query(aggregateSql([operation(inputs)], receipt.key)), /55P03:.*SYNC_SHIFT_CLOSURE_BUSY/);
        assert(Date.now() - startedAt < 3000, "busy replay must not wait for the competing writer");
        assert.deepEqual(await receiptSnapshot(receipt.key), receipt.saved);
        const written = await finish.raw(aggregateSql([operation([row({ id: writerOrder[1], row_version: 9 })])]) + "COMMIT;");
        assert.equal(written.code, 0, written.error); // proves earlier A SHARE lock was released after busy B.
        const result = JSON.parse(await query(aggregateSql([operation(inputs)], receipt.key)));
        assert.equal(result.replayed, true); assert.deepEqual(result.shift_closures, []);
        assert.equal(await query("SELECT bool_and(status='CLOSED' AND row_version>5) FROM shifts;"), "t");
        assert.deepEqual(await receiptSnapshot(receipt.key), receipt.saved);
      });
    await race("busy replay rolls back preceding writes and preserves the original receipt", async () => {
      await query("TRUNCATE shifts,sync_idempotency_receipts,sync_change_feed;" + insert(row({ row_version: 5 })));
      const input = cleanOpen({ row_version: 1 }), receipt = await legacyReceipt(input);
      const finish = await holder(aggregateSql([operation([row({ row_version: 9 })])]));
      await assert.rejects(query("BEGIN;SELECT sync_apply_audit_logs(" + quote(JSON.stringify([{ id: randomUUID(), store_id: "a" }])) +
        "::jsonb);" + aggregateSql([operation([input])], receipt.key) + "COMMIT;"), /55P03:.*SYNC_SHIFT_CLOSURE_BUSY/);
      assert.equal(await query("SELECT count(*) FROM audit_logs;"), "0");
      assert.deepEqual(await receiptSnapshot(receipt.key), receipt.saved); await finish("COMMIT");
      assert.equal(JSON.parse(await query(aggregateSql([operation([input])], receipt.key))).replayed, true);
    });
    await race("foreign ownership denial precedes busy replay validation", async () => {
      await query("TRUNCATE shifts,sync_idempotency_receipts,sync_change_feed;" + insert(row({ row_version: 5 })) +
        insert(row({ id: secondId, store_id: "b", terminal_id: "t-b", row_version: 5 })));
      const finish = await holder(aggregateSql([operation([row({ row_version: 9 })])]));
      for (const inputs of [[cleanOpen(), cleanOpen({ id: secondId })], [cleanOpen({ id: secondId }), cleanOpen()]])
        await assert.rejects(query(aggregateSql([operation(inputs)])), /SYNC_BRANCH_FORBIDDEN/);
      assert.equal(await query("SELECT count(*) FROM sync_idempotency_receipts;"), "0"); await finish("ROLLBACK");
      assert.equal(await query("SELECT store_id FROM shifts WHERE id=" + quote(secondId) + "::uuid;"), "b");
    });
    console.log(`${races} real two-session PostgreSQL lifecycle races passed; no existing database used.`);
  } finally {
    for (const child of children) { child.stdin.destroy(); child.kill(); }
    if (started) await control(["-D", data, "-m", "immediate", "-w", "stop"]);
    const actualFixture = await realpath(fixture), actualCache = await realpath(cache);
    assert.equal(dirname(actualFixture), actualCache); assert(basename(actualFixture).startsWith("shift-lifecycle-race-"));
    await rm(actualFixture, { recursive: true, force: true });
  }
}
