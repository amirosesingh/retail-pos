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
import { localDb } from "@/core/local-db/local-db";
import { hasStaffSession } from "@/core/api/sync-relay";
import { activeBranchId } from "./active-branch";
import { activityAudienceIdentity, activityVisibleTo } from "./activity-audience";
import {
  ACTIVITY_SOURCE_BATCH_SIZE,
  ACTIVITY_WINDOW_ERROR,
  MAX_ACTIVITY_OFFSET,
  MAX_ACTIVITY_SOURCE_BATCHES,
  activityScanBudgetExhausted,
} from "./activity-pagination";

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
  /** Durable identities that acknowledged this notification; retained in alert history. */
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
      { type: "stock_request_received", label: "Stock request received" },
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
    const parsed: unknown = JSON.parse(readBusinessValue(QUEUE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((row): row is Queued => !!row && typeof row === "object" && typeof row.clientEventId === "string" && typeof row.title === "string" && typeof row.type === "string") : [];
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

/** Raise an event. Never throws; callers may await durable storage when required. */
export async function recordActivity(input: ActivityEventInput): Promise<void> {
  const entry: Queued = {
    ...input,
    severity: input.severity ?? "info",
    clientEventId: isBrowser() && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  try {
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
  } catch {
    // Visibility events are non-critical and must never reject into checkout.
  }
}

export const pendingActivityCount = () => readQueue().length;

/* ------------------------------------------------------------------ reads */

type Row = Record<string, unknown>;

function map(row: Row): ActivityEvent {
  const jsonObject = (value: unknown): Record<string, unknown> => {
    if (value && typeof value === "object" && !Array.isArray(value))
      return value as Record<string, unknown>;
    if (typeof value !== "string" || !value.trim()) return {};
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  };
  const stringArray = (value: unknown): string[] => {
    if (Array.isArray(value))
      return value.filter((item): item is string => typeof item === "string");
    if (typeof value !== "string" || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  };
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
    meta: jsonObject(row["meta"]),
    whatsappStatus: String(row["whatsapp_status"] ?? "skipped"),
    createdAt: String(row["created_at"] ?? ""),
    clearedBy: stringArray(row["cleared_by"]),
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

/** `total` is a lower bound when `totalExact` is false. */
export type ActivityEventPage = { rows: ActivityEvent[]; total: number; totalExact?: boolean };

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

  const branch = profile.store_id?.trim() || "";
  const isAdmin = profile.role === "admin";
  if (branch && !isAdmin) {
    if (filter.storeId && filter.storeId !== branch) throw new Error("Branch access denied");
  }

  const buildQuery = () => {
    let query = supabaseExternal.from("activity_events").select("*");
    if (filter.types?.length) query = query.in("event_type", filter.types);
    if (filter.severities?.length) query = query.in("severity", filter.severities);
    if (branch && !isAdmin) query = query.eq("store_id", branch);
    else if (filter.storeId) query = query.eq("store_id", filter.storeId);
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
    return query
      .order(filter.sortBy ?? "created_at", {
        ascending: filter.sortDirection === "asc",
      })
      .order("id", { ascending: true });
  };

  const offset = Math.max(0, filter.offset ?? 0);
  if (offset > MAX_ACTIVITY_OFFSET)
    throw Object.assign(new Error(ACTIVITY_WINDOW_ERROR), { code: "ACTIVITY_WINDOW_EXCEEDED" });
  const limit = filter.limit ?? 200;
  const target = offset + limit;
  const identity = activityAudienceIdentity();
  const visibleRows: ActivityEvent[] = [];
  const batchSize = ACTIVITY_SOURCE_BATCH_SIZE;
  let sourceOffset = 0;
  let exhausted = false;
  let batchesRead = 0;
  // Advance the source cursor until this visible page is filled. Each database
  // read stays bounded while sparse private audiences can still page beyond
  // the first 10,000 source rows.
  while (visibleRows.length < target && batchesRead < MAX_ACTIVITY_SOURCE_BATCHES) {
    const result = await buildQuery().range(sourceOffset, sourceOffset + batchSize - 1);
    if (result.error) throw result.error;
    batchesRead += 1;
    const batch = (result.data ?? []).map((row) => map(row as Row));
    visibleRows.push(
      ...(identity
        ? batch.filter((row) =>
            activityVisibleTo(
              { store_id: row.storeId, terminal_id: row.terminalName, event_type: row.type, meta: row.meta },
              identity,
            ),
          )
        : batch),
    );
    if (batch.length < batchSize) {
      exhausted = true;
      break;
    }
    sourceOffset += batch.length;
  }
  let sourceRowRemains = false;
  if (!exhausted && batchesRead >= MAX_ACTIVITY_SOURCE_BATCHES && visibleRows.length < target) {
    const probe = await buildQuery().range(sourceOffset, sourceOffset);
    if (probe.error) throw probe.error;
    sourceRowRemains = (probe.data?.length ?? 0) > 0;
    exhausted = !sourceRowRemains;
  }
  if (activityScanBudgetExhausted({ batchesRead, exhausted, sourceRowRemains, visibleCount: visibleRows.length, target }))
    throw Object.assign(new Error(ACTIVITY_WINDOW_ERROR), { code: "ACTIVITY_WINDOW_EXCEEDED" });
  return {
    rows: visibleRows.slice(offset, offset + limit),
    total: visibleRows.length,
    totalExact: exhausted,
  };
}

/** Electron-only fallback. The authenticated hosted API remains primary. */
async function listLocalActivityEventPage(filter: ActivityFilter): Promise<ActivityEventPage> {
  const bridge = localDb();
  if (!bridge?.query) return { rows: [], total: 0 };
  const result = await bridge.query("activity_events", {
    orderBy: { column: "created_at", ascending: false },
    limit: 2000,
  });
  if (!result.ok) throw new Error(result.error ?? "The local notification log could not be read.");
  let rows = (result.rows ?? []).map((row) => map(row as Row));
  const identity = activityAudienceIdentity();
  if (identity)
    rows = rows.filter((row) =>
      activityVisibleTo(
        { store_id: row.storeId, terminal_id: row.terminalName, event_type: row.type, meta: row.meta },
        identity,
      ),
    );
  if (filter.types?.length) rows = rows.filter((row) => filter.types!.includes(row.type));
  if (filter.severities?.length)
    rows = rows.filter((row) => filter.severities!.includes(row.severity));
  if (filter.storeId) rows = rows.filter((row) => row.storeId === filter.storeId);
  if (filter.actor) {
    const actor = filter.actor.toLowerCase();
    rows = rows.filter((row) => row.actorName.toLowerCase().includes(actor));
  }
  if (filter.from) rows = rows.filter((row) => row.createdAt >= filter.from!);
  if (filter.to) rows = rows.filter((row) => row.createdAt <= filter.to!);
  if (filter.query) {
    const needle = filter.query.toLowerCase();
    rows = rows.filter((row) =>
      [row.title, row.message, row.actorName, row.terminalName, row.storeId].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }
  const field = filter.sortBy ?? "created_at";
  const value = (row: ActivityEvent) =>
    field === "created_at"
      ? row.createdAt
      : field === "severity"
        ? row.severity
        : field === "event_type"
          ? row.type
          : field === "store_id"
            ? row.storeId
            : row.title;
  const direction = (filter.sortDirection ?? "desc") === "asc" ? 1 : -1;
  rows.sort((left, right) => value(left).localeCompare(value(right)) * direction);
  const total = rows.length;
  const offset = Math.max(0, filter.offset ?? 0);
  const limit = Math.max(1, Math.min(2000, filter.limit ?? 100));
  return { rows: rows.slice(offset, offset + limit), total };
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
      /schema cache|does not exist/i.test(candidate.message ?? ""))
  );
};

/** Newest first. Returns [] when the caller is not an admin or supervisor. */
export async function listActivityEvents(filter: ActivityFilter = {}): Promise<ActivityEvent[]> {
  if (localDb()?.query) {
    try {
      return (await listLocalActivityEventPage(filter)).rows;
    } catch {
      // A broken local connection may still fall back to the hosted history.
    }
  }
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
      if (localDb()?.query) return (await listLocalActivityEventPage(filter)).rows;
      return [];
    }
    return (result.rows ?? []).map(map);
  } catch {
    if (localDb()?.query)
      return listLocalActivityEventPage(filter)
        .then((page) => page.rows)
        .catch(() => []);
    return [];
  }
}

/** Server-paged history for large audit and alert screens. */
export async function listActivityEventPage(
  filter: ActivityFilter = {},
): Promise<ActivityEventPage> {
  if (localDb()?.query) {
    try {
      return await listLocalActivityEventPage(filter);
    } catch {
      // Preserve access to hosted history while local SQL reconnects.
    }
  }
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
      totalExact?: boolean;
      error?: string;
    };
    if (!response.ok || !result.ok) {
      if (looksMissing({ message: result.error })) {
        logMissing = true;
        return { rows: [], total: 0 };
      }
      if (localDb()?.query) return listLocalActivityEventPage(filter);
      throw Object.assign(new Error(result.error || "Could not load alerts"), {
        status: response.status,
      });
    }
    return {
      rows: (result.rows ?? []).map(map),
      total: Number(result.total ?? 0) || 0,
      totalExact: result.totalExact !== false,
    };
  } catch (error) {
    if (looksMissing(error)) {
      logMissing = true;
      return { rows: [], total: 0 };
    }
    if (localDb()?.query) return listLocalActivityEventPage(filter);
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
 * Clearing an entry acknowledges it for every recipient. The event, the
 * approval request and the authorisation log remain unchanged. Clears are
 * persisted before the shared delivery cache hides the notification.
 */
const CLEARED_KEY = "pos.activity.cleared";

type ClearedMap = Record<string, string[]>;

function readClearedMap(): ClearedMap {
  if (!isBrowser()) return {};
  try {
    const raw = window.localStorage.getItem(CLEARED_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as ClearedMap) : {};
  } catch {
    return {};
  }
}

function writeClearedMap(map: ClearedMap) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(CLEARED_KEY, JSON.stringify(map));
  } catch {
    /* storage blocked — clearing is only a view preference */
  }
  window.dispatchEvent(new CustomEvent("pos:activity-cleared-changed"));
}

