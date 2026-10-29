import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
const { branchPredicate, rendererReadBranchPredicate, scopedWhere } = createRequire(import.meta.url)("../../../electron/db/branch-scope.cjs");
const column = (name: string) => ({ cloudColumn: name, sqlServerColumn: name });
const products = { cloudTable: "products", sqlServerTable: "products", columns: [column("id"), column("owner_store_id")] };
const promotions = { cloudTable: "promotions", sqlServerTable: "promotions", columns: [column("id"), { ...column("foc_product_id"), foreignKey: true, foreignKeyTarget: { table: "products", column: "id" } }] };
const registry = { tables: [products, promotions] };
// Execute the generated predicates against isolated rows. Only the SQL Server
// identifier/string/parameter syntax is adapted; the predicate is unchanged.
const postgres = (sql: string) => sql.replace(/dbo\./g, "").replace(/\[([^\]]+)\]/g, '"$1"').replace(/N'/g, "'").replace(/@branch/g, "$1");

it("reads and reconciles ordinary/shared promotions without exposing another branch's linked product", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE products(id text, owner_store_id text); CREATE TABLE promotions(id text, foc_product_id text);
      INSERT INTO products VALUES ('shared',NULL),('own','a'),('other','b');
      INSERT INTO promotions VALUES ('ordinary',NULL),('shared','shared'),('own','own'),('other','other'),('missing','missing');`);
    for (const predicate of [branchPredicate(registry, promotions), scopedWhere(registry, promotions)]) {
      const result = await db.query(`SELECT source.id FROM promotions source WHERE ${postgres(predicate)} ORDER BY source.id`, ["a"]);
      expect(result.rows).toEqual([{ id: "ordinary" }, { id: "own" }, { id: "shared" }]);
    }
    // An old registry without a branch/cluster directory cannot establish that
    // an ownerless product belongs to this company. Ordinary promotions remain.
    const read = await db.query(`SELECT source.id FROM promotions source WHERE ${postgres(rendererReadBranchPredicate(registry, promotions))} ORDER BY source.id`, ["a"]);
    expect(read.rows).toEqual([{ id: "ordinary" }, { id: "own" }]);
  } finally { await db.close(); }
});

it("compares mirrored PIN attempts while retaining native lockout rows untouched", async () => {
  const db = new PGlite();
  try {
    const table = { cloudTable: "pin_attempts", sqlServerTable: "pin_attempts", columns: [column("key")] };
    await db.exec(`CREATE TABLE pin_attempts(key text, attempts int);
      INSERT INTO pin_attempts VALUES ('server:a',2),('electron:terminal:a:person',5),('approval-lookup:a',5);`);
    const result = await db.query(`SELECT source.key FROM pin_attempts source WHERE ${postgres(scopedWhere(registry, table))}`);
    expect(result.rows).toEqual([{ key: "server:a" }]);
    expect((await db.query("SELECT attempts FROM pin_attempts WHERE attempts=5")).rows).toHaveLength(2);
  } finally { await db.close(); }
});
