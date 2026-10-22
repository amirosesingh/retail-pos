/** A stale startup error may outlive vault hydration. Retry once per app launch,
 * never loop if a second configuration failure occurs after the retry. */
let attempted = false;
export function claimRestoredConnectionRetry(ready: boolean): boolean {
  if (!ready || attempted) return false;
  attempted = true;
  return true;
}
