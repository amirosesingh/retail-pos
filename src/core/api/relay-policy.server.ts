/**
 * Server-side authorisation for the POS write relay.
 *
 * The relay commits with the central service key, which bypasses every row
 * rule. That is unavoidable — a PIN cashier has no account on the central
 * database — so this module re-applies, in the server, exactly what the row
 * rules would have applied to a directly-authenticated staff member:
 *
 *   1. the caller's branch is resolved from their proof, never from the body;
 *   2. every row and every match is pinned to that branch;
 *   3. sensitive columns are re-checked against the caller's permissions.
 *
 * A caller who cannot be scoped writes nothing.
 */
import { serviceRest } from "@/core/api/pos-relay.server";
import type { RelayOp } from "@/core/api/pos-relay.server";
import { claimsFromPayload, normalisePermissions } from "@/core/api/relay-claims.server";
import type { CallerClaims } from "@/core/api/relay-claims.server";

export type RelayScope = {
  kind: "cashier" | "terminal" | "staff";
  label: string;
  storeId: string | null;
  role: string | null;
  roleSlug: string | null;
  permissions: Record<string, boolean>;
  /** Admin / manager: allowed to write across branches. */
  isSupervisor: boolean;
  /** Who is acting: app_users.user_id, used for attribution only. */
  staffUserId?: string | null;
  /** Human name written onto rows so attribution is server-truth. */
  actorName?: string | null;
  terminalId?: string | null;
  /** Claims answered the question but no account row backed them up. */
  stale?: boolean;
};

export type RelayDenial = {
  ok: false;
  code:
    "TABLE_FORBIDDEN" | "STORE_FORBIDDEN" | "PERMISSION_DENIED" | "SCOPE_MISSING" | "SCOPE_STALE";
  error: string;
};

/** Tables the relay may write, and the column that carries the branch. */
const STORE_COLUMN: Record<string, string> = {
  sales: "store_id",
  shifts: "store_id",
  shift_notifications: "store_id",
  shift_sessions: "store_id",
  held_orders: "store_id",
  bookings: "store_id",
  drawer_events: "store_id",
  stock_adjustments: "store_id",
  stock_count_drafts: "store_id",
  sku_audit: "store_id",
  purchase_orders: "store_id",
  whatsapp_queue: "store_id",
  payment_transactions: "store_id",
  item_activity_logs: "store_id",
  // Branch trading rules. The branch column is the row's own key, so a till
  // can only ever write its own branch's rules; supervisors reach any branch.
  pos_store_settings: "store_id",
  authorization_requests: "store_id",
  authorization_log: "store_id",
  record_edits: "store_id",
  activity_events: "store_id",
  entity_status_history: "store_id",
  member_verifications: "store_id",
};

/** Child rows carry no branch of their own; their parent decides. */
const PARENT_OF: Record<string, { table: string; fk: string; parentStoreColumn: string }> = {
  sale_items: { table: "sales", fk: "sale_id", parentStoreColumn: "store_id" },
  booking_payments: { table: "bookings", fk: "booking_id", parentStoreColumn: "store_id" },
  purchase_order_items: { table: "purchase_orders", fk: "po_id", parentStoreColumn: "store_id" },
  stock_transfer_items: {
    table: "stock_transfers",
    fk: "transfer_id",
    parentStoreColumn: "from_store_id",
  },
};

/** Global catalogue tables: no branch, but permission-gated columns. */
const GLOBAL_TABLES = new Set([
  "products",
  "members",
  "audit_logs",
  "public_flags",
  "authorization_actions",
  "pos_settings",
  "settings_overrides",
  "settings_locks",
  "promotions",
  "coupon_campaigns",
  "suppliers",
]);

/** Both ends of a transfer may write it. */
const TRANSFER_TABLE = "stock_transfers";

/**
 * The branch registry itself. Its branch column is the row's own `id`, so it
 * cannot go through the ordinary store-pinning path: a supervisor may create
 * or edit any branch, and everyone else may only touch their own row.
 */
const STORES_TABLE = "stores";
const SCOPED_SETTINGS_TABLE = "settings_scoped";

/**
 * Who did it. These columns are written from the proven caller and any value
 * the till sent is discarded, so a receipt can never name another cashier.
 */
