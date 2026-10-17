import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const sql = readFileSync("supabase/migrations/20261017121938_private_approval_tokens.sql", "utf8");
const terminal = "11111111-1111-4111-8111-111111111111";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.app_users(user_id text PRIMARY KEY,permissions jsonb,is_active boolean DEFAULT true,store_id uuid);
    CREATE TABLE public.terminal_tokens(id uuid PRIMARY KEY,revoked_at timestamptz,status text DEFAULT 'active',location_id uuid);
    INSERT INTO public.app_users(user_id) VALUES ('manager'); INSERT INTO public.terminal_tokens(id) VALUES ('${terminal}');`);
  await db.exec(sql);
});
afterAll(async () => {
  await db.close();
});
describe("private approval token SQL", () => {
  it("denies credential RPC and private table access to ordinary clients", async () => {
    const result = await db.query<{
      public_access: boolean;
      anon_access: boolean;
      staff_access: boolean;
      service_access: boolean;
    }>(`SELECT
      has_schema_privilege('authenticated','pos_private','USAGE') public_access,
      has_function_privilege('anon','public.approval_token_state(text,text,uuid,text,bigint)','EXECUTE') anon_access,
      has_function_privilege('authenticated','public.approval_token_state(text,text,uuid,text,bigint)','EXECUTE') staff_access,
      has_function_privilege('service_role','public.approval_token_state(text,text,uuid,text,bigint)','EXECUTE') service_access`);
    expect(result.rows[0]).toEqual({
      public_access: false,
      anon_access: false,
      staff_access: false,
      service_access: true,
    });
  });
  it("updates method switches without removing linked page permissions", async () => {
    await db.query(
      `UPDATE public.app_users SET permissions='{"can_sell":true}'::jsonb WHERE user_id='manager'`,
    );
    await db.query(
      `SELECT public.approval_token_state('set_methods','manager',NULL,'{"pin":false,"totp":true}')`,
    );
    const rows = await db.query<{ permissions: unknown }>(
      `SELECT permissions FROM public.app_users WHERE user_id='manager'`,
    );
    expect(rows.rows[0].permissions).toEqual({
      can_sell: true,
      approval_pin_enabled: false,
      approval_totp_enabled: true,
    });
  });
  it("keeps credential switches when page permissions are replaced", async () => {
    await db.query(`SELECT public.approval_token_state('permissions','manager',NULL,'{"can_view_inventory":true,"approval_pin_enabled":true,"approval_totp_enabled":false}')`);
    const result = await db.query<{ permissions: unknown }>(`SELECT permissions FROM public.app_users WHERE user_id='manager'`);
    expect(result.rows[0].permissions).toEqual({ can_view_inventory: true, approval_pin_enabled: false, approval_totp_enabled: true });
  });
  it("filters branch bundles by user scope, active status and issuer registration", async () => {
    const branch = "22222222-2222-4222-8222-222222222222";
    const other = "33333333-3333-4333-8333-333333333333";
    await db.query(`SELECT public.approval_token_state('enroll','manager',$1,$2)`, [terminal, "a".repeat(60)]);
    await db.query(`UPDATE public.app_users SET store_id=$1 WHERE user_id='manager'`, [branch]);
    await db.query(`UPDATE public.terminal_tokens SET location_id=$1 WHERE id=$2`, [branch, terminal]);
    const read = async (id: string) => (await db.query<{value: unknown[]}>(`SELECT public.approval_token_state('read_branch',$1) AS value`, [id])).rows[0].value;
    expect(await read(branch)).toHaveLength(1);
    expect(await read(other)).toEqual([]);
    await db.query(`UPDATE public.terminal_tokens SET revoked_at=now() WHERE id=$1`, [terminal]);
    expect(await read(branch)).toEqual([]);
    await db.query(`UPDATE public.terminal_tokens SET revoked_at=NULL WHERE id=$1`, [terminal]);
    await db.query(`UPDATE public.app_users SET is_active=false WHERE user_id='manager'`);
    expect(await read(branch)).toEqual([]);
    await db.query(`UPDATE public.app_users SET is_active=true,store_id=NULL WHERE user_id='manager'`);
    expect(await read(other)).toHaveLength(1);
    await db.query(`SELECT public.approval_token_state('revoke','manager')`);
  });
  it("keeps concurrent enrollment idempotent and atomically rejects replay", async () => {
    const enroll = (secret: string) =>
      db.query<{ value: { id: string; secret_ciphertext: string } }>(
        `SELECT public.approval_token_state('enroll','manager',$1,$2) AS value`,
        [terminal, secret],
      );
    const first = await enroll("a".repeat(60));
    const second = await enroll("b".repeat(60));
    expect(second.rows[0].value).toEqual(first.rows[0].value);
    const consume = (step: number) =>
      db.query<{ value: boolean }>(
        `SELECT public.approval_token_state('consume','manager',$1,NULL,$2) AS value`,
        [terminal, step],
      );
    expect((await consume(20)).rows[0].value).toBe(true);
    expect((await consume(20)).rows[0].value).toBe(false);
    expect((await consume(19)).rows[0].value).toBe(false);
    expect((await consume(21)).rows[0].value).toBe(true);
    await db.query(`SELECT public.approval_token_state('revoke','manager')`);
    expect((await consume(22)).rows[0].value).toBe(false);
  });
});
