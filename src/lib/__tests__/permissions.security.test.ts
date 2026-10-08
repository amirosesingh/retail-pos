import { describe, expect, it } from "vitest";
import {
  CASHIER_PERMISSIONS,
  FULL_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  PERMISSION_TAGS,
  PERMISSION_TAG_KEYS,
  ROLE_PRESETS,
  STAFF_ROLES,
  SUPERVISOR_PERMISSIONS,
  WAREHOUSE_PERMISSIONS,
  normalizePermissions,
  rolePermissions,
  roleHasTag,
  type PermissionKey,
} from "@/lib/permissions";
import { isRouteVisibleFor, withVisibility } from "@/lib/ui-visibility";

/**
 * Snapshot of the least-privilege presets. If a preset is widened, this test
 * fails and the change must be made deliberately — that is the point: it
 * catches accidental privilege escalation before a release.
 */
const CASHIER_ALLOWED: PermissionKey[] = [
  "can_customize_display",
  "can_open_drawer",
  "can_close_drawer",
  "can_open_shift",
  "can_close_shift",
  // Counting the drawer is part of closing; seeing the expected cash or the
  // variance is deliberately NOT granted to a cashier.
  "can_shift_cash_count",
  "can_process_sale",
  "can_hold_cart",
  "can_view_held_orders",
  "can_reopen_held_order",
  "can_reprint_bill",
  "can_manage_bookings",
  // Bookings are taken at the till: a cashier raises the booking and takes
  // the deposit / part payment. Cancelling one still needs a supervisor.
  "can_create_booking",
  "can_collect_booking",
  "can_view_inventory",
  "can_add_member",
  "can_apply_member_discount",
  "can_view_member_history",
];

const WAREHOUSE_ALLOWED: PermissionKey[] = [
  "can_customize_display",
  "can_view_inventory",
  "can_add_new_product",
  "can_edit_product_details",
  "can_edit_product_price",
  "can_link_product_barcode",
  "can_archive_product",
  "can_restore_product",
  "can_publish_product",
  "can_receive_purchase_order",
  "can_adjust_stock",
  "can_create_transfer",
  "can_receive_transfer",
  "can_approve_transfer",
  "can_manage_locations",
];

const granted = (matrix: Record<string, boolean>) =>
  Object.entries(matrix)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .sort();

describe("permission presets", () => {
  it("cashiers keep exactly the till-floor permissions", () => {
    expect(granted(CASHIER_PERMISSIONS)).toEqual([...CASHIER_ALLOWED].sort());
  });

  it("keeps held-ticket visibility and actions independently configurable", () => {
    const matrix = normalizePermissions({
      can_hold_cart: true,
      can_view_held_orders: false,
      can_reopen_held_order: false,
      can_discard_held_order: true,
    });
    expect(matrix.can_hold_cart).toBe(true);
    expect(matrix.can_view_held_orders).toBe(false);
    expect(matrix.can_reopen_held_order).toBe(false);
    expect(matrix.can_discard_held_order).toBe(true);
  });

  it("maps an older hold permission to view and reopen only until the role is saved again", () => {
    const matrix = normalizePermissions({ can_hold_cart: true });
    expect(matrix.can_view_held_orders).toBe(true);
    expect(matrix.can_reopen_held_order).toBe(true);
    expect(matrix.can_discard_held_order).toBe(false);
  });

  it("warehouse users keep exactly the stock permissions", () => {
    expect(granted(WAREHOUSE_PERMISSIONS)).toEqual([...WAREHOUSE_ALLOWED].sort());
  });

  it("migrates the old add-product grant into independent catalogue actions", () => {
    const matrix = normalizePermissions({ can_add_new_product: true }, "warehouse");
    expect(matrix.can_edit_product_details).toBe(true);
    expect(matrix.can_link_product_barcode).toBe(true);
    expect(matrix.can_archive_product).toBe(true);
    expect(matrix.can_restore_product).toBe(true);
    expect(matrix.can_publish_product).toBe(true);

    const explicit = normalizePermissions(
      { can_add_new_product: true, can_publish_product: false },
      "warehouse",
    );
    expect(explicit.can_publish_product).toBe(false);
  });

  it("migrates the legacy products alias into independent catalogue actions", () => {
    const matrix = normalizePermissions({ products: true }, "warehouse");
    expect(matrix.can_add_new_product).toBe(true);
    expect(matrix.can_edit_product_details).toBe(true);
    expect(matrix.can_link_product_barcode).toBe(true);
    expect(matrix.can_archive_product).toBe(true);
    expect(matrix.can_restore_product).toBe(true);
    expect(matrix.can_publish_product).toBe(true);
  });

  it("never grants cashiers money, settings or staff control", () => {
    for (const key of [
      "can_view_sales_reports",
      "can_access_pos_settings",
      "can_manage_staff",
      "can_edit_product_price",
      "can_process_refund",
      "can_adjust_stock",
      "can_view_dashboard",
      "can_export_reports",
      "can_view_audit_trail",
      "can_manage_terminals",
      "can_manage_sync_backup",
      "can_manage_promotions",
    ] as PermissionKey[]) {
      expect(CASHIER_PERMISSIONS[key], key).toBe(false);
    }
  });

  it("limited roles cannot bypass the shift lock", () => {
    expect(CASHIER_PERMISSIONS["can_bypass_shift_lock"]).toBe(false);
    expect(WAREHOUSE_PERMISSIONS["can_bypass_shift_lock"]).toBe(false);
    expect(FULL_PERMISSIONS["can_bypass_shift_lock"]).toBe(true);
  });

  it("never grants warehouse users money or staff control", () => {
    for (const key of [
      "can_view_sales_reports",
      "can_access_pos_settings",
      "can_manage_staff",
      "can_process_sale",
      "can_process_refund",
      "can_view_dashboard",
      "can_export_reports",
      "can_manage_terminals",
      "can_manage_sync_backup",
    ] as PermissionKey[]) {
      expect(WAREHOUSE_PERMISSIONS[key], key).toBe(false);
    }
  });

  it("only administrators get the full matrix", () => {
    expect(rolePermissions("admin")).toEqual(FULL_PERMISSIONS);
    expect(rolePermissions("supervisor")).not.toEqual(FULL_PERMISSIONS);
    expect(rolePermissions("cashier")).not.toEqual(FULL_PERMISSIONS);
    expect(rolePermissions("warehouse")).not.toEqual(FULL_PERMISSIONS);
  });
});

