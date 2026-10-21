import { createRefreshQueue, subscribeBackgroundRefresh } from "./background-refresh";
import { subscribeDataChange } from "./sync-engine";
import { hasSignedInIdentity } from "./session-presence";

/** Reuses the app's change feed; no per-page Realtime channels or storage. */
export function subscribePageDataRefresh(
  read: () => Promise<unknown>,
  tables: readonly string[],
  { intervalMs = 300_000, allowOffline = false, initial = false } = {},
): () => void {
  const queue = createRefreshQueue(read);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const offData = subscribeDataChange(change => {
    if (!tables.includes(change.table) || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (document.visibilityState === "hidden" || !hasSignedInIdentity()) return;
      if (!allowOffline && !navigator.onLine) return;
      void queue.refresh();
    }, 100);
  });
  const offCatchup = subscribeBackgroundRefresh(() => void queue.refresh(), intervalMs, allowOffline);
  if (initial) void queue.refresh();
  return () => {
    offData(); offCatchup(); queue.stop();
    if (timer !== undefined) clearTimeout(timer);
  };
}