export const clearedIds = (userId: string): string[] => [...new Set([...(readClearedMap()["shared"] ?? []),...(readClearedMap()[who(userId)] ?? [])])];

/**
 * Dismissal is shared across recipients and synchronized devices. Approval records
 * and audit events remain durable.
 */
export function mergeRemoteActivityPreferences(_userId: string, rows: ActivityEvent[]) {
  const map = readClearedMap();
  const previous = map["shared"] ?? [];
  map["shared"] = [...new Set([...previous,...rows.filter(row => row.clearedBy.length > 0).map(row => row.id)])];
  if (map["shared"].length === previous.length) return;
  writeClearedMap(map);
}

async function saveNotificationClear(userId: string, id: string): Promise<boolean> {
  if (!userId || !id) return false;
  try {
    const bridge = localDb();
    if (bridge?.query) {
      const result = await bridge.query("activity_events",{match:{id},limit:1});
      if (!result.ok || !result.rows?.[0]) return false;
      const row = result.rows[0] as Row;
      const identity = activityAudienceIdentity();
      if (identity && !activityVisibleTo(row,identity)) return false;
      const previous = map(row).clearedBy;
      if (!previous.length) {
        const {commitOps} = await import("@/core/api/pos-db");
        await commitOps("Clearing notification",[{kind:"update",table:"activity_events",match:{id},values:{cleared_by:JSON.stringify([userId])},requireMatch:true}]);
      }
      return true;
    }
    const credentials = await readCredentials();
    if (platformName() === "electron") {
      if (!credentials.accessToken) return false;
      const result = await supabaseExternal.rpc("set_activity_event_cleared",{p_event_id:id,p_cleared:true});
      return !result.error;
    }
    const response = await posFetch("/api/v1/pos/activity-preferences",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"clear",eventId:id,cleared:true,...credentials})});
    const result = await response.json() as {ok?:boolean};
    return response.ok && result.ok === true;
  } catch { return false; }
}

