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
  "promotions",
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
export async function runRelayRead(read: RelayRead): Promise<{
  ok: boolean;
  row?: Record<string, unknown> | null;
  rows?: Record<string, unknown>[];
  error?: string;
  inventoryMode?: "deep" | "legacy";
  inventoryWarning?: string;
}> {
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
    const res = await serviceRest("stores?select=id,code,name,address,phone,group_id&order=name");
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
): Promise<{ ok: boolean; error?: string; code?: string }> {
  if (op.fn === "pos_sale_commit") {
    if (!scope.isSupervisor && scope.permissions.can_process_sale !== true) {
      return { ok: false, code: "PERMISSION_DENIED", error: "You are not allowed to process a sale." };
    }
    const sale = op.args._sale;
    const storeId = sale && typeof sale === "object" ? (sale as Record<string, unknown>).store_id : null;
    if (typeof storeId !== "string" || !storeId) {
      return { ok: false, code: "SCOPE_MISSING", error: "The sale branch is missing." };
    }
    if (!scope.isSupervisor && storeId !== scope.storeId) {
      return { ok: false, code: "STORE_FORBIDDEN", error: "You can only sell for your own branch." };
    }
    const res = await serviceRest("rpc/pos_sale_commit", {
      method: "POST",
      body: JSON.stringify(op.args),
    });
    return res.ok ? { ok: true } : { ok: false, error: (await res.text()).slice(0, 400) };
  }
  if (op.fn === "shift_cash_count_submit") {
    if (
      !scope.isSupervisor &&
      scope.permissions.can_shift_cash_count !== true &&
      scope.permissions.can_close_shift !== true
    ) {
      return { ok: false, code: "PERMISSION_DENIED", error: "You are not allowed to submit a shift cash count." };
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
    if (!scope.isSupervisor && storeId !== scope.storeId)
      return { ok: false, code: "STORE_FORBIDDEN", error: "You can only count cash for your own branch." };
    const res = await serviceRest("rpc/shift_cash_count_submit", {
      method: "POST",
      body: JSON.stringify(op.args),
    });
    return res.ok ? { ok: true } : { ok: false, error: (await res.text()).slice(0, 400) };
  }

  const spec = RELAY_RPCS[op.fn];
  if (!spec) return { ok: false, code: "TABLE_FORBIDDEN", error: `"${op.fn}" cannot be run` };
  if (!scope.isSupervisor && scope.permissions[spec.permission] !== true)
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
  if (!lookup.ok) return { ok: false, error: (await lookup.text()).slice(0, 300) };
  const rows = (await lookup.json()) as Record<string, unknown>[];
  const owner = rows[0];
  if (!owner) return { ok: false, code: "SCOPE_MISSING", error: "That record no longer exists." };
  const storeId = owner[spec.storeColumn];
  if (!scope.isSupervisor && storeId !== scope.storeId)
    return {
      ok: false,
      code: "STORE_FORBIDDEN",
      error: "You can only do this for your own branch.",
    };

  // Attribution comes from the verified caller, never from editable renderer
  // text. Quantities and reasons remain the user's requested operation.
  const actor = String(scope.actorName ?? scope.staffUserId ?? scope.label ?? "Staff").slice(0, 160);
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
  const res = await serviceRest(`rpc/${op.fn}`, {
    method: "POST",
    body: JSON.stringify(args),
  });
  if (res.ok) return { ok: true };
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
          prefer: keyed ? "return=minimal,resolution=merge-duplicates" : "return=minimal",
        },
      );
      break;
    }
    case "upsert":
      res = await serviceRest(`${safeOp.table}?on_conflict=${conflictKey(safeOp.table)}`, {
        method: "POST",
        body: JSON.stringify(safeOp.rows),
        prefer: "return=minimal,resolution=merge-duplicates",
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

  if (res.ok) return { ok: true };

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
  /** Sign-in email, when the proof carries one. Used to find the staff record. */
  email?: string | null;
  /** Supabase Auth id, for staff signed in with email + password. */
  authUserId?: string | null;
  /** Signed claims from the proof, used as the no-round-trip fast path. */
  claims?: import("@/core/api/relay-claims.server").CallerClaims | null;
};

/**
 * Establish who is pushing. Fails closed: an unproven caller writes nothing.
 *
 * A device can present several proofs at once. The verified person session
 * says who is acting; the terminal token supplies the device branch. A till
 * may also hold a separate Supabase machine account, which must not replace
 * the person who signed in with a PIN.
 */
export async function verifyRelayCaller(input: {
  sessionToken?: string;
  cashierToken?: string;
  terminalToken?: string;
  accessToken?: string;
}): Promise<RelayCaller> {
  let identity: RelayCaller | null = null;
  let terminalStore: string | null = null;
  let endedSession = false;

  // A cryptographic session record is the strongest proof: it can be revoked
  // centrally and expires when the till has been left idle.
  if (input.sessionToken) {
    const { touchSession } = await import("@/lib/session-guard.server");
    const check = await touchSession(input.sessionToken);
    if (check.ok) {
      const s = check.session;
      const kind: RelayCaller["kind"] =
        s.kind === "cashier" ? "cashier" : s.kind === "terminal" ? "terminal" : "staff";
      identity = {
        kind,
        label: s.label ?? s.staff_user_id ?? "session",
        storeId: s.branch_id ?? null,
        staffUserId: s.staff_user_id ?? null,
      };
    }
    // A device can retain an older raw session token while the same POS login
    // has already issued a fresh signed cashier or Auth proof. Do not let that
    // stale value prevent the other independently verified proofs below from
    // identifying the person who is currently signed in.
    endedSession = !check.ok && (check.reason === "revoked" || check.reason === "idle");
  }

  if (!identity && input.cashierToken) {
    const { verifyCashierSession } = await import("@/lib/pos-session.server");
    const session = (() => {
      try {
        return verifyCashierSession(input.cashierToken!);
      } catch {
        return null;
      }
    })();
    if (session)
      identity = { kind: "cashier", label: session.username, staffUserId: session.username };
  }

  if (input.terminalToken) {
    const res = await serviceRest(
      `terminal_tokens?id=eq.${encodeURIComponent(input.terminalToken)}&select=id,status,location_id,revoked_at`,
    );
    if (res.ok) {
      const rows = (await res.json()) as {
        status?: string;
        location_id?: string | null;
        revoked_at?: string | null;
      }[];
      const row = rows[0];
      // A revoked token (remote reset, branch removed) never proves anything.
      if (row && !row.revoked_at && (row.status === "active" || row.status === "used")) {
        terminalStore = row.location_id ?? null;
        identity ??= {
          kind: "terminal",
          label: input.terminalToken,
          storeId: terminalStore,
        };
      }
    }
  }

  // Use Auth only when no person session identified the caller. PIN sign-in
  // can coexist with a terminal's machine Auth session; replacing the proven
  // cashier with that machine account loses the person's database permissions.
  if (input.accessToken && (!identity || identity.kind === "terminal" ||
    (identity.kind === "staff" && !identity.staffUserId))) {
    const res = await fetch(`${supabaseConfig().url}/auth/v1/user`, {
      headers: {
        apikey: supabaseConfig().key,
        Authorization: `Bearer ${input.accessToken}`,
      },
    });
    if (res.ok) {
      const user = (await res.json()) as { id?: string; email?: string };
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
          storeId: claims?.storeId ?? terminalStore,
          claims,
        };
      }
    }
  }

  if (!identity && endedSession)
    throw new Error("Your session has ended — please sign in again.");

  if (!identity)
    throw new Error("This till could not prove who it is — sign in again or re-activate it.");

  // A physical terminal's activation is the branch authority. A cashier or
  // administrator signed into that device may change permissions, but cannot
  // make the till read or write another branch's operational data.
  if (terminalStore) identity = { ...identity, storeId: terminalStore };
  return identity;
}
