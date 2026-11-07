// Synthetic owned database only. Does not use operator credentials or profiles.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
const require = createRequire(import.meta.url);
const { MIGRATION, SIGNATURE } = require("./prepare-held-status.cjs");
const read = file => readFile(new URL("../" + file, import.meta.url), "utf8");
const metadata = JSON.parse(await read("src/lib/__tests__/fixtures/held-status-live-metadata.json"));
const history = JSON.parse(await read("src/lib/__tests__/fixtures/history-scope-live-metadata.json"));
const migration = await read("supabase/migrations/" + MIGRATION);
const native = process.argv.includes("--native");
assert(process.argv.slice(2).every(value => ["--native", "--postgrest"].includes(value)));
const source = native ? (await read("scripts/test-seven-shift-summary-native.fixture.mjs")).replaceAll("\r\n", "\n") : null;
if (native) assert.equal(source.split("return {\n   exec:").length, 2);
const fixture = native ? await import("data:text/javascript;base64," + Buffer.from(source.replace("return {\n   exec:", "return {historyRest:{port,directory},\n   exec:") + "\nexport {createNativeFixture};").toString("base64")) : null;
const db = native ? await fixture.createNativeFixture() : new PGlite();
const A = "aaaaaaaa-aaaa-4aaa-8aaa-00000000000a", B = "bbbbbbbb-bbbb-4bbb-8bbb-00000000000b";
const OPS = "cccccccc-cccc-4ccc-8ccc-000000000001", MAN = "cccccccc-cccc-4ccc-8ccc-000000000002";
const SHIFT = "bbbbbbbb-bbbb-4bbb-8bbb-000000000003", OTHER_SHIFT = "bbbbbbbb-bbbb-4bbb-8bbb-000000000004";
const id = n => "dddddddd-dddd-4ddd-8ddd-" + String(n).padStart(12, "0");
const quote = value => value === null ? "NULL" : "'" + String(value).replaceAll("'", "''") + "'";
const literal = value => "E" + quote(value.replaceAll("\\", "\\\\").replaceAll("\r", "\\r").replaceAll("\n", "\\n"));
const scalar = async (query, args = []) => (await db.query(query, args)).rows[0]?.value;
const call = (tickets, branch = A, terminal = OPS, max = 2097152) => scalar("SELECT public.pos_sync_held_status_v1('default',$1,$2,$3::jsonb,false,$4::integer) value", [branch, terminal, JSON.stringify(tickets), max]);
const ticket = (value, billNo = null, shiftId = null) => ({ id: value, billNo, shiftId });
const state = () => scalar("SELECT jsonb_build_object('held',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id)::text FROM held_orders h),'sales',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id)::text FROM sales s),'bookings',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id)::text FROM bookings b),'triggers',(SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY oid) FROM pg_trigger WHERE tgrelid IN('public.held_orders'::regclass,'public.sales'::regclass,'public.bookings'::regclass) AND NOT tgisinternal)) value");
let passed = 0;
const check = async (name, work) => { await work(); passed++; console.log("PASS " + name); };
const defaults = type => type === "uuid" ? "gen_random_uuid()" : /jsonb/.test(type) ? "'null'::jsonb" : type === "boolean" ? "false" : /numeric|integer|bigint|smallint/.test(type) ? "0" : /timestamp/.test(type) ? "now()" : type === "date" ? "CURRENT_DATE" : "''";
try {
  await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'role','service_role')$$;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULL::uuid$$;CREATE TABLE public.app_users(id text,auth_user_id uuid,is_active boolean,role text,permissions jsonb,store_id text);CREATE TABLE public.stores(id text);CREATE TABLE public.terminal_tokens(id uuid,platform text,location_id text,status text,is_claimed boolean,management_sync_enabled boolean,revoked_at timestamptz);");
  for (const table of ["held_orders", "sales", "bookings"]) {
    const columns = metadata.columns.filter(column => column.table_name === table);
    await db.exec('CREATE TABLE public."' + table + '"(' + columns.map(column => '"' + column.column_name + '" ' + column.type + (column.not_null ? " NOT NULL" : "") + " DEFAULT " + defaults(column.type) + (column.column_name === "id" ? " PRIMARY KEY" : "")).join(",") + ");ALTER TABLE public." + table + " ENABLE ROW LEVEL SECURITY;");
  }
  await db.exec("CREATE INDEX fixture_sales_bill ON public.sales(bill_number);");
  for (const entry of history.functions.filter(item => ["pos_sync_validate_scope(text,text,text)", "pos_sync_history_project_v1(jsonb,text,boolean)"].includes(item.signature))) {
    const found = entry.definition.match(/AS (\$\w*\$)([\s\S]*?)\1/); assert(found);
    await db.exec(entry.definition.replace(found[0], () => "AS " + literal(found[2])));
    await db.exec("REVOKE ALL ON FUNCTION public." + entry.signature + " FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public." + entry.signature + " TO service_role;");
  }
  await db.exec("GRANT USAGE ON SCHEMA public,auth TO service_role;GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;INSERT INTO stores(id) VALUES(" + quote(A) + "),(" + quote(B) + ");INSERT INTO terminal_tokens(id,platform,location_id,status,is_claimed,management_sync_enabled) VALUES(" + quote(OPS) + ",'pc'," + quote(A) + ",'used',true,false),(" + quote(MAN) + ",'pc',NULL,'used',true,true);");
  const line = '[{"productId":"product-1","price":19.123456789012,"qty":1,"taxRate":0,"name":"PRIVATE NAME","cost":77,"priceOverrideReason":"PRIVATE REASON","unknown":{"private":"PRIVATE"}},{"productId":"product-2","qty":2,"discount":null}]';
  await db.exec("INSERT INTO held_orders(id,store_id,shift_id,bill_no,status,row_version,updated_at,total,lines,coupon,note) VALUES('held-A'," + quote(A) + "," + quote(SHIFT) + ",'BILL-A','completed',2147483647,'2026-11-07T01:02:03.123456Z',9007199254740993.11," + quote(line) + "::jsonb,'{\"code\":\"C1\",\"discount\":1.25,\"name\":\"PRIVATE COUPON\",\"private\":{\"name\":\"PRIVATE\"}}','PRIVATE NOTE'),('cancel-A'," + quote(A) + "," + quote(SHIFT) + ",'CANCEL-A','cancelled',2,now(),1,'[]','null',''),('active-A'," + quote(A) + "," + quote(SHIFT) + ",'ACTIVE-A','held',3,now(),1,'[]','null',''),('foreign-B'," + quote(B) + "," + quote(SHIFT) + ",'BILL-B','cancelled',4,now(),1,'[]','null',''),('booking-A'," + quote(A) + "," + quote(SHIFT) + ",'BOOK-BILL','completed',5,now(),1,'[]','null'," + quote("booking:" + id(3)) + "),('bad-line'," + quote(A) + "," + quote(SHIFT) + ",'BAD','cancelled',6,now(),1,'[{\"productId\":{\"private\":\"PRIVATE\"}}]','null',''),('bad-coupon'," + quote(A) + "," + quote(SHIFT) + ",'BAD2','cancelled',7,now(),1,'[]','{\"code\":{\"private\":\"PRIVATE\"}}','');");
  await db.exec("INSERT INTO sales(id,store_id,shift_id,bill_number) VALUES(" + quote(id(1)) + "," + quote(A) + "," + quote(OTHER_SHIFT) + ",'BILL-A'),(" + quote(id(2)) + "," + quote(A) + "," + quote(SHIFT) + ",'MISSING-A'),(" + quote(id(4)) + "," + quote(B) + "," + quote(SHIFT) + ",'BILL-B');INSERT INTO bookings(id,store_id,shift_id,note) VALUES(" + quote(id(3)) + "," + quote(A) + "," + quote(SHIFT) + ",'PRIVATE BOOKING');");
  const before = await state();
  await check("one read-only migration adds the RPC without changing any held ticket, sale, booking or trigger", async () => { assert(!/^\s*(BEGIN|COMMIT)\s*;/mi.test(migration)); await db.exec(migration); assert.deepEqual(await state(), before); });
  await check("held proof preserves exact decimal identity while removing names, costs, notes and unknown fields", async () => {
    const result = await call([ticket("held-A", "BILL-A", SHIFT)]), record = result.records[0];
    assert.equal(result.heldStatusVersion, 1); assert.equal(record.proofFrom, "held"); assert.equal(record.rowVersion, "2147483647"); assert.equal(record.updatedAt, "2026-11-07T01:02:03.1234560Z");
    assert.match(record.identityJson, /9007199254740993\.11/); assert.match(record.identityJson, /19\.123456789012/); assert(!record.identityJson.includes("PRIVATE")); assert(!record.identityJson.includes("cost")); assert(!record.identityJson.includes("name"));
    const identity = JSON.parse(record.identityJson); assert.equal(identity.lines.length, 2); assert.equal(identity.lines[1].discount, null); assert(!Object.hasOwn(identity.lines[0], "discount"));
    assert.equal(record.parent.kind, "sale"); assert.equal(record.parent.id, id(1)); assert.equal(record.parent.shiftId, OTHER_SHIFT);
  });
  await check("cancelled proof requires an existing unchanged-identity candidate and has no parent", async () => { const record = (await call([ticket("cancel-A")])).records[0]; assert.equal(record.status, "cancelled"); assert.equal(record.proofFrom, "held"); assert.equal(record.parent, null); assert.equal((await call([ticket("unknown")])).records.length, 0); });
  await check("active, other-branch and invalid/nested private identities supply no adoption proof", async () => { assert.equal((await call([ticket("active-A", "ACTIVE-A", SHIFT), ticket("foreign-B"), ticket("bad-line"), ticket("bad-coupon")])).records.length, 0); });
  await check("a missing cloud hold returns only a distinct accepted-parent proof and never fabricated held metadata", async () => { const record = (await call([ticket("missing-local", "MISSING-A", SHIFT)])).records[0]; assert.equal(record.status, "completed"); assert.equal(record.proofFrom, "accepted_parent"); assert.equal(record.parent.id, id(2)); assert.equal(record.identityJson, null); assert.equal(record.rowVersion, null); assert.equal(record.updatedAt, null); });
  await check("missing holds with absent, foreign, wrong-shift or ambiguous parents remain unresolved", async () => {
    assert.equal((await call([ticket("none"), ticket("foreign-sale", "BILL-B", SHIFT), ticket("wrong-shift", "MISSING-A", OTHER_SHIFT)])).records.length, 0);
    await db.exec("INSERT INTO sales(id,store_id,shift_id,bill_number) VALUES(" + quote(id(5)) + "," + quote(A) + "," + quote(SHIFT) + ",'MISSING-A');");
    assert.equal((await call([ticket("ambiguous", "MISSING-A", SHIFT)])).records.length, 0);
  });
  await check("booking parent uses its saved note/store/shift relation and supplies no invented bill number", async () => { const record = (await call([ticket("booking-A", "BOOK-BILL", SHIFT)])).records[0]; assert.equal(record.parent.kind, "booking"); assert.equal(record.parent.id, id(3)); assert.equal(record.parent.billNo, null); });
  await check("Operations cannot select another branch and Management cannot use this maintenance read", async () => { await assert.rejects(call([ticket("held-A")], B), /SYNC_TERMINAL_SCOPE_FORBIDDEN/); await assert.rejects(call([ticket("held-A")], A, MAN), /SYNC_TERMINAL_SCOPE_FORBIDDEN/); });
  await check("bad/duplicate/unbounded ticket requests fail without reading arbitrary fields", async () => {
    for (const tickets of [[], [ticket("held-A"), ticket("held-A")], [{ ...ticket("held-A"), private: true }], [ticket("x".repeat(451))], [ticket("x", {})], Array.from({ length: 101 }, (_, n) => ticket("x" + n))]) await assert.rejects(call(tickets), /HELD_STATUS_(INVALID|DUPLICATE)/);
  });
  await check("response limits fail closed without truncating or changing retained work", async () => { await db.exec("UPDATE held_orders SET lines='[{\"productId\":\"" + "x".repeat(2000) + "\"}]'::jsonb WHERE id='cancel-A';"); await assert.rejects(call([ticket("cancel-A")], A, OPS, 1024), /HELD_STATUS_TOO_LARGE/); });
  await check("authenticated and anonymous roles have no RPC execution grant", async () => { for (const role of ["anon", "authenticated"]) { await db.exec("SET ROLE " + role); try { await assert.rejects(call([ticket("held-A")]), /permission denied/); } finally { await db.exec("RESET ROLE"); } } });
  await check("exact and CRLF migration replay preserve records and the existing RPC identity", async () => { const stateBefore = await state(), oid = await scalar("SELECT 'public." + SIGNATURE + "'::regprocedure::oid value"); await db.exec(migration); await db.exec(migration.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n")); assert.equal(await scalar("SELECT 'public." + SIGNATURE + "'::regprocedure::oid value"), oid); assert.deepEqual(await state(), stateBefore); });
  const rejectUpgrade = async (name, mutate, error) => check(name, async () => {
    const before = await state(), original = await scalar("SELECT pg_get_functiondef('public." + SIGNATURE + "'::regprocedure) value");
    await db.exec("BEGIN;");
    try { await mutate(); await assert.rejects(db.exec(migration), error); }
    finally { await db.exec("ROLLBACK;"); }
    assert.deepEqual(await state(), before); assert.equal(await scalar("SELECT pg_get_functiondef('public." + SIGNATURE + "'::regprocedure) value"), original);
  });
  await rejectUpgrade("an unreviewed scope validator aborts without changing the reader or records", async () => {
    const definition = await scalar("SELECT pg_get_functiondef('public.pos_sync_validate_scope(text,text,text)'::regprocedure) value");
    await db.exec(definition.replace("BEGIN", "BEGIN\n-- unreviewed fixture source"));
  }, /HELD_STATUS_SOURCE_UNSUPPORTED/);
  await rejectUpgrade("an added privacy-helper grant is refused rather than silently widening access", () => db.exec("GRANT EXECUTE ON FUNCTION public.pos_sync_history_project_v1(jsonb,text,boolean) TO authenticated;"), /HELD_STATUS_SOURCE_UNSUPPORTED/);
  await rejectUpgrade("a changed critical column is refused atomically", () => db.exec("ALTER TABLE held_orders ALTER COLUMN bill_no TYPE varchar(450);"), /HELD_STATUS_COLUMN_UNSUPPORTED/);
  await rejectUpgrade("a missing indexed sales lookup is refused without a scan or new index", () => db.exec("DROP INDEX fixture_sales_bill;"), /HELD_STATUS_LOOKUP_INDEX_UNSUPPORTED/);
  await rejectUpgrade("disabled table RLS is refused without changing it", () => db.exec("ALTER TABLE held_orders DISABLE ROW LEVEL SECURITY;"), /HELD_STATUS_TABLE_UNSUPPORTED/);
  await rejectUpgrade("an unreviewed existing RPC body is refused", async () => {
    const definition = await scalar("SELECT pg_get_functiondef('public." + SIGNATURE + "'::regprocedure) value");
    await db.exec(definition.replace("BEGIN", "BEGIN\n-- changed fixture body"));
  }, /HELD_STATUS_EXISTING_CHANGED/);
  await check("a late tool-ledger error rolls back the new reader and all grants", async () => {
    await db.exec("DROP FUNCTION public." + SIGNATURE + ";"); const before = await state();
    await db.exec("BEGIN;");
    try { await db.exec(migration); await assert.rejects(db.exec("SELECT 1/0;"), /division by zero/); }
    finally { await db.exec("ROLLBACK;"); }
    assert.equal(await scalar("SELECT to_regprocedure('public." + SIGNATURE + "')::text value"), null); assert.deepEqual(await state(), before);
    await db.exec(migration);
  });
  await check("the fresh canonical held component actually executes and replays without business writes", async () => {
    const { boundedHeldStatusCanonicalBlock } = require("./history-scope-canonical.cjs");
    await db.exec("DROP FUNCTION public." + SIGNATURE + ";"); const before = await state();
    const block = boundedHeldStatusCanonicalBlock(migration); await db.exec(block); await db.exec(block);
    assert.equal((await call([ticket("held-A", "BILL-A", SHIFT)])).records[0].proofFrom, "held"); assert.deepEqual(await state(), before);
  });
  if (process.argv.includes("--postgrest")) { assert(native); const { verifyHeldStatusPostgrest } = await import("./test-held-status-postgrest.fixture.mjs"); passed += await verifyHeldStatusPostgrest(db, { A, B, OPS, MAN, SHIFT }); }
  console.log("PASS " + passed + " held-status SQL groups");
} catch (error) { console.error(JSON.stringify({ message: String(error.message).slice(0, 1000), code: error.code, where: error.where })); process.exitCode = 1; }
finally { await db.close(); }
