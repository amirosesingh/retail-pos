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
