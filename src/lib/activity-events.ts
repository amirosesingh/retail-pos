/**
 * Activity notifications.
 *
 * One feed of "something happened" events — sign-ins, shifts, sales, refunds,
 * drawer opens, stock and staff changes. Admins see them in the header bell and
 * on the notifications report; selected types are also messaged on WhatsApp.
 *
 * Recording is fire-and-forget: it must never slow down or block the person
 * performing the action. When the till is offline the event is parked locally
 * and flushed on the next successful write.
 */
import { readBusinessValue, writeBusinessValue } from "./business-storage";
import { pushActivityEvent } from "./activity-events.functions";
import { readCredentials } from "./pos-credentials";
import { posFetch } from "./server-origin";
import { supabaseExternal } from "@/integrations/supabase/external-client";
import { platformName } from "@/platform-config/platform";

export type EventSeverity = "info" | "warning" | "critical";

export type ActivityEventInput = {
  type: string;
  severity?: EventSeverity;
  title: string;
  message?: string;
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  terminalId?: string | null;
  terminalName?: string | null;
  storeId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  amount?: number | null;
  meta?: Record<string, unknown>;
};

export type ActivityEvent = {
  id: string;
  type: string;
  severity: EventSeverity;
  title: string;
  message: string;
  actorName: string;
  actorRole: string;
  terminalName: string;
  storeId: string;
  entityType: string;
  entityId: string;
  amount: number | null;
  meta: Record<string, unknown>;
  whatsappStatus: string;
  createdAt: string;
  /** Staff identifiers that cleared this entry on another signed-in device. */
  clearedBy: string[];
};

/** Every event the till can raise, grouped for the settings matrix. */
export const EVENT_CATALOG: { group: string; types: { type: string; label: string }[] }[] = [
  {
    group: "Sign in & security",
    types: [
      { type: "sign_in", label: "Someone signs in" },
      { type: "sign_out", label: "Someone signs out" },
      { type: "sign_in_failed", label: "Failed PIN or password attempt" },
      { type: "account_locked", label: "Account locked after repeated failures" },
      { type: "terminal_activated", label: "Terminal activated" },
      { type: "terminal_unpaired", label: "Terminal unpaired" },
    ],
  },
  {
    group: "Shifts & cash",
    types: [
      { type: "shift_open", label: "Shift opened" },
      { type: "shift_close", label: "Shift closed" },
      { type: "shift_cash_variance", label: "Shift closed over or short" },
      { type: "xreport_print", label: "X-report printed" },
      { type: "drawer_open", label: "Cash drawer opened by hand" },
    ],
  },
  {
    group: "Selling",
    types: [
      { type: "sale_complete", label: "Sale completed" },
      { type: "sale_refund", label: "Refund issued" },
      { type: "sale_void", label: "Bill voided" },
      { type: "discount_override", label: "Large manual discount" },
    ],
  },
  {
    group: "Stock & purchasing",
    types: [
      { type: "stock_adjust", label: "Stock adjusted" },
      { type: "transfer_sent", label: "Transfer sent" },
      { type: "transfer_received", label: "Transfer received" },
      { type: "po_finalised", label: "Purchase order finalised" },
    ],
  },
  {
    group: "People",
    types: [
      { type: "staff_created", label: "Staff account created" },
      { type: "staff_updated", label: "Staff account edited" },
      { type: "staff_deactivated", label: "Staff account deactivated" },
      { type: "role_changed", label: "Role or permissions changed" },
    ],
  },
];

export const EVENT_LABELS: Record<string, string> = Object.fromEntries(
  EVENT_CATALOG.flatMap((g) => g.types.map((t) => [t.type, t.label] as const)),
);

export const SEVERITY_TONE: Record<EventSeverity, string> = {
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  warning: "border-warning/40 bg-warning/10 text-warning",
  info: "border-border bg-surface-2 text-muted-foreground",
};

/* ---------------------------------------------------------------- offline */

const QUEUE_KEY = "pos.activity.queue.v1";
const isBrowser = () => typeof window !== "undefined";

type Queued = ActivityEventInput & { clientEventId: string; createdAt: string };

