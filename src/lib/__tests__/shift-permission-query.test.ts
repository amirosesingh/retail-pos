import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("optimizes invariant shift checks without changing fields, scope, limits or privileges", () => {
  const old = readFileSync("supabase/migrations/20260927135206_harden_secure_shift_projection.sql", "utf8");
  const original = old.slice(old.indexOf("CREATE OR REPLACE FUNCTION private.shift_list_secure_impl"), old.indexOf("REVOKE ALL ON FUNCTION private.shift_list_secure_impl")).trim();
  const next = readFileSync("supabase/migrations/20261023110839_optimize_shift_permission_checks.sql", "utf8");
  const restored = next.slice(next.indexOf("CREATE OR REPLACE FUNCTION"))
    .replace(/\(SELECT public\.has_perm\('([^']+)'\)\)/g, "public.has_perm('$1')")
    .replace("(SELECT public.is_staff((SELECT auth.uid())))", "public.is_staff((SELECT auth.uid()))")
    .replace("(SELECT public.is_terminal_active())", "public.is_terminal_active()").trim();
  expect(restored.replace(/\r\n/g, "\n")).toBe(original.replace(/\r\n/g, "\n"));
  expect(next).not.toMatch(/\bGRANT\b|\bDROP\b|\bALTER TABLE\b/);
});
