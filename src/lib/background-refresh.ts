import { APP_RESUME_EVENT } from "@/core/activation/connection-health";
import { hasSignedInIdentity } from "./session-presence";

export const BACKGROUND_REFRESH_EVENT = "pos:background-refresh";

/** One read at a time; an event during a read requests one more pass. */
export function createRefreshQueue(read: () => Promise<unknown>, onError: (error: unknown) => void = () => {}) {
  let stopped = false;
  let running = false;
  let queued = false;
  const refresh = async () => {
    if (stopped) return;
    if (running) { queued = true; return; }
    running = true;
    do {
      queued = false;
      try { await read(); } catch (error) { if (!stopped) onError(error); }
    } while (queued && !stopped);
    running = false;
  };
  return { refresh, stop: () => { stopped = true; queued = false; } };
}

/** Payload-free hints only: readers retain their own SQL/RLS/branch predicates. */
export function requestBackgroundRefresh(): void {
  window.dispatchEvent(new Event(BACKGROUND_REFRESH_EVENT));
}

export function subscribeBackgroundRefresh(
  refresh: () => void,
  intervalMs = 60_000,
  allowOffline = false,
  includeLifecycle = true,
): () => void {
  const wake = () => {
    if (document.visibilityState === "hidden" || !hasSignedInIdentity()) return;
    if (!allowOffline && !navigator.onLine) return;
    refresh();
  };
  const timer = window.setInterval(wake, intervalMs);
  const events = includeLifecycle
    ? ["focus", "online", APP_RESUME_EVENT, BACKGROUND_REFRESH_EVENT]
    : [BACKGROUND_REFRESH_EVENT];
  for (const event of events) window.addEventListener(event, wake);
  if (includeLifecycle) document.addEventListener("visibilitychange", wake);
  return () => {
    window.clearInterval(timer);
    for (const event of events) window.removeEventListener(event, wake);
    if (includeLifecycle) document.removeEventListener("visibilitychange", wake);
  };
}
