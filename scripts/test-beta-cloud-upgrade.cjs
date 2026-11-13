"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { renderCloud, packageCloud, reviewedBody } = require("./lib/beta-cloud-upgrade.cjs");
const { packageLocal } = require("./lib/beta-local-upgrade.cjs");
const { packageUpgrade, outputPath } = require("./package-existing-local-upgrade.cjs");
function pglite() {
  try { return require("@electric-sql/pglite"); }
  catch { return require(path.resolve(__dirname, "../.tmp/sql-upgrade-tests/node_modules/@electric-sql/pglite")); }
}
const oldMigration = { version: "20261109075631", name: "fixture_old" };
const newMigration = { version: "20261110031005", name: "fixture_upgrade" };
const fixtureQuery = `SELECT jsonb_build_object('project_ref','fixture','database_name',current_database(),'database_role',current_user,'system_identifier','fixture',
 'migrations',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name) ORDER BY version) FROM supabase_migrations.schema_migrations),
 'installed',to_regclass('public.fixture_feature') IS NOT NULL) AS fingerprint;`;
async function fixture() {
  const { PGlite } = pglite(); const db = new PGlite();
  await db.exec("CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);CREATE TABLE business_sentinel(id int PRIMARY KEY,value text);INSERT INTO business_sentinel VALUES(1,'retained');");
  await db.query("INSERT INTO supabase_migrations.schema_migrations VALUES($1,$2,ARRAY['old'])", [oldMigration.version, oldMigration.name]);
  const identity = (await db.query("SELECT current_database() database_name,current_user database_role")).rows[0];
  const snapshot = { fingerprint: { project_ref: "fixture", ...identity, system_identifier: "fixture", migrations: [oldMigration,newMigration], installed: true } };
  const source = "BEGIN;\nCREATE TABLE public.fixture_feature(id int PRIMARY KEY);\nCOMMIT;\n";
  return { db, snapshot, source, sql: renderCloud({ snapshot,source,query:fixtureQuery }).sql };
}
test("already reviewed local artifact remains byte-identical", () => {
  assert.equal(packageUpgrade().sql, fs.readFileSync(outputPath,"utf8"));
});
test("current package contains seven event-era modules beyond025-030 and pins beta targets", () => {
  const local=packageLocal(),cloud=packageCloud();assert.equal(local.sources.length,13);
  assert(local.sql.includes("POS_Local_Beta"));assert(cloud.sql.includes("7703759698107299042"));
  for(const name of ["pos_sync_sale_outbox_v1","pos_sync_sale_acceptance_v1","pos_sync_grouped_stock_v1","refund_acceptance_json","pos_sync_cash_settings_recovery_pages_v1","pos_store_settings_edit_reviews"])assert(local.sql.includes(name));
});
test("existing upgrade covers every reviewed storage input in the beta fresh installer",()=>{
  const {root,sourceModules}=require("./lib/beta-local-upgrade.cjs"),{digest}=require("./lib/existing-local-upgrade.cjs");
  const header=fs.readFileSync(path.join(root,"database/beta/retail-pos-local-beta-fresh.sql"),"utf8").split("*/")[0];
  const inputs=[...header.matchAll(/([a-f0-9]{64})\s+((?:database|scripts)\/[^\r\n]+\.sql)/g)];
  assert(inputs.length>=10,"Fresh installer source inventory missing");
  const covered=new Set(["database/sqlserver/retail-pos-local-database.sql",...sourceModules().map(m=>m.file)]);
  for(const [,hash,file] of inputs){
    assert(covered.has(file),"Current storage input omitted: "+file);
    // The historical fresh package captured the sale outbox with Windows CRLF.
    // Only line endings may differ; all SQL text must still match its hash.
    const source=fs.readFileSync(path.join(root,file),"utf8").replace(/\r\n/g,"\n");
    assert([digest(source),digest(source.replace(/\n/g,"\r\n"))].map(value=>value.toLowerCase()).includes(hash),"Reviewed fresh input changed: "+file);
  }
});
test("cloud adapter removes only the owned outer transaction", () => {
  const s="-- preserved\nBEGIN;\nSELECT 'literal';\nCOMMIT;\n";
  assert.equal(reviewedBody(s),"-- preserved\nSELECT 'literal';\n");
  assert.throws(()=>reviewedBody("BEGIN;\nBEGIN;\nCOMMIT;"));
});
test("fresh local package pins an empty beta target and composes the reviewed full core and current upgrade",()=>{
  const {packageFreshLocal}=require("./lib/beta-local-fresh.cjs"),fresh=packageFreshLocal();
  assert.equal(fresh.upgradeSha256,packageLocal().sha256);
  assert(fresh.sql.includes("Fresh setup requires an empty database"));
  assert(!/^\s*GO\s*$/im.test(fresh.sql));
  assert(fresh.sql.indexOf("@@TRANCOUNT<>0")<fresh.sql.indexOf("IF DB_NAME()"));
});
test("known prior cloud baseline upgrades atomically and populated rerun is a no-op", async () => {
  const f=await fixture();try{
    await f.db.exec(f.sql);await f.db.exec("INSERT INTO fixture_feature VALUES(7)");
    await f.db.exec(f.sql);
    assert.deepEqual((await f.db.query("SELECT * FROM fixture_feature")).rows,[{id:7}]);
    assert.deepEqual((await f.db.query("SELECT * FROM business_sentinel")).rows,[{id:1,value:"retained"}]);
    assert.equal((await f.db.query("SELECT count(*)::int n FROM supabase_migrations.schema_migrations")).rows[0].n,2);
  }finally{await f.db.close();}
});
test("wrong cloud target and unknown ledger refuse before DDL",async()=>{
  const f=await fixture();try{
    const wrong={fingerprint:{...f.snapshot.fingerprint,system_identifier:"other"}};
    await assert.rejects(f.db.exec(renderCloud({snapshot:wrong,source:f.source,query:fixtureQuery}).sql),/WRONG_CLUSTER/);await f.db.exec("ROLLBACK");
    await f.db.exec("INSERT INTO supabase_migrations.schema_migrations VALUES('99999999999999','unknown',NULL)");
    await assert.rejects(f.db.exec(f.sql),/UNRECOGNIZED_BASELINE/);await f.db.exec("ROLLBACK");
    assert.equal((await f.db.query("SELECT to_regclass('fixture_feature') id")).rows[0].id,null);
  }finally{await f.db.close();}
});
test("late postflight failure rolls back DDL and migration-ledger append",async()=>{
  const f=await fixture();try{
    const badSource=f.source.replace("CREATE TABLE public.fixture_feature(id int PRIMARY KEY);","CREATE TABLE public.unexpected_feature(id int PRIMARY KEY);UPDATE business_sentinel SET value='must rollback';");
    await assert.rejects(f.db.exec(renderCloud({snapshot:f.snapshot,source:badSource,query:fixtureQuery}).sql),/POSTFLIGHT_MISMATCH/);await f.db.exec("ROLLBACK");
    assert.equal((await f.db.query("SELECT to_regclass('unexpected_feature') id")).rows[0].id,null);
    assert.equal((await f.db.query("SELECT count(*)::int n FROM supabase_migrations.schema_migrations")).rows[0].n,1);
    assert.equal((await f.db.query("SELECT value FROM business_sentinel")).rows[0].value,"retained");
  }finally{await f.db.close();}
});
