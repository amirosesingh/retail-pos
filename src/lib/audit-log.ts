import { readBusinessValue, writeBusinessValue } from "./business-storage";
import { useEffect, useSyncExternalStore } from "react";
import { db } from "@/core/api/pos-db";
import { hasSignedInIdentity } from "./session-presence";
import { replayOrder, stamp } from "./activity-journal";
import { isTerminalApp } from "@/platform-config/platform";

/**
 * Business-language activity groups.
 *
 * The trail is read by shop managers, so every entry lands in one of these
 * plain groups rather than a technical name like "interaction".
 */
export type AuditCategory =
  | "sale"
  | "payment"
  | "refund"
  | "drawer"
  | "discount"
  | "inventory"
  | "shift"
  | "member"
  | "settings"
  | "security"
  | "report"
  | "print"
  | "browse"
  | "other";

export const AUDIT_CATEGORIES: { value: AuditCategory; label: string }[] = [
  { value: "sale", label: "Sales" },
  { value: "payment", label: "Payments" },
  { value: "refund", label: "Returns & exchanges" },
  { value: "drawer", label: "No-sale & cash drawer" },
  { value: "discount", label: "Discounts & coupons" },
  { value: "inventory", label: "Inventory" },
  { value: "shift", label: "Shifts & attendance" },
  { value: "member", label: "Members" },
  { value: "settings", label: "Settings" },
  { value: "security", label: "Security & access" },
  { value: "report", label: "Reports & exports" },
  { value: "print", label: "Receipts & printing" },
  { value: "browse", label: "Browsing & screens" },
  { value: "other", label: "Other activity" },
];

export const AUDIT_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  AUDIT_CATEGORIES.map((c) => [c.value, c.label]),
);

/** Legacy category names still stored in older local logs. */
const LEGACY: Record<string, AuditCategory> = {
  ui_click: "browse",
  modal: "browse",
  search: "browse",
  navigation: "browse",
  interaction: "browse",
  lookup: "browse",
  sync: "other",
  messaging: "member",
  booking: "sale",
  cash: "drawer",
  purchasing: "inventory",
  promotion: "discount",
  staff: "security",
  session: "security",
  sale_event: "sale",
  inventory_edit: "inventory",
  member_event: "member",
  settings_change: "settings",
  transfer: "inventory",
  coupon: "discount",
  voucher: "discount",
};

/**
 * Screen the action happened on. Used as the final fallback so an entry made
 * on the inventory screen is filed under Inventory even when the wording is
 * ambiguous.
 */
const MODULE_CATEGORY: Record<string, AuditCategory> = {
  register: "sale",
  sales: "sale",
  receipts: "sale",
  bookings: "sale",
  holds: "sale",
  inventory: "inventory",
  purchasing: "inventory",
  transfers: "inventory",
  suppliers: "inventory",
  members: "member",
  customers: "member",
  messaging: "member",
  promotions: "discount",
  coupons: "discount",
  shifts: "shift",
  staff: "security",
  terminals: "settings",
  settings: "settings",
  reports: "report",
  audit: "report",
  dashboard: "browse",
};

/**
 * Resolves the activity group.
 *
 * The group the screen passed in wins — pressing Pay on the till files under
 * Sales, an edit on the stock screen files under Inventory. Only when the
 * caller passes nothing meaningful do we read the wording of the action, and
 * finally the screen it happened on.
 */
