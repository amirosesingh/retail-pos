// Isolated execution of the reviewed production SQL template; never connects to a server.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const template = await readFile(new URL("../docs/database/str1-archive-ownership-repair.review.sql", import.meta.url), "utf8");
const target = "a611a328-2217-4d77-944a-5f6a637d123b";
const sibling = "10000000-0000-4000-8000-000000000010";
const foreign = "10000000-0000-4000-8000-000000000011";
const ids = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"];
const canonicalMigration = await readFile(new URL("../supabase/migrations/20261002200000_canonicalize_branch_identity.sql", import.meta.url), "utf8");
const canonicalSql = canonicalMigration.slice(canonicalMigration.indexOf("create or replace function public.canonical_stock_by_store"), canonicalMigration.indexOf("revoke all on function public.canonical_stock_by_store"));
let passed = 0;
async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE stores(id text PRIMARY KEY, code text, group_id text, is_active boolean DEFAULT true, deleted_at timestamptz);
    INSERT INTO stores(id,code,group_id) VALUES('${target}','STR1','361-degree-sports'),('${sibling}','STR2','361-degree-sports'),('${foreign}','OTHER','foreign');
    CREATE TABLE products(id uuid PRIMARY KEY, owner_store_id text, is_archived boolean NOT NULL DEFAULT true, deleted_at timestamptz,
      stock_quantity numeric NOT NULL DEFAULT 0,stock_by_store jsonb NOT NULL,catalogue_store_ids text[] NOT NULL DEFAULT '{}',
      row_version bigint NOT NULL DEFAULT 7,updated_at timestamptz NOT NULL DEFAULT '2026-01-01Z',
      sku text NOT NULL, selling_price numeric DEFAULT 19.95,cost_price numeric DEFAULT 7.25,ecom_price numeric DEFAULT 22.00);
    CREATE TABLE repair_events(product_id uuid,kind text);
    CREATE TABLE sales(id int PRIMARY KEY,total numeric); INSERT INTO sales VALUES(1,99.95);
    CREATE FUNCTION received_product_catalogue_stores(uuid) RETURNS text[] LANGUAGE sql STABLE AS $$ SELECT '{}'::text[] $$;
    CREATE FUNCTION product_available_in_catalogue(pid uuid,branch text) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT EXISTS(SELECT 1 FROM products p JOIN stores own ON own.id=p.owner_store_id JOIN stores dest ON dest.id=branch
        WHERE p.id=pid AND (own.id=dest.id OR own.group_id=dest.group_id)) $$;
    ${canonicalSql}
    CREATE FUNCTION fixture_before() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      NEW.stock_by_store:=canonical_stock_by_store(NEW.stock_by_store);
      SELECT COALESCE(sum((value#>>'{}')::numeric),0) INTO NEW.stock_quantity FROM jsonb_each(NEW.stock_by_store);
      NEW.catalogue_store_ids:=received_product_catalogue_stores(NEW.id);
      NEW.row_version:=OLD.row_version+1; NEW.updated_at:=now(); RETURN NEW; END $$;
    CREATE TRIGGER fixture_before BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION fixture_before();
    CREATE FUNCTION fixture_after() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO repair_events VALUES(NEW.id,'history'),(NEW.id,'feed'); RETURN NULL; END $$;
    CREATE TRIGGER fixture_after AFTER UPDATE ON products FOR EACH ROW EXECUTE FUNCTION fixture_after();
    INSERT INTO products(id,stock_by_store,sku) VALUES
      ('${ids[0]}','{"${target}":0}','SKU-000001'),('${ids[1]}','{"${target}":0}','SKU-000002');`);
  return db;
}
async function scriptFor(db) {
  const rows = (await db.query("SELECT id,md5(to_jsonb(p)::text) fingerprint FROM products p ORDER BY id")).rows;
  const values = rows.map(r => `('${r.id}','${r.fingerprint}')`).join(",\n");
  assert.match(template, /INSERT INTO archive_repair_manifest VALUES[\s\S]*?;\s*DO \$preflight\$/);
  return template.replace(/INSERT INTO archive_repair_manifest VALUES[\s\S]*?;\s*DO \$preflight\$/, `INSERT INTO archive_repair_manifest VALUES\n${values};\nDO $preflight$`).replaceAll("<>594", "<>2");
}
async function snapshot(db) {
  return (await db.query("SELECT jsonb_agg(to_jsonb(p) ORDER BY id) data FROM products p")).rows[0].data;
}
async function rejected(db, sql, pattern) {
  const before = await snapshot(db);
  await assert.rejects(db.exec(sql), pattern);
  await db.exec("ROLLBACK");
  assert.deepEqual(await snapshot(db), before, "failed repair must leave all products untouched");
}
async function test(name, run) {
  const db = await fixture();
  try { await run(db); passed++; console.log(`PASS ${name}`); } finally { await db.close(); }
}

await test("happy path preserves stock, prices, SKU, archive and checkout records; correct cluster visibility", async db => {
  const sql = await scriptFor(db), before = await snapshot(db);
  await db.exec(sql);
  const after = await snapshot(db);
  for (let i=0;i<before.length;i++) {
    const expected = { ...before[i], owner_store_id: target, row_version: before[i].row_version+1, updated_at: after[i].updated_at };
    assert.deepEqual(after[i], expected);
    for (const branch of [target,sibling]) assert.equal((await db.query("SELECT product_available_in_catalogue($1,$2) ok",[after[i].id,branch])).rows[0].ok,true);
    assert.equal((await db.query("SELECT product_available_in_catalogue($1,$2) ok",[after[i].id,foreign])).rows[0].ok,false);
  }
  assert.equal((await db.query("SELECT count(*)::int n FROM repair_events")).rows[0].n,4);
  assert.equal((await db.query("SELECT total::text FROM sales WHERE id=1")).rows[0].total,"99.95");
  await rejected(db,sql,/Candidate changed/);
  assert.equal((await db.query("SELECT count(*)::int n FROM repair_events")).rows[0].n,4,"retry cannot duplicate audit/feed");
});

for (const [name, mutation] of [
  ["concurrent product edit",`UPDATE products SET selling_price=88 WHERE id='${ids[0]}'`],
  ["new conflicting owner",`UPDATE products SET owner_store_id='${foreign}' WHERE id='${ids[0]}'`],
  ["changed archived state",`UPDATE products SET is_archived=false WHERE id='${ids[0]}'`],
  ["changed stock",`UPDATE products SET stock_by_store='{"${target}":2}' WHERE id='${ids[0]}'`],
]) await test(`${name} aborts atomically`,async db => { const sql=await scriptFor(db); await db.exec(mutation); await rejected(db,sql,/Candidate changed/); });

await test("wrong target branch or cluster aborts",async db => {
  const sql=await scriptFor(db); await db.exec(`UPDATE stores SET group_id='foreign' WHERE id='${target}'`);
  await rejected(db,sql,/Repair target branch or cluster changed/);
});
await test("missing reviewed product aborts",async db => {
  const sql=await scriptFor(db); await db.exec(`DELETE FROM products WHERE id='${ids[0]}'`);
  await rejected(db,sql,/reviewed product is missing/);
});
await test("noncanonical stock map fails precondition even with a matching fingerprint",async db => {
  await db.exec(`DROP TRIGGER fixture_before ON products; UPDATE products SET stock_by_store='{"${target.toUpperCase()}":0}' WHERE id='${ids[0]}'`);
  const sql=await scriptFor(db); await rejected(db,sql,/Candidate changed or trigger preconditions differ/);
});
await test("transfer projection mismatch fails precondition even with a matching fingerprint",async db => {
  await db.exec(`DROP TRIGGER fixture_before ON products; UPDATE products SET catalogue_store_ids=ARRAY['${foreign}'] WHERE id='${ids[0]}'`);
  const sql=await scriptFor(db); await rejected(db,sql,/Candidate changed or trigger preconditions differ/);
});
await test("unexpected trigger mutation rolls back products and audit/feed entries",async db => {
  await db.exec(`CREATE FUNCTION fixture_bad() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.cost_price:=999; RETURN NEW; END $$;
    CREATE TRIGGER zz_fixture_bad BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION fixture_bad();`);
  const sql=await scriptFor(db); await rejected(db,sql,/Unexpected field or visibility change/);
  assert.equal((await db.query("SELECT count(*)::int n FROM repair_events")).rows[0].n,0);
});
await test("a trigger deleting a repaired row is detected and rolled back",async db => {
  await db.exec(`CREATE FUNCTION fixture_remove() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      DELETE FROM products WHERE id=NEW.id; RETURN NULL; END $$;
    CREATE TRIGGER zz_fixture_remove AFTER UPDATE ON products FOR EACH ROW EXECUTE FUNCTION fixture_remove();`);
  const sql=await scriptFor(db); await rejected(db,sql,/repaired product disappeared/);
  assert.equal((await db.query("SELECT count(*)::int n FROM repair_events")).rows[0].n,0);
});
console.log(`${passed} isolated archive ownership repair cases passed. No live database accessed.`);
