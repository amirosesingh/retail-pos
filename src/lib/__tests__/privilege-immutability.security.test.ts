import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(join(process.cwd(), "supabase", "schema.sql"), "utf8");

describe("self-privilege guards", () => {
  it.each(["app_users_block_self_privilege_change", "user_roles_block_self_grant"])(
    "%s is installed in the canonical schema",
    (name) => {
      expect(schema).toContain(`CREATE TRIGGER ${name}`);
      expect(schema).toContain(`EXECUTE FUNCTION public.${name}()`);
      expect(schema).toContain(`REVOKE EXECUTE ON FUNCTION public.${name}()`);
    },
  );

  it("refuses a change to one's own role, permissions, branch or access", () => {
    for (const column of ["NEW.role", "NEW.permissions", "NEW.store_id", "NEW.is_active"]) {
      expect(schema).toContain(column);
    }
    expect(schema).toContain("auth.uid()");
  });

  it("keeps transfers and their lines scoped to the staff member's branch", () => {
    expect(schema).toContain("transfer_in_my_branch");
    expect(schema).toContain("user_has_store_access(from_store_id)");
  });

  it("redacts shift financials in a restricted, branch-checked RPC", () => {
    expect(schema).toContain("CREATE OR REPLACE FUNCTION public.shift_list_secure");
    expect(schema).toMatch(
      /FUNCTION private\.shift_list_secure_impl[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = ''/,
    );
    expect(schema).toMatch(
      /FUNCTION public\.shift_list_secure[\s\S]*?SECURITY INVOKER[\s\S]*?SET search_path = ''/,
    );
    expect(schema).toContain("AND public.is_terminal_active()");
    expect(schema).toContain("AND public.store_visible(s.store_id)");
    expect(schema).toContain("can_shift_expected_cash_view");
    expect(schema).toContain("can_shift_counted_cash_view");
    expect(schema).toContain("can_shift_variance_view");
    expect(schema).toContain("REVOKE SELECT ON public.shifts FROM authenticated");
    expect(schema).toContain(
      "REVOKE ALL ON FUNCTION public.shift_list_secure(text, integer) FROM PUBLIC, anon",
    );
    expect(schema).toContain("REVOKE ALL ON FUNCTION public.shift_active_for_branch(text) FROM PUBLIC, anon, authenticated");
  });

  it("removes broad transfer policies in favour of endpoint-scoped policies", () => {
    expect(schema).toContain('DROP POLICY IF EXISTS "Staff read transfers"');
    expect(schema).toContain('CREATE POLICY "Scoped staff read transfers"');
    expect(schema).toContain("user_has_store_access(to_store_id)");
    expect(schema).toContain('CREATE POLICY "Scoped staff access transfer items"');
  });

  it("keeps the pending migration free of patch-marker syntax", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase", "migrations", "20260927115034_secure_shift_approvals_realtime.sql"),
      "utf8",
    );
    expect(migration).not.toMatch(/^\+/m);
  });
});
