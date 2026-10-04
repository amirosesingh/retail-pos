/** One online connection status shared by every client surface. */
import { useEffect, useState } from "react";
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
    void bridge?.database?.getState().then(setDesktopDatabase);
    void bridge?.sync?.getStatus().then(setDesktopSync);
    const offDatabase = bridge?.database?.subscribe(setDesktopDatabase);
    const offSync = bridge?.sync?.subscribe(setDesktopSync);
    return () => {
      offDatabase?.();
      offSync?.();
    };
  }, []);

  const conn = connectivity();
  const health = lastHealth();
  const status = describeStatus({ connectivity: conn });
  const desktop = hasLocalSqlEngine();
  const localConnected = desktop && desktopDatabase?.connected === true;
  const profile = (desktopDatabase?.profile ?? null) as {
    server?: string;
    database?: string;
  } | null;
  const syncing =
    desktop &&
    (desktopSync?.running === true || (desktopSync?.phase != null && desktopSync.phase !== "idle"));
  const lastPushAt = typeof desktopSync?.lastPushAt === "string" ? desktopSync.lastPushAt : null;
  const lastPullAt = typeof desktopSync?.lastPullAt === "string" ? desktopSync.lastPullAt : null;
  const lastSyncAt =
    [lastPushAt, lastPullAt]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
  const syncError = typeof desktopSync?.lastError === "string" ? desktopSync.lastError : null;
  const syncPhase = typeof desktopSync?.phase === "string" ? desktopSync.phase : "idle";
  const desktopView = desktop
    ? syncing
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
    credentialsInvalid: false,
    databaseMode: localConnected ? "Local SQL Server + Supabase sync" : "Central database",
    pending: Number(desktopSync?.pending ?? 0),
    conflicts: Number(desktopSync?.conflicts ?? 0),
    syncing,
    syncPhase,
    failed: Number(desktopSync?.failed ?? 0),
    syncEnabled: true,
    lastSyncAt,
    lastError: syncError,
    cloudConfigured: conn !== "connecting",
    local: {
      connected: localConnected,
      server: profile?.server ?? null,
      database: profile?.database ?? null,
      lastReadAt: null,
      lastWriteAt: null,
      lastCheckedAt:
        typeof desktopDatabase?.lastCheckedAt === "string" ? desktopDatabase.lastCheckedAt : null,
    },
  };
}
