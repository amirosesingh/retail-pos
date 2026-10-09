import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (path: string) => readFileSync(path,"utf8");
describe("admin activation cloud boundary", () => {
 it("has its own guarded page and reloads the API schema after installation", () => {
  const route = read("src/routes/settings.admin-terminals.tsx");
  expect(route).toContain('createFileRoute("/settings/admin-terminals")');
  expect(route).toContain("!isAdmin");
  expect(route).toContain("isTerminalApp()");
  expect(read("src/routes/settings.terminals.tsx")).not.toContain("AdminWebActivations");
  expect(read("supabase/migrations/20261009065040_admin_web_activation_cloud_only.sql")).toContain("NOTIFY pgrst, 'reload schema'");
 });
 it("keeps admin registrations outside both local schema and terminal synchronization", () => {
  for (const path of ["database/sqlserver/schema-registry.json","database/sqlserver/retail-pos-local-database.sql","src/core/api/pos-db.ts"])
   expect(read(path)).not.toMatch(/admin_portal|admin_web_activation/);
  const sql=read("supabase/migrations/20261009065040_admin_web_activation_cloud_only.sql");
  expect(sql).toContain("REVOKE ALL ON SCHEMA admin_portal FROM PUBLIC, anon, authenticated");
  expect(sql).toContain("public.has_role(v_user,'admin'::public.app_role)");
  expect(sql).toContain("AND admin_user_id=v_user");
  expect(sql).toContain("code_expires_at>now()");
  expect(sql).toContain("code_hash=NULL");
  expect(sql).not.toContain("sync_change_feed");
 });
 it("does not put activation codes in local sync or grant an admin role", () => {
  const client=read("src/lib/admin-web-activation.ts");
  expect(client).toContain("if (isTerminalApp()) throw");
  expect(client).toContain("supabaseExternal.rpc");
  expect(client).not.toMatch(/writeLocalSetting|commitOps|writeBatch/);
  expect(read("supabase/migrations/20261009065040_admin_web_activation_cloud_only.sql")).not.toMatch(/INSERT INTO public.user_roles/i);
 });
});
