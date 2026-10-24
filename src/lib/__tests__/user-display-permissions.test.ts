import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizePermissions, NO_PERMISSIONS, getEffectivePermissions } from "../permissions";
import { userElementVisible, userRouteVisible, withPageDisplayAccess } from "../ui-visibility";
import { tableColumnHidden } from "../table-column-policy";
import { managementDeviceAllowed } from "../management-device-access";
import { UserDisplayPermissions } from "@/platforms/web/components/admin/UserDisplayPermissions";

describe("per-user display and device choices", () => {
  it("replaces a legacy whole-page restriction only after an explicit page edit", () => {
    const hidden = { "sales.heldOrders": ["cashier"] };
    expect(userRouteVisible(hidden, "/holds", "cashier", NO_PERMISSIONS)).toBe(false);
    const saved = withPageDisplayAccess({ ...NO_PERMISSIONS, "page:holds": true }, ["/holds"], true);
    expect(userRouteVisible(hidden, "/holds", "cashier", normalizePermissions(JSON.parse(JSON.stringify(saved))))).toBe(true);
    expect(userRouteVisible(hidden, "/holds", "cashier", NO_PERMISSIONS)).toBe(false);
  });
  it("round-trips overrides without changing another user's inherited restrictions", () => {
    const hidden = { "register.closeShift": ["cashier"] };
    const raw = JSON.parse(JSON.stringify({ ...NO_PERMISSIONS, "display:register.closeShift": true, "display:route:/settings/tax": true }));
    for (const matrix of [normalizePermissions(raw), getEffectivePermissions("cashier", raw)]) {
      expect(userElementVisible(hidden, "register.closeShift", "cashier", matrix)).toBe(true);
      expect(userRouteVisible(hidden, "/settings/tax", "cashier", matrix)).toBe(true);
      expect(userRouteVisible(hidden, "/settings/tax", "cashier", { ...matrix, "page:settings": false })).toBe(false);
      expect(matrix.can_access_pos_settings).toBe(false);
    }
    expect(userElementVisible(hidden, "register.closeShift", "cashier", NO_PERMISSIONS)).toBe(false);
    expect(userRouteVisible({}, "/settings/tax", "cashier", {})).toBe(false);
  });
  it("retains company-wide column blocks over individual grants", () => {
    const rules = { "table:products:1": ["all"], "table:products:2": ["role:cashier"] };
    const own = { "display:table:products:1": true, "display:table:products:2": true };
    expect(tableColumnHidden(rules, "products", 1, "cashier", "a", own)).toBe(true);
    expect(tableColumnHidden(rules, "products", 2, "cashier", "a", own)).toBe(false);
    expect(tableColumnHidden(rules, "products", 2, "cashier", "b")).toBe(true);
  });
  it("uses explicit PC/mobile grants independently and preserves legacy supervisor admission", () => {
    expect(managementDeviceAllowed({ role: "manager", permissions: {} }, false)).toBe(true);
    expect(managementDeviceAllowed({ role: "manager", permissions: { can_use_management_pc: false } }, false)).toBe(false);
    const person = { role: "staff", permissions: { can_use_management_pc: true, can_access_pos_settings: false } };
    expect(managementDeviceAllowed(person, false)).toBe(true);
    expect(managementDeviceAllowed(person, true)).toBe(false);
    expect(managementDeviceAllowed({ role: "staff", permissions: { can_use_management_pc: "true" } }, false)).toBe(false);
  });
  it("renders both device switches and the display controls in the account editor", () => {
    const html = renderToStaticMarkup(createElement(UserDisplayPermissions, { permissions: NO_PERMISSIONS, onChange: () => {}, hidden: {}, role: "cashier", userId: "a", admin: false, busy: false, search: "tax" }));
    expect(html).toContain("Sign in on management computers");
    expect(html).toContain("Sign in on management phones and tablets");
    expect(html).toContain("Tax &amp; pricing");
    expect(html).toContain("Inherited");
  });
});
