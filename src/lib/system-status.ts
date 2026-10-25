/** One online connection status shared by every client surface. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { effectiveDatabaseMode, subscribeDatabaseMode } from "@/core/local-db/db-mode";
import { observeLiveSnapshot } from "./observe-live-snapshot";
import { hasSupabaseConfig } from "./external-supabase-config";
import {
  connectivity,
  lastHealth,
  subscribeConnectivity,
  type Connectivity,
} from "@/core/activation/connection-health";
import { hasLocalSqlEngine } from "@/core/local-db/local-db";

export type StatusTone = "connecting" | "ok" | "busy" | "offline" | "error";

export type SystemStatus = {
  connectivity: Connectivity;
  tone: StatusTone;
  label: string;
  detail: string;
  checkedAt: string | null;
  credentialsInvalid: boolean;
  databaseMode: string;
  pending: number;
  conflicts: number;
  syncing: boolean;
  syncPhase: string;
  failed: number;
  syncEnabled: true;
  lastSyncAt: string | null;
  lastError: string | null;
  cloudConfigured: boolean;
  local: {
    connected: boolean;
    ready: boolean;
    inUse: boolean;
    server: string | null;
    database: string | null;
    lastReadAt: null;
    lastWriteAt: null;
    lastCheckedAt: string | null;
  };
};

export function describeStatus(input: {
  connectivity: Connectivity;
  credentialsInvalid?: boolean;
}): Pick<SystemStatus, "tone" | "label" | "detail"> {
  if (input.connectivity === "connecting") {
    return { tone: "connecting", label: "Connecting…", detail: "Checking the central database…" };
  }
  if (input.credentialsInvalid) {
    return {
      tone: "error",
      label: "Check credentials",
      detail: "The central database rejected this device's credentials.",
    };
  }
  if (input.connectivity === "offline") {
    return {
      tone: "offline",
      label: "Offline",
      detail: "The central database is unavailable. Work cannot be saved until it reconnects.",
    };
  }
  return {
    tone: "ok",
    label: "Online",
    detail: "Connected directly to the central database.",
  };
}

export function useSystemStatus(): SystemStatus {
  const [, force] = useState(0);
  const [desktopDatabase, setDesktopDatabase] = useState<Record<string, unknown> | null>(null);
  const [desktopSync, setDesktopSync] = useState<Record<string, unknown> | null>(null);
  const databaseMode = useSyncExternalStore(subscribeDatabaseMode, effectiveDatabaseMode, () => "online");
  useEffect(() => subscribeConnectivity(() => force((value) => value + 1)), []);
  useEffect(() => {
    if (!hasLocalSqlEngine()) return;
    const bridge = (
      window as unknown as {
        pos?: {
          database?: {
            getState(): Promise<Record<string, unknown>>;
            subscribe(cb: (value: Record<string, unknown>) => void): () => void;
          };
          sync?: {
            getStatus(): Promise<Record<string, unknown>>;
            subscribe(cb: (value: Record<string, unknown>) => void): () => void;
          };
        };
      }
    ).pos;
    const offDatabase = bridge?.database && observeLiveSnapshot(
      () => bridge.database!.getState(), callback => bridge.database!.subscribe(callback), setDesktopDatabase);
    const offSync = bridge?.sync && observeLiveSnapshot(
      () => bridge.sync!.getStatus(), callback => bridge.sync!.subscribe(callback), setDesktopSync);
    return () => {
      offDatabase?.();
      offSync?.();
    };
  }, []);

  const conn = connectivity();
  const health = lastHealth();
  const credentialsInvalid = desktopSync?.credentialsInvalid === true;
  const status = describeStatus({ connectivity: conn, credentialsInvalid });
  const desktop = hasLocalSqlEngine();
  const localConnected = desktop && desktopDatabase?.connected === true;
  const localReady = localConnected && desktopDatabase?.tradingReady === true;
  const localInUse = localConnected && databaseMode === "local";
  const profile = (desktopDatabase?.profile ?? null) as {
    server?: string;
    database?: string;
  } | null;
  const syncing =
    desktop &&
    (desktopSync?.running === true || (desktopSync?.running == null && ["pushing", "pulling"].includes(String(desktopSync?.phase))));
  const lastPushAt = typeof desktopSync?.lastPushAt === "string" ? desktopSync.lastPushAt : null;
  const lastPullAt = typeof desktopSync?.lastPullAt === "string" ? desktopSync.lastPullAt : null;
  const lastSyncAt =
    [lastPushAt, lastPullAt]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
  const syncError = typeof desktopSync?.lastError === "string" ? desktopSync.lastError : null;
  const syncPhase = typeof desktopSync?.phase === "string" ? desktopSync.phase : "idle";
  const desktopView = localInUse
    ? !localReady
      ? { tone: "connecting" as const, label: "Preparing local database", detail: "SQL Server is connected; store data is being prepared." }
      : syncing
      ? {
          tone: "busy" as const,
          label: "Synchronizing",
          detail: "Sending local changes and checking Supabase for updates.",
        }
      : localConnected && conn === "offline"
        ? {
            tone: "busy" as const,
            label: "Offline · local",
            detail:
              "SQL Server is connected. Cloud work will synchronize automatically when internet returns.",
          }
        : syncError
          ? {
              tone: "error" as const,
              label: "Sync needs attention",
              detail:
                "Local SQL Server remains available; automatic cloud synchronization will retry.",
            }
          : localConnected
            ? {
                tone: "ok" as const,
                label: "Local + cloud",
                detail: "SQL Server is active and Supabase synchronization runs automatically.",
              }
            : status
    : status;
  return {
    connectivity: conn,
    ...desktopView,
    checkedAt: health?.at ? new Date(health.at).toISOString() : null,
    credentialsInvalid,
    databaseMode: localInUse ? "Local SQL Server" : "Online Supabase",
    pending: Number(desktopSync?.pending ?? 0),
    conflicts: Number(desktopSync?.conflicts ?? 0),
    syncing,
    syncPhase,
    failed: Number(desktopSync?.failed ?? 0),
    syncEnabled: true,
    lastSyncAt,
    lastError: syncError,
    cloudConfigured: hasSupabaseConfig(),
    local: {
      connected: localConnected,
      ready: localReady,
      inUse: localInUse,
      server: profile?.server ?? null,
      database: profile?.database ?? null,
      lastReadAt: null,
      lastWriteAt: null,
      lastCheckedAt:
        typeof desktopDatabase?.lastCheckedAt === "string" ? desktopDatabase.lastCheckedAt : null,
    },
  };
}
