#!/usr/bin/env node
/** Real SQL Server reads against session-scoped #fixtures only; never a POS database. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync, spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const { runInNewContext } = require("node:vm");

const root = path.resolve(__dirname, "..");
const BASELINE = "33f1996e649e9b601d0f7d8f5a8485554b877cdc";
const usage = "node scripts/test-sqlserver-catalogue-collation.cjs --server LOCALHOST\\INSTANCE [--sqlcmd PATH]";
const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) { console.log(usage); process.exit(0); }
const options = {};
for (let index = 0; index < args.length; index += 2) {
  if (!["--server", "--sqlcmd"].includes(args[index]) || !args[index + 1]) throw new Error(usage);
  if (Object.hasOwn(options, args[index])) throw new Error("Duplicate option");
  options[args[index]] = args[index + 1];
}
const server = options["--server"];
if (!server || !/^(?:[\w.-]+|\(local\))(?:\\[\w-]+)?$/.test(server)) throw new Error("A local SQL Server instance is required.");
const host = server.split("\\")[0].toLowerCase();
if (![".", "(local)", "localhost", "127.0.0.1", os.hostname().toLowerCase()].includes(host)) throw new Error("External database servers are forbidden by this isolated harness.");
const sqlcmd = options["--sqlcmd"] || "C:\\Program Files\\Microsoft SQL Server\\Client SDK\\ODBC\\180\\Tools\\Binn\\SQLCMD.EXE";
if (!/^sqlcmd(?:\.exe)?$/i.test(path.basename(sqlcmd)) || !fs.existsSync(sqlcmd)) throw new Error("Pass the installed sqlcmd executable, without credentials.");
const baseline = execFileSync("git", ["show", `${BASELINE}:electron/db/catalogue-scope.cjs`], { cwd: root, encoding: "utf8" });
const current = fs.readFileSync(path.join(root, "electron/db/catalogue-scope.cjs"), "utf8");
const tableNames = ["products", "stores", "pos_settings", "settings_scoped", "stock_transfers", "stock_transfer_items"];
const sqlTypes = { id: "uuid", product_id: "uuid", transfer_id: "uuid", deleted_at: "timestamptz", posted_at: "timestamptz", private_catalogue: "boolean", quantity_verified: "numeric", quantity_received: "numeric", stock_quantity: "numeric" };
const columns = {
  products: ["id", "name", "owner_store_id", "stock_by_store", "catalogue_store_ids", "stock_quantity", "deleted_at"],
  stores: ["id", "group_id", "private_catalogue"], pos_settings: ["id", "integration_settings"],
  settings_scoped: ["scope", "scope_id", "key", "value"],
  stock_transfers: ["id", "to_store_id", "status", "posted_at"],
  stock_transfer_items: ["transfer_id", "product_id", "quantity_verified", "quantity_received"],
};
const registry = { tables: tableNames.map(name => ({ cloudTable: name, sqlServerTable: name, scope: "branch", columns: columns[name].map(column => ({ cloudColumn: column, sqlServerColumn: column, cloudType: sqlTypes[column] || "text", primaryKey: column === "id" })) })) };
function moduleAt(filename, overrides = {}) {
  const code = fs.readFileSync(filename, "utf8"); const localRequire = createRequire(filename); const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, require: name => overrides[name] || localRequire(name), setImmediate }, { filename });
  return module.exports;
}
function helperFrom(code) { const module = { exports: {} }; runInNewContext(code, { module, exports: module.exports }); return module.exports; }
async function captureReads(helper) {
  const branch = moduleAt(path.join(root, "electron/db/branch-scope.cjs"), { "./catalogue-scope.cjs": helper });
  const { OperationsRepository } = moduleAt(path.join(root, "electron/db/repositories/operations.cjs"), { "../catalogue-scope.cjs": helper, "../branch-scope.cjs": branch });
  const captured = [];
  let stop = false;
  class Request {
    constructor() { this.inputs = {}; }
    input(name, value) { this.inputs[name] = value; return this; }
    async query(sql) { captured.push({ sql, inputs: this.inputs }); if (stop) throw new Error("FIXTURE_READ_CAPTURED"); return { recordset: [] }; }
  }
  class Transaction { async begin() {} async commit() {} async rollback() {} }
  const manager = { pool: { request: () => new Request() }, sql: () => ({ Request, Transaction, ISOLATION_LEVEL: { READ_COMMITTED: 2 } }) };
  const repo = new OperationsRepository(manager, registry);
  await repo.snapshotRows("products", "a");
  await repo.query("a", "products", { limit: 100 });
  stop = true;
  await assert.rejects(repo.applyOperation({}, { kind: "update", table: "products", match: { id: productId(1) }, values: { stock_quantity: 1, stock_by_store: { a: 1 } } }, { branchId: "a", enforcePermissions: true, productWriteKind: "sale", financialStockDeltas: new Map([[productId(1), -1]]) }), /FIXTURE_READ_CAPTURED/);
  assert.equal(captured.length, 3);
  for (const read of captured) assert.match(read.sql, /^SELECT /);
  return captured;
}
function fixtureSQL(sql) {
  const rewritten = sql.replace(/\bdbo\.\[?([A-Za-z_][A-Za-z0-9_]*)\]?/g, (_match, table) => {
    if (!tableNames.includes(table)) throw new Error(`Unexpected business table: ${table}`);
    return `#sql07_${table}`;
  });
  if (/\b(?:dbo|public)\s*\.|\b(?:CREATE|ALTER|DROP)\s+DATABASE\b|\bUSE\s+/i.test(rewritten)) throw new Error("Unsafe fixture namespace");
  return rewritten;
}
function literal(value) { return value == null ? "NULL" : `N'${String(value).replaceAll("'", "''")}'`; }
function productId(number) { return `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`; }
const products = [
  ["own_a", "a", { a: 2 }], ["sibling_b", "b", { b: 1 }], ["foreign_c", "c", { c: 9 }],
  ["stock_a", null, { a: 1.5 }], ["negative_b", null, { b: -1 }], ["stock_c", null, { c: 2 }],
  ["zero_a", null, { a: 0 }], ["empty", null, {}], ["posted_b", "c", {}],
  ["pending_b", "c", {}], ["zero_transfer_b", "c", {}], ["cached_b", "c", {}, ["b"]],
  ["cached_unknown", "c", {}, ["missing"]], ["invalid_json", null, "not json", "not json"],
  ["case_a", "A", {}], ["accent_other", "á", {}], ["own_u", "u", {}], ["own_v", "v", {}],
  ["own_p", "p", {}], ["cancelled_b", "c", {}], ["cached_c", "c", {}, ["c"]],
  ["null_json", null, null, null],
];
function setup(collation) {
  assert(["SQL_Latin1_General_CP1_CI_AS", "Latin1_General_BIN2"].includes(collation));
  const text = `nvarchar(450) COLLATE ${collation}`, json = `nvarchar(max) COLLATE ${collation}`;
  return `SET NOCOUNT ON; SET XACT_ABORT ON;
IF DB_NAME()<>N'tempdb' THROW 51000,N'Only tempdb fixture context is allowed',1;
PRINT N'Fixture DATABASE_DEFAULT='+CONVERT(nvarchar(128),DATABASEPROPERTYEX(DB_NAME(),N'Collation'));
CREATE TABLE #sql07_products(id uniqueidentifier PRIMARY KEY,name ${text},owner_store_id ${text} NULL,stock_by_store ${json},catalogue_store_ids ${json},stock_quantity decimal(38,8),deleted_at datetimeoffset NULL);
CREATE TABLE #sql07_stores(id ${text} PRIMARY KEY,group_id ${text} NULL,private_catalogue bit);
CREATE TABLE #sql07_pos_settings(id int PRIMARY KEY,integration_settings ${json});
CREATE TABLE #sql07_settings_scoped(scope ${text},scope_id ${text},[key] ${text},[value] ${json});
CREATE TABLE #sql07_stock_transfers(id uniqueidentifier PRIMARY KEY,to_store_id ${text},status ${text},posted_at datetimeoffset NULL);
CREATE TABLE #sql07_stock_transfer_items(transfer_id uniqueidentifier,product_id uniqueidentifier,quantity_verified decimal(38,8) NULL,quantity_received decimal(38,8) NULL);
INSERT #sql07_stores VALUES(N'a',N'g1',0),(N'b',N'g1',0),(N'c',N'g2',0),(N'á',N'g2',0),(N'u',NULL,0),(N'v',NULL,0),(N'p',NULL,1);
INSERT #sql07_pos_settings VALUES(1,N'{}');
INSERT #sql07_products VALUES ${products.map(([name, owner, stock, cached], index) => `('${productId(index + 1)}',${literal(name)},${literal(owner)},${literal(stock == null ? null : typeof stock === "string" ? stock : JSON.stringify(stock))},${literal(cached === null ? null : typeof cached === "string" ? cached : JSON.stringify(cached || []))},2,NULL)`).join(",\n")};
INSERT #sql07_stock_transfers VALUES('${productId(101)}',N'b',N'completed',SYSDATETIMEOFFSET()),('${productId(102)}',N'b',N'approved',NULL),('${productId(103)}',N'b',N'completed',SYSDATETIMEOFFSET()),('${productId(104)}',N'b',N'cancelled',SYSDATETIMEOFFSET());
INSERT #sql07_stock_transfer_items VALUES('${productId(101)}','${productId(9)}',2,2),('${productId(102)}','${productId(10)}',2,2),('${productId(103)}','${productId(11)}',0,2),('${productId(104)}','${productId(20)}',2,2);
DECLARE @branch nvarchar(450)=N'a',@offset int=0,@limit int=2000,@product uniqueidentifier='${productId(1)}',@actual nvarchar(max),@projectionLength int;
`;
}
function expectedQuery(query, expected, name) {
  const wanted = [...expected].sort().join(",");
  const projection = query.includes("AS [_catalogue_store_ids]");
  return `SELECT ${projection ? "@projectionLength=COALESCE(SUM(LEN(visible.[_catalogue_store_ids])),0)," : ""}@actual=COALESCE(STRING_AGG(CONVERT(nvarchar(max),visible.name),N',') WITHIN GROUP(ORDER BY visible.name),N'') FROM (${fixtureSQL(query).replace(/;\s*$/, "")}) visible;
IF @actual<>${literal(wanted)} THROW 51000,${literal(`Unexpected catalogue: ${name}`)},1;
${projection ? `IF @projectionLength<${expected.length * 2} THROW 51000,N'Catalogue projection was not read',1;` : ""}
PRINT ${literal(`PASS ${name}`)};\n`;
}
async function main() {
  const oldHelper = helperFrom(baseline), helper = helperFrom(current);
  const oldReads = await captureReads(oldHelper), reads = await captureReads(helper);
  const visibleA = ["own_a", "sibling_b", "stock_a", "negative_b", "posted_b", "cached_b", "case_a"];
  const cache = path.join(root, "node_modules", ".cache", "sql07-collation"); fs.mkdirSync(cache, { recursive: true });
  for (const collation of ["SQL_Latin1_General_CP1_CI_AS", "Latin1_General_BIN2"]) {
    let sql = setup(collation);
    if (collation === "SQL_Latin1_General_CP1_CI_AS") {
      sql += `BEGIN TRY
EXEC sys.sp_executesql ${literal(`SELECT COUNT(*) FROM #sql07_products source WHERE ${fixtureSQL(oldHelper.catalogueReadPredicate(registry))}`)},N'@branch nvarchar(450)',@branch=@branch;
THROW 51000,N'Baseline catalogue unexpectedly avoided collation error 468',1;
END TRY BEGIN CATCH
IF ERROR_NUMBER()<>468 THROW;
PRINT N'PASS prepatch actual predicate reproduces SQL Server 468'; END CATCH;\n`;
    }
    const select = `SELECT source.* FROM dbo.[products] source WHERE ${helper.catalogueReadPredicate(registry)}`;
    sql += expectedQuery(select, visibleA, `${collation}: same/sibling/stock/transfer/cached catalogue`);
    sql += `SET @branch=N'A';\n` + expectedQuery(select, visibleA, `${collation}: case-folded branch identity`);
    sql += `SET @branch=N'c';\n` + expectedQuery(select, ["foreign_c", "stock_c", "posted_b", "pending_b", "zero_transfer_b", "cached_b", "cached_unknown", "accent_other", "cancelled_b", "cached_c"], `${collation}: foreign cluster stays separate`);
    sql += `SET @branch=N'missing';\n` + expectedQuery(select, [], `${collation}: unknown branch denied`);
    sql += `SET @branch=NULL;\n` + expectedQuery(select, [], `${collation}: null branch denied`);
    sql += `SET @branch=N'u';\n` + expectedQuery(select, ["own_u", "own_v"], `${collation}: ungrouped shared legacy ownership`);
    sql += `SET @branch=N'p';\n` + expectedQuery(select, ["own_p"], `${collation}: ungrouped private catalogue excludes other owners`);
    sql += `SET @branch=N'a';\n`;
    sql += expectedQuery(reads[0].sql, visibleA, `${collation}: actual Operations.snapshotRows product page`);
    sql += expectedQuery(reads[1].sql, visibleA, `${collation}: actual Operations.query catalogue page`);
    sql += expectedQuery(reads[2].sql, ["own_a"], `${collation}: actual locked checkout stock read`);
    sql += `SET @product='${productId(3)}';\n` + expectedQuery(reads[2].sql, [], `${collation}: locked checkout read denies foreign product`);
    sql += `UPDATE #sql07_stores SET group_id=NULL WHERE group_id=N'g2';\nSET @branch=N'a';\n`;
    const legacyA = [...visibleA, "stock_c", "zero_a", "empty", "invalid_json", "null_json"];
    sql += expectedQuery(select, legacyA, `${collation}: one-cluster shared legacy products`);
    sql += `UPDATE #sql07_pos_settings SET integration_settings=N'{"branches":{"a":{"privateCatalogue":true}}}';\n` + expectedQuery(select, visibleA, `${collation}: JSON private-catalogue flag`);
    sql += `UPDATE #sql07_pos_settings SET integration_settings=N'not json'; INSERT #sql07_settings_scoped VALUES(N'GLOBAL',N'',N'pos_field:integration_settings',N'{"branches":{"a":{"privateCatalogue":true}}}');\n` + expectedQuery(select, visibleA, `${collation}: scoped JSON private-catalogue flag`);
    sql += `DELETE FROM #sql07_settings_scoped; UPDATE #sql07_stores SET private_catalogue=1 WHERE id=N'a';\n` + expectedQuery(select, visibleA, `${collation}: persisted branch private-catalogue flag`);
    sql += `PRINT N'ALL ${collation} TEMPDB FIXTURES PASSED';\n`;
    const file = path.join(cache, `${collation}.sql`); fs.writeFileSync(file, "\ufeff" + sql, "utf8");
    const result = spawnSync(sqlcmd, ["-S", server, "-E", "-C", "-d", "tempdb", "-X1", "-x", "-b", "-l", "8", "-t", "30", "-i", file, "-r1", "-h-1", "-w", "65535"], { encoding: "utf8", timeout: 45000, windowsHide: true });
    process.stdout.write(result.stdout || ""); process.stderr.write(result.stderr || "");
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Temporary SQL fixtures failed (${collation}); exit ${result.status}`);
  }
  assert(oldReads[0].sql.includes("_catalogue_store_ids"));
  console.log("Real SQL Server catalogue/snapshot/checkout-read fixtures passed. No existing database/schema/data was changed.");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
