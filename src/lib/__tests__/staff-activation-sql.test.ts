import { afterAll, beforeAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION has_perm(text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE TABLE app_users(user_id text,is_active boolean,updated_at timestamptz);
    CREATE TABLE cashiers(username text,is_active boolean,pin_hash text,store_id text,permissions jsonb);
    INSERT INTO app_users VALUES('cashier',false,now());
    INSERT INTO cashiers VALUES('cashier',false,'existing-hash','branch-a','{"can_sell":true}');`);
  const schema = readFileSync("supabase/schema.sql", "utf8");
  await db.exec(schema.slice(schema.indexOf("CREATE OR REPLACE FUNCTION public.staff_account_set_active("),
    schema.indexOf("CREATE OR REPLACE FUNCTION public.staff_account_set_pin(")));
});
afterAll(async () => db.close());
it.each([true, false, true])("saves activation %s to both staff and cashier without changing credentials or branch", async active => {
  await db.query("SELECT staff_account_set_active(' CASHIER ', $1)", [active]);
  expect((await db.query("SELECT is_active FROM app_users")).rows).toEqual([{ is_active: active }]);
  expect((await db.query("SELECT * FROM cashiers")).rows).toEqual([{
    username: "cashier", is_active: active, pin_hash: "existing-hash", store_id: "branch-a", permissions: { can_sell: true },
  }]);
});