function readQueue(): Queued[] {
  if (!isBrowser()) return [];
  try {
    return JSON.parse(readBusinessValue(QUEUE_KEY) ?? "[]") as Queued[];
  } catch {
    return [];
  }
}

function writeQueue(rows: Queued[]) {
  if (!isBrowser()) return;
  try {
    writeBusinessValue(QUEUE_KEY, JSON.stringify(rows.slice(-500)));
  } catch {
    /* storage full — the till keeps selling */
  }
}

async function send(entry: Queued): Promise<boolean> {
  try {
    // The server refuses events it cannot attribute, so the device's proof
    // travels with every one. Before sign-in the event simply waits in the
    // local queue and is flushed once there is a session.
    const credentials = await readCredentials();
    const res = await pushActivityEvent({ data: { ...entry, ...credentials } });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Keep the event on this till when the cloud cannot be reached.
 *
 * The browser queue survives a reload but not a wipe, so on a terminal with
 * its own database the event is written there instead and pushed by the sync
 * worker like a sale. Returns true when the row is safely stored.
 */
async function park(entry: Queued): Promise<boolean> {
  const { parkGovernanceRow } = await import("./governance-offline");
  const res = await parkGovernanceRow("activity_events", {
    id: entry.clientEventId,
    client_event_id: entry.clientEventId,
    event_type: entry.type,
    severity: entry.severity ?? "info",
    title: entry.title,
    message: entry.message ?? "",
    actor_id: entry.actorId ?? null,
    actor_name: entry.actorName ?? null,
    actor_role: entry.actorRole ?? null,
    terminal_id: entry.terminalId ?? null,
    terminal_name: entry.terminalName ?? null,
    store_id: entry.storeId ?? null,
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId ?? null,
    amount: entry.amount ?? null,
    meta: entry.meta ?? {},
    whatsapp_status: "skipped",
    created_at: entry.createdAt,
  });
  return res.parked;
}

/** Retry anything that could not reach the cloud earlier. */
export async function flushActivityQueue(): Promise<void> {
  const rows = readQueue();
  if (rows.length === 0) return;
  const left: Queued[] = [];
  for (const row of rows) {
    if (!(await send(row))) left.push(row);
  }
  writeQueue(left);
}

/** Raise an event. Never throws, never blocks the caller. */
export function recordActivity(input: ActivityEventInput): void {
  const entry: Queued = {
    ...input,
    severity: input.severity ?? "info",
    clientEventId: isBrowser() && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  void (async () => {
    // Electron governance events enter SQL Server first and are uploaded by
    // the same durable coordinator as the sale. Its browser queue is never an
    // Electron outbox.
    if (typeof window !== "undefined" && (window as unknown as { pos?: unknown }).pos) {
      if (await park(entry)) return;
    }
    if (await send(entry)) {
      void flushActivityQueue().catch(() => undefined);
      return;
    }
    // Offline: the till's own database keeps it if there is one, otherwise
    // the browser queue holds it until the line is back.
    if (await park(entry)) return;
    writeQueue([...readQueue(), entry]);
  })().catch(() => {
    // Visibility events are non-critical and must never reject into checkout.
  });
}

export const pendingActivityCount = () => readQueue().length;

/* ------------------------------------------------------------------ reads */

type Row = Record<string, unknown>;

function map(row: Row): ActivityEvent {
  return {
    id: String(row["id"] ?? ""),
    type: String(row["event_type"] ?? ""),
    severity: (row["severity"] as EventSeverity) ?? "info",
    title: String(row["title"] ?? ""),
    message: String(row["message"] ?? ""),
    actorName: String(row["actor_name"] ?? ""),
    actorRole: String(row["actor_role"] ?? ""),
    terminalName: String(row["terminal_name"] ?? row["terminal_id"] ?? ""),
    storeId: String(row["store_id"] ?? ""),
    entityType: String(row["entity_type"] ?? ""),
    entityId: String(row["entity_id"] ?? ""),
    amount: row["amount"] === null || row["amount"] === undefined ? null : Number(row["amount"]),
    meta:
      row["meta"] && typeof row["meta"] === "object" && !Array.isArray(row["meta"])
        ? (row["meta"] as Record<string, unknown>)
        : {},
    whatsappStatus: String(row["whatsapp_status"] ?? "skipped"),
    createdAt: String(row["created_at"] ?? ""),
    clearedBy: Array.isArray(row["cleared_by"])
      ? row["cleared_by"].filter((value): value is string => typeof value === "string")
      : [],
  };
}

export type ActivityFilter = {
  types?: string[];
  severities?: EventSeverity[];
  storeId?: string;
  actor?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  query?: string;
  sortBy?: "created_at" | "severity" | "event_type" | "store_id" | "title";
  sortDirection?: "asc" | "desc";
};

export type ActivityEventPage = { rows: ActivityEvent[]; total: number };

type ActivityProfile = {
  role: string;
  store_id: string | null;
  is_active: boolean;
};

/**
 * Electron already owns an authenticated connection to the operator-selected
 * Supabase project. Read the activity feed there instead of routing it through
 * the hosted POS backend, which may serve a different tenant or have no web
 * deployment variables at all.
 */
async function listActivityEventPageDirect(
  filter: ActivityFilter = {},
): Promise<ActivityEventPage> {
  const profileResult = await supabaseExternal.rpc("current_app_user");
  if (profileResult.error) throw profileResult.error;
  const profile = (profileResult.data?.[0] ?? null) as ActivityProfile | null;
  if (!profile?.is_active) throw new Error("A signed-in staff account is required");

  let query = supabaseExternal.from("activity_events").select("*", { count: "exact" });
  if (filter.types?.length) query = query.in("event_type", filter.types);
  if (filter.severities?.length) query = query.in("severity", filter.severities);

  const branch = profile.store_id?.trim() || "";
  const isAdmin = profile.role === "admin";
  if (branch && !isAdmin) {
    if (filter.storeId && filter.storeId !== branch) throw new Error("Branch access denied");
    query = query.eq("store_id", branch);
  } else if (filter.storeId) query = query.eq("store_id", filter.storeId);

  if (filter.actor) query = query.ilike("actor_name", `%${filter.actor.replace(/[,*()]/g, "")}%`);
  if (filter.query) {
    const term = filter.query.replace(/[,*()]/g, "");
    if (term)
      query = query.or(
        `title.ilike.%${term}%,message.ilike.%${term}%,actor_name.ilike.%${term}%,entity_id.ilike.%${term}%`,
      );
  }
  if (filter.from) query = query.gte("created_at", filter.from);
  if (filter.to) query = query.lte("created_at", filter.to);

  const offset = filter.offset ?? 0;
  const limit = filter.limit ?? 200;
  const result = await query
    .order(filter.sortBy ?? "created_at", { ascending: filter.sortDirection === "asc" })
    .range(offset, offset + limit - 1);
  if (result.error) throw result.error;
  const rows = (result.data ?? []).map((row) => map(row as Row));
  return { rows, total: result.count ?? rows.length };
}

/**
 * Older databases predate the activity feed. When the table is absent every
 * poll would log a 404, so the first miss switches the feature off for the
 * session and the UI shows a short "run the setup file" hint instead.
 */
let logMissing = false;

export const isActivityLogMissing = () => logMissing;

const looksMissing = (error: unknown) => {
  const candidate = error as { code?: string; message?: string } | null;
  return (
    !!candidate &&
    (candidate.code === "PGRST205" ||
      candidate.code === "42P01" ||
      /activity_events/i.test(candidate.message ?? "") ||
      /schema cache|does not exist/i.test(candidate.message ?? ""))
  );
};

/** Newest first. Returns [] when the caller is not an admin or supervisor. */
export async function listActivityEvents(filter: ActivityFilter = {}): Promise<ActivityEvent[]> {
  if (logMissing) return [];
  try {
    const credentials = await readCredentials();
    // A registered terminal proves the device, not the person. The activity
    // feed requires a current staff/cashier identity, so an offline or signed-
    // out supervisor view must stay quiet instead of polling a guaranteed 401.
    if (!credentials.sessionToken && !credentials.cashierToken && !credentials.accessToken)
      return [];
    // A Windows till must use the Supabase project restored from its DPAPI
    // vault. Never send this preference read to the separately configured web
    // backend, and never fall back to it when the staff Auth session is absent.
    if (platformName() === "electron") {
      if (!credentials.accessToken) return [];
      return (await listActivityEventPageDirect(filter)).rows;
    }
    const response = await posFetch("/api/v1/pos/activity-preferences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "list", ...filter, ...credentials }),
    });
    const result = (await response.json()) as { ok?: boolean; rows?: Row[]; error?: string };
    if (!response.ok || !result.ok) {
      if (looksMissing({ message: result.error })) logMissing = true;
      return [];
    }
    return (result.rows ?? []).map(map);
  } catch {
    return [];
  }
}

/** Server-paged history for large audit and alert screens. */
export async function listActivityEventPage(
  filter: ActivityFilter = {},
): Promise<ActivityEventPage> {
  if (logMissing) return { rows: [], total: 0 };
  try {
    const credentials = await readCredentials();
    if (!credentials.sessionToken && !credentials.cashierToken && !credentials.accessToken)
      return { rows: [], total: 0 };
    if (platformName() === "electron") {
      if (!credentials.accessToken) return { rows: [], total: 0 };
      return await listActivityEventPageDirect(filter);
    }
    const response = await posFetch("/api/v1/pos/activity-preferences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "list", ...filter, ...credentials }),
    });
    const result = (await response.json()) as {
      ok?: boolean;
      rows?: Row[];
      total?: number;
      error?: string;
    };
    if (!response.ok || !result.ok) {
      if (looksMissing({ message: result.error })) {
        logMissing = true;
        return { rows: [], total: 0 };
      }
      throw Object.assign(new Error(result.error || "Could not load alerts"), {
        status: response.status,
      });
    }
    return { rows: (result.rows ?? []).map(map), total: Number(result.total ?? 0) || 0 };
  } catch (error) {
    if (looksMissing(error)) {
      logMissing = true;
      return { rows: [], total: 0 };
    }
    throw error;
  }
}

/* ------------------------------------------------------------ read marker */

const SEEN_KEY = "pos.activity.seen";

type SeenMap = Record<string, string>;

function readSeenMap(): SeenMap {
  if (!isBrowser()) return {};
  try {
    const parsed = JSON.parse(readBusinessValue(SEEN_KEY) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" ? (parsed as SeenMap) : {};
  } catch {
    return {};
  }
}

const who = (userId: string) => (userId || "anon").toLowerCase();

export function lastSeenAt(userId = ""): string {
  return readSeenMap()[who(userId)] ?? "";
}

export function markActivitySeen(stamp = new Date().toISOString(), userId = "") {
  if (!isBrowser()) return;
  const map = readSeenMap();
  map[who(userId)] = stamp;
  writeBusinessValue(SEEN_KEY, JSON.stringify(map));
}

/** Rows raised since the admin last opened the bell. */
export const unseenEvents = (rows: ActivityEvent[], userId = ""): ActivityEvent[] => {
  const seen = lastSeenAt(userId);
  return seen ? rows.filter((r) => r.createdAt > seen) : rows;
};

export function toCsv(rows: ActivityEvent[]): string {
  const head = [
    "When",
    "Type",
    "Severity",
    "Title",
    "Message",
    "Person",
    "Role",
    "Terminal",
    "Branch",
    "Amount",
    "WhatsApp",
  ];
  const cell = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const body = rows.map((r) =>
    [
      r.createdAt,
      EVENT_LABELS[r.type] ?? r.type,
      r.severity,
      r.title,
      r.message,
      r.actorName,
      r.actorRole,
      r.terminalName,
      r.storeId,
      r.amount ?? "",
      r.whatsappStatus,
    ]
      .map(cell)
      .join(","),
  );
  return [head.map(cell).join(","), ...body].join("\n");
}
/* ------------------------------------------------------- cleared entries */

/**
 * Clearing an entry hides it for the person who cleared it. The event, the
 * approval request and the authorisation log are untouched — anything cleared
 * can be reopened from the Cleared tab.
 */
const CLEARED_KEY = "pos.activity.cleared";

type ClearedMap = Record<string, string[]>;

function readClearedMap(): ClearedMap {
  if (!isBrowser()) return {};
  try {
    const raw = readBusinessValue(CLEARED_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as ClearedMap) : {};
  } catch {
    return {};
  }
}

function writeClearedMap(map: ClearedMap) {
  if (!isBrowser()) return;
  try {
    writeBusinessValue(CLEARED_KEY, JSON.stringify(map));
  } catch {
    /* storage blocked — clearing is only a view preference */
  }
  window.dispatchEvent(new CustomEvent("pos:activity-cleared-changed"));
}

export const clearedIds = (userId: string): string[] => readClearedMap()[who(userId)] ?? [];

/**
 * Merge server-side clear markers into the durable device cache. This makes a
 * dismissal follow a person to their other tills while retaining offline use.
 */
export function mergeRemoteActivityPreferences(userId: string, rows: ActivityEvent[]) {
  const key = who(userId);
  const fetched = new Set(rows.map((row) => row.id));
  const remote = rows
    .filter((row) => row.clearedBy.some((id) => who(id) === key))
    .map((row) => row.id);
  const map = readClearedMap();
  map[key] = [...new Set([...(map[key] ?? []).filter((id) => !fetched.has(id)), ...remote])].slice(
    -500,
  );
  writeClearedMap(map);
}

async function syncClearedEntry(id: string, cleared: boolean): Promise<boolean> {
  try {
    const credentials = await readCredentials();
    if (!credentials.sessionToken && !credentials.cashierToken && !credentials.accessToken)
      return false;
    if (platformName() === "electron") {
      if (!credentials.accessToken) return false;
      const { error } = await supabaseExternal.rpc("set_activity_event_cleared", {
        p_event_id: id,
        p_cleared: cleared,
      });
      return !error;
    }
    const response = await posFetch("/api/v1/pos/activity-preferences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "clear", eventId: id, cleared, ...credentials }),
    });
    const result = (await response.json()) as { ok?: boolean };
    return response.ok && result.ok === true;
  } catch {
    return false;
  }
}

async function syncClearAllEntries(): Promise<boolean> {
  try {
    const credentials = await readCredentials();
    if (!credentials.sessionToken && !credentials.cashierToken && !credentials.accessToken)
      return false;
    if (platformName() === "electron") {
      if (!credentials.accessToken) return false;
      const { error } = await supabaseExternal.rpc("set_all_activity_events_cleared");
      return !error;
    }
    const response = await posFetch("/api/v1/pos/activity-preferences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "clear_all", ...credentials }),
    });
    const result = (await response.json()) as { ok?: boolean };
    return response.ok && result.ok === true;
  } catch {
    return false;
  }
}

