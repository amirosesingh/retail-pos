import { canCrossBranches } from "./relay-policy.server";
import { recordId, sameRecordId } from "@/lib/sale-identity";
import { sameBranchId } from "@/lib/branch-id";
import { dispatchFailure } from "@/lib/transfer-dispatch-result";
import { DesktopAdoptionUnavailableError } from "@/lib/desktop-adoption-availability.server";
import { STOCK_REQUEST_HEAD_COLUMNS, STOCK_REQUEST_ITEM_COLUMNS, STOCK_REQUEST_PAGE_SIZE, checkedStockRequestApprovalState, completeStockRequestRows, projectStockRequestRows, stockRequestItemPage, validateStockRequestHead } from "@/lib/stock-request-contract";
/**
 * Server-side write relay for the POS database.
 *
 * Terminal staff normally hold a backend Auth session after username + PIN
 * sign-in. The relay also supports offline/compatibility operation: it proves
 * who the caller is (a signed cashier
 * session, an active terminal token, or a staff access token) and then performs
 * the write with the service key, which never reaches the browser.
 */
import { runtimeEnvValue, supabaseConfig } from "@/lib/external-supabase-config";
import type { RelayScope } from "@/core/api/relay-policy.server";

export type RelayOp =
  | { kind: "insert"; table: string; rows: Record<string, unknown>[] }
  | {
      kind: "upsert";
      table: string;
      rows: Record<string, unknown>[];
      onConflict?: string;
    }
  | {
      kind: "update";
      table: string;
      values: Record<string, unknown>;
      match: Record<string, unknown>;
    }
  | { kind: "delete"; table: string; match: Record<string, unknown> };

/**
 * A named database routine. Only routines on the allow-list may be called,
 * and the caller's branch and permission are proven here first — the till
 * sends identifiers and quantities only, never computed figures.
 */
export type RelayRpc = { kind: "rpc"; table: string; fn: string; args: Record<string, unknown> };

/** Read requests the relay may answer for a proven till. */
export type RelayRead =
  | { kind: "transferRequestApprovalState"; requestId: string }
  | { kind: "health" }
  | { kind: "activeShift"; storeId: string }
  | { kind: "stores" }
  | { kind: "cloudSchema" }
  | { kind: "cloudInventory" }
  | { kind: "cloudProbe"; table: string };

/**
 * Only operational tables may be written through the relay. `stores` is
 * deliberately absent: branch records are supervisor-only and supervisors
 * hold a real session, so they write directly under the row rules.
 */
export const RELAY_TABLES = new Set([
  "sales",
  "sale_items",
  "payment_transactions",
  "payment_types",
  "item_activity_logs",
  "shifts",
  "shift_sessions",
  "held_orders",
  "bookings",
  "booking_payments",
  "drawer_events",
  "stock_adjustments",
  "stock_count_drafts",
  "sku_audit",
  "audit_logs",
  "members",
  "products",
  "purchase_orders",
  "purchase_order_items",
  "stock_transfers",
  "stock_transfer_items",
  "whatsapp_queue",
  "stores",
  "pos_store_settings",
  "pos_settings",
  "settings_scoped",
  "public_flags",
  "promotions",
  "coupon_campaigns",
  "suppliers",
  "authorization_actions",
  "authorization_requests",
  "authorization_log",
  "record_edits",
  "activity_events",
  "entity_status_history",
  "member_verifications",
  "shift_notifications",
]);

/** Conflict keys are owned by the server; callers cannot choose arbitrary unique columns. */
const RELAY_CONFLICT_KEYS: Readonly<Record<string, string>> = {
  sales: "id",
  sale_items: "id",
  payment_transactions: "id",
  item_activity_logs: "id",
  stock_count_drafts: "id",
  pos_store_settings: "store_id",
  settings_scoped: "scope,scope_id,key",
  public_flags: "key",
  shift_notifications: "shift_id",
};

function conflictKey(table: string): string {
  return RELAY_CONFLICT_KEYS[table] ?? "id";
}

/**
 * Names the service key may be bound under, in order of preference.
 *
 * The POS-specific name wins so a shop's own project always takes priority.
 * A hosting platform that provisions the same project under the canonical
 * name is accepted as a second candidate: without it, a stale or rotated
 * POS-specific secret leaves the whole deployment answering "Invalid API key"
 * even though a working key for the very same database is present. Neither
 * value ever leaves the server.
 */
