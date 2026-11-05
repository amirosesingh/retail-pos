import { createRefreshQueue } from "./background-refresh";

/**
 * Keep settings hints received during bootstrap without racing its first read.
 * Each operator/branch identity owns a separate instance and stops it on change.
 */
export function createSettingsStartupRefresh(read: (canApply: () => boolean) => Promise<unknown>) {
  let ready = false;
  let stopped = false;
  let dirty = false;
  let inFlight = false;
  let generation = 0;
  const queue = createRefreshQueue(async () => {
    if (stopped) return;
    if (!ready) { dirty = true; return; }
    dirty = false;
    inFlight = true;
    const started = generation;
    try {
      await read(() => !stopped && ready && started === generation);
    } finally {
      inFlight = false;
    }
  });

  return {
    refresh: () => {
      if (stopped) return Promise.resolve();
      if (!ready) { dirty = true; return Promise.resolve(); }
      return queue.refresh();
    },
    setReady: (next: boolean) => {
      if (stopped || next === ready) return Promise.resolve();
      if (!next && inFlight) dirty = true;
      ready = next;
      generation += 1;
      return ready && dirty ? queue.refresh() : Promise.resolve();
    },
    stop: () => {
      stopped = true;
      ready = false;
      generation += 1;
      queue.stop();
    },
  };
}
