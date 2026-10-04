/** Shared mutation shapes and transient sync indicators.
 * Business payloads are never queued in the renderer. Windows synchronization
 * is owned by Electron main and reads payloads from SQL Server business tables.
 */
import { BACKOFF_FACTOR, BASE_BACKOFF_MS, syncConfig } from "./sync-config";

export type Row = Record<string, unknown>;
export type SyncOp =
  | { kind: "insert"; table: string; rows: Row[] }
  | { kind: "upsert"; table: string; rows: Row[]; onConflict?: string }
  | {
      kind: "update";
      table: string;
      values: Row;
      match: Record<string, unknown>;
      /** Abort the surrounding local aggregate unless exactly one row matched. */
      requireMatch?: boolean;
    }
  | { kind: "delete"; table: string; match: Record<string, unknown> }
  | { kind: "rpc"; table: string; fn: string; args: Row };

export type QueuedOp = {
  id: string; context: string; op: SyncOp; createdAt: string; attempts: number;
  lastError?: string; status?: "pending" | "synced" | "failed"; quarantined?: boolean;
  branchId?: string | null; terminalId?: string; seq?: number; occurredAt?: string;
  lastAttemptAt?: string; baseVersions?: Record<string, number>;
};
export type QueueView = QueuedOp & {
  state: "waiting" | "retrying" | "refused";
  reason: string | null;
  nextAttemptAt: string | null;
};

type Listener = () => void;
const listeners = new Set<Listener>();
let enabled = true;
let syncedAt: string | null = null;
const notify = () => listeners.forEach((listener) => listener());

export const maxAttempts = () => syncConfig().maxAttempts;
export const maxBackoffMs = () => syncConfig().maxBackoffMs;
export function backoffMs(entry: Pick<QueuedOp, "id" | "attempts">): number {
  if (entry.attempts <= 0) return 0;
  const base = Math.min(maxBackoffMs(), BASE_BACKOFF_MS * BACKOFF_FACTOR ** (entry.attempts - 1));
  let hash = 0;
  for (const char of entry.id) hash = (hash * 31 + char.charCodeAt(0)) % 1000;
  return base + Math.round((hash / 1000) * Math.min(base, 5000));
}
export const nextAttemptDue = (entry: QueuedOp) =>
  new Date(entry.lastAttemptAt ?? entry.createdAt).getTime() + backoffMs(entry);

export function subscribeOutbox(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const listQueue = (): QueuedOp[] => [];
export const queueView = (): QueueView[] => [];
export const pendingCount = () => 0;
export const conflictCount = () => 0;

/** Compatibility return for old callers; the payload is deliberately not stored. */
export function enqueue(context: string, op: SyncOp): QueuedOp {
  return { id: crypto.randomUUID(), context, op, createdAt: new Date().toISOString(), attempts: 0, status: "pending" };
}
export const persisted = (_ids: string[]) => false;
export const resolveOp = (_id: string) => undefined;
export const failOp = (_id: string, _message: string) => undefined;
export const refuseOp = (_id: string, _message: string) => undefined;
export const retryQuarantined = () => undefined;
export const discardQuarantined = () => undefined;
export const retryOp = (_id: string) => undefined;
export const discardOp = (_id: string) => undefined;

export const isOnlineSyncEnabled = () => enabled;
export function setOnlineSyncEnabled(on: boolean) { enabled = on; notify(); }
export const lastSyncedAt = () => syncedAt;
export function markSynced() { syncedAt = new Date().toISOString(); notify(); }
export const isOnline = () => typeof window === "undefined" || window.navigator.onLine;