export async function clearActivityEntry(userId: string, id: string): Promise<boolean> {
  if (!(await syncClearedEntry(id, true))) return false;
  const map = readClearedMap();
  const key = who(userId);
  const list = map[key] ?? [];
  if (!list.includes(id)) map[key] = [...list, id].slice(-500);
  writeClearedMap(map);
  return true;
}

export async function reopenActivityEntry(userId: string, id: string): Promise<boolean> {
  if (!(await syncClearedEntry(id, false))) return false;
  const map = readClearedMap();
  const key = who(userId);
  map[key] = (map[key] ?? []).filter((x) => x !== id);
  writeClearedMap(map);
  return true;
}

/** Move every currently active notification into this person's history. */
export async function clearAllActivityEntries(
  userId: string,
  visibleIds: string[],
): Promise<boolean> {
  if (!(await syncClearAllEntries())) return false;
  const map = readClearedMap();
  const key = who(userId);
  map[key] = [...new Set([...(map[key] ?? []), ...visibleIds])].slice(-500);
  writeClearedMap(map);
  return true;
}

export const isCleared = (userId: string, id: string): boolean => clearedIds(userId).includes(id);

/**
 * Reconcile inserts and clear/reopen updates immediately across authenticated
 * browsers. Registered PIN-only terminals retain the bounded poll fallback.
 */
export function subscribeActivityEvents(onChange: () => void): () => void {
  try {
    const channel = supabaseExternal.channel("pos-activity-notifications");
    channel.on("postgres_changes", { event: "*", schema: "public", table: "activity_events" }, () =>
      onChange(),
    );
    channel.subscribe();
    return () => {
      void supabaseExternal.removeChannel(channel);
    };
  } catch {
    return () => undefined;
  }
}
