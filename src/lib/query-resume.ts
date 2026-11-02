import type { QueryClient } from "@tanstack/react-query";
import { isLiveQuery } from "./live-query-refresh";
/** A resume reuses fresh data; reconnect catches up after potentially missed events. */
export function refreshResumedQueries(client: QueryClient, reconnect: boolean) {
  // Live queries have one coordinator for native/browser lifecycle and commits.
  return client.refetchQueries({ type: "active", predicate: query => !isLiveQuery(query), ...(reconnect ? {} : { stale: true }) }, { cancelRefetch: false });
}
