import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("location management boundaries", () => {
  it("uses can_manage_locations consistently from UI to the service relay", () => {
    const route = read("src/routes/settings.groups.tsx");
    const server = read("src/lib/store-groups.functions.ts");
    const relay = read("src/core/api/relay-policy.server.ts");
    const navigation = read("src/platforms/web/components/pos/nav-config.ts");

    expect(route).toContain('can("can_manage_locations")');
    expect(server).toContain('permission: "can_manage_locations"');
    expect(server).not.toContain("supervisor: true");
    expect(relay).toContain('allowed(scope, "can_manage_locations")');
    expect(navigation).toContain('"/settings/groups": "can_manage_locations"');
  });

  it("keeps store-group RLS aligned with the application permission", () => {
    const schema = read("supabase/schema.sql");
    const migration = read(
      "supabase/migrations/20261008123000_align_location_management_permissions.sql",
    );

    for (const sql of [schema, migration]) {
      const start = sql.lastIndexOf(
        'DROP POLICY IF EXISTS "Supervisors manage store groups"',
      );
      const policies = sql.slice(start, start + 900);
      expect(policies).toContain("public.has_perm('can_manage_locations')");
      expect(policies).not.toContain("public.is_app_supervisor()");
    }
  });

  it("does not expose trading activity or exports to inventory-only users", () => {
    const page = read("src/routes/all-shops.tsx");

    expect(page).toContain('const canExport = can("can_export_reports")');
    expect(page).toMatch(/\{canExport && \([\s\S]{0,220}?Export CSV/);
    expect(page).toMatch(/\{showMoney && \([\s\S]{0,180}?Shift open/);
    expect(page).toContain('"Stock quantities only"');
    expect(page).toContain("visibleStoreIds.has(sale.storeId)");
  });
});
