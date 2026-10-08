// ============================================================================
// Granular feature permissions. Stored as a JSONB object on public.app_users.
// ============================================================================

export const PERMISSION_GROUPS = [
  {
    id: "drawer",
    label: "Cash Drawer",
    keys: [
      "can_open_drawer",
      "can_close_drawer",
      "can_view_drawer_balance",
      "can_open_shift",
      "can_close_shift",
      "can_bypass_shift_lock",
      "can_shift_cash_count",
      "can_shift_expected_cash_view",
      "can_shift_counted_cash_view",
      "can_shift_variance_view",
      "can_shift_financial_summary_view",
      "can_shift_payment_breakdown_view",
      "can_shift_closing_history_view",
      "can_shift_report_reprint",
      "can_manage_other_shifts",
      "can_shift_variance_approve",
      "can_shift_cash_recount",
    ],
  },
  {
    id: "approvals",
    label: "Sales Approvals (off = manager PIN required)",
    keys: [
      "can_delete_line",
      "can_reduce_qty",
      "can_discount_bill",
      "can_override_price",
      "can_void_cart",
      "can_no_sale_open",
      "can_edit_tenders",
    ],
  },
  {
    id: "sales",
    label: "Sales & Checkout",
    keys: [
      "can_process_sale",
      "can_give_discount",
      "can_void_item",
      "can_hold_cart",
      "can_view_held_orders",
      "can_reopen_held_order",
      "can_discard_held_order",
      "can_process_refund",
      "can_process_exchange",
      "can_reprint_bill",
      "can_send_whatsapp_bill",
      "can_manage_bookings",
      "can_create_booking",
      "can_collect_booking",
      "can_cancel_booking",
    ],
  },
  {
    id: "inventory",
    label: "Inventory & Pricing",
    keys: [
      "can_view_inventory",
      "can_edit_product_price",
      "can_add_new_product",
      "can_edit_product_details",
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
      "can_manage_categories",
      "can_bulk_edit_products",
      "can_merge_products",
    ],
  },
  {
    id: "members",
    label: "Members & Loyalty",
    keys: [
      "can_add_member",
      "can_edit_member_points",
      "can_apply_member_discount",
      "can_redeem_points",
      "can_view_member_history",
    ],
  },
  {
    id: "reports",
    label: "Reports & Analytics",
    keys: [
      "can_view_sales_reports",
      "can_view_dashboard",
      "can_view_audit_trail",
      "can_export_reports",
    ],
  },
  {
    id: "system",
    label: "System & Administration",
    keys: [
      "can_access_pos_settings",
      "can_manage_staff",
      "can_manage_promotions",
      "can_manage_terminals",
      "can_manage_sync_backup",
    ],
  },
] as const;

