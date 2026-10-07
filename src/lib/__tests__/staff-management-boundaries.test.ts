import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("staff management boundaries", () => {
  it("uses the configured staff-management permission at the page and PIN mutation", () => {
    const route = read("src/routes/staff.tsx");
    const authorization = read("src/lib/authorization.functions.ts");

    expect(route).toContain('can("can_manage_staff")');
    expect(route).not.toContain("if (!isSupervisor)");
    expect(authorization).toContain(
      'canManageStaff: role === "admin" || scope.permissions.can_manage_staff === true',
    );
    expect(authorization).toContain('error: "Staff management permission is required"');
  });

  it("wakes local database synchronization for every staff identity table", () => {
    const engine = read("src/lib/sync-engine.ts");
    const accounts = read("src/platforms/web/components/admin/StaffManager.tsx");
    const roles = read("src/platforms/web/components/admin/RoleManager.tsx");

    for (const table of ["app_users", "cashiers", "staff_roles", "user_roles"]) {
      expect(engine).toContain(`"${table}"`);
    }
    expect(engine).toContain("LIVE_CONTROL_TABLES");
    expect(accounts).toContain('propagateStaffChange("staff approval PIN changed"');
    expect(accounts).toContain('propagateStaffChange("staff permissions changed"');
    expect(accounts).toContain('propagateStaffChange("staff account status changed"');
    expect(roles).toContain('broadcastSettingsChange("staff_roles")');
  });

  it("keeps a failed permission save contained and clears the busy state", () => {
    const accounts = read("src/platforms/web/components/admin/StaffManager.tsx");
    const save = accounts.slice(
      accounts.indexOf("const savePermissions = async"),
      accounts.indexOf("const remove = async"),
    );
    expect(save).toContain("try {");
    expect(save).toContain("catch (error)");
    expect(save).toContain("finally {");
    expect(save).toContain('setBusy("")');
  });

  it("persists the selected role preset when a staff account is first created", () => {
    const screen = read("src/platforms/web/components/admin/StaffManager.tsx");
    const client = read("src/lib/staff-admin.ts");
    const endpoint = read("src/lib/staff-admin.functions.ts");
    const server = read("src/lib/staff-admin.server.ts");

    expect(screen).toContain("permissions: selectedRole.permissions");
    expect(client).toContain("permissions: input.permissions");
    expect(endpoint).toContain("permissions: z.record(z.string(), z.boolean())");
    expect(server).toContain("p_permissions: payload.permissions ?? null");
  });
});
