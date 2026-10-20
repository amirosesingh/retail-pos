import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (path: string) => readFileSync(path,"utf8");
describe("admin activation cloud boundary", () => {
 it("redirects old bookmarks and removes browser activation from navigation and startup", () => {
  expect(read("src/routes/settings.admin-terminals.tsx")).toContain('redirect({ to: "/settings/mobile-terminals" })');
  expect(read("src/platforms/web/components/pos/AppShell.tsx")).not.toContain("useAdminWebActivation");
  expect(read("src/lib/settings-catalog.tsx")).not.toContain('id: "admin-terminals"');
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
 it("retains historical audit storage without granting roles", () => {
  expect(read("supabase/migrations/20261009065040_admin_web_activation_cloud_only.sql")).not.toMatch(/INSERT INTO public.user_roles/i);
 });
});
