/** Coalesce change notifications and discard results after logout/user switching. */
export function createPermissionRefresh<T>(options: {
  read: () => Promise<T>;
  apply: (result: T) => Promise<void> | void;
  current: () => boolean;
}) {
  let running = false;
  let queued = false;
  let stopped = false;
  return {
    async refresh() {
      if (stopped || !options.current()) return;
      if (running) { queued = true; return; }
      running = true;
      try {
        do {
          queued = false;
          try {
            const result = await options.read();
            if (!stopped && options.current()) await options.apply(result);
          } catch { /* Connectivity loss preserves the last verified permissions. */ }
        } while (queued && !stopped && options.current());
      } finally { running = false; }
    },
    stop() { stopped = true; queued = false; },
  };
}
