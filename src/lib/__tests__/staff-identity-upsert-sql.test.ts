import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const original = readFileSync("supabase/migrations/20261019102437_staff_login_alias_and_profile_edit.sql", "utf8");
const fix = readFileSync("supabase/migrations/20261020061456_fix_staff_identity_upsert_guard.sql", "utf8");
const profileId = "11111111-1111-4111-8111-111111111111";
const authId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
let db: PGlite;

// Match the real staff_account_upsert conflict path without touching Auth or
// requiring pgcrypto. The production routine keeps the stored PIN when omitted.
const upsert = (id = authId, auth: string | null = authId, alias: string | null = null, username = "cashier") =>
  db.query(`INSERT INTO app_users(id,user_id,auth_user_id,login_username,is_active)
    VALUES ($1,$2,$3,$4,true) ON CONFLICT(user_id) DO UPDATE SET is_active=EXCLUDED.is_active`,
  [id, username, auth, alias]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE app_users(id uuid PRIMARY KEY,user_id text UNIQUE NOT NULL,
      auth_user_id uuid,login_username text,is_active boolean,store_id text,
      permissions jsonb,pin_hash text);`);
  await db.exec(original.slice(original.indexOf("CREATE OR REPLACE FUNCTION public.guard_staff_login_identity"),
    original.indexOf("CREATE OR REPLACE FUNCTION public.staff_login_available")));
});
beforeEach(async () => {
  await db.exec("TRUNCATE app_users");
  await db.exec(fix);
  await db.query(`INSERT INTO app_users VALUES($1,'cashier',$2,'cashier-alias',false,
    'branch-1','{"can_sell":true,"can_manage_staff":false}','existing-secret-hash')`, [profileId, authId]);
});
afterAll(async () => { await db.close(); });

describe("staff creation and activation identity guard", () => {
  it("reproduces the old rejection then repairs the same-account upsert", async () => {
    await db.exec(original.slice(original.indexOf("CREATE OR REPLACE FUNCTION public.guard_staff_login_identity"),
      original.indexOf("DROP TRIGGER IF EXISTS guard_staff_login_identity")));
    await expect(upsert()).rejects.toThrow("That username is already in use");
    await db.exec(fix);
    await upsert();
    const { rows } = await db.query("SELECT * FROM app_users WHERE user_id='cashier'");
    expect(rows[0]).toEqual({
      id: profileId, user_id: "cashier", auth_user_id: authId, login_username: "cashier-alias",
      is_active: true, store_id: "branch-1",
      permissions: { can_sell: true, can_manage_staff: false }, pin_hash: "existing-secret-hash",
    });
  });
  it("allows a fresh identity and repeated save without a second credential", async () => {
    await upsert(otherId, otherId, null, "new-user");
    await upsert(otherId, otherId, null, "new-user");
    expect((await db.query("SELECT count(*)::int AS n FROM app_users")).rows[0]).toEqual({ n: 2 });
  });
  it("still accepts accounts whose profile ID already equals their Auth ID", async () => {
    await db.query("UPDATE app_users SET id=$1 WHERE user_id='cashier'", [authId]);
    await upsert();
  });
  it.each([otherId, null])("rejects the existing username with a different or absent Auth identity: %s", async auth => {
    await expect(upsert(otherId, auth)).rejects.toThrow("That username is already in use");
  });
  it("does not adopt a legacy row with a missing Auth identity", async () => {
    await db.exec("UPDATE app_users SET auth_user_id=NULL WHERE user_id='cashier'");
    await expect(upsert()).rejects.toThrow("That username is already in use");
  });
  it("rejects another user's alias even when the proposed insert matches its own account", async () => {
    await upsert(otherId, otherId, "reserved", "other-user");
    await expect(upsert(authId, authId, "RESERVED")).rejects.toThrow("That username is already in use");
  });
  it("rejects a case-variant conflict key that would insert a separate row", async () => {
    await expect(upsert(authId, authId, null, "CASHIER")).rejects.toThrow("That username is already in use");
  });
  it("rejects another account taking an existing username or alias", async () => {
    await expect(upsert(otherId, otherId, "cashier", "new-user")).rejects.toThrow("That username is already in use");
    await expect(upsert(otherId, otherId, "CASHIER-ALIAS", "new-user")).rejects.toThrow("That username is already in use");
  });
  it("retains alias validation and update collision checks", async () => {
    await expect(upsert(authId, authId, "bad alias")).rejects.toThrow("STAFF_LOGIN_USERNAME_INVALID");
    await upsert(otherId, otherId, null, "other-user");
    await expect(db.exec("UPDATE app_users SET login_username='cashier' WHERE user_id='other-user'"))
      .rejects.toThrow("That username is already in use");
  });
  it("keeps direct execution unavailable to ordinary clients", async () => {
    const { rows } = await db.query(`SELECT
      has_function_privilege('anon','public.guard_staff_login_identity()','EXECUTE') AS anon,
      has_function_privilege('authenticated','public.guard_staff_login_identity()','EXECUTE') AS authenticated`);
    expect(rows[0]).toEqual({ anon: false, authenticated: false });
  });
});