describe("permission matrix integrity", () => {
  it("every key is reachable from the Staff Management UI groups", () => {
    const inGroups = PERMISSION_GROUPS.flatMap((g) => [...g.keys]);
    expect([...inGroups].sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it("unknown stored keys can never grant a permission", () => {
    const matrix = normalizePermissions(
      { can_manage_staff: true, totally_made_up: true } as Record<string, unknown>,
      "cashier",
    );
    expect(Object.keys(matrix).sort()).toEqual([...PERMISSION_KEYS].sort());
    expect((matrix as Record<string, boolean>).totally_made_up).toBeUndefined();
  });

  it("a missing stored matrix falls back to the role preset, not full access", () => {
    expect(normalizePermissions(null, "cashier")).toEqual(CASHIER_PERMISSIONS);
    expect(normalizePermissions(undefined, "warehouse")).toEqual(WAREHOUSE_PERMISSIONS);
  });

  it("an empty stored matrix denies business permissions while allowing personal appearance", () => {
    const matrix = normalizePermissions({}, "cashier");
    expect(granted(matrix)).toEqual(["can_customize_display"]);
  });
});
describe("permission tags", () => {
  it("every permission belongs to exactly one tag", () => {
    const tagged = PERMISSION_TAG_KEYS.flatMap((t) => PERMISSION_TAGS[t].keys);
    expect([...tagged].sort()).toEqual([...PERMISSION_KEYS].sort());
    expect(new Set(tagged).size).toBe(tagged.length);
  });

  it("only administrators carry the admin-only tag", () => {
    expect(PERMISSION_TAGS["admin-only"].roles).toEqual(["admin"]);
    expect(roleHasTag("cashier", "admin-only")).toBe(false);
    expect(roleHasTag("supervisor", "admin-only")).toBe(false);
    expect(roleHasTag("admin", "admin-only")).toBe(true);
  });

  it("supervisors manage terminals but not staff, sync or general settings", () => {
    for (const key of [
      "can_manage_staff",
      "can_manage_sync_backup",
      "can_access_pos_settings",
    ] as PermissionKey[]) {
      expect(SUPERVISOR_PERMISSIONS[key], key).toBe(false);
    }
    expect(SUPERVISOR_PERMISSIONS.can_manage_terminals).toBe(true);
    expect(
      normalizePermissions({ can_manage_terminals: false }, "supervisor").can_manage_terminals,
    ).toBe(true);
    expect(SUPERVISOR_PERMISSIONS.can_process_sale).toBe(true);
  });

  it("every built-in role has a preset", () => {
    for (const role of STAFF_ROLES) expect(ROLE_PRESETS[role]).toEqual(rolePermissions(role));
  });
});

describe("route visibility", () => {
  it("a hidden settings page is refused for that role only", () => {
    const hidden = { "route:/settings/services": ["supervisor"] };
    expect(isRouteVisibleFor(hidden, "/settings/services", "supervisor")).toBe(false);
    expect(isRouteVisibleFor({}, "/settings/services", "supervisor")).toBe(true);
    expect(isRouteVisibleFor(hidden, "/settings/services", "admin")).toBe(true);
  });

  it("an admin-only settings page is never shown to a cashier", () => {
    expect(isRouteVisibleFor({}, "/settings/database", "cashier")).toBe(false);
    expect(isRouteVisibleFor({}, "/settings/display", "cashier")).toBe(true);
  });

  it("screens with no visibility entry stay reachable", () => {
    expect(isRouteVisibleFor({}, "/", "cashier")).toBe(true);
    expect(isRouteVisibleFor({}, "/reports/sales", "supervisor")).toBe(true);
  });

  it("a sensitive page is hidden until it is granted, and can never be granted for a core page", () => {
    const key = "route:/settings/rules";
    expect(isRouteVisibleFor({}, "/settings/rules", "supervisor")).toBe(false);
    const granted = withVisibility({}, key, "supervisor", false);
    expect(isRouteVisibleFor(granted, "/settings/rules", "supervisor")).toBe(true);
    expect(isRouteVisibleFor(granted, "/settings/rules", "cashier")).toBe(false);
    const revoked = withVisibility(granted, key, "supervisor", true);
    expect(isRouteVisibleFor(revoked, "/settings/rules", "supervisor")).toBe(false);

    const core = withVisibility({}, "route:/settings/access", "supervisor", false);
    expect(isRouteVisibleFor(core, "/settings/access", "supervisor")).toBe(false);
  });
});
