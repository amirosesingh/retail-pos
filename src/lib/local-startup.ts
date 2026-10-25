/** Local readiness releases startup UI only; it never grants a user permission. */
export type LocalStartupState = { state?: string; enabled?: boolean; configured?: boolean; connected?: boolean; tradingReady?: boolean };
export function canStartLocally(input: {
  windows: boolean;
  management: boolean;
  tokenId?: string;
  branchId?: string | null;
  database: LocalStartupState | null;
}): boolean {
  const db = input.database;
  return input.windows && !input.management && Boolean(input.tokenId && input.branchId) &&
    db?.enabled === true && db.configured === true && db.connected === true && db.tradingReady === true;
}

export function observeLocalStartup(
  database: { getState(): Promise<LocalStartupState>; subscribe?: (cb: (state: LocalStartupState) => void) => () => void },
  update: (state: LocalStartupState | null) => void,
): () => void {
  let active = true;
  let revision = 0;
  const off = database.subscribe?.(state => { revision++; if (active) update(state); });
  const initialRevision = revision;
  void database.getState().then(state => {
    if (active && revision === initialRevision) update(state);
  }, () => { if (active && revision === initialRevision) update(null); });
  return () => { active = false; off?.(); };
}

/** Cached identities must still pass their ordinary session checks. */
export function localStartupAuthReady(localReady: boolean, hasCloudIdentity: boolean, hasTerminalUser: boolean, verifiedLocalPin: boolean): boolean {
  return localReady && ((!hasCloudIdentity && !hasTerminalUser) || (hasTerminalUser && verifiedLocalPin));
}
