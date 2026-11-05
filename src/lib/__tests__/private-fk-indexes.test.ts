import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20261026075533_index_private_foreign_keys.sql", "utf8");
it("indexes optional private foreign keys idempotently without altering data or RLS", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA admin_portal; CREATE SCHEMA pos_private;
      CREATE TABLE admin_portal.activation_events(id integer,activation_id integer,actor_id integer);
      CREATE TABLE admin_portal.activations(id integer,admin_user_id integer);
      CREATE TABLE pos_private.approval_tokens(id integer,terminal_id integer);
      ALTER TABLE pos_private.approval_tokens ENABLE ROW LEVEL SECURITY;
      INSERT INTO pos_private.approval_tokens VALUES(1,2);`);
    await db.exec(migration);
    await db.exec(migration);
    const indexes = await db.query("SELECT indexname FROM pg_indexes WHERE schemaname IN ('admin_portal','pos_private')");
    expect(indexes.rows).toHaveLength(4);
    expect((await db.query("SELECT * FROM pos_private.approval_tokens")).rows).toEqual([{ id: 1, terminal_id: 2 }]);
    expect((await db.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE oid='pos_private.approval_tokens'::regclass")).rows[0].relrowsecurity).toBe(true);
    expect((await db.query("SHOW lock_timeout")).rows).toEqual([{ lock_timeout: "0" }]);
  } finally { await db.close(); }
});
it("allows a fresh installation without optional administrative schemas", async () => {
  const db = new PGlite();
  try { await expect(db.exec(migration)).resolves.toBeDefined(); }
  finally { await db.close(); }
});
