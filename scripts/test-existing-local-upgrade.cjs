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

test("the standalone025–030 file is deterministic and carries no runtime/source-file dependency",()=>{
 const {packageUpgrade,outputPath}=require('./package-existing-local-upgrade.cjs'),built=packageUpgrade();
 assert.equal(readFileSync(outputPath,'utf8'),built.sql);
 assert.deepEqual(built.sources.map(s=>s.id.slice(0,3)),['025','026','027','028','029','030']);
 assert.doesNotMatch(built.sql,/^\s*(?:GO|USE\s|CREATE\s+DATABASE|:r\s)/im);
 assert.doesNotMatch(built.sql,/Module 031|SET\s+CHANGE_TRACKING|UPDATE\s+dbo\.\[?products/i);
 assert.match(built.sql,/IF NOT\(OBJECT_ID/);
 assert.match(built.sql,/Unrecognized 026_shift_financial_operations/);
 assert.ok(/HASHBYTES\(''SHA2_256'',CONVERT\(varbinary\(max\)/.test(built.sql),'Nested batch retains SHA256 validation');
 assert.match(built.sql,/FOR JSON PATH,INCLUDE_NULL_VALUES/);
 assert.equal(packageUpgrade().sha256,built.sha256);
 assert.equal(built.sql.includes('\r'),false,'Distributed SQL is LF-only without normalizing SQL literal contents');
});

test("catalogue recognition preserves literals and distinguishes inherited collation from explicit BIN2",()=>{
 const {validationSql,fields,manifestFingerprint,fingerprintAlgorithm}=require('./lib/local-upgrade-catalogue.cjs');
 const shape={selectors:{tables:['fixture']},...Object.fromEntries(Object.keys(fields).map(k=>[k,[]]))};
 const row=name=>Object.fromEntries(fields[name].split(',').map(value=>{const[key,type]=value.split(':');return[key,type==='s'?null:0];}));
 shape.columns=[{...row('columns'),table_name:'fixture',name:'plain',collation:'$DATABASE_DEFAULT'},{...row('columns'),table_name:'fixture',name:'proof',collation:'Latin1_General_100_BIN2'}];
 shape.checks=[{...row('checks'),table_name:'fixture',name:'literal',definition:"([value]='Two  Spaces AND UPPER')"}];
 shape.fingerprintAlgorithm=fingerprintAlgorithm;shape.fingerprints=Object.fromEntries(Object.keys(fields).map(name=>[name,manifestFingerprint(shape,name)]));
 const sql=validationSql(shape,'owned fixture');assert.match(shape.checks[0].definition,/Two  Spaces AND UPPER/);assert.match(sql,/\$DATABASE_DEFAULT/);assert.match(sql,/Latin1_General_100_BIN2/);
 assert.match(sql,/c\.collation_name=CONVERT\(sysname,DATABASEPROPERTYEX/);
 assert.doesNotMatch(sql,/LOWER\(|REPLACE\([^\n]*N' '/i);
 assert.throws(()=>validationSql({...shape,selectors:{tables:['fixture;DROP']}},'bad'));
 for(const value of ["([value]='Two Spaces AND UPPER')","([value]='Two  Spaces and UPPER')",null]){
  const changed=structuredClone(shape);changed.checks[0].definition=value;assert.throws(()=>validationSql(changed,'changed'),/mismatch/);
 }
 const missing=structuredClone(shape);delete missing.checks[0].definition;assert.throws(()=>validationSql(missing,'missing'));
});

test("SQL structural newline variants preserve quoted values, identifiers and escaped quotes",()=>{
 const {structuralNewlines}=require('./lib/local-upgrade-catalogue.cjs');
 const source="SELECT\r\n N'a\r\nb',N'it''s\r\nexact',[a\r\nb],\"a\r\nb\";\r\n-- 'comment only\r\n/* ' nested /* x */ */\r\n";
 const lf=structuralNewlines(source);assert.equal(lf,"SELECT\n N'a\r\nb',N'it''s\r\nexact',[a\r\nb],\"a\r\nb\";\n-- 'comment only\n/* ' nested /* x */ */\n");
 assert.equal(structuralNewlines(lf,'\r\n'),source);
 assert.notEqual(structuralNewlines("DEFAULT(N'a\r\nb')"),structuralNewlines("DEFAULT(N'a\nb')"));
 const {canonical}=require('./lib/existing-local-upgrade.cjs');
 assert.notEqual(canonical("SELECT N'a\r\nb';"),canonical("SELECT N'a\nb';"),'Module canonicalization must retain literal bytes too');
 assert.throws(()=>structuralNewlines("SELECT N'unterminated"));
});

test('quoted module CR bytes use MAX-width reconstruction in an LF-only artifact',()=>{
 const text="BEGIN TRANSACTION;\nCREATE TABLE dbo.cr(id int,value nvarchar(max));\nINSERT dbo.cr VALUES(1,N'"+'x'.repeat(3000)+"\r\n"+'y'.repeat(3000)+"');\nCOMMIT;\n";
 const built=render([moduleFor('028_cr',text)]);
 assert.equal(built.sql.includes('\r'),false);
 assert.ok(built.sql.includes("CONVERT(nvarchar(max),N''''"));
 assert.ok(built.sql.includes('NCHAR(13)'));
});