type ActorColumns = { id?: string; name?: string; role?: string };
const ACTOR_COLUMNS: Record<string, ActorColumns> = {
  sales: { id: "cashier_id", name: "cashier_name" },
  shift_sessions: { id: "staff_id", name: "staff_name", role: "role" },
  drawer_events: { id: "staff_id", name: "staff_name", role: "role" },
  stock_adjustments: { id: "staff_id", name: "staff_name", role: "role" },
  stock_count_drafts: { id: "staff_id", name: "staff_name" },
  sku_audit: { id: "staff_id", name: "staff_name", role: "role" },
  bookings: { name: "cashier" },
  held_orders: { name: "held_by" },
  purchase_orders: { name: "operator_name" },
  // The audit trail carries no branch column, so the only thing worth
  // pinning is who acted — never the name the till chose to send.
  audit_logs: { id: "user_id", name: "user_name" },
};

/** Shift rows record who opened and, later, who closed. */
const SHIFT_OPEN: ActorColumns = {
  id: "opened_by_staff_id",
  name: "opened_by_name",
  role: "opened_by_role",
};
const SHIFT_CLOSE: ActorColumns = {
  id: "closed_by_staff_id",
  name: "closed_by_name",
  role: "closed_by_role",
};

/** column -> permission flag required to set it. */
const COLUMN_PERMISSIONS: Record<string, Record<string, string>> = {
  products: {
    selling_price: "can_edit_product_price",
    cost_price: "can_edit_product_price",
    ecom_price: "can_edit_product_price",
    landing_pct: "can_edit_product_price",
    reorder_level: "can_edit_product_details",
    stock_quantity: "can_adjust_stock",
    stock_by_store: "can_adjust_stock",
  },
  members: {
    tier_id: "can_edit_member_points",
    loyalty_points: "can_edit_member_points",
    total_spent: "can_edit_member_points",
  },
  sales: {
    is_refunded: "can_process_refund",
    discount_amount: "can_give_discount",
    payment_type: "can_edit_tenders",
  },
  sale_items: {
    discount_percent: "can_give_discount",
    discount_amount: "can_give_discount",
  },
  purchase_orders: { total_cost: "can_receive_purchase_order" },
  purchase_order_items: { cost_price: "can_receive_purchase_order" },
};

/** Whole-table gates for a given operation kind. */
const TABLE_PERMISSIONS: Record<string, { write?: string; remove?: string }> = {
  purchase_orders: { write: "can_receive_purchase_order" },
  purchase_order_items: { write: "can_receive_purchase_order" },
  stock_adjustments: { write: "can_adjust_stock" },
  stock_count_drafts: { write: "can_adjust_stock", remove: "can_adjust_stock" },
  sales: { remove: "can_void_item" },
  sale_items: { remove: "can_void_item" },
  members: { write: "can_add_member" },
  // Only an account allowed into POS settings may change trading rules.
  pos_store_settings: { write: "can_access_pos_settings", remove: "can_access_pos_settings" },
  authorization_actions: { write: "can_access_pos_settings", remove: "can_access_pos_settings" },
  pos_settings: { write: "can_access_pos_settings", remove: "can_access_pos_settings" },
  settings_overrides: { write: "can_access_pos_settings", remove: "can_access_pos_settings" },
  settings_locks: { write: "can_access_pos_settings", remove: "can_access_pos_settings" },
  public_flags: { write: "can_access_pos_settings", remove: "can_access_pos_settings" },
  promotions: { write: "can_manage_promotions", remove: "can_manage_promotions" },
  coupon_campaigns: { write: "can_manage_promotions", remove: "can_manage_promotions" },
  suppliers: { write: "can_receive_purchase_order", remove: "can_receive_purchase_order" },
  settings_scoped: { write: "can_edit_product_price" },
};

export const RELAY_WRITABLE_TABLES = new Set([
  ...Object.keys(STORE_COLUMN),
  ...Object.keys(PARENT_OF),
  ...GLOBAL_TABLES,
  TRANSFER_TABLE,
  STORES_TABLE,
  SCOPED_SETTINGS_TABLE,
]);

const deny = (code: RelayDenial["code"], error: string): RelayDenial => ({
  ok: false,
  code,
  error,
});

type AppUserRow = {
  user_id?: string | null;
  full_name?: string | null;
  store_id?: string | null;
  role?: string | null;
  role_slug?: string | null;
  permissions?: unknown;
  is_active?: boolean | null;
};

const SELECT_APP_USER = "select=user_id,full_name,store_id,role,role_slug,permissions,is_active";

/**
 * Short-lived cache so a burst of queued operations from one till costs a
 * single lookup instead of one per operation.
 */
const CACHE_TTL_MS = 30_000;
const userCache = new Map<string, { at: number; row: AppUserRow | null }>();

