"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PGlite } = require("@electric-sql/pglite");
const { render, PROJECT, SYSTEM } = require("./package-sale-item-beta-repair.cjs");
async function fixture(work) {
  const db = new PGlite();
  try {
    const identity = (await db.query("SELECT system_identifier::text id FROM pg_control_system();")).rows[0].id;
    await work(db, identity);
  } finally { await db.close(); }
}
test("the default beta target refuses another database cluster before any schema action", async () => fixture(async db => {
  const result = render("CREATE TABLE must_not_exist(id integer);");
  assert.equal(result.project, PROJECT); assert.equal(result.systemIdentifier, SYSTEM);
  await assert.rejects(db.exec(result.sql), /RETAIL_POS_BETA_WRONG_CLUSTER/);
  assert.equal((await db.query("SELECT to_regclass('public.must_not_exist') relation;")).rows[0].relation, null);
}));
test("a failure anywhere in the wrapped payload rolls back all changes and preserves prior work", async () => fixture(async (db, identity) => {
  await db.exec("CREATE TABLE pending_fixture(id integer PRIMARY KEY,acknowledged boolean NOT NULL); INSERT INTO pending_fixture VALUES(1,false);");
  const result = render("CREATE TABLE partial_metadata(id integer); UPDATE pending_fixture SET acknowledged=true; DO $failure$BEGIN RAISE EXCEPTION 'owned fixture refusal'; END $failure$;", identity);
  await assert.rejects(db.exec(result.sql), /owned fixture refusal/);
  assert.equal((await db.query("SELECT to_regclass('public.partial_metadata') relation;")).rows[0].relation, null);
  assert.deepEqual((await db.query("SELECT * FROM pending_fixture;")).rows, [{ id: 1, acknowledged: false }]);
}));
test("a verified target completes and can replay an idempotent metadata-only payload", async () => fixture(async (db, identity) => {
  const result = render("CREATE TABLE IF NOT EXISTS owned_metadata(id integer);", identity);
  await db.exec(result.sql); await db.exec(result.sql);
  assert.equal((await db.query("SELECT COUNT(*)::integer count FROM owned_metadata;")).rows[0].count, 0);
  assert.equal(result.sha256.length, 64); assert.equal(result.bodySha256.length, 64);
}));
test("the complete reviewed scope component executes and replays inside the atomic beta wrapper", async () => {
  const { createSaleItemScopeFixture } = require("./lib/sale-item-scope-fixture.cjs");
  const f = await createSaleItemScopeFixture();
  try {
    const identity = (await f.db.query("SELECT system_identifier::text id FROM pg_control_system();")).rows[0].id;
    const result = render(f.sql, identity);
    await f.db.exec(result.sql); await f.db.exec(result.sql);
    assert.equal((await f.db.query("SELECT count(*)::integer count FROM pg_attribute WHERE attrelid='public.sync_change_feed'::regclass AND attname='sale_parent_scope_verified' AND NOT attisdropped;")).rows[0].count, 1);
  } finally { await f.db.close(); }
});
test("transaction delimiters, invalid cluster identifiers and delimiter injection are refused", () => {
  for (const body of ["BEGIN;\nSELECT 1;", "SELECT 1;\nCOMMIT;", "ROLLBACK;", "$retail_reviewed_sale_item_scope$"])
    assert.throws(() => render(body));
  assert.throws(() => render("SELECT 1;", "unsafe'identifier"));
});