const SERVICE_KEY_NAMES = ["POS_SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

const envValue = (name: string): string | undefined =>
  // Cloudflare hands secrets to the worker per request, so check what the
  // server entry captured before falling back to the process environment.
  runtimeEnvValue(name) ?? process.env[name];

/** Keys the central database has already rejected as invalid this run. */
const rejectedKeys = new Set<string>();

/** Every configured candidate, in preference order, at call time. */
function serviceKeyCandidates(): string[] {
  const out: string[] = [];
  for (const name of SERVICE_KEY_NAMES) {
    const value = envValue(name)?.trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

/** Read the key at call time: some runtimes inject env per request. */
function readServiceKey(): string | undefined {
  const candidates = serviceKeyCandidates();
  return candidates.find((k) => !rejectedKeys.has(k)) ?? candidates[0];
}

export function serviceKey(): string {
  const key = readServiceKey();
  if (!key) throw new Error("The central database service key is not configured");
  return key;
}

/** Whether this deployment can talk to the central database at all. */
export function hasServiceKey(): boolean {
  try {
    return Boolean(readServiceKey());
  } catch {
    // A misconfigured duplicate must surface on use, not be reported as
    // "no key configured".
    return true;
  }
}

/**
 * Answer a read for a proven till. This keeps offline/compatibility sessions
 * working when no live backend Auth session is available.
 */
export async function runRelayRead(read: RelayRead, scope?: RelayScope): Promise<{
  ok: boolean;
  row?: Record<string, unknown> | null;
  rows?: Record<string, unknown>[];
  error?: string;
  code?: string;
  status?: number;
  inventoryMode?: "deep" | "legacy";
  inventoryWarning?: string;
}> {
  if (read.kind === "transferRequestApprovalState") {
    if (!scope || scope.managementReplica || scope.kind === "terminal" || scope.stale || !scope.staffUserId ||
        (scope.role !== "admin" && scope.roleSlug !== "admin" && scope.permissions.can_approve_transfer !== true))
      return { ok: false, status: 403, code: "PERMISSION_DENIED", error: "An active transfer approver session is required." };
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(read.requestId))
      return { ok: false, status: 400, code: "SCOPE_MISSING", error: "The stock request identity is invalid." };
    try {
      const response = await serviceRest(`stock_transfers?id=eq.${encodeURIComponent(recordId(read.requestId))}&select=${STOCK_REQUEST_HEAD_COLUMNS}&limit=1`);
      if (!response.ok) throw new Error("Request read failed");
      const request = projectStockRequestRows(await response.json(), STOCK_REQUEST_HEAD_COLUMNS)[0];
      if (!request || request.kind !== "request" || !sameRecordId(String(request.id), read.requestId))
        return { ok: false, status: 404, code: "SCOPE_MISSING", error: "The stock request is no longer available." };
      validateStockRequestHead(request, "request");
      if (scope.storeId ? !sameBranchId(request.from_store_id, scope.storeId) : !canCrossBranches(scope))
        return { ok: false, status: 403, code: "STORE_FORBIDDEN", error: "You can only approve stock requests for your sending branch." };
      const count = (res: Response) => { const total = res.headers.get("content-range")?.match(/\/(\d+)$/)?.[1]; return total === undefined ? null : Number(total); };
      const childResponse = await serviceRest(`stock_transfers?source_request_id=eq.${encodeURIComponent(String(request.id))}&select=${STOCK_REQUEST_HEAD_COLUMNS}&order=id&limit=2`, { prefer: "count=exact" });
      if (!childResponse.ok) throw new Error("Fulfilment read failed");
      const children = completeStockRequestRows(await childResponse.json(), count(childResponse), STOCK_REQUEST_HEAD_COLUMNS, 1);
      const fulfilment = children[0] ?? null;
      if (fulfilment && (fulfilment.kind !== "transfer" || !sameRecordId(String(fulfilment.source_request_id), String(request.id)) ||
          !sameBranchId(fulfilment.from_store_id, request.from_store_id) || !sameBranchId(fulfilment.to_store_id, request.to_store_id)))
        throw new Error("Inconsistent fulfilment");
      const lines = async (id: unknown) => {
        const rows: Record<string, unknown>[] = []; let total: number | null = null;
        do {
          const res = await serviceRest(`stock_transfer_items?transfer_id=eq.${encodeURIComponent(String(id))}&select=${STOCK_REQUEST_ITEM_COLUMNS}&order=id&limit=${STOCK_REQUEST_PAGE_SIZE}&offset=${rows.length}`, { prefer: "count=exact" });
          if (!res.ok) throw new Error("Request line read failed");
          const page = stockRequestItemPage(await res.json(), count(res), total, rows.length);
          rows.push(...page.rows); total = page.count;
        } while (rows.length < total);
        return rows;
      };
      const [requestItems, fulfilmentItems] = await Promise.all([lines(request.id), fulfilment ? lines(fulfilment.id) : Promise.resolve([])]);
      return { ok: true, row: checkedStockRequestApprovalState({ request, fulfilment, requestItems, fulfilmentItems }) };
    } catch {
      return { ok: false, status: 503, code: "TRANSFER_REQUEST_UNAVAILABLE", error: "The central request and fulfilment could not be read completely. Refresh them before approval." };
    }
  }
  // The endpoint has already verified the caller and resolved its branch.
  // A health check must never attempt a write with a fabricated record ID.
  if (read.kind === "health") return { ok: true };
  if (read.kind === "cloudSchema") {
    // The PostgREST root document lists every exposed table with its columns
    // (including type and nullability), which is exactly what the till needs
    // to spot central-schema drift against the authoritative definition.
    const res = await serviceRest("");
    if (!res.ok) return { ok: false, error: (await res.text()).slice(0, 400) };
    const spec = (await res.json()) as {
      definitions?: Record<
        string,
        {
          properties?: Record<string, { type?: string; format?: string }>;
          required?: string[];
        }
      >;
    };
    const rows: Record<string, unknown>[] = [];
    for (const [table, def] of Object.entries(spec.definitions ?? {})) {
      const required = new Set(def?.required ?? []);
      for (const [column, prop] of Object.entries(def?.properties ?? {})) {
        rows.push({
          table,
          column,
          type: typeof prop?.type === "string" ? prop.type : null,
          format: typeof prop?.format === "string" ? prop.format : null,
          nullable: !required.has(column),
        });
      }
    }
    return { ok: true, rows };
  }
  if (read.kind === "cloudInventory") {
    // Deep, read-only inventory: nullability, defaults, keys, constraints,
    // indexes, triggers, row security and policies. Only available when the
    // central project carries the schema_inventory_deep helper; the caller
    // falls back to the shallow description document when it does not.
    const res = await serviceRest("rpc/schema_inventory_deep", {
      method: "POST",
      body: "{}",
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 400);
      const deepError = `HTTP ${res.status}: ${text}`;
      const helperMissing =
        res.status === 404 && (text.includes("PGRST202") || text.includes("schema_inventory_deep"));
      if (!helperMissing) return { ok: false, error: deepError };

      const legacy = await serviceRest("rpc/schema_inventory", {
        method: "POST",
        body: "{}",
      });
      if (!legacy.ok) {
        return {
          ok: false,
          error: `${deepError}; compatibility helper failed with HTTP ${legacy.status}: ${(
            await legacy.text()
          ).slice(0, 240)}`,
        };
      }
      const payload = (await legacy.json()) as Record<string, unknown> | null;
      return {
        ok: true,
        row: payload ?? {},
        inventoryMode: "legacy",
        inventoryWarning: deepError,
      };
    }
    const payload = (await res.json()) as Record<string, unknown> | null;
    return { ok: true, row: payload ?? {}, inventoryMode: "deep" };
  }

  if (read.kind === "cloudProbe") {
    // One cheap probe per table: answers "can the central database serve this
    // table right now?" with the exact PostgREST error when it cannot — the
    // difference between a missing table (schema cache), a permission problem
    // and a plain connectivity failure.
    const table = read.table.replace(/[^a-z0-9_]/gi, "");
    if (!table) return { ok: false, error: "Invalid table name" };
    try {
      const res = await serviceRest(`${table}?select=*&limit=1`);
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` };
      }
      return { ok: true, rows: [] };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Network error" };
    }
  }
  if (read.kind === "stores") {
    // This small directory is also the registered terminal's authoritative
    // location record. Preserve warehouse hierarchy/type flags: reducing the
    // row to legacy store fields made a registered warehouse reappear as an
    // ordinary shop after PIN/password sign-in.
    const res = await serviceRest(
      "stores?select=id,code,name,address,phone,group_id,location_type,parent_id,is_central,is_primary_sub,building_name,floor_label,is_active,archived_at,private_catalogue&deleted_at=is.null&order=name",
    );
    if (!res.ok) return { ok: false, error: (await res.text()).slice(0, 400) };
    return { ok: true, rows: (await res.json()) as Record<string, unknown>[] };
  }
  const res = await serviceRest(
    `shifts?store_id=eq.${encodeURIComponent(read.storeId)}&status=eq.OPEN` +
      `&closed_at=is.null&order=opened_at.desc&limit=1`,
  );
  if (!res.ok) return { ok: false, error: (await res.text()).slice(0, 400) };
  const rows = (await res.json()) as Record<string, unknown>[];
  return { ok: true, row: rows[0] ?? null };
}

function serviceHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
  };
  // New-format sb_secret_ keys are opaque strings, not bearer JWTs.
  if (!key.startsWith("sb_")) headers["Authorization"] = `Bearer ${key}`;
  return headers;
}

/** A rejected-credential answer, as opposed to a permission or data problem. */
async function isInvalidKey(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  try {
    return (await res.clone().text()).includes("Invalid API key");
  } catch {
    return false;
  }
}

/**
 * Raw PostgREST call with the service key.
 *
 * If the database rejects the key itself (a rotated or foreign secret), the
 * call is retried once with the next configured candidate and the bad key is
 * remembered so the rest of the run goes straight to the working one. The key
 * value is never logged or returned.
 */
export async function serviceRest(
  path: string,
  init: RequestInit & { prefer?: string } = {},
): Promise<Response> {
  const url = `${supabaseConfig().url}/rest/v1/${path}`;
  const extra = (init.headers as Record<string, string>) ?? {};
  const candidates = serviceKeyCandidates().filter((k) => !rejectedKeys.has(k));
  const keys = candidates.length ? candidates : [serviceKey()];

  let last: Response | undefined;
  for (const key of keys) {
    const headers = { ...serviceHeaders(key), ...extra };
    if (init.prefer) headers["Prefer"] = init.prefer;
    const res = await fetch(url, { ...init, headers });
    if (!(await isInvalidKey(res))) return res;
    rejectedKeys.add(key);
    last = res;
  }
  return last as Response;
}

const encodeValue = (value: unknown) =>
  value === null ? "is.null" : `eq.${encodeURIComponent(String(value))}`;

const query = (match: Record<string, unknown>) =>
  Object.entries(match)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeValue(v)}`)
    .join("&");

/**
 * Database routines a proven till may ask the server to run, with the branch
 * the row belongs to and the permission the caller must hold.
 */
const RELAY_RPCS: Record<
  string,
  { permission: string; ownerTable: string; idArg: string; storeColumn: string }
> = {
  sale_refund: {
    permission: "can_process_refund",
    ownerTable: "sales",
    idArg: "_sale_id",
    storeColumn: "store_id",
  },
  stock_transfer_approve: {
    permission: "can_approve_transfer",
    ownerTable: "stock_transfers",
    idArg: "p_transfer_id",
    storeColumn: "from_store_id",
  },
  stock_transfer_dispatch: {
    permission: "can_create_transfer",
    ownerTable: "stock_transfers",
    idArg: "p_transfer_id",
    storeColumn: "from_store_id",
  },
  stock_transfer_dispatch_atomic: {
    permission: "can_create_transfer",
    ownerTable: "stock_transfers",
    idArg: "p_transfer_id",
    storeColumn: "from_store_id",
  },
  stock_transfer_receive: {
    permission: "can_receive_transfer",
    ownerTable: "stock_transfers",
    idArg: "p_transfer_id",
    storeColumn: "to_store_id",
  },
  stock_transfer_verify: {
    permission: "can_receive_transfer",
    ownerTable: "stock_transfers",
    idArg: "p_transfer_id",
    storeColumn: "to_store_id",
  },
};

/** Native dispatch responses expose operational guidance, never database text. */
async function nativeDispatchFailure(response: Response): Promise<{ ok: false; error: string; code?: string; status: number }> {
  const body: unknown = await response.json().catch(() => null);
  const fields = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const safe = dispatchFailure({ ...fields, status: response.status });
  const upstreamCode = typeof fields.code === "string" ? fields.code : "";
  const sqlDenial = /^[0-9A-Z]{5}$/.test(upstreamCode);
  // Only a bounded diagnostic code/status stays server-side. Messages, hints,
  // details and gateway response bodies can contain private database context.
  const diagnosticCode = sqlDenial || /^PGRST\d{3}$/.test(upstreamCode) ? upstreamCode : "UNKNOWN";
  console.warn("[transfer-dispatch] Backend rejection", { code: diagnosticCode, status: response.status });
  // A genuine gateway/transport failure may have committed before the response
  // was lost. Keep its HTTP status and omit a definitive business-error code so
  // the client can make its single identical, receipt-backed reconciliation.
  const ambiguous = !sqlDenial && safe.code === "TRANSFER_DISPATCH_UNCONFIRMED" &&
    (response.status >= 500 || response.status === 408);
  return { ok: false, error: safe.error, status: response.status, ...(!ambiguous ? { code: safe.code } : {}) };
}

/**
 * Run one allow-listed routine on the caller's behalf.
 *
 * The branch of the record is read on the server and compared with the
 * caller's own branch, and the permission flag is checked here, because the
 * service key bypasses the database's own row rules.
 */
export async function runRelayRpc(
  op: RelayRpc,
  scope: RelayScope,
): Promise<{ ok: boolean; error?: string; code?: string; status?: number; data?: unknown }> {
  if (op.fn === "pos_sale_commit") {
    if (
      scope.role !== "admin" &&
      scope.roleSlug !== "admin" &&
      scope.permissions.can_process_sale !== true
    ) {
      return {
        ok: false,
        code: "PERMISSION_DENIED",
        error: "You are not allowed to process a sale.",
      };
    }
    const sale = op.args._sale;
    if (
      sale &&
      typeof sale === "object" &&
      String((sale as Record<string, unknown>).original_bill_number ?? "").startsWith("OLDPOS:") &&
      scope.role !== "admin" &&
      scope.roleSlug !== "admin"
    )
      return {
        ok: false,
        code: "PERMISSION_DENIED",
        error: "Only an administrator can enter an old POS exchange.",
      };
    const storeId =
      sale && typeof sale === "object" ? (sale as Record<string, unknown>).store_id : null;
    if (typeof storeId !== "string" || !storeId) {
      return { ok: false, code: "SCOPE_MISSING", error: "The sale branch is missing." };
    }
    if (!canCrossBranches(scope) && storeId !== scope.storeId) {
      return {
        ok: false,
        code: "STORE_FORBIDDEN",
        error: "You can only sell for your own branch.",
      };
    }
    const res = await serviceRest("rpc/pos_sale_commit", {
      method: "POST",
      body: JSON.stringify(op.args),
    });
    return res.ok ? { ok: true } : { ok: false, error: (await res.text()).slice(0, 400) };
  }
  if (op.fn === "shift_cash_count_submit") {
    if (
      scope.role !== "admin" &&
      scope.roleSlug !== "admin" &&
      scope.permissions.can_shift_cash_count !== true &&
      scope.permissions.can_close_shift !== true
    ) {
      return {
        ok: false,
        code: "PERMISSION_DENIED",
        error: "You are not allowed to submit a shift cash count.",
      };
    }
    const shiftId = op.args.p_shift;
    if (typeof shiftId !== "string" || !shiftId)
      return { ok: false, code: "SCOPE_MISSING", error: "The shift is missing." };
    const lookup = await serviceRest(
      `shifts?id=eq.${encodeURIComponent(shiftId)}&select=store_id&limit=1`,
    );
    if (!lookup.ok) return { ok: false, error: (await lookup.text()).slice(0, 300) };
    const rows = (await lookup.json()) as Record<string, unknown>[];
    const owner = rows[0];
    if (!owner) return { ok: false, code: "SCOPE_MISSING", error: "That shift no longer exists." };
    const storeId = owner.store_id;
    if (!canCrossBranches(scope) && storeId !== scope.storeId)
      return {
        ok: false,
        code: "STORE_FORBIDDEN",
        error: "You can only count cash for your own branch.",
      };
    const res = await serviceRest("rpc/shift_cash_count_submit", {
      method: "POST",
      body: JSON.stringify(op.args),
    });
    return res.ok ? { ok: true } : { ok: false, error: (await res.text()).slice(0, 400) };
  }

  const spec = RELAY_RPCS[op.fn];
  const nativeDispatch = op.fn === "stock_transfer_dispatch" || op.fn === "stock_transfer_dispatch_atomic";
  if (!spec) return { ok: false, code: "TABLE_FORBIDDEN", error: `"${op.fn}" cannot be run` };
  if (
    scope.role !== "admin" &&
    scope.roleSlug !== "admin" &&
    scope.permissions[spec.permission] !== true
  )
    return {
      ok: false,
      code: "PERMISSION_DENIED",
      error: "You are not allowed to do this.",
    };

  const id = op.args[spec.idArg];
  if (typeof id !== "string" || !id)
    return { ok: false, code: "SCOPE_MISSING", error: "Nothing to act on." };

  const lookup = await serviceRest(
    `${spec.ownerTable}?id=eq.${encodeURIComponent(id)}&select=${spec.storeColumn}&limit=1`,
  );
  if (!lookup.ok) return nativeDispatch ? nativeDispatchFailure(lookup) : { ok: false, error: (await lookup.text()).slice(0, 300) };
  const rows = (await lookup.json()) as Record<string, unknown>[];
  const owner = rows[0];
  if (!owner) return { ok: false, code: "SCOPE_MISSING", error: "That record no longer exists." };
  const storeId = owner[spec.storeColumn];
  if (!canCrossBranches(scope) && storeId !== scope.storeId)
    return {
      ok: false,
      code: "STORE_FORBIDDEN",
      error: "You can only do this for your own branch.",
    };

  // Attribution comes from the verified caller, never from editable renderer
  // text. Quantities and reasons remain the user's requested operation.
  const actor = String(scope.actorName ?? scope.staffUserId ?? scope.label ?? "Staff").slice(
    0,
    160,
  );
  const actorField =
    op.fn === "stock_transfer_approve"
      ? "p_approved_by"
      : op.fn === "stock_transfer_dispatch"
        ? "p_dispatched_by"
        : op.fn === "stock_transfer_receive"
          ? "p_received_by"
          : op.fn === "stock_transfer_verify"
            ? "p_verified_by"
            : null;
  const args = actorField ? { ...op.args, [actorField]: actor } : op.args;
  // Only the account resolved from the verified session may become the native
  // database actor. Renderer attribution/actor parameters are never forwarded.
  const nativeApproval = op.fn === "stock_transfer_approve";
  if ((nativeApproval || nativeDispatch) && (!scope.staffUserId || scope.stale || scope.kind === "terminal"))
    return { ok: false, code: "PERMISSION_DENIED", error: "An active staff session is required to act on transfers." };
  const rpcArgs = nativeApproval || nativeDispatch ? {
    p_transfer_id: id,
    p_staff_user_id: scope.staffUserId,
    p_bound_store_id: canCrossBranches(scope) ? null : scope.storeId,
    p_lines: op.args.p_lines ?? null,
    ...(nativeDispatch ? { p_strict_lines: op.fn === "stock_transfer_dispatch_atomic" } : {}),
  } : args;
  const res = await serviceRest(`rpc/${nativeApproval ? "stock_transfer_approve_for_staff" : nativeDispatch ? "stock_transfer_dispatch_atomic_for_staff" : op.fn}`, {
    method: "POST",
    body: JSON.stringify(rpcArgs),
  });
  if (res.ok) return op.fn === "stock_transfer_dispatch_atomic" ? { ok: true, data: await res.json() } : { ok: true };
  if (nativeDispatch) return nativeDispatchFailure(res);
  return { ok: false, error: (await res.text()).slice(0, 400) };
}

/**

 * Execute one queued operation with service rights.
 *
 * The caller's scope is mandatory: the operation is first rewritten so it can
 * only touch the caller's own branch and only the columns their permissions
 * allow, and is refused outright otherwise.
 */
export async function runRelayOp(
  op: RelayOp,
  scope: RelayScope,
  batchIds?: Map<string, Set<string>>,
): Promise<{ ok: boolean; error?: string; code?: string }> {
  if (!RELAY_TABLES.has(op.table)) return { ok: false, error: `"${op.table}" cannot be synced` };

  const { safeAuthorizeRelayOp } = await import("@/core/api/relay-policy.server");
  const decision = await safeAuthorizeRelayOp(op, scope, batchIds);
  if (!decision.ok) return { ok: false, error: decision.error, code: decision.code };
  const safeOp = decision.op;
  // Receipt graphs are immutable on replay, matching the native SQL writer.
  // A permission check followed by merge-duplicates would still race another
  // checkout inserting the same ID. Corrections have dedicated transactions.
  const immutableReceipt = ["sales", "sale_items", "payment_transactions"].includes(safeOp.table);
  const conflictResolution = immutableReceipt ? "ignore-duplicates" : "merge-duplicates";

  let res: Response;
  switch (safeOp.kind) {
    case "insert": {
      // Client-generated ids make retry an acknowledgement of the same row,
      // not a second insert that fails with a duplicate-key error.
      const keyed =
        safeOp.rows.length > 0 && safeOp.rows.every((row) => typeof row.id === "string" && row.id);
      res = await serviceRest(
        keyed ? `${safeOp.table}?on_conflict=${conflictKey(safeOp.table)}` : safeOp.table,
        {
          method: "POST",
          body: JSON.stringify(safeOp.rows),
          prefer: keyed ? `return=minimal,resolution=${conflictResolution}` : "return=minimal",
        },
      );
      break;
    }
    case "upsert":
      res = await serviceRest(`${safeOp.table}?on_conflict=${conflictKey(safeOp.table)}`, {
        method: "POST",
        body: JSON.stringify(safeOp.rows),
        prefer: `return=minimal,resolution=${conflictResolution}`,
      });
      break;
    case "update":
      res = await serviceRest(`${safeOp.table}?${query(safeOp.match)}`, {
        method: "PATCH",
        body: JSON.stringify(safeOp.values),
        prefer: "return=minimal",
      });
      break;
    case "delete":
      res = await serviceRest(`${safeOp.table}?${query(safeOp.match)}`, {
        method: "DELETE",
        prefer: "return=minimal",
      });
      break;
  }

  if (res.ok) {
    if (safeOp.table === "sales" && (safeOp.kind === "insert" || safeOp.kind === "upsert") && !canCrossBranches(scope)) {
      // An ignored duplicate is not evidence that this caller owns its parent.
      // The batch can trust successful parent IDs for subsequent children only
      // after checking the persisted branch, including a duplicate no-op.
      const ids = [...new Set(safeOp.rows.map(row => recordId(String(row.id ?? ""))))];
      if (ids.some(id => !id)) return { ok: false, code: "STORE_FORBIDDEN", error: "The sale identity is missing." };
      if (ids.length) {
        const quoted = ids.map(id => `"${id.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(",");
        const params = new URLSearchParams({ select: "id,store_id", id: `in.(${quoted})` });
        const check = await serviceRest(`sales?${params}`);
        if (!check.ok) return { ok: false, code: "STORE_FORBIDDEN", error: "The saved sale branch could not be verified." };
        const saved = await check.json() as Array<{ id: string; store_id: string }>;
        if (!scope.storeId || saved.length !== ids.length || saved.some(row => !ids.includes(recordId(row.id)) || !sameBranchId(row.store_id, scope.storeId)))
          return { ok: false, code: "STORE_FORBIDDEN", error: "You cannot use another branch's sale." };
      }
    }
    return { ok: true };
  }

  // A re-pushed tender can collide with the copy the first attempt already
  // stored. The per-tender idempotency key settles it: when every row is
  // already present centrally, the push is acknowledged, not failed.
  if (
    (safeOp.kind === "upsert" || safeOp.kind === "insert") &&
    safeOp.table === "payment_transactions" &&
    res.status === 409
  ) {
    const keys = [
      ...new Set(
        safeOp.rows
          .map((r) =>
            typeof r.client_transaction_id === "string" ? r.client_transaction_id : null,
          )
          .filter((k): k is string => Boolean(k)),
      ),
    ];
    if (keys.length > 0 && keys.length === safeOp.rows.length) {
      const check = await serviceRest(
        `payment_transactions?select=id&client_transaction_id=in.(${keys
          .map((k) => encodeURIComponent(k))
          .join(",")})`,
      );
      if (check.ok) {
        const found = (await check.json()) as unknown[];
        if (found.length >= keys.length) return { ok: true };
      }
    }
  }

  const text = await res.text();
  let message = text;
  try {
    message = (JSON.parse(text) as { message?: string }).message ?? text;
  } catch {
    /* plain text error */
  }
  return { ok: false, error: message.slice(0, 400) };
}

export type RelayCaller = {
  kind: "cashier" | "terminal" | "staff";
  label: string;
  storeId?: string | null;
  /** app_users.user_id, when the proof carries it. */
  staffUserId?: string | null;
  /** A cashier proof's independently verified, revocable login. */
  sessionToken?: string;
  /** Sign-in email, when the proof carries one. Used to find the staff record. */
  email?: string | null;
  /** Supabase Auth id, for staff signed in with email + password. */
  authUserId?: string | null;
  /** Signed claims from the proof, used as the no-round-trip fast path. */
  claims?: import("@/core/api/relay-claims.server").CallerClaims | null;
  /** Verified physical terminal identity. Never accepted from a request body. */
  terminalId?: string | null;
  managementDevice?: boolean;
  managementMobileDevice?: boolean;
  terminal?: import("@/lib/terminal-binding.server").VerifiedTerminalDescriptor;
};

/**
 * Establish who is pushing. Fails closed: an unproven caller writes nothing.
 *
 * A device can present several proofs at once. The verified person session
 * says who is acting; the terminal token supplies the device branch. A till
 * may also hold a separate Supabase machine account, which must not replace
 * the person who signed in with a PIN.
 */
export class RelayAuthenticationError extends Error {}

export async function verifyRelayCaller(input: {
  sessionToken?: string;
  cashierToken?: string;
  terminalToken?: string;
  accessToken?: string;
  deviceBindingProof?: string;
}, options: { strictAvailability?: boolean } = {}): Promise<RelayCaller> {
  let identity: RelayCaller | null = null;
  let terminalStore: string | null = null;
  let terminalId: string | null = null;
  let managementDevice = false;
  let managementMobileDevice = false;
  let storedTerminalId:string|null=null;
  let storedBranch:string|null=null;
  let terminal:import("@/lib/terminal-binding.server").VerifiedTerminalDescriptor|undefined;

  // A cryptographic session record is the strongest proof: it can be revoked
  // centrally and expires when the till has been left idle.
  if (input.sessionToken) {
    const { touchSession } = await import("@/lib/session-guard.server");
    let check: Awaited<ReturnType<typeof touchSession>>;
    try { check = await touchSession(input.sessionToken); }
    catch (error) {
      if (options.strictAvailability) throw new DesktopAdoptionUnavailableError();
      throw error;
    }
    if (options.strictAvailability && !check.ok && check.reason === "unavailable")
      throw new DesktopAdoptionUnavailableError();
    if (check.ok) {
      const s = check.session;
      storedTerminalId=s.terminal_id??null;
      storedBranch=s.branch_id??null;
      const kind: RelayCaller["kind"] =
        s.kind === "cashier" ? "cashier" : s.kind === "terminal" ? "terminal" : "staff";
      identity = {
        kind,
        label: s.label ?? s.staff_user_id ?? "session",
        storeId: s.branch_id ?? null,
        staffUserId: s.staff_user_id ?? null,
      };
    }
    if (!check.ok && (check.reason === "revoked" || check.reason === "idle"))
      throw new RelayAuthenticationError("Your session has ended — please sign in again.");
  }

  if (!identity && input.cashierToken) {
    const { verifyCashierSession } = await import("@/lib/pos-session.server");
    const session = await (async () => {
      try {
        return options.strictAvailability
          ? await verifyCashierSession(input.cashierToken!, { strictAvailability: true })
          : await verifyCashierSession(input.cashierToken!);
      } catch {
        if (options.strictAvailability) throw new DesktopAdoptionUnavailableError();
        return null;
      }
    })();
    if (session) {
      storedTerminalId=session.terminalId??null;
      storedBranch=session.storeId??null;
      identity = {
        kind: "cashier",
        label: session.username,
        staffUserId: session.username,
        storeId: session.storeId,
        sessionToken: session.sessionToken,
      };
    }
  }

  if(storedTerminalId && input.terminalToken && recordId(storedTerminalId)!==recordId(input.terminalToken))
    throw new RelayAuthenticationError("The request does not match the signed-in terminal.");
  const requestedTerminal=storedTerminalId || input.terminalToken;
  if(requestedTerminal){
    const {readVerifiedTerminal}=await import("@/lib/terminal-binding.server");
    terminal=await readVerifiedTerminal(requestedTerminal,input.deviceBindingProof,!storedTerminalId);
    terminalId=terminal.id;
    terminalStore=terminal.branchId;
    if(storedTerminalId && terminal.mode==="operations" && (!storedBranch || !sameBranchId(storedBranch,terminalStore)))
      throw new RelayAuthenticationError("This terminal registration changed. Sign in again after its assignment is reviewed.");
    managementDevice=terminal.mode==="management";
    managementMobileDevice=managementDevice && terminal.platform==="mobile";
        identity ??= {
          kind: "terminal",
          label: requestedTerminal,
          storeId: terminalStore,
          terminalId,
        };
  }

  // Use Auth only when no person session identified the caller. PIN sign-in
  // can coexist with a terminal's machine Auth session; replacing the proven
  // cashier with that machine account loses the person's database permissions.
  if (
    input.accessToken &&
    (!identity ||
      identity.kind === "terminal" ||
      (identity.kind === "staff" && !identity.staffUserId))
  ) {
    let res: Response;
    try {
      res = await fetch(`${supabaseConfig().url}/auth/v1/user`, {
        headers: {
          apikey: supabaseConfig().key,
          Authorization: `Bearer ${input.accessToken}`,
        },
      });
    } catch (error) {
      if (options.strictAvailability) {
        throw new DesktopAdoptionUnavailableError();
      }
      throw error;
    }
    if (options.strictAvailability && !res.ok) {
      if (res.status === 400 || res.status === 401 || res.status === 403)
        throw new RelayAuthenticationError("Your sign-in could not be verified.");
      throw new DesktopAdoptionUnavailableError();
    }
    if (res.ok) {
      let user: { id?: string; email?: string };
      if (options.strictAvailability) {
        try {
          const value: unknown = await res.json();
          if (!value || typeof value !== "object" || Array.isArray(value) ||
              typeof (value as { id?: unknown }).id !== "string" || !(value as { id: string }).id.trim() ||
              ((value as { email?: unknown }).email != null && typeof (value as { email?: unknown }).email !== "string"))
            throw new Error("Invalid verification response");
          user = value as { id: string; email?: string };
        } catch {
          throw new DesktopAdoptionUnavailableError();
        }
      } else user = (await res.json()) as { id?: string; email?: string };
      if (user.id) {
        // The token is proven; only now are its claims worth reading.
        const { claimsFromJwt, claimsFromPayload } = await import("@/core/api/relay-claims.server");
        const claims = claimsFromJwt(input.accessToken) ?? claimsFromPayload(user);
        identity = {
          kind: "staff",
          label: user.email ?? user.id,
          email: user.email ?? null,
          authUserId: user.id,
          // The device's own branch still applies unless the account names one.
          storeId: terminalStore,
          claims,
        };
      }
    }
  }


  if (!identity)
    throw new RelayAuthenticationError(
      "This till could not prove who it is — sign in again or re-activate it.",
    );

  // A physical terminal's activation is the branch authority. A cashier or
  // administrator signed into that device may change permissions, but cannot
  // make the till read or write another branch's operational data.
  if (terminalStore) identity = { ...identity, storeId: terminalStore, terminalId };
  if (managementDevice) identity = { ...identity, terminalId, managementDevice: true, managementMobileDevice };
  if(terminal)identity={...identity,terminal};
  return identity;
}
