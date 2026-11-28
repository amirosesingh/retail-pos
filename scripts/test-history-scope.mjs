// Owned synthetic PostgreSQL/PGlite only. No operator connection, profile or data.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
const require = createRequire(import.meta.url);
const { MIGRATION, build } = require("./prepare-history-scope.cjs");
const transport = require("./prepare-scoped-history-transport.cjs");
const read = file => readFile(new URL("../" + file, import.meta.url), "utf8");
const metadata = JSON.parse(await read("src/lib/__tests__/fixtures/history-scope-live-metadata.json"));
const registry = JSON.parse(await read("database/sqlserver/schema-registry.json"));
const migration = await read("supabase/migrations/" + MIGRATION);
const transportMigration = (await read("supabase/migrations/" + transport.MIGRATION)).replaceAll("\r\n", "\n");
const native = process.argv.includes("--native");
assert(process.argv.slice(2).every(value => ["--native", "--postgrest"].includes(value)));
const nativeBaseSource = native ? (await read("scripts/test-seven-shift-summary-native.fixture.mjs")).replaceAll("\r\n", "\n") : null;
if (native) assert.equal(nativeBaseSource.split("return {\n   exec:").length, 2);
const nativeSource = native ? nativeBaseSource.replace("return {\n   exec:", "return {historyRest:{port,directory},\n   exec:") : null;
const factory = native ? await import("data:text/javascript;base64," + Buffer.from(nativeSource + "\nexport {createNativeFixture};").toString("base64")) : null;
const db = native ? await factory.createNativeFixture() : new PGlite();
const prepared = build(metadata);
const staged = transport.build(metadata);
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const literal = value => "E" + quote(value.replaceAll("\\", "\\\\").replaceAll("\r", "\\r").replaceAll("\n", "\\n"));
const scalar = async (query, params = []) => (await db.query(query, params)).rows[0]?.value;
const apply = async definition => {
  const match = definition.match(/AS (\$\w*\$)([\s\S]*?)\1/);
  assert(match);
  await db.exec(definition.replace(match[0], () => "AS " + literal(match[2])));
};
const A = "aaaaaaaa-aaaa-4aaa-8aaa-00000000000a", B = "bbbbbbbb-bbbb-4bbb-8bbb-00000000000b";
const OPS = "cccccccc-cccc-4ccc-8ccc-000000000001", MAN = "cccccccc-cccc-4ccc-8ccc-000000000002";
const OTHER = "cccccccc-cccc-4ccc-8ccc-000000000003", TEXT = "cccccccc-cccc-4ccc-8ccc-000000000004";
const id = n => "dddddddd-dddd-4ddd-8ddd-" + String(n).padStart(12, "0");
const call = async (name, args) => scalar("SELECT public." + name + "(" + args.map(quote).join(",") + ") value");
const idx = (version, action = "begin", after = null, upper = null, branch = A, terminal = OPS) =>
  scalar("SELECT public.pos_sync_history_index_v" + version + "($1,$2,$3,$4,$5::uuid,$6::uuid,1000,false) value", ["default", branch, terminal, action, after, upper]);
const rows = (version, ids, branch = A, terminal = OPS, keep = false) =>
  scalar("SELECT public.pos_sync_history_rows_v" + version + "($1,$2,$3,$4::jsonb,$5::boolean,2097152) value", ["default", branch, terminal, JSON.stringify(ids), keep]);
