import { readFileSync } from "node:fs";
import { PERMISSION_PAGES } from "../permission-pages";
import { afterEach, describe, expect, it } from "vitest";
import { cacheRoleDefinitions, cachedRoleDefinition, getEffectivePermissions, hasPermission, normalizePermissions, rolePermissions } from "../permissions";

import { isVisibleFor, withVisibility } from "../ui-visibility";

afterEach(() => cacheRoleDefinitions([]));

describe("effective role and account permissions", () => {
  it("lets an individual hide costs without disabling checkout or reports", () => {
    const permissions = getEffectivePermissions("supervisor", { can_view_cost_margin: false });
    expect(permissions.can_view_cost_margin).toBe(false);
    expect(permissions.can_view_sales_reports).toBe(true);
    expect(permissions.can_process_sale).toBe(true);
  });
  it("inherits the explicit cost setting from a custom role", () => {
    cacheRoleDefinitions([{ slug: "sales-only", baseLevel: "supervisor", permissions: { ...rolePermissions("supervisor"), can_view_cost_margin: false } }]);
    expect(getEffectivePermissions("sales-only", { can_give_discount: true }).can_view_cost_margin).toBe(false);
    expect(getEffectivePermissions("sales-only", { can_view_cost_margin: true }).can_view_cost_margin).toBe(true);
  });
  it("preserves legacy financial access only until a cost choice is saved", () => {
    expect(normalizePermissions({ can_view_sales_reports: true }).can_view_cost_margin).toBe(true);
    expect(normalizePermissions({ can_view_sales_reports: true, can_view_cost_margin: false }).can_view_cost_margin).toBe(false);
    expect(normalizePermissions({ can_view_sales_reports: false }).can_view_cost_margin).toBe(false);
    expect(normalizePermissions({ can_view_sales_reports: true, "page:reports": false }).can_view_cost_margin).toBe(false);
    expect(normalizePermissions({ can_view_sales_reports: true, "page:reports": "true" }).can_view_cost_margin).toBe(false);
  });
  it("preserves a person's explicit page denial over an inherited action grant", () => {
    cacheRoleDefinitions([{ slug: "custom-stock", baseLevel: "warehouse", permissions: rolePermissions("warehouse") }]);
    const permissions = getEffectivePermissions("custom-stock", { "page:inventory": false });
    expect(permissions["page:inventory"]).toBe(false);
    expect(hasPermission(permissions, "can_view_inventory")).toBe(false);
  });
  it("keeps explicit action denials while inheriting other role grants", () => {
    const permissions = getEffectivePermissions("warehouse", { can_adjust_stock: false });
    expect(permissions.can_adjust_stock).toBe(false);
    expect(permissions.can_view_inventory).toBe(true);
  });
  it.each(["false", "true", 1, {}, null])("does not turn malformed values into grants: %s", value => {
    expect(normalizePermissions({ can_manage_staff: value }).can_manage_staff).toBe(false);
    expect(getEffectivePermissions("cashier", { can_manage_staff: value }).can_manage_staff).toBe(false);
  });
  it("removes deleted roles from the cache after an authoritative refresh", () => {
    cacheRoleDefinitions([{ slug: "removed-role", baseLevel: "supervisor", permissions: rolePermissions("supervisor") }]);
    cacheRoleDefinitions([]);
    expect(cachedRoleDefinition("removed-role")).toBeNull();
    expect(getEffectivePermissions("removed-role").can_manage_staff).toBe(false);
  });
  it("does not mutate shared role presets when applying individual overrides", () => {
    getEffectivePermissions("warehouse", { can_view_inventory: false });
    expect(getEffectivePermissions("warehouse").can_view_inventory).toBe(true);
  });
});

describe("custom role visibility isolation", () => {
  it("inherits base visibility until explicitly changed without changing other roles", () => {
    cacheRoleDefinitions([{ slug: "stock-reviewer", baseLevel: "warehouse", permissions: rolePermissions("warehouse") }]);
    const hidden = { "register.closeShift": ["warehouse"] };
    expect(isVisibleFor(hidden, "register.closeShift", "stock-reviewer")).toBe(false);
    const next = withVisibility(hidden, "register.closeShift", "stock-reviewer", false);
    expect(isVisibleFor(next, "register.closeShift", "stock-reviewer")).toBe(true);
    expect(isVisibleFor(next, "register.closeShift", "warehouse")).toBe(false);
    expect(hidden).toEqual({ "register.closeShift": ["warehouse"] });
  });
});

describe("database permission migration contract", () => {
  const sql = readFileSync("supabase/migrations/20261022043000_enforce_staff_permission_denials.sql", "utf8");
  it("has no supervisor blanket grant and requires an active verified identity", () => {
    expect(sql).not.toContain("is_app_supervisor()");
    expect(sql).toContain("a.is_active");
    expect(sql).toContain("(SELECT auth.uid()) IS NOT NULL");
    expect(sql).toContain("role = 'admin' OR role_slug = 'admin'");
    expect(sql).toContain("permissions->_flag = 'true'::jsonb");
  });
  it("keeps database page ownership identical to the app and Electron", () => {
    const encoded = sql.match(/'({"can_[^']+})'::jsonb/);
    expect(encoded).not.toBeNull();
    const expected: Record<string, string[]> = {};
    // This historical SQL migration predates the PC sign-in flag. Device
    // admission is checked by the server; it grants no table/page ownership.
    for (const page of PERMISSION_PAGES) for (const key of page.keys) if (key !== "can_use_management_pc" && !key.endsWith("sponsorship")) (expected[key] ??= []).push(page.id);
    expect(JSON.parse(encoded![1])).toEqual(expected);
  });
});