export async function clearActivityEntry(userId: string, id: string): Promise<boolean> {
  if (!await saveNotificationClear(userId,id)) return false;
  const map = readClearedMap();
  const key = "shared";
  const list = map[key] ?? [];
  if (!list.includes(id)) map[key] = [...list, id];
  writeClearedMap(map);
  return true;
}

export async function reopenActivityEntry(userId: string, id: string): Promise<boolean> {
  if ((readClearedMap()["shared"] ?? []).includes(id)) return false;
  const map = readClearedMap();
  const key = who(userId);
  map[key] = (map[key] ?? []).filter((x) => x !== id);
  writeClearedMap(map);
  return true;
}

/** Acknowledge the displayed notifications; retain successful clears on partial failure. */
export async function clearAllActivityEntries(
  userId: string,
  visibleIds: string[],
): Promise<boolean> {
  const ids = [...new Set(visibleIds)];
  const bridge = localDb();
  if (bridge?.query && ids.length) {
    if (!userId) return false;
    try {
      const result = await bridge.query("activity_events",{in:{column:"id",values:ids},limit:ids.length});
      if (!result.ok || result.rows?.length !== ids.length) return false;
      const identity = activityAudienceIdentity();
      if (identity && result.rows.some(row => !activityVisibleTo(row as Row,identity))) return false;
      const {commitOps} = await import("@/core/api/pos-db");
      const rows = result.rows.filter(row => !map(row as Row).clearedBy.length);
      if (rows.length) await commitOps("Clearing notifications",rows.map(row => ({kind:"update" as const,table:"activity_events",match:{id:row.id},values:{cleared_by:JSON.stringify([userId])},requireMatch:true})));
      const cleared = readClearedMap();
      cleared["shared"] = [...new Set([...(cleared["shared"] ?? []),...ids])];
      writeClearedMap(cleared);
      return true;
    } catch { return false; }
  }
  let saved = true;
  for (let index=0;index<ids.length;index+=4) {
    const results = await Promise.all(ids.slice(index,index+4).map(id => clearActivityEntry(userId,id)));
    if (results.some(result => !result)) saved = false;
  }
  return saved;
}

