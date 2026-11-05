const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { digest, nestedModule, renderExistingLocalUpgrade } = require("./lib/existing-local-upgrade.cjs");
const moduleFor = (id, sql, standaloneGuard = false) => ({ id, sql, sha256: digest(sql), standaloneGuard });
const fixture = moduleFor("028_fixture", "SET XACT_ABORT ON;\nBEGIN TRANSACTION;\nCREATE TABLE dbo.fixture(id int NOT NULL);\nCOMMIT;\n");
const render = modules => renderExistingLocalUpgrade({ version: "1.4.82", modules, coreValidation: "IF OBJECT_ID(N'dbo.products',N'U') IS NULL THROW 51028,'Missing core',1;" });

test("one outer batch preserves individually owned transactions and quotes module literals", () => {
  const out = render([fixture]);
  assert.match(out.sql, /BEGIN TRY\n BEGIN TRANSACTION/);
  assert.match(out.sql, /sp_getapplock/);
  assert.match(out.sql, /EXEC sys.sp_executesql N'SET XACT_ABORT ON;\nBEGIN TRANSACTION;/);
  assert.match(out.sql, /IF XACT_STATE\(\)<>0 ROLLBACK TRANSACTION;\n THROW;/);
  assert.ok(out.sql.indexOf("IF @@TRANCOUNT<>0") < out.sql.indexOf("SET XACT_ABORT ON"));
  assert.equal(out.sha256, digest(out.sql));
  assert.deepEqual(out, render([fixture]));
});
test("reviewed bytes and module dependency identities are mandatory", () => {
  assert.throws(() => render([{ ...fixture, sql: fixture.sql + "--changed" }]), /bytes changed/);
  assert.throws(() => render([fixture, fixture]), /Duplicate/);
  assert.throws(() => render([moduleFor("030_later", fixture.sql), fixture]), /order/);
  assert.throws(() => render([{ ...fixture, id: "../../secret" }]), /identity/);
});
test("Windows and LF checkouts produce identical upgrade bytes while raw source hashes remain inspectable", () => {
  const windows = moduleFor(fixture.id, fixture.sql.replaceAll("\n", "\r\n"));
  const lf = render([fixture]), crlf = render([windows]);
  assert.equal(lf.sql, crlf.sql); assert.equal(lf.sha256, crlf.sha256);
  assert.notEqual(lf.sources[0].rawHash, crlf.sources[0].rawHash);
  assert.equal(lf.sources[0].canonicalHash, crlf.sources[0].canonicalHash);
});
test("unreviewed database switches, privilege changes and broken transaction modules are rejected", () => {
  for (const statement of ["USE POS_Local;", "ALTER DATABASE POS_Local SET READ_ONLY;", "GRANT SELECT TO public;", "COMMIT;", "RETURN;", "GO\n"])
    assert.throws(() => render([moduleFor("028_fixture", fixture.sql + statement)]));
});
test("only the declared initial standalone guard can be removed", () => {
  const source = "-- owned metadata\nIF @@TRANCOUNT<>0\nBEGIN\n RAISERROR('No caller transaction.',16,1);\n RETURN;\nEND;\n" + fixture.sql;
  const prepared = nestedModule(moduleFor("028_fixture", source, true));
  assert.equal(prepared.body, "-- owned metadata\n" + fixture.sql);
  assert.throws(() => nestedModule(moduleFor("028_fixture", source)), /Declare/);
  assert.throws(() => nestedModule({ ...fixture, standaloneGuard: true }), /Unexpected/);
  assert.throws(() => nestedModule(moduleFor("028_fixture", "SELECT 1;\n" + source, true)), /Unexpected/);
});
test("the three already reviewed financial/sharing modules compose without editing their shape guards", () => {
  const names = ["025_shift_financial_bases", "026_shift_financial_operations", "027_shift_branch_sharing"];
  const modules = names.map(id => moduleFor(id, readFileSync("database/sqlserver/prepared/" + id + ".sql", "utf8"), true));
  const out = render(modules);
  for (const module of modules) {
    const prepared = nestedModule(module);
    assert.ok(out.sql.includes(prepared.canonicalHash));
    assert.equal(out.sources.find(source => source.id === module.id).rawHash, module.sha256);
  }
  assert.match(out.sql, /Financial proofs are immutable/);
  assert.match(out.sql, /shift-sharing column has an unexpected definition/);
  assert.equal(out.sources.length, 3);
});
