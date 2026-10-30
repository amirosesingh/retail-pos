// Executes only in disposable in-memory PostgreSQL. No network/database profile.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { PushWorker } = require("../electron/sync/push-worker.cjs");
const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261030153259_confirm_shift_closure_sync_acknowledgement.sql", import.meta.url), "utf8");
const sourceFunction = (name, source = schema) => {
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
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.auth_role',true) $$;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${operator}'::uuid $$;
  CREATE TABLE app_users(id text,auth_user_id uuid,role text,permissions jsonb,is_active boolean,store_id text);
  CREATE TABLE terminal_tokens(id text PRIMARY KEY,location_id text,status text,revoked_at timestamptz);
  CREATE TABLE audit_logs(id uuid PRIMARY KEY,store_id text);
  CREATE TABLE sync_idempotency_receipts(batch_id uuid PRIMARY KEY,organization_id text,branch_id text,
    table_name text,payload_hash text,applied_count int);
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
  INSERT INTO terminal_tokens VALUES('t-a','a','active',NULL),('t-b','b','active',NULL),('management',NULL,'active',NULL);
  SELECT set_config('test.auth_role','service_role',false);`);

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
const operation = rows => ({ table: "shifts", rows, changes: [] });
const aggregate = (operations, batchId = randomUUID(), branch = "a", terminal = "t-a") =>
  db.query("SELECT pos_sync_push_aggregate($1::uuid,'default',$2,$3,$4::jsonb) result", [batchId, branch, terminal, JSON.stringify(operations)]);
const batch = (rows, batchId = randomUUID(), branch = "a", terminal = "t-a") =>
  db.query("SELECT pos_sync_push_batch($1::uuid,'default',$2,$3,'shifts',$4::jsonb,'[]'::jsonb) result", [batchId, branch, terminal, JSON.stringify(rows)]);
const state = async () => (await db.query("SELECT status,state,row_version,store_id,counted_cash,closed_at FROM shifts WHERE id=$1::uuid", [id])).rows[0];
async function seed(value = openRow()) {
  await db.exec("TRUNCATE shifts,sync_idempotency_receipts,audit_logs; SELECT set_config('test.auth_role','service_role',false);");
  await db.query("INSERT INTO shifts SELECT * FROM jsonb_populate_record(NULL::shifts,$1::jsonb)", [JSON.stringify(value)]);
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
  await db.exec(migration);
  await test("equal-version ignored closure fails atomically and cannot save a receipt", async () => {
    await assert.rejects(aggregate([operation([row({ row_version: 1 })])]), /SYNC_SHIFT_CLOSURE_CONFLICT/);
    assert.equal((await state()).status, "OPEN");
    assert.equal((await db.query("SELECT count(*)::int n FROM sync_idempotency_receipts")).rows[0].n, 0);
  });
  await test("newer closure persists and returns exact same-branch proof", async () => {
    const response = (await aggregate([operation([row()])])).rows[0].result;
    assert.equal(response.shift_closure_ack_version, 1);
    assert.deepEqual(response.shift_closures, [{ id, store_id: "a", row_version: 2 }]);
    assert.equal((await state()).status, "CLOSED");
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
    assert.equal(response.replayed, true); assert.equal(response.shift_closure_ack_version, 1);
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
    assert.equal(response.replayed, true); assert.deepEqual(response.shift_closures, [{ id, store_id: "a", row_version: 2 }]);
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
    const pending = new Set(["closure"]); let calls = 0; const failures = [];
    const localRow = row();
    const shiftTable = { cloudTable: "shifts", sqlServerTable: "shifts", dependencyOrder: 0,
      columns: [{ cloudColumn: "id", sqlServerColumn: "id", primaryKey: true },{ cloudColumn: "store_id", sqlServerColumn: "store_id" }] };
    const worker = new PushWorker({ registry: { tables: [shiftTable] }, reader: {
      pendingAggregates: async (_branch,_limit,deferred = []) => pending.has("closure") && !deferred.includes("closure")
        ? [{ aggregateId: "closure", changes: [{ entity_type: "shifts", entity_id: JSON.stringify({ id }), key: { id }, operation: "update" }] }] : [],
      rows: async () => [localRow], acknowledgeAggregate: async key => pending.delete(key),
      failAggregate: async (_key,error) => failures.push(error.code),
    }, cloud: { terminalId: () => "t-a", pushAggregate: async value => {
      const response = (await aggregate(value.operations, value.batchId)).rows[0].result;
      if (++calls === 1) throw Object.assign(new Error("Response lost after commit"),{ code: "ETIMEDOUT" });
      return response;
    } } });
    await worker.pushAggregates("a",100,true); assert(pending.has("closure")); assert.equal(failures[0], "ETIMEDOUT");
    await worker.pushAggregates("a",100,true); assert.equal(pending.size, 0); assert.equal(calls, 2);
    assert.equal((await db.query("SELECT count(*)::int n FROM sync_idempotency_receipts")).rows[0].n, 1);
    assert.equal((await state()).row_version, 2);
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
  await test("generated contract retains the same helpers and atomic closure/replay behavior", async () => {
    for (const name of ["pos_sync_assert_shift_ownership","pos_sync_shift_closure_ack","pos_sync_aggregate_shift_closure_ack"])
      assert.equal(sourceFunction(name, generatedContract), sourceFunction(name, migration));
    await db.exec(["sync_apply_shifts","pos_sync_push_batch","pos_sync_push_aggregate"]
      .map(name => sourceFunction(name,generatedContract)).join("\n"));
    await assert.rejects(aggregate([operation([row({ row_version: 1 })])]), /SYNC_SHIFT_CLOSURE_CONFLICT/);
    const key = randomUUID(); const operations = [operation([row()])];
    await aggregate(operations,key);
    const response = (await aggregate(operations,key)).rows[0].result;
    assert.equal(response.replayed,true); assert.equal(response.shift_closure_ack_version,1);
    assert.deepEqual(response.shift_closures,[{ id,store_id:"a",row_version:2 }]);
    await db.exec(migration); // Regeneration followed by migration is safe too.
  });
  console.log(`${passed} isolated shift closure synchronization scenarios passed.`);
} finally { await db.close(); }
