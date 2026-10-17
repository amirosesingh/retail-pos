import { describe, expect, it } from "vitest";
import { terminalUserPermissions } from "../terminal-user-permissions";
import { CASHIER_PERMISSIONS, SUPERVISOR_PERMISSIONS, hasPermission } from "../permissions";

describe("verified PIN identity permissions", () => {
  it.each([
    { role: "manager", roleSlug: "custom-supervisor" },
    { role: "staff", roleSlug: "supervisor" },
  ])("preserves supervisor overrides for $role/$roleSlug", (identity) => {
    const permissions = terminalUserPermissions({ ...identity, permissions: {
      ...SUPERVISOR_PERMISSIONS,
      can_process_sale: false,
      "page:inventory": false,
      can_manage_staff: false,
    } });
    expect(permissions.can_process_sale).toBe(false);
    expect(permissions.can_manage_staff).toBe(false);
    expect(hasPermission(permissions, "can_view_inventory")).toBe(false);
    expect(permissions.can_close_shift).toBe(SUPERVISOR_PERMISSIONS.can_close_shift);
  });

  it("preserves cashier grants, denials and hidden pages", () => {
    const permissions = terminalUserPermissions({ role: "staff", roleSlug: "cashier", permissions: {
      ...CASHIER_PERMISSIONS, can_process_sale: false, "page:inventory": false,
    } });
    expect(permissions.can_process_sale).toBe(false);
    expect(permissions.can_open_shift).toBe(true);
    expect(permissions.can_manage_staff).toBe(false);
    expect(hasPermission(permissions, "can_view_inventory")).toBe(false);
  });

  it("retains the administrator policy", () => {
    expect(terminalUserPermissions({ role: "admin", permissions: { can_manage_staff: false } }).can_manage_staff).toBe(true);
  });
});
