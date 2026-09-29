/**
 * Live health of every till, for the read-only branch monitoring centre.
 *
 * Each terminal publishes one row describing itself: where it is, who is
 * signed in, whether it is reaching the central database, how many changes
 * are still waiting to go up, and when the last successful sync happened.
 * Nothing on this screen can change a terminal's settings — it only reports.
 */
import { supabaseExternal as supabase } from "@/integrations/supabase/external-client";
import { terminalId } from "./activity-journal";
import { activeBranchId, activeBranchName } from "./active-branch";
import { isMissingSchema } from "./schema-guard";
import { databaseModeLabel, effectiveDatabaseMode, isFailingOver } from "@/core/local-db/db-mode";
import { hasLocalSqlEngine } from "@/core/local-db/local-db";
import { conflictCount, isOnline, lastSyncedAt, pendingCount } from "./sync-outbox";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { APP_VERSION } from "@/version";

export type TelemetryRow = {
  terminal_id: string;
  store_id: string | null;
  terminal_name: string | null;
  /** human name the operator gave this machine when it was activated */
  device_name?: string | null;
  /** pc / mobile — how the device presents itself */
  device_type?: string | null;
  /** branch or warehouse this device is bound to */
  location_name?: string | null;
  session_status?: string | null;
  last_heartbeat_at?: string | null;
  staff_name: string | null;
  staff_role: string | null;
  db_mode: string;
  connection_status: string;
  storage_engine: string;
  pending_count: number;
  conflict_count: number;
  last_synced_at: string | null;
  app_version: string | null;
  platform: string | null;
  last_seen_at: string;
};

type TerminalRegistration = {
  id: string;
  location_id: string | null;
  location_name: string | null;
  device_name: string | null;
  status: string | null;
  platform: string | null;
  app_version: string | null;
  last_seen_at: string | null;
  last_sync_at: string | null;
};

/** Which store keeps this terminal's offline copy of the data. */
export function storageEngine(): string {
  if (typeof window === "undefined") return "cloud";
  if (hasLocalSqlEngine()) return "sqlserver";
  return "live";
}

/** Plain-language connection state used by the monitoring centre. */
export function connectionStatus(): "online" | "offline" | "local" {
  if (!isOnline()) return "offline";
  if (isFailingOver() || effectiveDatabaseMode() === "local") return "local";
  return "online";
}

export const CONNECTION_LABEL: Record<string, string> = {
  online: "Online",
  offline: "Offline",
  local: "Local storage active",
};

export const ENGINE_LABEL: Record<string, string> = {
  sqlserver: "Local Microsoft SQL Server",
  live: "Live only (no local copy)",
  cloud: "Cloud only",
};

/** Snapshot of this terminal right now. */
export function snapshot(staff?: { name?: string | null; role?: string | null }): TelemetryRow {
  const cfg = typeof window === "undefined" ? null : readTerminalConfig();
  const now = new Date().toISOString();
  return {
    // Activated devices report under the registry row id, so the current
    // terminal list cannot split one physical till into registry + heartbeat.
    terminal_id: cfg?.tokenId ?? terminalId(),
    store_id: activeBranchId() ?? null,
    terminal_name: cfg?.deviceName ?? cfg?.locationName ?? activeBranchName() ?? null,
    device_name: cfg?.deviceName ?? null,
    device_type: cfg?.deviceType ?? (isMobilePlatform() ? "mobile" : "pc"),
    location_name: cfg?.locationName ?? activeBranchName() ?? null,
    session_status: staff?.name ? "signed_in" : "idle",
    last_heartbeat_at: now,
    staff_name: staff?.name ?? null,
    staff_role: staff?.role ?? null,
    db_mode: databaseModeLabel(),
    connection_status: connectionStatus(),
    storage_engine: storageEngine(),
    pending_count: pendingCount(),
    conflict_count: conflictCount(),
    last_synced_at: lastSyncedAt(),
    app_version: APP_VERSION,
    platform: typeof navigator === "undefined" ? null : navigator.platform || null,
    last_seen_at: now,
  };
}

/**
 * Columns this database has refused so far. A till pointed at a database that
 * is a version behind keeps reporting its core status instead of failing every
 * heartbeat; the dropped names are remembered for the rest of the session.
 */
const droppedColumns = new Set<string>();

/** Columns the heartbeat must never drop — without them the row is meaningless. */
const ESSENTIAL = new Set(["terminal_id", "store_id", "last_seen_at"]);

/** Which telemetry columns this database could not accept, if any. */
export const missingTelemetryColumns = (): string[] => [...droppedColumns];

/** Pull the offending column name out of a PostgREST / Postgres error. */
function missingColumn(error: { code?: string; message?: string } | null): string | null {
  if (!error) return null;
  if (error.code !== "PGRST204" && error.code !== "42703") return null;
  const m = /'([^']+)'|"([^"]+)"/.exec(error.message ?? "");
  return m?.[1] ?? m?.[2] ?? null;
}

function withoutDropped(row: TelemetryRow): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const key of droppedColumns) delete out[key];
  return out;
}

type TelemetrySession = { access_token?: string | null } | null;

/** Anonymous Data API writes are rejected; do not start one during sign-out. */
export const hasTelemetryAuthSession = (session: TelemetrySession): boolean =>
  Boolean(session?.access_token);

