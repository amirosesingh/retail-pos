/** An overdue or superseded initial read must never publish a snapshot. */
export function dataReadIdentity(person: string | null | undefined, mode: string, branch: string | null | undefined): string | null {
  return person ? JSON.stringify([person, mode, (branch ?? "").trim().toLowerCase()]) : null;
}

/** A directory or healthy pool alone is not a loaded business snapshot. */
export function dataSnapshotReady(ready: boolean, signedIn: boolean, identity: string | null, snapshotIdentity: string | null): boolean {
  return ready && (!signedIn || (Boolean(identity) && identity === snapshotIdentity));
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
