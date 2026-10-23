/** UI identity and the direct database bearer are separate during PIN login. */
export function businessReadsReady(authReady: boolean, signedIn: boolean, local: boolean, cloudUserId: string | null, verifiedCloudSession: boolean): boolean {
  return authReady && signedIn && (local || (Boolean(cloudUserId) && verifiedCloudSession));
}

/** Secondary transfer reads must wait for this identity's initial backend snapshot. */
export function transferReadsReady(readsReady: boolean, phase: string, identity: string | null, snapshotIdentity: string | null, storeId: string | null): boolean {
  return readsReady && phase === "ready" && Boolean(identity) && snapshotIdentity === identity && Boolean(storeId);
}