async function fetchAppUser(filter: string): Promise<AppUserRow | null> {
  const hit = userCache.get(filter);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.row;
  const res = await serviceRest(`app_users?${filter}&${SELECT_APP_USER}&limit=1`);
  if (!res.ok) return null; // transient failure: do not cache
  const rows = (await res.json()) as AppUserRow[];
  const row = rows[0];
  const value = !row || row.is_active === false ? null : row;
  userCache.set(filter, { at: Date.now(), row: value });
  return value;
}

const supervisorRole = (role: string | null, slug: string | null) =>
  role === "admin" || role === "manager" || slug === "admin" || slug === "supervisor";

/**
 * Work out the caller's branch, identity and permissions.
 *
 * Fast path: the proof's own signed claims already answer it. Fallback: look
 * the account up in app_users (cached briefly). A caller whose claims name a
 * branch but whose account row is missing is not refused outright — the scope
 * is marked stale so the till is told to refresh instead of retrying forever.
 */
export async function resolveRelayScope(caller: {
  kind: "cashier" | "terminal" | "staff";
  label: string;
  storeId?: string | null;
  staffUserId?: string | null;
  email?: string | null;
  authUserId?: string | null;
  claims?: CallerClaims | null;
  terminalId?: string | null;
}): Promise<RelayScope> {
  const claims = caller.claims ?? null;
  const fastEnough = claims && claims.storeId && claims.role && claims.permissions !== null;

  let row: AppUserRow | null = null;
  if (!fastEnough) {
    if (caller.authUserId)
      row = await fetchAppUser(`auth_user_id=eq.${encodeURIComponent(caller.authUserId)}`);
    if (!row && caller.staffUserId)
      row = await fetchAppUser(`user_id=eq.${encodeURIComponent(caller.staffUserId)}`);
    // An account created before the auth link existed is still findable by the
    // address it signs in with.
    if (!row && caller.email)
      row = await fetchAppUser(`email=eq.${encodeURIComponent(caller.email)}`);
    if (!row && caller.kind !== "terminal" && caller.label)
      row = await fetchAppUser(`user_id=eq.${encodeURIComponent(caller.label)}`);
    if (!row && caller.kind !== "terminal" && caller.label.includes("@"))
      row = await fetchAppUser(`email=eq.${encodeURIComponent(caller.label)}`);
  }

  const role = row?.role ?? claims?.role ?? null;
  const roleSlug = row?.role_slug ?? claims?.roleSlug ?? null;
  const permissions = row ? normalisePermissions(row.permissions) : (claims?.permissions ?? {});
  const staffUserId = row?.user_id ?? caller.staffUserId ?? claims?.staffUserId ?? null;
  const isSupervisor = supervisorRole(role, roleSlug);

  return {
    kind: caller.kind,
    label: caller.label,
    // The proof's own branch wins: a terminal token is physically bound to a
    // branch, and a session records the branch it was opened at.
    storeId: caller.storeId ?? row?.store_id ?? claims?.storeId ?? null,
    role,
    roleSlug,
    permissions,
    isSupervisor,
    staffUserId,
    actorName: row?.full_name ?? claims?.actorName ?? caller.label ?? null,
    terminalId: caller.terminalId ?? null,
    // No account row and no usable claims: the caller can still be identified
    // but their permissions are unknown, so writes are refused as stale. A
    // proven supervisor is never stale — their role already answers it.
    stale: !row && !fastEnough && caller.kind === "staff" && !isSupervisor,
  };
}

/** Re-export so callers can build a scope from a verified token payload. */
export { claimsFromPayload };

const allowed = (scope: RelayScope, flag: string | undefined) =>
  !flag || scope.role === "admin" || scope.roleSlug === "admin" || scope.permissions[flag] === true;

async function parentStore(child: string, id: unknown): Promise<string | null | undefined> {
  const parent = PARENT_OF[child];
  if (!parent || id === undefined || id === null) return undefined;
  const res = await serviceRest(
    `${parent.table}?id=eq.${encodeURIComponent(String(id))}&select=${parent.parentStoreColumn}&limit=1`,
  );
  if (!res.ok) return undefined;
  const rows = (await res.json()) as Record<string, unknown>[];
  const row = rows[0];
  if (!row) return undefined;
  const value = row[parent.parentStoreColumn];
  return value === null || value === undefined ? null : String(value);
}

const visibleStore = (scope: RelayScope, storeId: string | null | undefined) =>
  scope.isSupervisor || (!!storeId && storeId === scope.storeId);

function canonicalJsonValue(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return canonicalJsonValue(JSON.parse(trimmed));
      } catch {
        // Ordinary tender labels remain strings.
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalJsonValue(item)]),
    );
  }
  return value ?? null;
}

