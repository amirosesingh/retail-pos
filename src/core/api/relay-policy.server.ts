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
  "authorization_actions",
  "pos_settings",
  "promotions",
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
    stock_quantity: "can_adjust_stock",
    stock_by_store: "can_adjust_stock",
  },
  members: {
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
  promotions: { write: "can_manage_promotions", remove: "can_manage_promotions" },
  suppliers: { write: "can_receive_purchase_order", remove: "can_receive_purchase_order" },
};

export const RELAY_WRITABLE_TABLES = new Set([
  ...Object.keys(STORE_COLUMN),
  ...Object.keys(PARENT_OF),
  ...GLOBAL_TABLES,
  TRANSFER_TABLE,
  STORES_TABLE,
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
    // No account row and no usable claims: the caller can still be identified
    // but their permissions are unknown, so writes are refused as stale. A
    // proven supervisor is never stale — their role already answers it.
    stale: !row && !fastEnough && caller.kind === "staff" && !isSupervisor,
  };
}

/** Re-export so callers can build a scope from a verified token payload. */
export { claimsFromPayload };

const allowed = (scope: RelayScope, flag: string | undefined) =>
  !flag || scope.isSupervisor || scope.permissions[flag] === true;

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

  if (scope.stale && !scope.isSupervisor)
    return deny(
      "SCOPE_STALE",
      "Your account details could not be confirmed — sign in again to refresh them.",
    );

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
        if (flag && !allowed(scope, flag))
          return deny("PERMISSION_DENIED", `Your account cannot change "${column}".`);
      }
    }
  }

  op = stampActor(op, scope);

  if (op.table === STORES_TABLE) return authorizeStores(op, scope);

  const storeColumn = STORE_COLUMN[op.table];
  if (storeColumn) return pinToStore(op, scope, storeColumn);

  if (op.table === TRANSFER_TABLE) return authorizeTransfer(op, scope);

  if (PARENT_OF[op.table]) return authorizeChild(op, scope, batchIds);

  // Global catalogue rows: no branch to pin, permissions already checked.
  return { ok: true, op };
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
 * Branch registry rules. Creating or renaming a branch is an administrator's
 * job; a till may at most keep its own branch row up to date.
 */
function authorizeStores(op: RelayOp, scope: RelayScope): { ok: true; op: RelayOp } | RelayDenial {
  if (scope.isSupervisor) return { ok: true, op };

  if (op.kind === "delete")
    return deny("PERMISSION_DENIED", "Only an administrator can remove a branch.");

  if (op.kind === "insert" || op.kind === "upsert") {
    const foreign = op.rows.some((row) => String(row["id"] ?? "") !== (scope.storeId ?? ""));
    if (foreign)
      return deny("STORE_FORBIDDEN", "Only an administrator can add or change other branches.");
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
