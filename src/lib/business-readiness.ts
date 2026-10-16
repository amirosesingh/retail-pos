/** UI identity and the direct database bearer are separate during PIN login. */
export function businessReadsReady(authReady: boolean, signedIn: boolean, local: boolean, cloudUserId: string | null): boolean {
  return authReady && signedIn && (local || Boolean(cloudUserId));
}