export type PermissionKey =
  | "can_open_drawer"
  | "can_close_drawer"
  | "can_view_drawer_balance"
  | "can_open_shift"
  | "can_close_shift"
  | "can_bypass_shift_lock"
  | "can_shift_cash_count"
  | "can_shift_expected_cash_view"
  | "can_shift_counted_cash_view"
  | "can_shift_variance_view"
  | "can_shift_financial_summary_view"
  | "can_shift_payment_breakdown_view"
  | "can_shift_closing_history_view"
  | "can_shift_report_reprint"
  | "can_manage_other_shifts"
  | "can_shift_variance_approve"
  | "can_shift_cash_recount"
  | "can_delete_line"
  | "can_reduce_qty"
  | "can_discount_bill"
  | "can_override_price"
  | "can_void_cart"
  | "can_no_sale_open"
  | "can_edit_tenders"
  | "can_process_sale"
  | "can_give_discount"
  | "can_void_item"
  | "can_hold_cart"
  | "can_view_held_orders"
  | "can_reopen_held_order"
  | "can_discard_held_order"
  | "can_process_refund"
  | "can_process_exchange"
  | "can_reprint_bill"
  | "can_send_whatsapp_bill"
  | "can_manage_bookings"
  | "can_create_booking"
  | "can_collect_booking"
  | "can_cancel_booking"
  | "can_view_inventory"
  | "can_edit_product_price"
  | "can_add_new_product"
  | "can_edit_product_details"
  | "can_link_product_barcode"
  | "can_archive_product"
  | "can_restore_product"
  | "can_publish_product"
  | "can_receive_purchase_order"
  | "can_adjust_stock"
  | "can_create_transfer"
  | "can_receive_transfer"
  | "can_approve_transfer"
  | "can_manage_locations"
  | "can_manage_categories"
  | "can_bulk_edit_products"
  | "can_merge_products"
  | "can_add_member"
  | "can_edit_member_points"
  | "can_apply_member_discount"
  | "can_redeem_points"
  | "can_view_member_history"
  | "can_view_sales_reports"
  | "can_view_dashboard"
  | "can_view_audit_trail"
  | "can_export_reports"
  | "can_access_pos_settings"
  | "can_manage_staff"
  | "can_manage_promotions"
  | "can_manage_terminals"
  | "can_manage_sync_backup";

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  can_open_drawer: "Open cash drawer",
  can_close_drawer: "Close / count drawer",
  can_view_drawer_balance: "View drawer balance",
  can_open_shift: "Open a shift",
  can_close_shift: "Close a shift / run Z-report",
  can_bypass_shift_lock: "Use the terminal without an open shift",
  can_shift_cash_count: "Submit the closing cash count",
  can_shift_expected_cash_view: "See expected cash for a shift",
  can_shift_counted_cash_view: "See cash counted during shift closing",
  can_shift_variance_view: "See shift over/short variance",
  can_shift_financial_summary_view: "See the financial summary for a shift",
  can_shift_payment_breakdown_view: "See the payment-method breakdown for a shift",
  can_shift_closing_history_view: "See completed shift-closing history",
  can_shift_report_reprint: "Reprint a completed shift closing report",
  can_manage_other_shifts: "Close or manage another user's or terminal's shift",
  can_shift_variance_approve: "Approve a shift variance and finalise the close",
  can_shift_cash_recount: "Authorise and submit a drawer recount",
  can_delete_line: "Delete a line from the cart",
  can_reduce_qty: "Reduce an item quantity",
  can_discount_bill: "Apply a bill-level discount",
  can_override_price: "Override a price at the till",
  can_void_cart: "Void the whole cart",
  can_no_sale_open: "Open the drawer without a sale",
  can_edit_tenders: "Edit split-payment tenders",
  can_process_sale: "Process a sale",
  can_give_discount: "Give discounts",
  can_void_item: "Void a line item",
  can_hold_cart: "Hold / park a cart",
  can_view_held_orders: "View held tickets",
  can_reopen_held_order: "Reopen a held ticket",
  can_discard_held_order: "Discard a held ticket",
  can_process_refund: "Process refunds",
  can_process_exchange: "Process exchanges",
  can_reprint_bill: "Reprint / re-issue a bill",
  can_send_whatsapp_bill: "Send a bill by WhatsApp",
  can_manage_bookings: "Take and collect bookings (pay later)",
  can_create_booking: "Create bookings / racket jobs",
  can_collect_booking: "Collect bookings & take part payments",
  can_cancel_booking: "Cancel or delete a booking / job",
  can_view_inventory: "View inventory",
  can_edit_product_price: "Edit product pricing",
  can_add_new_product: "Add new products",
  can_edit_product_details: "Edit product details",
  can_link_product_barcode: "Link barcodes to products",
  can_archive_product: "Archive products",
  can_restore_product: "Restore archived products",
  can_publish_product: "Show or hide products online",
  can_receive_purchase_order: "Receive purchase orders",
  can_adjust_stock: "Adjust / recount stock",
  can_create_transfer: "Create stock transfer requests",
  can_receive_transfer: "Approve / receive transfers",
  can_approve_transfer: "Authorise transfers before stock moves",
  can_manage_locations: "Manage locations & warehouses",
  can_manage_categories: "Manage categories, sub-categories & units",
  can_bulk_edit_products: "Bulk edit or delete products",
  can_merge_products: "Merge duplicate products / add alias barcodes",
  can_add_member: "Add members",
  can_edit_member_points: "Edit member points",
  can_apply_member_discount: "Apply member discount",
  can_redeem_points: "Redeem loyalty points at the till",
  can_view_member_history: "View member purchase history",
  can_view_sales_reports: "View sales reports",
  can_view_dashboard: "View the live dashboard",
  can_view_audit_trail: "View register activity / audit trail",
  can_export_reports: "Export or download report data",
  can_access_pos_settings: "Access POS settings",
  can_manage_staff: "Manage staff & permissions",
  can_manage_promotions: "Edit promotions & coupon rules",
  can_manage_terminals: "Manage terminal activation tokens",
  can_manage_sync_backup: "Manage database connection",
};

export const PERMISSION_KEYS = Object.keys(PERMISSION_LABELS) as PermissionKey[];

export type StaffPermissions = Record<PermissionKey, boolean>;

