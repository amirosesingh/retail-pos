import { createRefreshQueue, subscribeBackgroundRefresh } from "./background-refresh";
import { subscribeSettingsChange } from "./sync-engine";
import { hasSignedInIdentity } from "./session-presence";

/** Operational settings stay live outside Settings; hidden screens catch up on return. */
export function subscribeSettingsRefresh(
  read: () => Promise<unknown>,
  accept: (change: { table: string; reason: string }) => boolean = () => true,
  { initial = false } = {},
): () => void {
  const queue = createRefreshQueue(read);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wake = () => {
    if (document.visibilityState === "hidden" || !hasSignedInIdentity()) return;
    // Local SQL must remain usable without internet.
    void queue.refresh();
  };
  const offSettings = subscribeSettingsChange(change => {
    if (!accept(change) || timer !== undefined) return;
    timer = setTimeout(() => { timer = undefined; wake(); }, 100);
  });
  const offCatchup = subscribeBackgroundRefresh(wake, 60_000, true);
  if (initial) void queue.refresh();
  return () => {
    offSettings(); offCatchup(); queue.stop();
    if (timer !== undefined) clearTimeout(timer);
  };
}