/** Send this terminal's status up. Failures are silent — it is only telemetry. */
export async function publishTelemetry(staff?: { name?: string | null; role?: string | null }) {
  if (typeof window === "undefined") return;
  if (!isOnline()) return;
  // The POS identity can outlive the Supabase session for a few milliseconds
  // while logout/sign-in effects settle. Re-check at the write boundary so a
  // stale React identity cannot emit an anonymous heartbeat and a noisy 401.
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error || !hasTelemetryAuthSession(data.session)) return;
  } catch {
    return;
  }
  const row = snapshot(staff);
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const { error } = await supabase
        .from("branch_telemetry")
        .upsert(withoutDropped(row) as never, { onConflict: "terminal_id" });
      if (!error) return;
      const column = missingColumn(error as { code?: string; message?: string });
      if (!column || ESSENTIAL.has(column) || droppedColumns.has(column)) return;
      droppedColumns.add(column);
      if (import.meta.env.DEV)
        console.warn(`[telemetry] compatibility column unavailable: ${column}`);
    } catch {
      /* telemetry never interrupts trading */
      return;
    }
  }
}

/** Every terminal's latest status, newest heartbeat first. */
export async function listTelemetry(): Promise<TelemetryRow[]> {
  const [telemetry, registrations] = await Promise.all([
    supabase.from("branch_telemetry").select("*").order("last_seen_at", { ascending: false }),
    supabase
      .from("terminal_tokens")
      .select(
        "id,location_id,location_name,device_name,status,platform,app_version,last_seen_at,last_sync_at",
      )
      .is("revoked_at", null)
      .in("status", ["active", "used"])
      .order("created_at", { ascending: true }),
  ]);
  const { data, error } = telemetry;
  if (error) {
    // A database that has not had the repair script applied yet shows an
    // empty telemetry board rather than taking the settings screen down.
    if (isMissingSchema(error)) return [];
    throw error;
  }
  const live = (data ?? []) as unknown as TelemetryRow[];
  // The registry is authoritative for which terminals exist. A newly-created
  // terminal therefore appears immediately, even before its first heartbeat.
  if (registrations.error) return live;
  return mergeTerminalTelemetry(live, (registrations.data ?? []) as TerminalRegistration[]);
}

export function mergeTerminalTelemetry(
  live: TelemetryRow[],
  registrations: TerminalRegistration[],
): TelemetryRow[] {
  // The registry is the lifecycle authority. A heartbeat without a current
  // active registration is historical telemetry, not a terminal that should
  // remain in the current branch tree after revoke/delete/reissue.
  const liveById = new Map(live.map((row) => [row.terminal_id, row]));
  const byId = new Map<string, TelemetryRow>();
  for (const terminal of registrations) {
    const row = liveById.get(terminal.id);
    if (row) {
      byId.set(terminal.id, {
        ...row,
        store_id: row.store_id ?? terminal.location_id,
        device_name: row.device_name ?? terminal.device_name,
        terminal_name: row.terminal_name ?? terminal.device_name,
        location_name: row.location_name ?? terminal.location_name,
        app_version: row.app_version ?? terminal.app_version,
        platform: row.platform ?? terminal.platform,
      });
      continue;
    }
    byId.set(terminal.id, {
      terminal_id: terminal.id,
      store_id: terminal.location_id,
      terminal_name: terminal.device_name,
      device_name: terminal.device_name,
      device_type: terminal.platform,
      location_name: terminal.location_name,
      session_status: "never_seen",
      last_heartbeat_at: null,
      staff_name: null,
      staff_role: null,
      db_mode: "unknown",
      connection_status: "offline",
      storage_engine: "unknown",
      pending_count: 0,
      conflict_count: 0,
      last_synced_at: terminal.last_sync_at,
      app_version: terminal.app_version,
      platform: terminal.platform,
      last_seen_at: terminal.last_seen_at ?? "",
    });
  }
  return [...byId.values()].sort((a, b) =>
    (b.last_heartbeat_at ?? b.last_seen_at ?? "").localeCompare(
      a.last_heartbeat_at ?? a.last_seen_at ?? "",
    ),
  );
}

export type TelemetryHistoryRow = {
  id: string;
  terminal_id: string | null;
  store_id: string | null;
  direction: string;
  table_name: string;
  records: number;
  status: string;
  error_message: string | null;
  created_at: string;
};

/** Existing central sync ledger, used as telemetry history. */
export async function listTelemetryHistory(limit = 100): Promise<TelemetryHistoryRow[]> {
  const { data, error } = await supabase
    .from("offline_sync_audit_log")
    .select("id,terminal_id,store_id,direction,table_name,records,status,error_message,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
  return (data ?? []) as unknown as TelemetryHistoryRow[];
}

/** How this machine presents itself, used when the activation predates naming. */
function isMobilePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Name shown to people; falls back through the identifiers we do have. */
export const deviceLabel = (row: TelemetryRow): string =>
  row.device_name?.trim() || row.terminal_name?.trim() || row.terminal_id.slice(0, 8);

export type Health = "online" | "stale" | "offline" | "unknown";

export const HEALTH_LABEL: Record<Health, string> = {
  online: "Online",
  stale: "Stale",
  offline: "Offline",
  unknown: "Unknown",
};

/**
 * Live health from the heartbeat itself, never from the status a till last
 * managed to write: an old row is Stale, then Offline, and a till that has
 * never reported is Unknown.
 */
export function health(row: TelemetryRow, now = Date.now()): Health {
  const beat = row.last_heartbeat_at ?? row.last_seen_at;
  const at = beat ? new Date(beat).getTime() : NaN;
  if (!beat || Number.isNaN(at)) return "unknown";
  const age = now - at;
  if (age > 15 * 60_000) return "offline";
  if (age > 2 * 60_000) return "stale";
  return row.connection_status === "offline" ? "offline" : "online";
}

/** A till that has not checked in for five minutes is treated as unreachable. */
export const isStale = (row: TelemetryRow, now = Date.now()): boolean =>
  health(row, now) !== "online";