export function resolveCategory(raw: string, action: string, module = ""): AuditCategory {
  // 1. an explicit, known group always wins
  if (AUDIT_CATEGORY_LABELS[raw] && raw !== "other") return raw as AuditCategory;
  const legacy = LEGACY[raw];
  if (legacy === "browse") return "browse";
  if (legacy && legacy !== "other") return legacy;

  // 2. read the wording of the action
  const a = action.toLowerCase();
  if (/refund|exchange|void|return/.test(a)) return "refund";
  if (/drawer|no.?sale|cash count|float/.test(a)) return "drawer";
  if (/shift|attendance|sign.?in|signed in|sign.?out/.test(a)) return "shift";
  if (/whatsapp|message sent|sms/.test(a)) return "member";
  if (/login|logout|locked|unlock|override|permission|role|staff|cashier account/.test(a))
    return "security";
  if (/receiving|purchase order|supplier|barcode scanned/.test(a)) return "inventory";
  if (/coupon|voucher|promotion|discount|tier/.test(a)) return "discount";
  if (/stock transfer/.test(a)) return "inventory";
  if (/payment|tender|paid|card/.test(a)) return "payment";
  if (/print/.test(a)) return "print";
  if (/export|report/.test(a)) return "report";
  if (/bill|sale|booking|pay later|deposit|collect|receipt printed/.test(a)) return "sale";
  if (/stock|product|inventory|price/.test(a)) return "inventory";
  if (/member|points|loyalty/.test(a)) return "member";
  if (/setting/.test(a)) return "settings";

  // 3. fall back to the screen, then the legacy name
  const byModule = MODULE_CATEGORY[module.toLowerCase()];
  if (byModule) return byModule;
  if (legacy) return legacy;
  return AUDIT_CATEGORY_LABELS[raw] ? (raw as AuditCategory) : "other";
}

/** Old records still carry retired category names — map them for display. */
export const displayCategory = (c: string): AuditCategory =>
  AUDIT_CATEGORY_LABELS[c] ? (c as AuditCategory) : (LEGACY[c] ?? "other");

export type AuditLog = {
  id: string;
  at: string;
  category: AuditCategory;
  action: string;
  module: string;
  staffId: string;
  staffName: string;
  /** role the person held when the action happened */
  role: string;
  storeId: string | null;
  route: string;
  details: Record<string, unknown>;
  synced_to_cloud: boolean;
  syncedAt: string | null;
  /** till that produced the entry */
  terminalId?: string;
  /** monotonic per-terminal order, used when replaying after an outage */
  seq?: number;
  /** device clock reading (may differ from the cloud's received time) */
  deviceTime?: string;
};

const KEY = "pos-audit-logs-v1";
/** Cap applies to already-synced history only — pending entries are never
 *  dropped, however long the terminal stays offline. */
const MAX_SYNCED = 4000;

let logs: AuditLog[] = [];
let sqlLogs: AuditLog[] = [];
let visibleLogs: AuditLog[] = [];
let loaded = false;
let sqlHistoryLoaded = false;
const listeners = new Set<() => void>();

let actor = {
  staffId: "anonymous",
  staffName: "Unknown",
  role: "unknown",
  storeId: null as string | null,
  authUserId: null as string | null,
};

/** Tell the logger which employee is currently on the terminal. */
export const setAuditActor = (next: Partial<typeof actor>) => {
  actor = { ...actor, ...next };
};

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = readBusinessValue(KEY);
    if (raw) logs = JSON.parse(raw) as AuditLog[];
  } catch {
    /* corrupt storage */
  }
  refreshVisibleLogs();
}

function refreshVisibleLogs() {
  const byId = new Map<string, AuditLog>();
  for (const row of sqlLogs) byId.set(row.id, row);
  for (const row of logs) byId.set(row.id, row);
  visibleLogs = [...byId.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    writeBusinessValue(KEY, JSON.stringify(trim(logs)));
  } catch {
    /* storage full */
  }
}

/** Keep every pending entry; only archive old, already-synced ones. */
function trim(rows: AuditLog[]): AuditLog[] {
  let synced = 0;
  return rows.filter((r) => {
    if (!r.synced_to_cloud) return true;
    synced += 1;
    return synced <= MAX_SYNCED;
  });
}

function emit() {
  refreshVisibleLogs();
  persist();
  listeners.forEach((l) => l());
}