const build = (on: PermissionKey[]): StaffPermissions =>
  PERMISSION_KEYS.reduce((acc, k) => {
    acc[k] = on.includes(k);
    return acc;
  }, {} as StaffPermissions);

export const FULL_PERMISSIONS: StaffPermissions = build(PERMISSION_KEYS);
export const NO_PERMISSIONS: StaffPermissions = build([]);

/** Baseline a brand-new cashier starts with. */
export const CASHIER_PERMISSIONS: StaffPermissions = build([
  "can_open_drawer",
  "can_close_drawer",
  "can_open_shift",
  "can_close_shift",
  "can_shift_cash_count",
  "can_process_sale",
  "can_hold_cart",
  "can_view_held_orders",
  "can_reopen_held_order",
  "can_reprint_bill",
  "can_manage_bookings",
  "can_create_booking",
  "can_collect_booking",
  "can_view_inventory",
  "can_add_member",
  "can_apply_member_discount",
  "can_view_member_history",
]);

/** Kept for existing screens that still ask for the older coarse flags. */
export const DEFAULT_PERMISSIONS = CASHIER_PERMISSIONS;

/** Baseline a brand-new warehouse user starts with. Every key stays editable
 *  from the Staff Management permission matrix — nothing is hard-locked. */
export const WAREHOUSE_PERMISSIONS: StaffPermissions = build([
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
]);

// --------------------------------------------------------------------------
// Simplified roles. The database enum is app_role (admin | manager | staff).
// Cashiers live in public.cashiers, so an app_users row with role `staff`
// is a warehouse account.
// --------------------------------------------------------------------------
export type StaffRole = "cashier" | "warehouse" | "supervisor" | "admin";
export const STAFF_ROLES: StaffRole[] = ["cashier", "warehouse", "supervisor", "admin"];

export type DbRole = "admin" | "manager" | "staff";

export const toDbRole = (role: StaffRole): DbRole =>
  role === "admin" ? "admin" : role === "supervisor" ? "manager" : "staff";

export const fromDbRole = (role: string | null | undefined): StaffRole =>
  role === "admin" ? "admin" : role === "manager" ? "supervisor" : "warehouse";

export const rolePermissions = (role: StaffRole): StaffPermissions =>
  role === "cashier"
    ? { ...CASHIER_PERMISSIONS }
    : role === "warehouse"
      ? { ...WAREHOUSE_PERMISSIONS }
      : role === "supervisor"
        ? { ...SUPERVISOR_PERMISSIONS }
        : { ...FULL_PERMISSIONS };

// --------------------------------------------------------------------------
// Legacy flag aliases used by older screens / nav config.
// --------------------------------------------------------------------------
export type LegacyFlag =
  "financials" | "products" | "ecommerce" | "can_refund" | "can_open_drawer_manual";

const LEGACY_MAP: Record<LegacyFlag, PermissionKey> = {
  financials: "can_view_sales_reports",
  products: "can_add_new_product",
  ecommerce: "can_edit_product_price",
  can_refund: "can_process_refund",
  can_open_drawer_manual: "can_open_drawer",
};

export type PermissionFlag = PermissionKey | LegacyFlag;

export const resolvePermission = (flag: PermissionFlag): PermissionKey =>
  (LEGACY_MAP as Record<string, PermissionKey>)[flag] ?? (flag as PermissionKey);

/** Normalise any stored JSONB blob (old or new shape) into a full matrix. */
export function normalizePermissions(
  raw: Record<string, unknown> | null | undefined,
  role: StaffRole = "cashier",
): StaffPermissions {
  const limited = role === "cashier" || role === "warehouse";
  const base = limited ? { ...NO_PERMISSIONS } : { ...FULL_PERMISSIONS };
  // No stored matrix yet → fall back to the role's default preset.
  if (!raw) return rolePermissions(role);
  for (const [key, value] of Object.entries(raw)) {
    const resolved = resolvePermission(key as PermissionFlag);
    if (resolved in base) base[resolved] = !!value;
  }
  // Existing cashier matrices predate the split hold controls. Preserve their
  // current workflow once, while every subsequently saved matrix carries the
  // three independent choices explicitly.
  if (limited && !("can_view_held_orders" in raw))
    base.can_view_held_orders = raw["can_hold_cart"] === true;
  if (limited && !("can_reopen_held_order" in raw))
    base.can_reopen_held_order = raw["can_hold_cart"] === true;
  if (limited && !("can_discard_held_order" in raw))
    base.can_discard_held_order = raw["can_void_cart"] === true;
  // Product catalogue actions used to share can_add_new_product. Preserve the
  // old behavior once, then store each choice independently on the next save.
  for (const key of [
    "can_edit_product_details",
    "can_link_product_barcode",
    "can_archive_product",
    "can_restore_product",
    "can_publish_product",
  ] as const) {
    if (limited && !(key in raw)) base[key] = base.can_add_new_product === true;
  }
  // Terminal registration belongs to supervisors and administrators even when
  // an older stored matrix still carries the former supervisor default (false).
  if (role === "supervisor") base.can_manage_terminals = true;
  return base;
}

