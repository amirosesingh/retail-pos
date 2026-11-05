import { createRefreshQueue, subscribeBackgroundRefresh } from "./background-refresh";
import { subscribeSettingsChange } from "./sync-engine";
import { hasSignedInIdentity } from "./session-presence";

/** Operational settings stay live outside Settings; hidden screens catch up on return. */
export function subscribeSettingsRefresh(
  read: () => Promise<unknown>,
  accept: (change: { table: string; reason: string; storeId?: string | null }) => boolean = () => true,
  { initial = false, eventOnly = false } = {},
): (() => void) & { retry: () => Promise<void> } {
  const queue = createRefreshQueue(read);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  const wake = () => {
    if (document.visibilityState === "hidden" || !hasSignedInIdentity()) return;
    dirty = false;
    // Local SQL must remain usable without internet.
    void queue.refresh();
  };
  const offSettings = subscribeSettingsChange(change => {
    if (!accept(change)) return;
    dirty = true;
    if (timer !== undefined) return;
    timer = setTimeout(() => { timer = undefined; wake(); }, 100);
  });
  const catchupPending = () => { if (dirty) wake(); };
  if (eventOnly) document.addEventListener("visibilitychange", catchupPending);
  const offCatchup = eventOnly ? () => {} : subscribeBackgroundRefresh(wake, 60_000, true);
  if (initial) void queue.refresh();
  const stop = () => {
    offSettings(); offCatchup(); queue.stop();
    document.removeEventListener("visibilitychange", catchupPending);
    if (timer !== undefined) clearTimeout(timer);
  };
  return Object.assign(stop, { retry: queue.retry });
}