const sameJsonValue = (left: unknown, right: unknown) =>
  JSON.stringify(canonicalJsonValue(left)) === JSON.stringify(canonicalJsonValue(right));

const PRODUCT_FIELD_PERMISSIONS: Readonly<Record<string, string>> = {
  selling_price: "can_edit_product_price",
  cost_price: "can_edit_product_price",
  ecom_price: "can_edit_product_price",
  landing_pct: "can_edit_product_price",
  name: "can_edit_product_details",
  sku: "can_edit_product_details",
  barcode: "can_edit_product_details",
  category: "can_edit_product_details",
  sub_category: "can_edit_product_details",
  product_group: "can_edit_product_details",
  brand: "can_edit_product_details",
  unit: "can_edit_product_details",
  packs: "can_edit_product_details",
  reorder_level: "can_edit_product_details",
  tax_rate: "can_edit_product_details",
  barcode_aliases: "can_link_product_barcode",
  barcode_variants: "can_link_product_barcode",
  ecom_visible: "can_publish_product",
  stock_quantity: "can_adjust_stock",
  stock_by_store: "can_adjust_stock",
};

const PRODUCT_GUARD_COLUMNS = [
  "id",
  ...Object.keys(PRODUCT_FIELD_PERMISSIONS),
  "is_archived",
] as const;

/**
 * Product writes use the service role in the relay, so the database trigger
 * cannot see the cashier's identity. Reapply the same granular permission
 * comparison here against the stored row before any service-role write.
 */
async function authorizeProductOp(
  op: RelayOp,
  scope: RelayScope,
): Promise<{ ok: true; op: RelayOp } | RelayDenial> {
  if (scope.role === "admin" || scope.roleSlug === "admin") return { ok: true, op };
  if (op.kind === "delete") {
    if (
      scope.permissions.can_bulk_edit_products !== true &&
      scope.permissions.can_merge_products !== true
    )
      return deny("PERMISSION_DENIED", "Your account cannot permanently remove products.");
    return { ok: true, op };
  }

  const payloads = op.kind === "update" ? [op.values] : op.rows;
  const ids = [
    ...new Set(
      (op.kind === "update" ? [op.match["id"]] : payloads.map((row) => row["id"]))
        .filter((id) => id != null && String(id))
        .map(String),
    ),
  ];
  const existing = new Map<string, Record<string, unknown>>();
  if (ids.length) {
    const encoded = ids.map((id) => encodeURIComponent(id)).join(",");
    const response = await serviceRest(
      `products?id=in.(${encoded})&select=${PRODUCT_GUARD_COLUMNS.join(",")}`,
    );
    if (!response.ok)
      return deny("PERMISSION_DENIED", "The existing product could not be verified — try again.");
    for (const row of (await response.json()) as Record<string, unknown>[]) {
      if (row["id"] != null) existing.set(String(row["id"]), row);
    }
  }

  for (const payload of payloads) {
    const id = String(
      payload["id"] ?? (op.kind === "update" ? op.match["id"] : "") ?? "",
    );
    const before = existing.get(id);
    if (!before) {
      if (!allowed(scope, "can_add_new_product"))
        return deny("PERMISSION_DENIED", "Your account cannot add products.");
      continue;
    }
    for (const [column, permission] of Object.entries(PRODUCT_FIELD_PERMISSIONS)) {
      if (
        payload[column] !== undefined &&
        !sameJsonValue(payload[column], before[column]) &&
        !allowed(scope, permission)
      )
        return deny("PERMISSION_DENIED", `Your account cannot change "${column}".`);
    }
    if (
      payload["is_archived"] !== undefined &&
      !sameJsonValue(payload["is_archived"], before["is_archived"])
    ) {
      const permission = payload["is_archived"]
        ? "can_archive_product"
        : "can_restore_product";
      if (!allowed(scope, permission))
        return deny("PERMISSION_DENIED", "Your account cannot change product archive status.");
    }
  }
  return { ok: true, op };
}

