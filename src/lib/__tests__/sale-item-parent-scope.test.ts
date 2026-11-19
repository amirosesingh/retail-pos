import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const { branchPredicate, rendererReadBranchPredicate, comparisonWhere } = require("../../../electron/db/branch-scope.cjs");
const registry = require("../../../database/sqlserver/schema-registry.json");
const source = readFileSync("scripts/generate-supabase-sync-contract.cjs", "utf8");
const helpers = new Function("registry", "excludedColumns", source.slice(source.indexOf("const q = "), source.indexOf("const tables = registry.tables")) +
  ";return {branchPredicate,incomingBranchGuard,feedBranches};")(registry, () => new Set());
const items = registry.tables.find((table: { cloudTable: string }) => table.cloudTable === "sale_items");
const {parentPredicate,parentGuard} = require("../../../scripts/sale-item-sync-scope.cjs");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const postgres = (sql: string) => sql.replace(/dbo\./g, "public.").replace(/\[([^\]]+)\]/g, '"$1"').replace(/N'/g,"'").replace(/@branch/g,"$1");
async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE sales(id uuid PRIMARY KEY,store_id text NOT NULL);
    CREATE TABLE sale_items(id uuid PRIMARY KEY,sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,branch_id text);
    INSERT INTO sales VALUES ('${uuid(1)}','A'),('${uuid(2)}','B');
    INSERT INTO sale_items VALUES ('${uuid(10)}','${uuid(1)}',NULL),('${uuid(11)}','${uuid(1)}',''),
      ('${uuid(12)}','${uuid(1)}','A'),('${uuid(13)}','${uuid(1)}','B'),
      ('${uuid(14)}','${uuid(2)}',NULL),('${uuid(15)}','${uuid(2)}','A');`);
  return db;
}

describe("sale line scope follows its verified sale parent", () => {
  it("keeps native reads, uploads and comparison on the same parent scope without relabeling rows", async () => {
    const db = await fixture();
    try {
      for (const predicate of [branchPredicate(registry,items),rendererReadBranchPredicate(registry,items),comparisonWhere(registry,{...items,retentionClass:"reference"})]) {
        const result = await db.query(`SELECT source.id FROM sale_items source WHERE ${postgres(predicate)} ORDER BY source.id`,["A"]);
        expect(result.rows).toEqual([10,11,12].map(n => ({id:uuid(n)})));
      }
      expect((await db.query(`SELECT branch_id FROM sale_items WHERE id='${uuid(10)}'`)).rows).toEqual([{branch_id:null}]);
      expect(branchPredicate({tables:[items]},items)).toBe("1=0");
    } finally { await db.close(); }
  });

  it("executes the generated cloud predicate and rejects forged or missing upload parents", async () => {
    const db = await fixture();
    try {
      const predicate = parentPredicate("x").replaceAll("p_branch_id","$1");
      expect((await db.query(`SELECT x.id FROM sale_items x WHERE ${predicate} ORDER BY x.id`,["A"])).rows).toEqual([10,11,12].map(n => ({id:uuid(n)})));
      await db.exec(`CREATE FUNCTION fixture_guard(p_rows jsonb,p_branch_id text) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN ${helpers.incomingBranchGuard(items)} ${parentGuard("p_rows")} RETURN p_rows; END $$;`);
      const valid = {id:uuid(20),sale_id:uuid(1),branch_id:null};
      expect((await db.query("SELECT fixture_guard($1::jsonb,'A') rows",[JSON.stringify([valid])])).rows[0].rows).toEqual([{...valid,branch_id:"A"}]);
      for (const row of [{...valid,sale_id:uuid(2)},{...valid,branch_id:"B"},{...valid,sale_id:uuid(99)}])
        await expect(db.query("SELECT fixture_guard($1::jsonb,'A')",[JSON.stringify([row])])).rejects.toThrow("SYNC_BRANCH_FORBIDDEN");
    } finally { await db.close(); }
  });
});
