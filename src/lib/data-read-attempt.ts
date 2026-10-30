import { isTransientReadError } from "./read-retry";

/** An overdue or superseded initial read must never publish a snapshot. */
export function dataReadIdentity(person: string | null | undefined, mode: string, branch: string | null | undefined): string | null {
  return person ? JSON.stringify([person, mode, (branch ?? "").trim().toLowerCase()]) : null;
}

/** A directory or healthy pool alone is not a loaded business snapshot. */
export function dataSnapshotReady(ready: boolean, signedIn: boolean, identity: string | null, snapshotIdentity: string | null): boolean {
  return ready && (!signedIn || (Boolean(identity) && identity === snapshotIdentity));
}

export function snapshotRefreshReady(readsReady: boolean, phase: string, identity: string | null, snapshotIdentity: string | null): boolean {
  return readsReady && phase === "ready" && Boolean(identity) && identity === snapshotIdentity;
}

export function needsBootstrapBranchResolution(mode: string, branch: string | null | undefined, haveDirectoryTask: boolean): boolean {
  return mode === "online" && !branch && haveDirectoryTask;
}

/** A public heartbeat is only a recovery hint, never proof business reads work. */
export function createBootstrapRecovery(now: () => number = Date.now) {
  let failure: { generation: number; at: number } | null = null;
  let automaticAttempts = 0;
  return {
    reset() { failure = null; automaticAttempts = 0; },
    failed(error: unknown, generation: number) {
      // DOMException TimeoutError has numeric code 23, which is not a Postgres
      // integrity code. Recognize the actual bounded-read exception separately.
      const timeout = error instanceof DOMException && error.name === "TimeoutError";
      const response = error as { code?: unknown; status?: unknown } | null;
      const status = Number(response?.status ?? 0);
      // SDK PostgrestError objects omit HTTP status. These four codes describe
      // connection/pool/schema-cache infrastructure, never an access grant.
      const infrastructure = /^PGRST00[0-3]$/.test(String(response?.code ?? "")) &&
        !(status >= 400 && status < 500 && status !== 408 && status !== 429);
      failure = timeout || infrastructure || isTransientReadError(error) ? { generation, at: now() } : null;
    },
    healthy(report: { cloud: boolean; at: number }, generation: number): boolean {
      if (!failure || !report.cloud || failure.generation !== generation ||
          report.at <= failure.at || now() - failure.at < 30_000 || automaticAttempts >= 2) return false;
      // Consume before the caller starts a read: duplicate health publications
      // cannot schedule another attempt. Two failures require manual recovery.
      failure = null;
      automaticAttempts++;
      return true;
    },
  };
}

/** Focus must not replace a reconnect's shorter catch-up threshold. */
export function createReconnectUrgency() {
  let reconnect = false;
  return {
    note(urgent: boolean) { reconnect ||= urgent; },
    take() { const urgent = reconnect; reconnect = false; return urgent; },
  };
}

/** Share only simultaneous reads of the exact scope; completed results are never cached. */
export function createScopedReadFlight<T>() {
  const pending = new Map<string, Promise<T>>();
  return {
    read(key: string, load: () => Promise<T>): Promise<T> {
      const existing = pending.get(key);
      if (existing) return existing;
      const next = Promise.resolve().then(load);
      pending.set(key, next);
      const clear = () => { if (pending.get(key) === next) pending.delete(key); };
      void next.then(clear, clear);
      return next;
    },
  };
}

export function beginDataReadAttempt(generation: { current: number }) {
  const started = ++generation.current;
  let active = true;
  return {
    current: () => active && generation.current === started,
    cancel: () => { active = false; },
    invalidate: () => {
      active = false;
      if (generation.current === started) generation.current++;
    },
  };
}
