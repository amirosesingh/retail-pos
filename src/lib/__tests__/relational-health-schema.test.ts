import { expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
it("checks auth and public foreign keys using their real parent schema", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE TABLE public.members(id uuid PRIMARY KEY, auth_user_id uuid REFERENCES auth.users(id));
      CREATE TABLE public.membership_tiers(id uuid PRIMARY KEY);
      ALTER TABLE public.members ADD tier_id uuid REFERENCES public.membership_tiers(id);`);
    await db.exec(readFileSync("supabase/migrations/20261017132000_fix_relational_health_parent_schema.sql", "utf8"));
    const result = await db.query<{ value: { tables: { table: string; links: { parent_table: string; orphans: number }[] }[] } }>(
      `SELECT public.operational_relational_health() AS value`,
    );
    expect(result.rows[0].value.tables.find(t => t.table === "members")?.links)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ parent_table: "users", orphans: 0 }),
        expect.objectContaining({ parent_table: "membership_tiers", orphans: 0 }),
      ]));
  } finally { await db.close(); }
});