export const isCleared = (userId: string, id: string): boolean => clearedIds(userId).includes(id);

/**
 * Reconcile inserts and clear/reopen updates immediately across authenticated
 * browsers. Registered PIN-only terminals retain the bounded poll fallback.
 */
export function subscribeActivityEvents(onChange: () => void): () => void {
  const cleanups: Array<() => void> = [];
  const bridge = localDb();
  if (bridge?.onBusinessChanged) {
    // Electron commits activity rows and clear/reopen preferences to SQL
    // Server before cloud synchronization. Refresh from that durable local
    // commit immediately so offline popups and preference changes never wait
    // for the 15-second reconciliation poll or Supabase Realtime.
    cleanups.push(bridge.onBusinessChanged(() => onChange()));
  }
  // A PIN-only Electron session deliberately has no Supabase Auth JWT. The
  // anon role cannot SELECT this protected table, and Realtime reports that
  // lack of privilege misleadingly as "invalid column for filter store_id".
  // Local SQL notifications plus the reconciliation poll remain authoritative.
  if (!hasStaffSession()) return () => cleanups.forEach((cleanup) => cleanup());
  try {
    const channel = supabaseExternal.channel("pos-activity-notifications");
    const branchId = activeBranchId();
    if (branchId) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "activity_events",
          filter: `store_id=eq.${branchId}`,
        },
        () => onChange(),
      );
    }
    channel.subscribe();
    cleanups.push(() => {
      void supabaseExternal.removeChannel(channel);
    });
  } catch {
    // Local SQL notifications still work when the cloud channel is offline.
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}
