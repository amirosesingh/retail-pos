import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mayApproveTransferRelease } from "../transfer-approval-policy";
import { AUTH_ACTIONS, defaultRule, resolveRules } from "../authorization";
import { validateAuthorizationRuleConfiguration } from "@/platforms/web/components/pos/settings/authorization-rule-configuration";
const migration = readFileSync("supabase/migrations/20261026161839_honor_configured_cross_cluster_transfer_approvers.sql", "utf8");
describe("configured cross-cluster transfer approval", () => {
  it("requires both transfer permission and configured eligibility, including for supervisors", async () => {
    const db = new PGlite();
    try {
      await db.exec(`create role anon;create role authenticated;create role service_role;
        create table app_users(id uuid primary key,user_id text,role text,permissions jsonb,is_active boolean);
        create table authorization_actions(id uuid primary key default gen_random_uuid(),action_key text,scope_type text,scope_id text,is_enabled boolean,allowed_roles text[],allowed_user_ids text[]);
        create function current_app_user() returns setof public.app_users language sql as $$select * from public.app_users where user_id=current_setting('test.actor',true)$$;
        create function has_perm(flag text) returns boolean language sql as $$select coalesce((select permissions->flag='true'::jsonb from public.current_app_user()),false)$$;
        create function is_app_supervisor() returns boolean language sql as $$select true$$;
        insert into app_users values
        ('11111111-1111-4111-8111-111111111111','supervisor','manager','{"can_approve_transfer":true}',true),
        ('22222222-2222-4222-8222-222222222222','selected','staff','{"can_approve_transfer":true}',true),
        ('33333333-3333-4333-8333-333333333333','without-permission','staff','{"can_approve_transfer":false}',true);
        insert into authorization_actions(action_key,scope_type,scope_id,is_enabled,allowed_roles,allowed_user_ids)
          values('cross_group_transfer_approval','global','',true,'{}',array['selected']);`);
      await db.exec("alter table app_users add column role_slug text;update app_users set role_slug='supervisor' where user_id='supervisor'");
      await db.exec(migration);
      const allowed = async (actor: string) => {
        await db.query("select set_config('test.actor',$1,false)",[actor]);
        return (await db.query<{allowed:boolean}>("select may_approve_cross_group_transfer() as allowed")).rows[0].allowed;
      };
      expect(await allowed("supervisor")).toBe(false);
      expect(await allowed("selected")).toBe(true);
      await db.exec("update authorization_actions set allowed_user_ids=array['without-permission']");
      expect(await allowed("without-permission")).toBe(false);
      await db.exec("update authorization_actions set allowed_roles=array['manager'],allowed_user_ids='{}'");
      expect(await allowed("supervisor")).toBe(true);
      await db.exec("update authorization_actions set allowed_roles=array['supervisor']");
      expect(await allowed("supervisor")).toBe(true);
      await db.exec("update authorization_actions set allowed_user_ids=array['!supervisor']");
      expect(await allowed("supervisor")).toBe(false);
      await db.exec("update authorization_actions set allowed_roles='{}',allowed_user_ids=array['22222222-2222-4222-8222-222222222222']");
      expect(await allowed("selected")).toBe(true);
      await db.exec("update app_users set is_active=false where user_id='selected'");
      expect(await allowed("selected")).toBe(false);
      await db.exec("update authorization_actions set is_enabled=false");
      expect(await allowed("supervisor")).toBe(true);
      expect(await allowed("without-permission")).toBe(false);
      expect(await allowed("unknown")).toBe(false);
      await db.exec(migration);
      expect((await db.query<{allowed:boolean}>("select has_function_privilege('anon','may_approve_cross_group_transfer()','EXECUTE') as allowed")).rows[0].allowed).toBe(false);
      expect((await db.query("select * from app_users")).rows).toHaveLength(3);
    } finally { await db.close(); }
  });
  it("keeps same-cluster release unchanged and denies cross-cluster self approval or unselected users", () => {
    const rule = {...defaultRule("cross_group_transfer_approval"), id:"saved-rule", allowedRoles: [], allowedUserIds: ["selected"]};
    const selected = {ids:["selected","22222222-2222-4222-8222-222222222222"],name:"Selected",role:"staff"};
    expect(mayApproveTransferRelease(false,"Selected",selected,rule)).toBe(true);
    expect(mayApproveTransferRelease(true,"Requester",selected,{...rule,id:"",allowedUserIds:[]})).toBe(true);
    expect(mayApproveTransferRelease(true,"Requester",selected,rule)).toBe(true);
    expect(mayApproveTransferRelease(true,"Selected",selected,rule)).toBe(false);
    expect(mayApproveTransferRelease(true,"Requester",{ids:["other"],name:"Other",role:"manager"},rule)).toBe(false);
    expect(mayApproveTransferRelease(true,"Requester",selected,{...rule,allowedRoles:["staff"],allowedUserIds:["!selected",selected.ids[1]]})).toBe(false);
    const global = {...rule,id:"global",scopeType:"global" as const,scopeId:""};
    const branch = {...rule,id:"branch",scopeType:"branch" as const,scopeId:"store",allowedRoles:["manager"]};
    expect(resolveRules([global,branch],"store").cross_group_transfer_approval?.id).toBe("global");
  });
  it("exposes the existing policy without an off switch or a second timeout workflow", () => {
    expect(AUTH_ACTIONS.find(action=>action.key==='cross_group_transfer_approval')).toBeDefined();
    const rule = defaultRule("cross_group_transfer_approval");
    expect(rule.mode).toBe("request");
    expect(validateAuthorizationRuleConfiguration(rule, {})).toEqual([]);
    expect(validateAuthorizationRuleConfiguration({...rule,mode:"none"},{})).not.toEqual([]);
    expect(validateAuthorizationRuleConfiguration({...rule,scopeType:"branch",scopeId:"store"},{})).not.toEqual([]);
    const schema=readFileSync("supabase/schema.sql","utf8");
    expect(schema).toContain("A transfer between groups must be approved by someone other than the requester");
    expect(schema).toContain("This transfer crosses groups and has no valid approval");
  });
});