// --------------------------------------------------------------------------
// One place every screen asks "is this person allowed to …".
// --------------------------------------------------------------------------

/** Anything that can carry permissions: a signed-in user, or a bare matrix. */
export type PermissionSubject =
  | {
      role?: string | null;
      roleSlug?: string | null;
      permissions?: Record<string, unknown> | null;
    }
  | Record<string, unknown>
  | null
  | undefined;

const matrixOf = (subject: PermissionSubject): Record<string, unknown> => {
  if (!subject) return {};
  const withPerms = subject as { permissions?: Record<string, unknown> | null };
  if (withPerms.permissions && typeof withPerms.permissions === "object")
    return withPerms.permissions;
  return subject as Record<string, unknown>;
};

/** Administrators are never blocked by the matrix. */
const isAdminSubject = (subject: PermissionSubject): boolean => {
  const s = (subject ?? {}) as { role?: unknown; roleSlug?: unknown };
  return s.role === "admin" || s.roleSlug === "admin";
};

/** Is this person allowed to do `flag`? Legacy flag names are accepted. */
export function hasPermission(subject: PermissionSubject, flag: PermissionFlag | string): boolean {
  if (isAdminSubject(subject)) return true;
  return !!matrixOf(subject)[resolvePermission(flag as PermissionFlag)];
}

/** Allowed to do at least one of these. */
export function hasAnyPermission(
  subject: PermissionSubject,
  flags: (PermissionFlag | string)[],
): boolean {
  return flags.some((f) => hasPermission(subject, f));
}

/** Allowed to do every one of these. */
export function hasAllPermissions(
  subject: PermissionSubject,
  flags: (PermissionFlag | string)[],
): boolean {
  return flags.every((f) => hasPermission(subject, f));
}

/**
 * Roles seen the last time the roles table answered, kept in memory so the
 * resolver below still works with no connection.
 */
type CachedRole = { slug: string; baseLevel: StaffRole; permissions: StaffPermissions };
const roleCache = new Map<string, CachedRole>();

export function cacheRoleDefinitions(roles: CachedRole[]) {
  for (const r of roles) if (r.slug) roleCache.set(r.slug, r);
}

export function cachedRoleDefinition(slug: string | null | undefined): CachedRole | null {
  return slug ? (roleCache.get(slug) ?? null) : null;
}

/**
 * The permissions a role grants before any per-person tuning: a custom role
 * from the roles table when we know it, otherwise the built-in preset.
 */
export function getEffectivePermissions(
  roleSlug: string | null | undefined,
  overrides?: Record<string, unknown> | null,
): StaffPermissions {
  const cached = roleSlug ? roleCache.get(roleSlug) : null;
  const base: StaffRole =
    cached?.baseLevel ??
    (roleSlug === "admin" ||
    roleSlug === "supervisor" ||
    roleSlug === "warehouse" ||
    roleSlug === "cashier"
      ? (roleSlug as StaffRole)
      : "cashier");
  const preset = cached ? { ...cached.permissions } : rolePermissions(base);
  if (!overrides || Object.keys(overrides).length === 0) return preset;
  const merged = { ...preset };
  for (const [key, value] of Object.entries(overrides)) {
    const resolved = resolvePermission(key as PermissionFlag);
    if (resolved in merged) merged[resolved] = !!value;
  }
  return merged;
}

// --------------------------------------------------------------------------
// Role presets and permission tags.
//
// One source of truth: the same presets drive account creation, the Accounts
// screen preset picker and custom-role base levels. Tags sit *over* the matrix
// and decide what a role can see; the matrix still decides what may be done.
// --------------------------------------------------------------------------

/** Supervisors run the floor and may register devices, but do not own staff,
 *  sync/backup or general settings. */
export const SUPERVISOR_PERMISSIONS: StaffPermissions = build(
  PERMISSION_KEYS.filter(
    (k) =>
      k !== "can_manage_staff" && k !== "can_manage_sync_backup" && k !== "can_access_pos_settings",
  ),
);

