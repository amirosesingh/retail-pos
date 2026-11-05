import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { CASHIER_PERMISSIONS, SUPERVISOR_PERMISSIONS } from "../permissions";
it("seeds missing roles idempotently without replacing a saved preset", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table staff_roles(slug text primary key,name text,base_level text,permissions jsonb,is_core boolean);insert into staff_roles values('cashier','My cashier','cashier','{"can_process_sale":false}',true);`);
    const migration = readFileSync("supabase/migrations/20261026110000_seed_missing_staff_role_defaults.sql", "utf8");
    await db.exec(migration); await db.exec(migration);
    const { rows } = await db.query<{slug:string;permissions:Record<string,boolean>}>("select slug,permissions from staff_roles order by slug");
    expect(rows).toHaveLength(5);
    expect(rows.find(row => row.slug === "cashier")?.permissions).toEqual({can_process_sale:false});
    expect(rows.find(row => row.slug === "manager")?.permissions).toEqual(SUPERVISOR_PERMISSIONS);
    await db.exec("delete from staff_roles where slug='cashier'"); await db.exec(migration);
    expect((await db.query<{permissions:unknown}>("select permissions from staff_roles where slug='cashier'")).rows[0].permissions).toEqual(CASHIER_PERMISSIONS);
  } finally { await db.close(); }
});