/** A cashier may create a sale with tenders, but cannot change tenders later. */
async function upsertChangesExistingTender(rows: Record<string, unknown>[]): Promise<boolean> {
  for (const row of rows) {
    if (row["payment_type"] === undefined && row["payments"] === undefined) continue;
    const id = String(row["id"] ?? "").trim();
    if (!id) return true;
    const response = await serviceRest(
      `sales?id=eq.${encodeURIComponent(id)}&select=id,payment_type,payments&limit=1`,
    );
    if (!response.ok) return true;
    const existing = ((await response.json()) as Record<string, unknown>[])[0];
    if (!existing) continue;
    if (
      (row["payment_type"] !== undefined &&
        !sameJsonValue(row["payment_type"], existing["payment_type"])) ||
      (row["payments"] !== undefined && !sameJsonValue(row["payments"], existing["payments"]))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Apply the branch and permission rules to one queued operation, returning a
 * rewritten operation that is safe to run with service rights.
 */
export async function authorizeRelayOp(
  op: RelayOp,
  scope: RelayScope,
  /** ids inserted earlier in the same request, so child-first pushes work. */
  batchIds?: Map<string, Set<string>>,
): Promise<{ ok: true; op: RelayOp } | RelayDenial> {
  if (!RELAY_WRITABLE_TABLES.has(op.table))
    return deny("TABLE_FORBIDDEN", `"${op.table}" cannot be synced`);

  if (!scope.isSupervisor && !scope.storeId)
    return deny("SCOPE_MISSING", "This till is not assigned to a branch — sign in again.");
  const settingsAdmin = scope.role === "admin" || scope.roleSlug === "admin";
  if (["pos_settings", "public_flags"].includes(op.table) && !settingsAdmin)
    return deny("PERMISSION_DENIED", "Global settings require an administrator.");
  if (["settings_overrides", "settings_locks"].includes(op.table))
    return authorizeSettingsMutation(op, scope);


  if (scope.stale && !scope.isSupervisor)
    return deny(
      "SCOPE_STALE",
      "Your account details could not be confirmed — sign in again to refresh them.",
    );

  const isAdmin = scope.role === "admin" || scope.roleSlug === "admin";
  if (op.table === "sales" && !isAdmin && scope.kind !== "terminal") {
    const rows = op.kind === "insert" || op.kind === "upsert" ? op.rows : op.kind === "update" ? [op.values] : [];
    if (rows.some(row => String(row.original_bill_number ?? "").startsWith("OLDPOS:")))
      return deny("PERMISSION_DENIED", "Only an administrator can enter an old POS exchange.");
  }
  if (op.table === "products") {
    const productAccess = await authorizeProductOp(op, scope);
    if (!productAccess.ok) return productAccess;
  }
  let saleTenderCorrection = false;
  if (op.table === "sales" && !isAdmin) {
    saleTenderCorrection =
      (op.kind === "update" &&
        (op.values["payment_type"] !== undefined || op.values["payments"] !== undefined)) ||
      (op.kind === "upsert" && (await upsertChangesExistingTender(op.rows)));
    if (saleTenderCorrection) {
      return deny("PERMISSION_DENIED", "Only an administrator can correct a completed payment.");
    }
  }
  if (op.table === "record_edits" && !isAdmin) {
    return deny("PERMISSION_DENIED", "Only an administrator can write correction history.");
  }

  if (op.table === "authorization_requests" && !scope.isSupervisor) {
    if (op.kind !== "insert" && op.kind !== "upsert")
      return deny("PERMISSION_DENIED", "Only a supervisor can change an authorization decision.");
    op = {
      ...op,
      rows: op.rows.map((row) => ({
        ...row,
        status: "pending",
        decided_by: null,
        decided_by_name: null,
        decided_at: null,
        decision_note: null,
        approved_amount: null,
        approved_payload: {},
        consumed_at: null,
      })),
    } as RelayOp;
  }

  const appendOnlyTables = new Set([
    "authorization_log",
    "record_edits",
    "activity_events",
    "entity_status_history",
    "member_verifications",
    "shift_notifications",
  ]);
  if (appendOnlyTables.has(op.table) && op.kind !== "insert" && op.kind !== "upsert")
    return deny("PERMISSION_DENIED", `"${op.table}" is append-only through terminal sync.`);

  const gate = TABLE_PERMISSIONS[op.table];
  if (op.kind === "delete") {
    if (!allowed(scope, gate?.remove))
      return deny("PERMISSION_DENIED", "Your account cannot remove these records.");
  } else if (!allowed(scope, gate?.write)) {
    return deny("PERMISSION_DENIED", "Your account cannot change these records.");
  }

  // Column-level permission checks on the values actually being written.
  const columnGate = COLUMN_PERMISSIONS[op.table];
  if (columnGate) {
    const payloads =
      op.kind === "insert" || op.kind === "upsert"
        ? op.rows
        : op.kind === "update"
          ? [op.values]
          : [];
    for (const payload of payloads) {
      for (const column of Object.keys(payload)) {
        const flag = columnGate[column];
        if (
          op.table === "sales" &&
          column === "payment_type" &&
          (op.kind === "insert" || op.kind === "upsert") &&
          !saleTenderCorrection
        ) {
          continue;
        }
        if (flag && !allowed(scope, flag))
          return deny("PERMISSION_DENIED", `Your account cannot change "${column}".`);
      }
    }
  }

  op = stampActor(op, scope);

  if (op.table === STORES_TABLE) return authorizeStores(op, scope);

  if (op.table === SCOPED_SETTINGS_TABLE) return authorizeProductPriceOverride(op, scope);

  const storeColumn = STORE_COLUMN[op.table];
  if (storeColumn) return pinToStore(op, scope, storeColumn);

  if (op.table === TRANSFER_TABLE) return authorizeTransfer(op, scope);

  if (PARENT_OF[op.table]) return authorizeChild(op, scope, batchIds);

  // Global catalogue rows: no branch to pin, permissions already checked.
  return { ok: true, op };
}

/** Settings ownership is checked with the proved role and paired branch. */
export async function authorizeSettingsMutation(op: RelayOp, scope: RelayScope): Promise<{ok: true; op: RelayOp} | RelayDenial> {
  const admin = scope.role === "admin" || scope.roleSlug === "admin";
  if (scope.stale) return deny("SCOPE_STALE", "Sign in again to confirm your settings permissions.");
  if (scope.kind === "terminal" || (!admin && scope.permissions.can_access_pos_settings !== true))
    return deny("PERMISSION_DENIED", "Branch settings permission is required.");
  if (op.table === "settings_locks")
    return admin ? {ok: true, op} : deny("PERMISSION_DENIED", "Only an administrator may change global locks.");
  if (op.table !== "settings_overrides")
    return deny("TABLE_FORBIDDEN", "Unsupported settings mutation.");
  const rows = op.kind === "insert" || op.kind === "upsert" ? op.rows : [{...op.match, ...(op.kind === "update" ? op.values : {})}];
  for (const row of rows) {
    const tier = String(row.scope ?? "").toUpperCase();
    const id = String(row.scope_id ?? "");
    const section = String(row.section ?? "");
    if (!["CLUSTER", "BRANCH", "TERMINAL"].includes(tier) || !id || !/^[a-zA-Z0-9_-]+$/.test(section))
      return deny("PERMISSION_DENIED", "A complete, valid settings scope and section are required.");
    if (!admin && (tier !== "BRANCH" || id !== scope.storeId))
      return deny("STORE_FORBIDDEN", "You may only edit this terminal's branch settings.");
    if (!admin) {
      const response = await serviceRest(`settings_locks?select=locked&section=eq.${encodeURIComponent(section)}&limit=1`);
      if (!response.ok) return deny("PERMISSION_DENIED", "Could not verify the administrator settings lock.");
      const locks = await response.json() as Array<{locked?: boolean}>;
      if (locks[0]?.locked) return deny("PERMISSION_DENIED", "This setting is locked by an administrator.");
    }
  }
  return {ok: true, op};
}

/**
 * The generic relay must not become a service-role settings editor. Its only
 * scoped-settings use is the existing branch product-price override, pinned
 * to the proven branch and stripped of client-owned revision/timestamp data.
 */
function authorizeProductPriceOverride(
  op: RelayOp,
  scope: RelayScope,
): { ok: true; op: RelayOp } | RelayDenial {
  if (op.kind !== "insert" && op.kind !== "upsert")
    return deny("PERMISSION_DENIED", "Branch price overrides must be saved as one complete record.");

  const rows: Record<string, unknown>[] = [];
  for (const row of op.rows) {
    const branchId = String(row["scope_id"] ?? "");
    const key = String(row["key"] ?? "");
    const value = row["value"];
    if (
      String(row["scope"] ?? "").toUpperCase() !== "BRANCH" ||
      !branchId ||
      !key.startsWith("product_price:") ||
      key.length <= "product_price:".length ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) return deny("PERMISSION_DENIED", "Only a valid branch product-price override can be saved here.");
    if (!scope.isSupervisor && branchId !== scope.storeId)
      return deny("STORE_FORBIDDEN", "You cannot change another branch's prices.");

    const price = value as Record<string, unknown>;
    const sellingPrice = Number(price["selling_price"]);
    const rawEcomPrice = price["ecom_price"];
    const ecomPrice = rawEcomPrice == null ? null : Number(rawEcomPrice);
    if (!Number.isFinite(sellingPrice) || (ecomPrice !== null && !Number.isFinite(ecomPrice)))
      return deny("PERMISSION_DENIED", "Enter a valid branch selling price.");

    rows.push({
      scope: "BRANCH",
      scope_id: branchId,
      key,
      value: { selling_price: sellingPrice, ecom_price: ecomPrice },
      is_overridden: true,
      updated_by: scope.staffUserId ?? scope.actorName ?? null,
    });
  }
  return {
    ok: true,
    op: op.kind === "upsert"
      ? { ...op, rows, onConflict: "scope,scope_id,key" }
      : { ...op, rows },
  };
}

/** Overwrite the actor columns from the proven caller. */
function stampActor(op: RelayOp, scope: RelayScope): RelayOp {
  const base = ACTOR_COLUMNS[op.table];
  const isShift = op.table === "shifts";
  if (!base && !isShift) return op;

  const apply = (payload: Record<string, unknown>, closing: boolean) => {
    const cols = isShift ? (closing ? SHIFT_CLOSE : SHIFT_OPEN) : base!;
    const out = { ...payload };
    // Only stamp what the row is actually touching for updates of shifts, so
    // an unrelated edit does not rewrite the opener.
    if (cols.id && scope.staffUserId) out[cols.id] = scope.staffUserId;
    if (cols.name && scope.actorName) out[cols.name] = scope.actorName;
    if (cols.role && (scope.roleSlug ?? scope.role)) out[cols.role] = scope.roleSlug ?? scope.role;
    return out;
  };

  if (op.kind === "insert" || op.kind === "upsert")
    return { ...op, rows: op.rows.map((row) => apply(row, false)) };
  if (op.kind === "update") {
    // A shift update that sets closed_at is the close; anything else leaves
    // the opener alone and records nothing new.
    if (isShift) {
      const closing = op.values["closed_at"] !== undefined || op.values["status"] === "CLOSED";
      if (!closing) return op;
      return { ...op, values: apply(op.values, true) };
    }
    return { ...op, values: apply(op.values, false) };
  }
  return op;
}

function pinToStore(
  op: RelayOp,
  scope: RelayScope,
  column: string,
): { ok: true; op: RelayOp } | RelayDenial {
  if (op.kind === "insert" || op.kind === "upsert") {
    const rows = op.rows.map((row) => {
      const given = row[column];
      if (given !== undefined && given !== null && String(given) !== (scope.storeId ?? "")) {
        if (!scope.isSupervisor) throw new StoreViolation();
        return row;
      }
      return { ...row, [column]: scope.storeId ?? given ?? null };
    });
    return { ok: true, op: { ...op, rows } as RelayOp };
  }

  const given = op.match[column];
  if (given !== undefined && given !== null && String(given) !== (scope.storeId ?? "")) {
    if (!scope.isSupervisor)
      return deny("STORE_FORBIDDEN", "You cannot change another branch's records.");
    return { ok: true, op };
  }
  // Supervisors keep cross-branch reach; everyone else is pinned.
  const match = scope.isSupervisor ? op.match : { ...op.match, [column]: scope.storeId };
  if (op.kind === "update") {
    const values = { ...op.values };
    if (
      !scope.isSupervisor &&
      values[column] !== undefined &&
      String(values[column]) !== scope.storeId
    )
      return deny("STORE_FORBIDDEN", "A record cannot be moved to another branch.");
    return { ok: true, op: { ...op, values, match } };
  }
  return { ok: true, op: { ...op, match } };
}

class StoreViolation extends Error {}

/**
 * Branch registry rules. Location managers may maintain the directory; a
 * till without that permission may at most keep its own branch row up to date.
 */
function authorizeStores(op: RelayOp, scope: RelayScope): { ok: true; op: RelayOp } | RelayDenial {
  if (allowed(scope, "can_manage_locations")) return { ok: true, op };

  if (op.kind === "delete")
    return deny("PERMISSION_DENIED", "Your account cannot remove a branch.");

  if (op.kind === "insert" || op.kind === "upsert") {
    const foreign = op.rows.some((row) => String(row["id"] ?? "") !== (scope.storeId ?? ""));
    if (foreign)
      return deny("STORE_FORBIDDEN", "Your account cannot add or change other branches.");
    return { ok: true, op };
  }

  const target = op.match["id"];
  if (target === undefined || String(target) !== (scope.storeId ?? ""))
    return deny("STORE_FORBIDDEN", "You cannot change another branch's details.");
  if (op.values["id"] !== undefined && String(op.values["id"]) !== scope.storeId)
    return deny("STORE_FORBIDDEN", "A branch cannot be given another branch's id.");
  return { ok: true, op };
}

function authorizeTransfer(
  op: RelayOp,
  scope: RelayScope,
): Promise<{ ok: true; op: RelayOp } | RelayDenial> | ({ ok: true; op: RelayOp } | RelayDenial) {
  if (scope.isSupervisor) return { ok: true, op };
  const involved = (row: Record<string, unknown>) =>
    String(row["from_store_id"] ?? "") === scope.storeId ||
    String(row["to_store_id"] ?? "") === scope.storeId;

  if (op.kind === "insert" || op.kind === "upsert") {
    if (!op.rows.every(involved))
      return deny("STORE_FORBIDDEN", "A transfer must involve your own branch.");
    return { ok: true, op };
  }
  // Updates and deletes: the transfer named by the match must have this
  // branch at one end, and the ends themselves may never be rewritten.
  if (op.kind === "update") {
    for (const column of ["from_store_id", "to_store_id"]) {
      const given = op.values[column];
      if (given !== undefined && String(given) !== scope.storeId)
        return deny("STORE_FORBIDDEN", "A transfer cannot be re-pointed at another branch.");
    }
  }
  return transferInvolvesCaller(op, scope);
}

async function transferInvolvesCaller(
  op: RelayOp,
  scope: RelayScope,
): Promise<{ ok: true; op: RelayOp } | RelayDenial> {
  const match = op.kind === "update" || op.kind === "delete" ? op.match : {};
  const id = match["id"];
  if (id === undefined || id === null)
    return deny("STORE_FORBIDDEN", "This change does not say which transfer it applies to.");
  const res = await serviceRest(
    `${TRANSFER_TABLE}?id=eq.${encodeURIComponent(String(id))}&select=from_store_id,to_store_id&limit=1`,
  );
  if (!res.ok) return deny("STORE_FORBIDDEN", "The transfer could not be checked — try again.");
  const rows = (await res.json()) as Record<string, unknown>[];
  const row = rows[0];
  if (!row) return deny("STORE_FORBIDDEN", "That transfer no longer exists.");
  const ends = [row["from_store_id"], row["to_store_id"]].map((v) =>
    v == null ? null : String(v),
  );
  if (!ends.includes(scope.storeId))
    return deny("STORE_FORBIDDEN", "You cannot change another branch's transfer.");
  return { ok: true, op };
}

async function authorizeChild(
  op: RelayOp,
  scope: RelayScope,
  batchIds?: Map<string, Set<string>>,
): Promise<{ ok: true; op: RelayOp } | RelayDenial> {
  if (scope.isSupervisor) return { ok: true, op };
  const parent = PARENT_OF[op.table]!;
  const ids: unknown[] =
    op.kind === "insert" || op.kind === "upsert"
      ? op.rows.map((row) => row[parent.fk])
      : [op.match[parent.fk] ?? (op.kind === "update" ? op.values[parent.fk] : undefined)];

  const known = batchIds?.get(parent.table);
  for (const id of ids) {
    if (id === undefined || id === null)
      return deny("STORE_FORBIDDEN", "This record does not say which order it belongs to.");
    // A parent pushed earlier in this same request was already pinned to the
    // caller's branch, so the child rides on that check.
    if (known?.has(String(id))) continue;
    const store = await parentStore(op.table, id);
    // Anything else must be a parent the server already holds, in this branch.
    if (store === undefined || !visibleStore(scope, store))
      return deny("STORE_FORBIDDEN", "You cannot change another branch's records.");
  }
  return { ok: true, op };
}

/**
 * Collect the ids of parent rows being inserted in this request, so children
 * pushed alongside their parent are accepted.
 */
export function batchInsertIds(ops: RelayOp[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const op of ops) {
    if (op.kind !== "insert" && op.kind !== "upsert") continue;
    const set = map.get(op.table) ?? new Set<string>();
    for (const row of op.rows) if (row["id"] != null) set.add(String(row["id"]));
    map.set(op.table, set);
  }
  return map;
}

/** Wrapper so the thrown branch violation inside map() becomes a denial. */
export async function safeAuthorizeRelayOp(
  op: RelayOp,
  scope: RelayScope,
  batchIds?: Map<string, Set<string>>,
): Promise<{ ok: true; op: RelayOp } | RelayDenial> {
  try {
    return await authorizeRelayOp(op, scope, batchIds);
  } catch (e) {
    if (e instanceof StoreViolation)
      return deny("STORE_FORBIDDEN", "You cannot write records for another branch.");
    throw e;
  }
}