/** Every built-in level with the permissions a brand-new account starts on. */
export const ROLE_PRESETS: Record<StaffRole, StaffPermissions> = {
  cashier: CASHIER_PERMISSIONS,
  warehouse: WAREHOUSE_PERMISSIONS,
  supervisor: SUPERVISOR_PERMISSIONS,
  admin: FULL_PERMISSIONS,
};

export const ROLE_LABELS: Record<StaffRole, string> = {
  cashier: "Cashier",
  warehouse: "Warehouse",
  supervisor: "Supervisor",
  admin: "Owner / Administrator",
};

export type PermissionTag =
  "cashier-visible" | "inventory-access" | "reports-access" | "supervisor-only" | "admin-only";

export const TAG_LABELS: Record<PermissionTag, string> = {
  "cashier-visible": "Till floor",
  "inventory-access": "Stock & supply",
  "reports-access": "Reporting",
  "supervisor-only": "Supervisor",
  "admin-only": "Administrator",
};

/** Which roles a tag is meant for, and the permissions it bundles. */
export const PERMISSION_TAGS: Record<PermissionTag, { roles: StaffRole[]; keys: PermissionKey[] }> =
  {
    "cashier-visible": {
      roles: ["cashier", "supervisor", "admin"],
      keys: [
        "can_open_drawer",
        "can_close_drawer",
        "can_view_drawer_balance",
        "can_open_shift",
        "can_close_shift",
        "can_bypass_shift_lock",
        "can_shift_cash_count",
        "can_shift_expected_cash_view",
        "can_shift_counted_cash_view",
        "can_shift_variance_view",
        "can_shift_financial_summary_view",
        "can_shift_payment_breakdown_view",
        "can_shift_closing_history_view",
        "can_shift_report_reprint",
        "can_manage_other_shifts",
        "can_shift_variance_approve",
        "can_shift_cash_recount",
        "can_delete_line",
        "can_reduce_qty",
        "can_discount_bill",
        "can_override_price",
        "can_void_cart",
        "can_no_sale_open",
        "can_edit_tenders",
        "can_process_sale",
        "can_give_discount",
        "can_void_item",
        "can_hold_cart",
        "can_view_held_orders",
        "can_reopen_held_order",
        "can_discard_held_order",
        "can_process_refund",
        "can_process_exchange",
        "can_reprint_bill",
        "can_send_whatsapp_bill",
        "can_manage_bookings",
        "can_create_booking",
        "can_collect_booking",
        "can_cancel_booking",
        "can_add_member",
        "can_apply_member_discount",
        "can_redeem_points",
        "can_view_member_history",
      ],
    },
    "inventory-access": {
      roles: ["warehouse", "supervisor", "admin"],
      keys: [
        "can_view_inventory",
        "can_edit_product_price",
        "can_add_new_product",
        "can_edit_product_details",
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
        "can_manage_categories",
        "can_bulk_edit_products",
        "can_merge_products",
      ],
    },
    "reports-access": {
      roles: ["supervisor", "admin"],
      keys: [
        "can_view_sales_reports",
        "can_view_dashboard",
        "can_view_audit_trail",
        "can_export_reports",
      ],
    },
    "supervisor-only": {
      roles: ["supervisor", "admin"],
      keys: ["can_edit_member_points", "can_manage_promotions", "can_manage_terminals"],
    },
    "admin-only": {
      roles: ["admin"],
      keys: ["can_access_pos_settings", "can_manage_staff", "can_manage_sync_backup"],
    },
  };

export const PERMISSION_TAG_KEYS = Object.keys(PERMISSION_TAGS) as PermissionTag[];

const TAG_OF_KEY = ((): Record<PermissionKey, PermissionTag> => {
  const map = {} as Record<PermissionKey, PermissionTag>;
  for (const tag of PERMISSION_TAG_KEYS) {
    for (const key of PERMISSION_TAGS[tag].keys) map[key] = tag;
  }
  return map;
})();

/** The tag a single permission belongs to. */
export const tagOfPermission = (flag: PermissionFlag): PermissionTag =>
  TAG_OF_KEY[resolvePermission(flag)] ?? "admin-only";

/** Tags a role is meant to see. Administrators see everything. */
export function tagsForRole(role: StaffRole): PermissionTag[] {
  if (role === "admin") return [...PERMISSION_TAG_KEYS];
  return PERMISSION_TAG_KEYS.filter((t) => PERMISSION_TAGS[t].roles.includes(role));
}

/** Is a screen carrying `tag` meant for this role? */
export const roleHasTag = (role: StaffRole, tag: PermissionTag): boolean =>
  role === "admin" || PERMISSION_TAGS[tag].roles.includes(role);
