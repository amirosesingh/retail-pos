import type { QueryClient } from "@tanstack/react-query";
/** A resume reuses fresh data; reconnect catches up after potentially missed events. */
export function refreshResumedQueries(client: QueryClient, reconnect: boolean) {
  return client.refetchQueries({ type: "active", ...(reconnect ? {} : { stale: true }) });
}