/** Global logging utility — every write lands locally first, offline-safe. */
export const logger = {
  log(category: string, actionName: string, module: string, details: Record<string, unknown> = {}) {
    if (typeof window === "undefined") return;
    load();
    const s = stamp(actor.storeId);
    const entry: AuditLog = {
      id: crypto.randomUUID(),
      at: s.deviceTime,
      category: resolveCategory(category, actionName, module),
      action: actionName,
      module,
      staffId: actor.staffId,
      staffName: actor.staffName,
      role: actor.role,
      storeId: actor.storeId ?? s.branchId,
      route: window.location.pathname,
      details: { ...details, role: actor.role, authUserId: actor.authUserId },
      synced_to_cloud: false,
      syncedAt: null,
      terminalId: s.terminalId,
      seq: s.seq,
      deviceTime: s.deviceTime,
    };
    logs = trim([entry, ...logs]);
    emit();
    scheduleFlush();
    return entry;
  },
  all() {
    load();
    return visibleLogs;
  },
  clear() {
    logs = [];
    emit();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/* ---------------- background sync engine ---------------- */

let syncTimer: ReturnType<typeof setInterval> | null = null;
const BATCH = 50;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight: Promise<void> | null = null;

/** Debounced push so fresh activity reaches the cloud within seconds. */
function scheduleFlush() {
  if (typeof window === "undefined" || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushBatch();
  }, 3000);
}

export type SyncState = {
  online: boolean;
  pending: number;
  lastSyncAt: string | null;
  lastError: string | null;
};

let syncState: SyncState = { online: true, pending: 0, lastSyncAt: null, lastError: null };
const syncListeners = new Set<() => void>();

const setSync = (patch: Partial<SyncState>) => {
  syncState = { ...syncState, ...patch };
  syncListeners.forEach((l) => l());
};

function flushBatch(): Promise<void> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = flushBatchOnce().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

async function flushBatchOnce() {
  load();
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  // Oldest first, in per-terminal sequence, so the cloud sees the same order
  // the branch experienced — even after days offline.
  const pending = replayOrder(logs.filter((l) => !l.synced_to_cloud));
  setSync({ online, pending: pending.length });
  if (!online || !pending.length) return;
  // Nobody signed in: the central journal would reject the write anyway.
  // The entries stay queued locally and go up on the next signed-in flush.
  if (!hasSignedInIdentity()) return;

  // Push in batches to the cloud audit_logs table; failures stay pending.
  const slice = pending.slice(0, BATCH);
  let batch: string[];
  try {
    batch = await db.pushAuditLogs(
      slice.map((l) => ({
        id: l.id,
        at: l.at,
        staffName: l.staffName,
        category: AUDIT_CATEGORY_LABELS[l.category] ?? l.category,
        action: l.action,
        module: l.module,
        details: {
          ...l.details,
          route: l.route,
          staffId: l.staffId,
          role: l.role,
          storeId: l.storeId,
          terminalId: l.terminalId,
          seq: l.seq,
          deviceTime: l.deviceTime ?? l.at,
          receivedAt: new Date().toISOString(),
        },
      })),
    );
  } catch (e) {
    // A duplicate key means these entries already reached the cloud — treat
    // them as delivered so the queue is not blocked behind them forever.
    const code = (e as { code?: string } | null)?.code;
    if (code !== "23505") {
      setSync({
        lastError: e instanceof Error ? e.message : "Audit upload failed; retrying automatically.",
      });
      return;
    }
    batch = slice.map((l) => l.id);
  }
  const at = new Date().toISOString();
  logs = logs.map((l) =>
    batch.includes(l.id) ? { ...l, synced_to_cloud: true, syncedAt: at } : l,
  );
  emit();
  setSync({
    pending: logs.filter((l) => !l.synced_to_cloud).length,
    lastSyncAt: at,
    lastError: null,
  });
}

/** Ping every 30s: push pending records when online, stay silent when offline. */
export function startAuditSync() {
  if (typeof window === "undefined" || syncTimer) return;
  load();
  setSync({ pending: logs.filter((l) => !l.synced_to_cloud).length, online: navigator.onLine });
  syncTimer = setInterval(() => void flushBatch(), 30_000);
  window.addEventListener("online", () => {
    setSync({ online: true });
    void flushBatch();
  });
  window.addEventListener("offline", () => setSync({ online: false }));
  void flushBatch();
}

export function useAuditLogs() {
  // The renderer cache is deliberately small. On Windows, hydrate a bounded
  // history from SQL Server so reports survive restarts without expanding
  // browser storage or loading an unbounded audit table into memory.
  useEffect(() => {
    if (sqlHistoryLoaded || !isTerminalApp()) return;
    sqlHistoryLoaded = true;
    void dbRouterAuditHistory();
  }, []);
  return useSyncExternalStore(
    logger.subscribe,
    () => logger.all(),
    () => [] as AuditLog[],
  );
}

async function dbRouterAuditHistory(): Promise<void> {
  try {
    const rows = await db.queryAuditLogs(2000);
    load();
    const existing = new Set(logs.map((row) => row.id));
    const mapped = rows
      .filter((row) => !existing.has(String(row.id)))
      .map((row): AuditLog => {
        const rawDetails = row.details;
        const details =
          rawDetails && typeof rawDetails === "object"
            ? (rawDetails as Record<string, unknown>)
            : typeof rawDetails === "string"
              ? (() => {
                  try {
                    return JSON.parse(rawDetails) as Record<string, unknown>;
                  } catch {
                    return {};
                  }
                })()
              : {};
        const action = String(row.action_name ?? row.action ?? "Recorded activity");
        const module = String(row.target_module ?? "");
        const createdAt = String(row.created_at ?? new Date(0).toISOString());
        const rawCategory = String(row.action_category ?? "other").toLowerCase();
        const category =
          AUDIT_CATEGORIES.find((item) => item.label.toLowerCase() === rawCategory)?.value ??
          rawCategory;
        return {
          id: String(row.id),
          at: createdAt,
          category: resolveCategory(category, action, module),
          action,
          module,
          staffId: String(row.user_id ?? details.staffId ?? "unknown"),
          staffName: String(row.user_name ?? "Unknown"),
          role: String(details.role ?? "unknown"),
          storeId: typeof row.store_id === "string" ? row.store_id : null,
          route: String(details.route ?? ""),
          details,
          synced_to_cloud: true,
          syncedAt: null,
          terminalId: typeof details.terminalId === "string" ? details.terminalId : undefined,
          seq: typeof details.seq === "number" ? details.seq : undefined,
          deviceTime: typeof details.deviceTime === "string" ? details.deviceTime : createdAt,
        };
      });
    if (!mapped.length) return;
    sqlLogs = mapped;
    refreshVisibleLogs();
    listeners.forEach((listener) => listener());
  } catch {
    // The current renderer cache remains usable when local SQL is unavailable.
    sqlHistoryLoaded = false;
  }
}

export function useSyncState() {
  return useSyncExternalStore(
    (fn: () => void) => {
      syncListeners.add(fn);
      return () => syncListeners.delete(fn);
    },
    () => syncState,
    () => syncState,
  );
}

export const auditToCsv = (rows: AuditLog[]) => {
  const head = [
    "Timestamp",
    "Staff Name",
    "Staff ID",
    "Role",
    "Action type",
    "Action",
    "Module",
    "Route",
    "Synced",
    "Details",
  ];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const body = rows.map((r) =>
    [
      new Date(r.at).toLocaleString(),
      r.staffName,
      r.staffId,
      r.role ?? "",
      AUDIT_CATEGORY_LABELS[r.category] ?? r.category,
      r.action,
      r.module,
      r.route,
      r.synced_to_cloud ? "synced" : "pending",
      JSON.stringify(r.details),
    ]
      .map((v) => esc(String(v)))
      .join(","),
  );
  return [head.map(esc).join(","), ...body].join("\n");
};
