import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MEMBERSHIP_TERMS_VERSION, MEMBERSHIP_PRIVACY_VERSION } from "../membership-policies";
let db: PGlite;
const uid = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const signup = { full_name: "Test Member", phone: "+6738123456", terms_accepted: true, terms_version: MEMBERSHIP_TERMS_VERSION, privacy_version: MEMBERSHIP_PRIVACY_VERSION, marketing_consent: false };
const enroll = (profile: Record<string, unknown>) => db.query("select public.membership_portal_enroll_details($1::jsonb)", [JSON.stringify(profile)]);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql as $$ select jsonb_build_object('email', 'member@example.invalid') $$;
    grant usage on schema auth to authenticated;
    create table public.members(id uuid primary key default gen_random_uuid(), auth_user_id uuid unique, member_code text unique, full_name text, email text, phone text unique, address text, country_code text, postal_code text, date_of_birth date, is_verified boolean, verified_at timestamptz, verified_channel text, updated_at timestamptz default now());
    create function public.membership_claim() returns uuid language sql as $$ select id from public.members where auth_user_id = auth.uid() $$;
    create function public.membership_profile_for(p_id uuid) returns jsonb language sql as $$ select jsonb_build_object('id', id, 'phone', phone, 'full_name', full_name) from public.members where id = p_id $$;
    insert into auth.users values ('${uid}', 'member@example.invalid', now()), ('${other}', 'other@example.invalid', now());
  `);
  await db.exec(readFileSync("supabase/membership/migrations/20261017120000_membership_signup_consents.sql", "utf8"));
}, 30_000);
beforeEach(async () => {
  await db.exec("reset role; delete from public.members;");
  await db.query("select set_config('test.uid', $1, false)", [uid]);
});
afterAll(async () => { await db?.close(); });
describe("membership consent migration in PostgreSQL", () => {
  it("aligns database and application policy versions", async () => {
    const result = await db.query<{ policy: unknown }>("select public.membership_signup_policy_version() as policy");
    expect(result.rows[0].policy).toEqual({ terms_version: MEMBERSHIP_TERMS_VERSION, privacy_version: MEMBERSHIP_PRIVACY_VERSION });
  });
  it.each([undefined, false, "true"])("rejects invalid acceptance %s without creating a member", async (terms_accepted) => {
    await expect(enroll({ ...signup, terms_accepted })).rejects.toThrow("MEMBERSHIP_TERMS_ACCEPTANCE_REQUIRED");
    expect((await db.query("select * from public.members")).rows).toHaveLength(0);
  });
  it("rejects outdated policies and malformed marketing choice", async () => {
    await expect(enroll({ ...signup, terms_version: "old" })).rejects.toThrow("MEMBERSHIP_POLICY_VERSION_CHANGED");
    await expect(enroll({ ...signup, marketing_consent: "false" })).rejects.toThrow("Invalid marketing consent");
  });
  it.each([false, true])("records authenticated ownership, server time and marketing %s", async (marketing_consent) => {
    await enroll({ ...signup, marketing_consent, accepted_at: "1900-01-01", auth_user_id: other });
    const rows = (await db.query<{ auth_user_id: string; marketing_consent: boolean; accepted_at: Date }>("select * from public.member_signup_consents")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].auth_user_id).toBe(uid);
    expect(rows[0].marketing_consent).toBe(marketing_consent);
    expect(new Date(rows[0].accepted_at).getFullYear()).toBeGreaterThan(2025);
  });
  it("preserves completion of a previously claimed member", async () => {
    await db.query("insert into public.members(auth_user_id, member_code, full_name, phone) values ($1, '+6738999999', 'Old Name', '+6738999999')", [uid]);
    await enroll(signup);
    expect((await db.query("select full_name, phone from public.members")).rows).toEqual([{ full_name: signup.full_name, phone: signup.phone }]);
    expect((await db.query("select * from public.member_signup_consents")).rows).toHaveLength(1);
  });
  it("treats an omitted optional marketing choice as declined", async () => {
    const { marketing_consent: _unused, ...withoutMarketing } = signup;
    await enroll(withoutMarketing);
    expect((await db.query("select marketing_consent from public.member_signup_consents")).rows).toEqual([{ marketing_consent: false }]);
  });
  it("keeps consent records read-only and visible only to their authenticated owner", async () => {
    await enroll(signup);
    await db.exec("set role authenticated");
    expect((await db.query("select * from public.member_signup_consents")).rows).toHaveLength(1);
    await db.query("select set_config('test.uid', $1, false)", [other]);
    expect((await db.query("select * from public.member_signup_consents")).rows).toHaveLength(0);
    await expect(db.exec("delete from public.member_signup_consents")).rejects.toThrow("permission denied");
  });
  it("rolls back enrollment when consent evidence cannot be written", async () => {
    await db.exec(`create function public.reject_test_consent() returns trigger language plpgsql as $$ begin raise exception 'consent unavailable'; end $$;
      create trigger reject_test_consent before insert on public.member_signup_consents for each row execute function public.reject_test_consent();`);
    try {
      await expect(enroll(signup)).rejects.toThrow("consent unavailable");
      expect((await db.query("select * from public.members")).rows).toHaveLength(0);
    } finally { await db.exec("drop trigger reject_test_consent on public.member_signup_consents; drop function public.reject_test_consent();"); }
  });
});
