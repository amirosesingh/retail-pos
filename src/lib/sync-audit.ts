/**
 * Sync audit ledger — one row per sync operation, readable in
 * Settings → Data Sync & Audit.
 *
 * On the desktop shell the rows live in the embedded local database so they
 * survive a cleared browser cache; in the browser they fall back to
 * localStorage. Both are capped so the ledger can never grow without bound.
 */
import { readBusinessValue, writeBusinessValue } from "./business-storage";


export type SyncDirection = "push" | "pull" | "mirror" | "system";
export type SyncAuditStatus = "success" | "failed" | "skipped";

export type SyncAuditRow = {
  id: string;
  at: string;
  direction: SyncDirection;
  entity: string;
  record_id?: string | null;
  records: number;
  status: SyncAuditStatus;
  error?: string | null;
};

type Bridge = {
  localAuditLog?: (entry: Record<string, unknown>) => Promise<{ ok: boolean }>;
  localAuditList?: (limit?: number) => Promise<{ ok: boolean; rows?: SyncAuditRow[] }>;
  localAuditClear?: () => Promise<{ ok: boolean }>;
  localInfo?: () => Promise<{
    ok: boolean;
    engine?: string;
    path?: string;
    counts?: Record<string, number>;
    pending?: { total: number; byEntity: Record<string, number> };
  }>;
  localMirror?: (entity: string, rows: unknown[]) => Promise<{ ok: boolean; written?: number }>;
};

const bridge = (): Bridge | null =>
  typeof window === "undefined" ? null : ((window as unknown as { pos?: Bridge }).pos ?? null);

const KEY = "pos.sync.audit";
const LIMIT = 300;
const MAX_SERIALIZED_CHARS = 256_000;
const MAX_ERROR_CHARS = 1_000;

const listeners = new Set<() => void>();

export function subscribeSyncAudit(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const announce = () => {
  for (const l of listeners) l();
};

function readLocal(): SyncAuditRow[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(readBusinessValue(KEY) ?? "[]") as SyncAuditRow[];
  } catch {
    return [];
  }
}

function writeLocal(rows: SyncAuditRow[]) {
  if (typeof window === "undefined") return;
  let kept = rows.slice(0, LIMIT).map((row) => ({
    ...row,
    entity: String(row.entity ?? "").slice(0, 160),
    record_id: row.record_id == null ? null : String(row.record_id).slice(0, 256),
    error: row.error == null ? null : String(row.error).slice(0, MAX_ERROR_CHARS),
  }));
  // Count and byte bounds are both required: a few large error strings can
  // exceed Web Storage long before the row limit is reached. If the origin is
  // already near its quota, progressively retain fewer recent rows. Auditing
  // is best-effort and must never reject the synchronization promise.
  while (kept.length) {
    let serialized = JSON.stringify(kept);
    while (serialized.length > MAX_SERIALIZED_CHARS && kept.length > 1) {
      kept = kept.slice(0, Math.max(1, Math.floor(kept.length / 2)));
      serialized = JSON.stringify(kept);
    }
    try {
      writeBusinessValue(KEY, serialized);
      return;
    } catch {
      kept = kept.slice(0, Math.floor(kept.length / 2));
    }
  }
  try {
    writeBusinessValue(KEY, "[]");
  } catch {
    // The origin is completely full. The desktop ledger or future writes can
    // recover after storage is cleared; the active sync must still complete.
  }
}

/** Record one sync operation. Never throws — auditing must not break a sale. */
export function recordSync(entry: {
  direction: SyncDirection;
  entity: string;
  records?: number;
  status: SyncAuditStatus;
  recordId?: string | null;
  error?: string | null;
}) {
  const row: SyncAuditRow = {
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
    at: new Date().toISOString(),
    direction: entry.direction,
    entity: entry.entity,
    record_id: entry.recordId ?? null,
    records: entry.records ?? 0,
    status: entry.status,
    error: entry.error ?? null,
  };
  writeLocal([row, ...readLocal()]);
  void bridge()
    ?.localAuditLog?.({ ...entry, recordId: entry.recordId ?? null })
    .catch(() => {});
  announce();
  return row;
}

/** Newest first. Desktop rows win when the shell has a ledger of its own. */
export async function listSyncAudit(limit = 200): Promise<SyncAuditRow[]> {
  const shell = bridge();
  if (shell?.localAuditList) {
    try {
      const res = await shell.localAuditList(limit);
      if (res.ok && res.rows?.length) return res.rows;
    } catch {
      /* fall through to the browser copy */
    }
  }
  return readLocal().slice(0, limit);
}

export async function clearSyncAudit() {
  writeLocal([]);
  await bridge()?.localAuditClear?.().catch(() => {});
  announce();
}

export type LocalEngineInfo = {
  engine: string;
  path?: string;
  counts: Record<string, number>;
};

/** Embedded database telemetry, or null in a plain browser. */
export async function localEngineInfo(): Promise<LocalEngineInfo | null> {
  const shell = bridge();
  if (!shell?.localInfo) return null;
  try {
    const res = await shell.localInfo();
    if (!res.ok) return null;
    return {
      engine: res.engine ?? "unknown",
      path: res.path,
      counts: res.counts ?? {},
    };
  } catch {
    return null;
  }
}

/** Mirror cloud rows into the embedded database (server-wins for catalogue). */
export async function mirrorToLocal(entity: string, rows: unknown[]): Promise<number> {
  const shell = bridge();
  if (!shell?.localMirror || !rows.length) return 0;
  try {
    const res = await shell.localMirror(entity, rows);
    return res.written ?? 0;
  } catch {
    return 0;
  }
}
