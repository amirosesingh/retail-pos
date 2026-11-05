import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { memberToRow } from "@/core/api/pos-db";
import type { Member } from "@/core/types/pos-types";
it("saves contact separately and never echoes it from checkout member snapshots", () => {
  const member: Member = {id:"member",code:"M1",name:"Name",phone:"123",email:"verified@example.com",contactEmail:" contact@example.com ",tier:"VIP",points:0,totalSpend:0,joinedAt:"2026-10-26"};
  expect(memberToRow(member,()=>"tier",false,true)).toMatchObject({contact_email:"contact@example.com"});
  expect(memberToRow(member,()=>"tier")).not.toHaveProperty("contact_email");
  expect(memberToRow(member,()=>"tier",false,true)).not.toHaveProperty("email");
  expect(memberToRow(member,()=>"tier",false,true)).not.toHaveProperty("tier_id");
});
it("permission-checks tier creation, validates values, preserves member links and contact identity", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;
      create function is_staff_now() returns boolean language sql as $$select true$$;
      create function has_perm(text) returns boolean language sql as $$select coalesce(current_setting('test.tier_access',true),'false')::boolean$$;
      create table membership_tiers(id uuid primary key default gen_random_uuid(),name text,discount_percentage numeric,points_multiplier numeric,deleted_at text,updated_at timestamptz);
      create table members(id uuid primary key default gen_random_uuid(),email text,is_verified boolean,tier_id uuid references membership_tiers(id),phone text,address text);
      create function sync_apply_members(p_rows jsonb) returns integer language plpgsql as $body$ begin
        insert into members(id,phone, email, address) select id,phone, email, address from jsonb_populate_recordset(null::members,p_rows)
        on conflict(id) do update set email = excluded.email, address=excluded.address;return 1;end;$body$;
      set test.tier_access='false';`);
    const sql=readFileSync("supabase/migrations/20261026111000_member_contact_and_tier_editor.sql","utf8");
    await db.exec(sql);
    await expect(db.query("select staff_membership_tier_save('VIP',10,2,null)")).rejects.toThrow("MEMBER_TIER_PERMISSION_REQUIRED");
    await db.exec("set test.tier_access='true'");
    await db.query("select staff_membership_tier_save('VIP',10,2,null)");
    await expect(db.query("select staff_membership_tier_save('vip',0,1,null)")).rejects.toThrow("already exists");
    await expect(db.query("select staff_membership_tier_save('Bad',101,1,null)")).rejects.toThrow("Invalid tier");
    await db.exec("insert into members(email,is_verified,tier_id) select 'verified@example.com',true,id from membership_tiers where name='VIP';update members set contact_email='contact@example.com';");
    const {rows}=await db.query<{email:string;contact_email:string;is_verified:boolean}>("select email,contact_email,is_verified from members");
    expect(rows[0]).toEqual({email:"verified@example.com",contact_email:"contact@example.com",is_verified:true});
    await expect(db.exec("update members set contact_email='invalid'")).rejects.toThrow("members_contact_email_valid");
    await db.query("select sync_apply_members(jsonb_build_array(jsonb_build_object('id',id,'email',email))) from members");
    expect((await db.query<{contact_email:string}>("select contact_email from members")).rows[0].contact_email).toBe("contact@example.com");
    await db.query("select sync_apply_members(jsonb_build_array(jsonb_build_object('id',id,'email',email,'contact_email','updated@example.com'))) from members");
    expect((await db.query<{contact_email:string}>("select contact_email from members")).rows[0].contact_email).toBe("updated@example.com");
    await db.exec(sql);
    expect((await db.query("select * from membership_tiers")).rows).toHaveLength(1);
  } finally {await db.close();}
});