const boot = (terminal = OPS, branch = A) => scalar("SELECT public.pos_sync_bootstrap('default',$1,$2,'change_history',NULL,7300,10) value", [branch, terminal]);
const protectedBoot = (terminal = OPS, branch = A) => scalar("SELECT public.pos_sync_history_page_v1('default',$1,$2,NULL,7300,false,2097152) value", [branch, terminal]);
const count = (terminal = OPS, branch = A) => scalar("SELECT row_count::text value FROM public.pos_sync_counts('default',$1,$2,7300) WHERE table_name='change_history'", [branch, terminal]);
const stageCount = (terminal = OPS, branch = A) => scalar("SELECT row_count::text value FROM public.pos_sync_counts_history_v2('default',$1,$2,7300) WHERE table_name='change_history'", [branch, terminal]);
const stagePage = (terminal = OPS, branch = A, cursor = null, bytes = 2097152) => scalar("SELECT public.pos_sync_history_page_v2('default',$1,$2,$3,7300,false,$4) value", [branch, terminal, cursor, bytes]);
let passed = 0;
const check = async (name, work) => { await work(); passed++; console.log("PASS " + name); };
const state = () => scalar("SELECT jsonb_build_object('history',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id)::text FROM public.change_history h),'triggers',(SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY tgname) FROM pg_trigger WHERE tgrelid='public.change_history'::regclass AND NOT tgisinternal),'indexes',(SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid) FROM pg_index WHERE indrelid='public.change_history'::regclass),'functions',(SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'name',p.proname,'body',p.prosrc,'acl',p.proacl::text,'config',p.proconfig,'owner',p.proowner) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'pos_sync%')) value");
async function restore() {
  for (const entry of metadata.functions) {
    await apply(entry.definition);
    await db.exec("REVOKE ALL ON FUNCTION public." + entry.signature + " FROM PUBLIC,anon,authenticated,service_role;");
    await db.exec("GRANT EXECUTE ON FUNCTION public." + entry.signature + " TO service_role;");
    if (entry.acl.includes("=X/postgres,postgres=")) await db.exec("GRANT EXECUTE ON FUNCTION public." + entry.signature + " TO PUBLIC;");
  }
  for (const entry of [...prepared.additions, ...prepared.helpers]) await db.exec("DROP FUNCTION IF EXISTS public." + entry.signature + ";");
}
async function rejectMigration(name, mutate, pattern, cleanup = async () => {}) {
  await restore();
  await mutate();
  const before = await state();
  await db.exec("BEGIN;");
  try { await assert.rejects(db.exec(migration), pattern); }
  finally { await db.exec("ROLLBACK;"); }
  assert.deepEqual(await state(), before);
  await cleanup();
  passed++; console.log("PASS " + name);
}
try {
  await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TYPE public.app_role AS ENUM('admin','supervisor','cashier');CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'role','service_role')$$;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULL::uuid$$;");
  for (const table of registry.tables) {
    if (table.cloudTable === "change_history") continue;
    const columns = new Map(table.columns.map(column => [column.cloudColumn, column.cloudType]));
    if (table.cloudTable === "terminal_tokens") for (const [name, type] of Object.entries({ platform: "text", location_id: "text", status: "text", revoked_at: "timestamptz", is_claimed: "boolean", management_sync_enabled: "boolean" })) columns.set(name, type);
    if (table.cloudTable === "app_users") for (const [name, type] of Object.entries({ auth_user_id: "uuid", is_active: "boolean", role: "public.app_role", permissions: "jsonb", store_id: "text" })) columns.set(name, type);
    await db.exec('CREATE TABLE public."' + table.cloudTable + '"(' + [...columns].map(([name, type]) => '"' + name + '" ' + type).join(",") + ");");
  }
  await db.exec("CREATE TABLE public.change_history(" + metadata.history_shape.map(column => '"' + column.name + '" ' + column.type + (column.not_null ? " NOT NULL" : "") + (column.name === "id" ? " PRIMARY KEY" : "")).join(",") + ");ALTER TABLE public.change_history ENABLE ROW LEVEL SECURITY;");
  await db.exec("CREATE TABLE public.sync_change_feed(cursor bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,organization_id text,branch_id text,terminal_id text,table_name text,entity_id text,operation text,row_version bigint,tombstone boolean,changed_at timestamptz);");
  await db.exec("CREATE FUNCTION public.product_available_in_catalogue(product uuid,branch text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT true$$;CREATE FUNCTION public.catalogue_product_ids_for_branch(branch text) RETURNS SETOF uuid LANGUAGE sql STABLE AS $$SELECT id FROM public.products$$;");
  await restore();
  for (const entry of metadata.functions) {
    const actual = await scalar("SELECT replace(pg_get_functiondef($1::regprocedure),chr(13)||chr(10),chr(10)) value", ["public." + entry.signature]);
    const expected = entry.definition.replaceAll("\r\n", "\n");
    if (actual !== expected) {
      let offset = 0; while (actual[offset] === expected[offset] && offset < expected.length) offset++;
      throw new Error("Fixture serializer mismatch " + entry.signature + " at " + offset + ": actual " + actual.slice(offset, offset + 90) + "; expected " + expected.slice(offset, offset + 90));
    }
  }
  await db.exec("CREATE TRIGGER change_history_no_change BEFORE DELETE OR UPDATE ON public.change_history FOR EACH ROW EXECUTE FUNCTION public.change_history_immutable();GRANT USAGE ON SCHEMA public,auth TO service_role;GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;");
  await db.exec("INSERT INTO stores(id,group_id) VALUES(" + quote(A) + ",'cluster-A'),(" + quote(B) + ",'cluster-B'),('StoreA','cluster-A');INSERT INTO terminal_tokens(id,platform,location_id,status,is_claimed,management_sync_enabled) VALUES(" + quote(OPS) + ",'pc'," + quote(A) + ",'used',true,false),(" + quote(MAN) + ",'pc',NULL,'used',true,true),(" + quote(OTHER) + ",'pc'," + quote(B) + ",'used',true,false),(" + quote(TEXT) + ",'pc','StoreA','used',true,false);");
  const cases = [["BRANCH", A, "default"], ["BRANCH", B, "default"], ["GLOBAL", null, "default"], ["PRIVATE", A, "default"], ["TERMINAL", OPS, "default"], ["CLUSTER", "cluster-A", "default"], ["BRANCH", null, "default"], ["branch", A, "default"], ["BRANCH", A.toUpperCase(), "default"], ["BRANCH", " " + A, "default"], ["BRANCH", A, "other"], ["BRANCH", "StoreA", "default"], ["BRANCH", "storea", "default"]];
  for (const [index, [scope, scopeId, organization]] of cases.entries()) await db.exec("INSERT INTO public.change_history(id,organization_id,entity_type,entity_id,action,old_value,new_value,revision,scope_type,scope_id,source_application,server_timestamp) VALUES(" + quote(id(index + 1)) + "," + quote(organization) + ",'products'," + quote(id(index + 1)) + ",'insert','{\"table_name\":\"terminal_tokens\",\"claim_proof\":\"PRIVATE\"}','{\"table_name\":\"products\",\"ecom_price\":19.22,\"exact\":9007199254740993}',9007199254740993," + quote(scope) + "," + (scopeId === null ? "NULL" : quote(scopeId)) + ",'fixture','2026-11-07T01:02:03.123456Z');");
  const original = await state();
  await check("unmodified source reproduces cross-branch/global bootstrap and index disclosure", async () => { assert.equal((await boot()).rows.length, 10); assert.equal((await idx(1)).ids.length, 13); assert.equal(await count(), "13"); });
  if (process.argv.includes("--postgrest")) {
    assert(native);
    const { verifyHistoryScopePostgrest } = await import("./test-history-scope-postgrest.fixture.mjs");
    passed += await verifyHistoryScopePostgrest(db, { A, B, OPS, OTHER, MAN, id }, { legacy: true });
    assert.deepEqual(await state(), original);
  }
  await check("scoped transport artifact is deterministic and a late failure rolls back every added function", async () => {
    assert.equal(transportMigration, transport.render(metadata));
    assert(!/^\s*(BEGIN|COMMIT)\s*;/mi.test(transportMigration));
    await db.exec("BEGIN;");
    try {
      await db.exec(transportMigration);
      await assert.rejects(db.exec("INSERT INTO deliberately_missing_transport_ledger VALUES(1);"), /does not exist/);
    } finally { await db.exec("ROLLBACK;"); }
    assert.deepEqual(await state(), original);
  });
  await check("unknown source grants abort before any staged SQL is committed", async () => {
    await db.exec("BEGIN;");
    try {
      await db.exec("GRANT EXECUTE ON FUNCTION public.pos_sync_counts(text,text,text,integer) TO authenticated;");
      await assert.rejects(db.exec(transportMigration), /HISTORY_TRANSPORT_METADATA/);
    } finally { await db.exec("ROLLBACK;"); }
    assert.deepEqual(await state(), original);
  });
  await check("additive stage preserves every legacy function, history row, trigger and index, leaving the installed v2 handshake absent", async () => {
    const before = { bootstrap: await boot(), index: await idx(1), count: await count() };
    await db.exec(transportMigration);
    const after = await state(), names = new Set(staged.targets.map(entry => entry.signature.split("(")[0]));
    assert.equal(after.functions.filter(entry => names.has(entry.name)).length, 8);
    assert.deepEqual({ ...after, functions: after.functions.filter(entry => !names.has(entry.name)) }, original);
    assert.deepEqual({ bootstrap: await boot(), index: await idx(1), count: await count() }, before);
    assert.equal(await scalar("SELECT to_regprocedure('public.pos_sync_history_index_v2(text,text,text,text,uuid,uuid,integer,boolean)') value"), null);
    await db.exec(transportMigration);
    assert.deepEqual(await state(), after);
  });
  await check("staged branch and Management reads agree across index, exact rows, opaque bootstrap and counts", async () => {
    for (const [terminal, branch, expected] of [[OPS,A,[id(1),id(9)]],[OTHER,B,[id(2)]]]) {
      const begin = await idx(3,"begin",null,null,branch,terminal);
      assert.equal(begin.protocol,"history-index-v2");assert.equal(begin.policy,"branch-history-v1");assert.equal(begin.history_scope,"branch");
      assert.deepEqual(begin.ids,expected);
      assert.deepEqual((await stagePage(terminal,branch)).rows.map(row=>row.id),expected);
      assert.equal(await stageCount(terminal,branch),String(expected.length));
      const exact = await rows(3,expected,branch,terminal);
      assert.equal(exact.protocol,"history-rows-v2");
      assert.deepEqual(exact.rows.map(row=>row.id),expected);
      assert(!exact.rows[0].new_value_json.includes("ecom_price"));
    }
    const management = await idx(3,"begin",null,null,B,MAN);
    assert.equal(management.history_scope,"company");
    assert(management.ids.includes(id(3))&&!management.ids.includes(id(11)));
    assert.equal(await stageCount(MAN,B),"12");
    const first=await stagePage(MAN,B),second=await stagePage(MAN,B,first.cursor);
    assert.equal(first.rows.length,10);assert.equal(second.rows.length,2);assert.equal(second.cursor,null);
    assert.deepEqual([...first.rows,...second.rows].map(row=>row.id),management.ids);
    await assert.rejects(stagePage(OPS,B), /SYNC_(?:TERMINAL_)?(?:BRANCH|SCOPE)_FORBIDDEN|SYNC_TERMINAL_SCOPE_FORBIDDEN/);
    await assert.rejects(stagePage(OPS,A,'{"id":"unknown"}'), /POS_HISTORY_STREAM_INVALID_ARGUMENT/);
    await assert.rejects(rows(3,[id(2)]), /HISTORY_INDEX_ROW_MISSING/);
    const operationalCounts = name => db.query(
      "SELECT table_name,row_count::text FROM public."+name+"('default',$1,$2,7300) WHERE table_name<>'change_history' ORDER BY table_name",[A,OPS]);
    assert.deepEqual((await operationalCounts("pos_sync_counts_history_v2")).rows,(await operationalCounts("pos_sync_counts")).rows);
  });
  await check("staged bootstrap resumes after the last kept UUID when response bytes split the page", async () => {
    await db.exec("BEGIN;");
    try {
      for (const suffix of [21,22]) await db.exec("INSERT INTO public.change_history(id,organization_id,entity_type,entity_id,action,new_value,revision,scope_type,scope_id,source_application,server_timestamp) VALUES ("+
        quote(id(suffix))+",'default','products','fixture','insert',jsonb_build_object('blob',repeat('x',1500)),1,'BRANCH',"+quote(A)+",'fixture',now());");
      const first=await stagePage(OPS,A,JSON.stringify({id:id(20)}),1024);
      assert.deepEqual(first.rows.map(row=>row.id),[id(21)]);
      assert.deepEqual(JSON.parse(first.cursor),{id:id(21)});
      const last=await stagePage(OPS,A,first.cursor,1024);
      assert.deepEqual(last.rows.map(row=>row.id),[id(22)]);assert.equal(last.cursor,null);
    } finally { await db.exec("ROLLBACK;"); }
  });
  await check("staged feed scopes before limit, keeps real mixed records and does not advance over an unauthorized tombstone", async () => {
    await db.exec("BEGIN;");
    try {
      await db.exec("INSERT INTO sync_change_feed(organization_id,branch_id,table_name,entity_id,operation,row_version,tombstone) SELECT 'default','global','change_history'," + quote(JSON.stringify({ id: id(2) })) + ",'insert',1,false FROM generate_series(1,101);");
      await db.exec("INSERT INTO sync_change_feed(organization_id,branch_id,table_name,entity_id,operation,row_version,tombstone) VALUES "
       + "('default','global','change_history'," + quote(JSON.stringify({id:id(1)})) + ",'delete',1,true),"
       + "('default','global','change_history'," + quote(JSON.stringify({id:id(1)})) + ",'insert',1,false),"
       + "('default','global','stores'," + quote(JSON.stringify({id:A})) + ",'update',1,false);");
      const value = await scalar("SELECT public.pos_sync_feed_page_v2('default',$1,$2,0,false,2097152) value",[A,OPS]);
      assert.deepEqual(value.map(row=>[row.cursor,row.table_name,row.tombstone]),[[103,"change_history",false],[104,"stores",false]]);
      assert.equal(value[0].row_data.id,id(1));
      const legacy = await scalar("SELECT public.pos_sync_feed_page_v1('default',$1,$2,0,false,2097152) value",[A,OPS]);
      assert.equal(legacy.length,10);assert.equal(legacy[0].row_data.id,id(2));
    } finally { await db.exec("ROLLBACK;"); }
    // Identity sequences are not transactional even for this isolated fixture.
    await db.exec("ALTER TABLE public.sync_change_feed ALTER COLUMN cursor RESTART WITH 1;");
  });
  await check("staged exact replay refuses a partial install or unexpected new routine ACL", async () => {
    const before=await state();
    for (const [mutation,error] of [
      ["DROP FUNCTION public.pos_sync_history_rows_v3(text,text,text,jsonb,boolean,integer);",/HISTORY_TRANSPORT_PARTIAL/],
      ["GRANT EXECUTE ON FUNCTION public.pos_sync_history_rows_v3(text,text,text,jsonb,boolean,integer) TO authenticated;",/HISTORY_TRANSPORT_METADATA/],
    ]) {
      await db.exec("BEGIN;");
      try { await db.exec(mutation);await assert.rejects(db.exec(transportMigration),error); }
      finally { await db.exec("ROLLBACK;"); }
      assert.deepEqual(await state(),before);
    }
  });
  if (process.argv.includes("--postgrest")) {
    const { verifyHistoryScopePostgrest } = await import("./test-history-scope-postgrest.fixture.mjs");
    passed += await verifyHistoryScopePostgrest(db, { A, B, OPS, OTHER, MAN, id }, { staged: true });
  }
  await check("one tool-owned migration installs only guarded readers/helpers and preserves all history/trigger/index values", async () => { assert(!/^\s*(BEGIN|COMMIT)\s*;/mi.test(migration)); await db.exec(migration); const after = await state(); assert.deepEqual(after.history, original.history); assert.deepEqual(after.triggers, original.triggers); assert.deepEqual(after.indexes, original.indexes); });
  await check("the existing final cutover and staged transport coexist and replay without changed functions or records", async () => {
    const before=await state();
    await db.exec(transportMigration);await db.exec(migration);await db.exec(transportMigration.replaceAll("\n","\r\n"));
    assert.deepEqual(await state(),before);
    assert.deepEqual((await idx(3)).ids,(await idx(2)).ids);
    assert.deepEqual((await stagePage()).rows.map(row=>row.id),(await protectedBoot()).rows.map(row=>row.id));
  });
  await check("old v1 bootstrap/protected bootstrap/count/index return only exact own-branch rows", async () => { for (const value of [await boot(), await protectedBoot()]) assert.deepEqual(value.rows.map(row => row.id), [id(1), id(9)]); const value = await idx(1); assert.deepEqual(value.ids, [id(1), id(9)]); assert.equal(value.upper_id, id(9)); assert.equal(await count(), "2"); assert(!Object.hasOwn(value, "policy")); assert.equal((await idx(1, "finish", null, value.upper_id)).range_count, "2"); });
  await check("new v2 explicitly attests branch policy without changing exact financial/privacy projection", async () => { const value = await idx(2); assert.equal(value.protocol, "history-index-v2"); assert.equal(value.policy, "branch-history-v1"); assert.equal(value.history_scope, "branch"); const result = await rows(2, [id(1), id(9)]); assert.equal(result.protocol, "history-rows-v2"); assert.equal(result.history_scope, "branch"); assert.equal(result.rows[0].revision, "9007199254740993"); assert.match(result.rows[0].new_value_json, /9007199254740993/); assert(!result.rows[0].new_value_json.includes("ecom_price")); assert(!result.rows[0].old_value_json.includes("PRIVATE")); assert.equal(result.rows[0].server_timestamp, "2026-11-07T01:02:03.1234560Z"); });
  await check("strict non-UUID branch strings retain case-sensitive identity", async () => { assert.deepEqual((await idx(2, "begin", null, null, "StoreA", TEXT)).ids, [id(12)]); });
  await check("foreign/GLOBAL/PRIVATE/TERMINAL/unknown/unattributed row requests all fail without an existence oracle", async () => { for (const version of [1, 2]) for (const n of [2, 3, 4, 5, 6, 7, 8, 10, 11, 13, 999]) await assert.rejects(rows(version, [id(n)]), /HISTORY_INDEX_ROW_MISSING/); });
  await check("verified Management receives every current-company history scope but excludes another organization", async () => { const p = await idx(2, "begin", null, null, B, MAN); assert.equal(p.history_scope, "company"); assert.equal(p.ids.length, 12); assert(!p.ids.includes(id(11))); const old = await idx(1, "begin", null, null, A, MAN); assert.equal(old.ids.length, 12); assert(!Object.hasOwn(old, "history_scope")); assert.equal(await count(MAN, B), "12"); assert.equal((await rows(2, [id(3), id(4), id(5)], B, MAN)).rows.length, 3); });
  await check("a registered Operations administrator cannot select another branch or invent Management mode", async () => { await assert.rejects(idx(2, "begin", null, null, B, OPS), /SYNC_TERMINAL_SCOPE_FORBIDDEN/); await db.exec("UPDATE terminal_tokens SET management_sync_enabled=false WHERE id=" + quote(MAN)); await assert.rejects(idx(2, "begin", null, null, A, MAN), /SYNC_TERMINAL_SCOPE_FORBIDDEN/); await db.exec("UPDATE terminal_tokens SET management_sync_enabled=true WHERE id=" + quote(MAN)); });
  await check("revoked and unclaimed Management registrations do not gain company history", async () => { await db.exec("UPDATE terminal_tokens SET revoked_at=now() WHERE id=" + quote(MAN)); await assert.rejects(idx(2, "begin", null, null, A, MAN), /SYNC_TERMINAL_SCOPE_FORBIDDEN/); await db.exec("UPDATE terminal_tokens SET revoked_at=NULL,is_claimed=false WHERE id=" + quote(MAN)); await assert.rejects(idx(2, "begin", null, null, A, MAN), /SYNC_TERMINAL_SCOPE_FORBIDDEN/); await db.exec("UPDATE terminal_tokens SET is_claimed=true WHERE id=" + quote(MAN)); });
  await check("unauthorized global feed hints are excluded before page limits, never emitted as fake tombstones", async () => { await db.exec("INSERT INTO sync_change_feed(organization_id,branch_id,table_name,entity_id,operation,row_version,tombstone) SELECT 'default','global','change_history'," + quote(JSON.stringify({ id: id(3) })) + ",'insert',1,false FROM generate_series(1,101);"); const empty = await scalar("SELECT public.pos_sync_feed_page_v1('default',$1,$2,0,false,2097152) value", [A, OPS]); assert.deepEqual(empty, []); await db.exec("INSERT INTO sync_change_feed(organization_id,branch_id,table_name,entity_id,operation,row_version,tombstone) VALUES('default','global','stores'," + quote(JSON.stringify({ id: A })) + ",'update',1,false);"); const result = await scalar("SELECT public.pos_sync_feed_page_v1('default',$1,$2,0,false,2097152) value", [A, OPS]); assert.equal(result.length, 1); assert.equal(result[0].table_name, "stores"); assert.equal(result[0].cursor, 102); assert.equal(result[0].tombstone, false); });
  await check("exact replay and CRLF replay preserve function identities, records and source guards", async () => { const before = await state(); await db.exec(migration); await db.exec(migration.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n")); assert.deepEqual(await state(), before); });
  await check("public and authenticated callers cannot invoke either helper or v1/v2 sync readers", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec("SET ROLE " + role + ";");
      try {
        for (const query of [
          "SELECT public.pos_sync_history_company_scope_v1('default','" + A + "','" + OPS + "')",
          "SELECT public.pos_sync_history_row_visible_v1(true,'default','A','default','GLOBAL',NULL)",
          "SELECT public.pos_sync_history_index_v1('default','" + A + "','" + OPS + "','begin')",
          "SELECT public.pos_sync_history_index_v2('default','" + A + "','" + OPS + "','begin')"
        ]) await assert.rejects(db.exec(query), /permission denied/);
      } finally { await db.exec("RESET ROLE;"); }
    }
  });
  await rejectMigration("changed validator source aborts before any reader/helper changes", async () => {
    const entry = metadata.functions.find(item => item.signature === "pos_sync_validate_read_scope(text,text,text)");
    await apply(entry.definition.replace("BEGIN", "BEGIN\n-- unreviewed fixture source"));
  }, /HISTORY_SCOPE_SOURCE_CHANGED/);
  await rejectMigration("changed existing routine grants abort without restoring or widening them", async () => {
    await db.exec("GRANT EXECUTE ON FUNCTION public.pos_sync_counts(text,text,text,integer) TO authenticated;");
  }, /HISTORY_SCOPE_SOURCE_METADATA/);
  await rejectMigration("an added history column is refused without changing its records", async () => {
    await db.exec("ALTER TABLE public.change_history ADD COLUMN fixture_extra text;");
  }, /HISTORY_SCOPE_HISTORY_SHAPE/, () => db.exec("ALTER TABLE public.change_history DROP COLUMN fixture_extra;"));
  await rejectMigration("disabled history RLS is refused without silently changing it", async () => {
    await db.exec("ALTER TABLE public.change_history DISABLE ROW LEVEL SECURITY;");
  }, /HISTORY_SCOPE_HISTORY_SHAPE/, () => db.exec("ALTER TABLE public.change_history ENABLE ROW LEVEL SECURITY;"));
  await rejectMigration("missing immutable guard is refused without inventing history protection", async () => {
    await db.exec("ALTER TABLE public.change_history DISABLE TRIGGER change_history_no_change;");
  }, /HISTORY_SCOPE_HISTORY_SHAPE/, () => db.exec("ALTER TABLE public.change_history ENABLE TRIGGER change_history_no_change;"));
  await rejectMigration("known but partial helper installation is refused atomically", async () => {
    await apply(prepared.helpers[0].definition);
    await db.exec("REVOKE ALL ON FUNCTION public." + prepared.helpers[0].signature + " FROM PUBLIC;GRANT EXECUTE ON FUNCTION public." + prepared.helpers[0].signature + " TO service_role;");
  }, /HISTORY_SCOPE_PARTIAL_INSTALL/);
  await restore();
  await check("a late tool-ledger failure rolls back every routine/helper and preserves exact history", async () => {
    const before = await state();
    await db.exec("BEGIN;");
    try { await db.exec(migration); await assert.rejects(db.exec("SELECT 1/0;"), /division by zero/); }
    finally { await db.exec("ROLLBACK;"); }
    assert.deepEqual(await state(), before);
  });
  await check("fresh canonical component executes the reviewed 70-table/pre-count wrapper variants and replays", async () => {
    const { historyScopeCanonicalBlock, scopedHistoryTransportCanonicalBlock, withScopedHistoryTransportContract } = require("./history-scope-canonical.cjs");
    const block = historyScopeCanonicalBlock(migration);
    const canonicalInputs = JSON.parse(block.match(/ expected constant jsonb := \$history_scope_data\$([^\r\n]*?)\$history_scope_data\$::jsonb;/)[1]);
    await apply(canonicalInputs.find(item => item.signature === "pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)").definition);
    const oldCapture = JSON.parse(await read("src/lib/__tests__/fixtures/history-count-contract-live-metadata.json"));
    await apply(oldCapture.functions.find(item => item.signature === "pos_sync_counts(text,text,text,integer)").definition);
    const delegate = metadata.functions.find(item => item.signature === "pos_sync_counts_scoped(text,text,text,integer)");
    const old = delegate.definition.replaceAll("\r\n", "\n");
    const needle = 'x WHERE true;\nEND $function$';
    assert.equal(old.split(needle).length, 2);
    await apply(old.replace(needle, 'x WHERE true UNION ALL SELECT \'change_history\'::text table_name,count(*)::bigint row_count FROM public."change_history" x WHERE true;\nEND $function$'));
    await db.exec("REVOKE EXECUTE ON FUNCTION public.change_history_immutable() FROM PUBLIC;");
    const before = await state();
    await db.exec(block);
    assert.equal(await count(), "2");
    assert.equal((await idx(2)).history_scope, "branch");
    assert.deepEqual((await state()).history, before.history);
    const verified = await state(); await db.exec(block); assert.deepEqual(await state(), verified);
    for (const target of [...staged.targets].reverse()) await db.exec("DROP FUNCTION public."+target.signature+";");
    const beforeStage=await state(),stageBlock=scopedHistoryTransportCanonicalBlock(transportMigration,block);
    await assert.rejects(db.exec(transportMigration), /HISTORY_TRANSPORT_SOURCE_CHANGED/);
    assert.deepEqual(await state(),beforeStage);
    await db.exec(stageBlock);
    assert.deepEqual((await idx(3)).ids,[id(1),id(9)]);
    assert.equal(await stageCount(),"2");
    const stagedFresh=await state();await db.exec(stageBlock);assert.deepEqual(await state(),stagedFresh);
    const schema=(await read("supabase/schema.sql")).replaceAll("\r\n","\n");
    assert(schema.includes(stageBlock));assert.equal(withScopedHistoryTransportContract(schema,transportMigration),schema);
  });
  if (process.argv.includes("--postgrest")) {
    assert(native);
    const { verifyHistoryScopePostgrest } = await import("./test-history-scope-postgrest.fixture.mjs");
    passed += await verifyHistoryScopePostgrest(db, { A, B, OPS, MAN, id });
  }
  console.log("PASS " + passed + " history branch/Management scope groups");
} catch (error) {
  console.error(JSON.stringify({ message: String(error.message).slice(0, 1000), code: error.code, where: error.where }));
  process.exitCode = 1;
} finally {
  await db.close();
}
